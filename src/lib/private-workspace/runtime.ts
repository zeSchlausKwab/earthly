import type { PendingWorkspaceJoin, StoredWorkspace } from './storage'
import type { PrivateWorkspaceService, WorkspaceJoinRequest } from './service'

export type PrivateWorkspaceSyncState = 'idle' | 'syncing' | 'current' | 'offline'

export interface PrivateWorkspaceSnapshot {
	loaded: boolean
	workspaces: StoredWorkspace[]
	pendingJoins: PendingWorkspaceJoin[]
	syncByWorkspace: Readonly<Record<string, PrivateWorkspaceSyncState>>
}

const EMPTY_SNAPSHOT: PrivateWorkspaceSnapshot = {
	loaded: false,
	workspaces: [],
	pendingJoins: [],
	syncByWorkspace: {},
}

/**
 * Account-scoped owner of the private workspace service.
 *
 * MLS state transitions must be applied in order. This runtime serializes every
 * coordinator operation, retains one ContextVM delivery identity, and publishes
 * local snapshots to every mounted consumer (sidebar, map and editor).
 */
export class PrivateWorkspaceRuntime {
	private snapshot = EMPTY_SNAPSHOT
	private readonly listeners = new Set<() => void>()
	private queue: Promise<void> = Promise.resolve()
	private readonly pendingSyncs = new Set<string>()
	private readonly watches = new Map<
		string,
		{
			count: number
			failures: number
			quietPolls: number
			timer?: ReturnType<typeof setTimeout>
		}
	>()

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
	 * Keep a selected group current while it is visible. Multiple React consumers
	 * share one timer; automatic failures are represented as offline and retried.
	 */
	watchWorkspace(workspaceId: string): () => void {
		const existing = this.watches.get(workspaceId)
		if (existing) {
			existing.count += 1
			return () => this.unwatchWorkspace(workspaceId)
		}

		this.watches.set(workspaceId, { count: 1, failures: 0, quietPolls: 0 })
		void this.pollWorkspace(workspaceId)
		return () => this.unwatchWorkspace(workspaceId)
	}

	private async pollWorkspace(workspaceId: string): Promise<void> {
		const changed = await this.syncWorkspace(workspaceId, false)
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		const offline = this.snapshot.syncByWorkspace[workspaceId] === 'offline'
		watch.failures = offline ? watch.failures + 1 : 0
		watch.quietPolls = offline || changed ? 0 : Math.min(watch.quietPolls + 1, 2)
		const delay = offline
			? Math.min(30_000, this.syncIntervalMs * 2 ** Math.min(watch.failures, 5))
			: this.syncIntervalMs * 2 ** watch.quietPolls
		watch.timer = setTimeout(() => void this.pollWorkspace(workspaceId), delay)
	}

	private unwatchWorkspace(workspaceId: string): void {
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		watch.count -= 1
		if (watch.count > 0) return
		if (watch.timer) clearTimeout(watch.timer)
		this.watches.delete(workspaceId)
	}

	async dispose(): Promise<void> {
		for (const watch of this.watches.values()) {
			if (watch.timer) clearTimeout(watch.timer)
		}
		this.watches.clear()
		await this.queue
		await this.service.dispose()
	}
}
