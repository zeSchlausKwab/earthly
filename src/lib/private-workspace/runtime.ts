import type { CoordinatorMessage, CoordinatorMessageStreamSubscription } from './contracts'
import { CordnUnsupportedStreamingError } from './coordinator'
import type { PendingWorkspaceJoin, StoredWorkspace } from './storage'
import type { PrivateWorkspaceService, WorkspaceJoinRequest } from './service'

export type PrivateWorkspaceSyncState = 'idle' | 'syncing' | 'current' | 'offline'
export type PrivateWorkspaceTransportMode = 'streaming' | 'polling'

export interface PrivateWorkspaceSnapshot {
	loaded: boolean
	workspaces: StoredWorkspace[]
	pendingJoins: PendingWorkspaceJoin[]
	syncByWorkspace: Readonly<Record<string, PrivateWorkspaceSyncState>>
	transportByWorkspace?: Readonly<Record<string, PrivateWorkspaceTransportMode>>
}

const EMPTY_SNAPSHOT: PrivateWorkspaceSnapshot = {
	loaded: false,
	workspaces: [],
	pendingJoins: [],
	syncByWorkspace: {},
	transportByWorkspace: {},
}

const AUTO_APPROVE_POLL_INTERVAL_MS = 10_000

interface WorkspaceWatch {
	count: number
	failures: number
	quietPolls: number
	timer?: ReturnType<typeof setTimeout>
	autoApproveTimer?: ReturnType<typeof setInterval>
	stream?: CoordinatorMessageStreamSubscription
	streamingUnsupported: boolean
	openingStream: boolean
}

/**
 * Account-scoped owner of the private workspace service.
 *
 * MLS state transitions must be applied in order. This runtime serializes every
 * coordinator operation, retains one ContextVM delivery identity, streams live
 * Cordn v0.5 updates over `msg_sub_many` with seamless fallback to adaptive
 * polling on Cordn v0.4 servers, and publishes local snapshots to every mounted
 * consumer (sidebar, map and editor).
 */
export class PrivateWorkspaceRuntime {
	private snapshot = EMPTY_SNAPSHOT
	private readonly listeners = new Set<() => void>()
	private queue: Promise<void> = Promise.resolve()
	private readonly pendingSyncs = new Set<string>()
	private readonly watches = new Map<string, WorkspaceWatch>()

	constructor(
		readonly service: PrivateWorkspaceService,
		private readonly syncIntervalMs = 1_500,
	) {}

	getSnapshot = (): PrivateWorkspaceSnapshot => this.snapshot

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(next: PrivateWorkspaceSnapshot): void {
		this.snapshot = next
		for (const listener of this.listeners) listener()
	}

	private patch(next: Partial<PrivateWorkspaceSnapshot>): void {
		this.emit({ ...this.snapshot, ...next })
	}

	private setSyncState(workspaceId: string, state: PrivateWorkspaceSyncState): void {
		if (this.snapshot.syncByWorkspace[workspaceId] === state) return
		this.patch({
			syncByWorkspace: { ...this.snapshot.syncByWorkspace, [workspaceId]: state },
		})
	}

	private setTransportMode(
		workspaceId: string,
		mode: PrivateWorkspaceTransportMode | undefined,
	): void {
		const current = this.snapshot.transportByWorkspace ?? {}
		if (current[workspaceId] === mode) return
		const next = { ...current }
		if (mode === undefined) delete next[workspaceId]
		else next[workspaceId] = mode
		this.patch({ transportByWorkspace: next })
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const task = this.queue.then(operation, operation)
		this.queue = task.then(
			() => undefined,
			() => undefined,
		)
		return task
	}

	private async reload(): Promise<void> {
		const [workspaces, pendingJoins] = await Promise.all([
			this.service.listWorkspaces(),
			this.service.listPendingJoins(),
		])
		this.patch({ loaded: true, workspaces, pendingJoins })
	}

	refresh(): Promise<void> {
		return this.enqueue(() => this.reload())
	}

	/** Run a serialized mutation and immediately publish the resulting local state. */
	perform<T>(operation: (service: PrivateWorkspaceService) => Promise<T>): Promise<T> {
		return this.enqueue(async () => {
			try {
				const result = await operation(this.service)
				await this.reload()
				return result
			} catch (error) {
				await this.service.resetConnections()
				throw error
			}
		})
	}

	/**
	 * Sign a shareable invitation from persisted group coordinates.
	 *
	 * This intentionally bypasses the MLS mutation queue: invitation creation is
	 * read-only and must remain available when a background coordinator sync is
	 * slow or offline.
	 */
	createInvitation(workspaceId: string): Promise<string> {
		return this.service.createInvitation(workspaceId)
	}

