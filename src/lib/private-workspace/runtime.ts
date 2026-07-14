import type { PendingWorkspaceJoin, StoredWorkspace } from './storage'
import type { PrivateWorkspaceService } from './service'

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
		{ count: number; failures: number; timer?: ReturnType<typeof setTimeout> }
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

	async syncWorkspace(workspaceId: string, reportFailure = true): Promise<void> {
		if (this.pendingSyncs.has(workspaceId)) return
		this.pendingSyncs.add(workspaceId)
		this.patch({
			syncByWorkspace: { ...this.snapshot.syncByWorkspace, [workspaceId]: 'syncing' },
		})
		try {
			await this.enqueue(async () => {
				try {
					await this.service.syncWorkspace(workspaceId)
					await this.reload()
				} catch (error) {
					await this.service.resetConnections()
					throw error
				}
			})
			this.patch({
				syncByWorkspace: { ...this.snapshot.syncByWorkspace, [workspaceId]: 'current' },
			})
		} catch (error) {
			this.patch({
				syncByWorkspace: { ...this.snapshot.syncByWorkspace, [workspaceId]: 'offline' },
			})
			if (reportFailure) throw error
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

		this.watches.set(workspaceId, { count: 1, failures: 0 })
		void this.pollWorkspace(workspaceId)
		return () => this.unwatchWorkspace(workspaceId)
	}

	private async pollWorkspace(workspaceId: string): Promise<void> {
		await this.syncWorkspace(workspaceId, false)
		const watch = this.watches.get(workspaceId)
		if (!watch) return
		const offline = this.snapshot.syncByWorkspace[workspaceId] === 'offline'
		watch.failures = offline ? watch.failures + 1 : 0
		const delay = offline
			? Math.min(30_000, this.syncIntervalMs * 2 ** Math.min(watch.failures, 5))
			: this.syncIntervalMs
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