	/**
	 * Read pending join requests without waiting behind MLS mutations or the
	 * selected workspace's background message sync.
	 */
	async fetchJoinRequests(workspaceId: string): Promise<WorkspaceJoinRequest[]> {
		try {
			return await this.service.fetchJoinRequests(workspaceId)
		} catch (error) {
			await this.service.resetConnections()
			throw error
		}
	}

	async syncWorkspace(workspaceId: string, reportFailure = true): Promise<boolean> {
		if (this.pendingSyncs.has(workspaceId)) return false
		this.pendingSyncs.add(workspaceId)
		if (reportFailure) this.setSyncState(workspaceId, 'syncing')
		try {
			const changed = await this.enqueue(async () => {
				try {
					const result = await this.service.syncWorkspaceResult(workspaceId)
					if (result.changed) await this.reload()
					return result.changed
				} catch (error) {
					await this.service.resetConnections()
					throw error
				}
			})
			this.setSyncState(workspaceId, 'current')
			return changed
		} catch (error) {
			this.setSyncState(workspaceId, 'offline')
			if (reportFailure) throw error
			return false
		} finally {
			this.pendingSyncs.delete(workspaceId)
		}
	}

	/**
	 * Ingest one live streamed coordinator message through the shared serialized
	 * MLS ingestion queue.
	 */
	ingestStreamedMessage(workspaceId: string, message: CoordinatorMessage): Promise<boolean> {
		return this.enqueue(async () => {
			if (typeof this.service.ingestStreamedMessage !== 'function') {
				const fallback = await this.service.syncWorkspaceResult(workspaceId)
				if (fallback.changed) await this.reload()
				this.setSyncState(workspaceId, 'current')
				return fallback.changed
			}
			const result = await this.service.ingestStreamedMessage(workspaceId, message)
			if (result.changed) await this.reload()
			this.setSyncState(workspaceId, 'current')
			return result.changed
		})
	}

	/**
	 * Keep a selected group current while it is visible. Multiple React consumers
	 * share one stream/timer. On Cordn v0.5 coordinators, live `msg_sub_many`
	 * push frames feed directly into the serialized ingestion queue; on Cordn v0.4
	 * coordinators, the watch falls back seamlessly to adaptive 1.5s polling.
	 */
	watchWorkspace(workspaceId: string): () => void {
		const existing = this.watches.get(workspaceId)
		if (existing) {
			existing.count += 1
			return () => this.unwatchWorkspace(workspaceId)
		}

		const watch: WorkspaceWatch = {
			count: 1,
			failures: 0,
			quietPolls: 0,
			streamingUnsupported: typeof this.service.openWorkspaceStream !== 'function',
			openingStream: false,
		}
		this.watches.set(workspaceId, watch)

		if (typeof this.service.pollAndAutoApproveJoinRequests === 'function') {
			watch.autoApproveTimer = setInterval(() => {
				void this.runAutoApproveCheck(workspaceId)
			}, AUTO_APPROVE_POLL_INTERVAL_MS)
		}

		void this.startWatchLoop(workspaceId)
		return () => this.unwatchWorkspace(workspaceId)
	}

	private async runAutoApproveCheck(workspaceId: string): Promise<void> {
		const current = this.snapshot.workspaces.find((ws) => ws.workspaceId === workspaceId)
		if (
			!current?.autoApproveJoins ||
			current.role !== 'administrator' ||
			current.status !== 'active'
		) {
			return
		}
		try {
			await this.enqueue(async () => {
				const result = await this.service.pollAndAutoApproveJoinRequests(workspaceId)
				if (result.approved.length > 0) await this.reload()
			})
		} catch {
			// Background auto-approve failures retry on the next tick.
		}
	}

	private async startWatchLoop(workspaceId: string): Promise<void> {
		const watch = this.watches.get(workspaceId)
		if (!watch) return

		const changed = await this.syncWorkspace(workspaceId, false)
		const afterSyncWatch = this.watches.get(workspaceId)
		if (!afterSyncWatch) return

		const offline = this.snapshot.syncByWorkspace[workspaceId] === 'offline'
		if (!offline && !afterSyncWatch.streamingUnsupported) {
			const streamed = await this.tryOpenStream(workspaceId)
			if (streamed) return
		}

		const stillWatched = this.watches.get(workspaceId)
		if (!stillWatched) return
		this.setTransportMode(workspaceId, 'polling')
		this.scheduleNextPoll(workspaceId, changed, offline)
	}

	private async tryOpenStream(workspaceId: string): Promise<boolean> {
		const watch = this.watches.get(workspaceId)
		if (
			!watch ||
			watch.streamingUnsupported ||
			watch.stream ||
			watch.openingStream ||
			typeof this.service.openWorkspaceStream !== 'function'
		) {
			return false
		}
		watch.openingStream = true
		try {
			const subscription = await this.service.openWorkspaceStream(workspaceId, {
				onMessage: async (message) => {
					if (!this.watches.has(workspaceId)) return
					await this.ingestStreamedMessage(workspaceId, message)
				},
				onError: (error) => {
					const activeWatch = this.watches.get(workspaceId)
					if (!activeWatch) return
					activeWatch.stream = undefined
					if (error instanceof CordnUnsupportedStreamingError) {
						activeWatch.streamingUnsupported = true
						this.setTransportMode(workspaceId, 'polling')
						this.scheduleNextPoll(workspaceId, false, false)
						return
					}
					this.setSyncState(workspaceId, 'offline')
					this.setTransportMode(workspaceId, 'polling')
					this.scheduleStreamReconnect(workspaceId)
				},
				onClose: () => {
					const activeWatch = this.watches.get(workspaceId)
					if (!activeWatch) return
					if (activeWatch.stream) {
						activeWatch.stream = undefined
						if (activeWatch.streamingUnsupported) {
							this.setTransportMode(workspaceId, 'polling')
							this.scheduleNextPoll(workspaceId, false, false)
						} else {
							this.scheduleStreamReconnect(workspaceId)
						}
					}
				},
			})

			const latestWatch = this.watches.get(workspaceId)
			if (!latestWatch) {
				await subscription.close('unwatched').catch(() => undefined)
				return false
			}
			latestWatch.stream = subscription
			latestWatch.failures = 0
			latestWatch.quietPolls = 0
			this.setTransportMode(workspaceId, 'streaming')
			this.setSyncState(workspaceId, 'current')
			return true
		} catch (error) {
			const latestWatch = this.watches.get(workspaceId)
			if (!latestWatch) return false
			if (error instanceof CordnUnsupportedStreamingError) {
				latestWatch.streamingUnsupported = true
				this.setTransportMode(workspaceId, 'polling')
				return false
			}
			this.setSyncState(workspaceId, 'offline')
			this.setTransportMode(workspaceId, 'polling')
			return false
		} finally {
			const latestWatch = this.watches.get(workspaceId)
			if (latestWatch) latestWatch.openingStream = false
		}
	}

	private scheduleStreamReconnect(workspaceId: string): void {
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		if (watch.timer) clearTimeout(watch.timer)
		watch.failures += 1
		const delay = Math.min(30_000, this.syncIntervalMs * 2 ** Math.min(watch.failures, 5))
		watch.timer = setTimeout(() => {
			watch.timer = undefined
			void this.startWatchLoop(workspaceId)
		}, delay)
	}

	private scheduleNextPoll(workspaceId: string, changed: boolean, offline: boolean): void {
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		if (watch.timer) clearTimeout(watch.timer)
		watch.failures = offline ? watch.failures + 1 : 0
		watch.quietPolls = offline || changed ? 0 : Math.min(watch.quietPolls + 1, 2)
		const delay = offline
			? Math.min(30_000, this.syncIntervalMs * 2 ** Math.min(watch.failures, 5))
			: this.syncIntervalMs * 2 ** watch.quietPolls
		watch.timer = setTimeout(() => {
			watch.timer = undefined
			void this.pollWorkspace(workspaceId)
		}, delay)
	}

	private async pollWorkspace(workspaceId: string): Promise<void> {
		const watch = this.watches.get(workspaceId)
		if (!watch || watch.stream) return
		const changed = await this.syncWorkspace(workspaceId, false)
		const nextWatch = this.watches.get(workspaceId)
		if (!nextWatch || nextWatch.stream) return
		const offline = this.snapshot.syncByWorkspace[workspaceId] === 'offline'
		if (!offline && !nextWatch.streamingUnsupported) {
			const streamed = await this.tryOpenStream(workspaceId)
			if (streamed) return
		}
		this.scheduleNextPoll(workspaceId, changed, offline)
	}

	private unwatchWorkspace(workspaceId: string): void {
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		watch.count -= 1
		if (watch.count > 0) return
		if (watch.timer) clearTimeout(watch.timer)
		if (watch.autoApproveTimer) clearInterval(watch.autoApproveTimer)
		const stream = watch.stream
		watch.stream = undefined
		this.watches.delete(workspaceId)
		this.setTransportMode(workspaceId, undefined)
		if (stream) void stream.close('unwatch').catch(() => undefined)
	}

	async dispose(): Promise<void> {
		const streams: CoordinatorMessageStreamSubscription[] = []
		for (const watch of this.watches.values()) {
			if (watch.timer) clearTimeout(watch.timer)
			if (watch.autoApproveTimer) clearInterval(watch.autoApproveTimer)
			if (watch.stream) streams.push(watch.stream)
		}
		this.watches.clear()
		await Promise.allSettled(streams.map((stream) => stream.close('dispose')))
		await this.queue
		await this.service.dispose()
	}
}
