import { describe, expect, test } from 'bun:test'
import type { PrivateWorkspaceService } from './service'
import { PrivateWorkspaceRuntime } from './runtime'
import type { StoredWorkspace } from './storage'

function storedWorkspace(cursor = 0): StoredWorkspace {
	return {
		workspaceId: 'workspace-1',
		groupId: 'group-1',
		ownerPubkey: 'a'.repeat(64),
		adminPubkey: 'a'.repeat(64),
		coordinatorPubkey: 'b'.repeat(64),
		relays: ['ws://localhost:3334'],
		role: 'administrator',
		status: 'active',
		stateBase64: '',
		cursor,
		envelopes: [],
		createdAt: 1,
	}
}

describe('PrivateWorkspaceRuntime', () => {
	test('publishes local state after a serialized operation', async () => {
		const workspaces: StoredWorkspace[] = []
		const fake = {
			listWorkspaces: async () => [...workspaces],
			listPendingJoins: async () => [],
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService
		const runtime = new PrivateWorkspaceRuntime(fake)
		let notifications = 0
		const unsubscribe = runtime.subscribe(() => notifications++)

		await runtime.perform(async () => {
			workspaces.push(storedWorkspace())
			return workspaces[0]
		})

		expect(runtime.getSnapshot().workspaces).toHaveLength(1)
		expect(runtime.getSnapshot().loaded).toBe(true)
		expect(notifications).toBeGreaterThan(0)
		unsubscribe()
	})

	test('deduplicates overlapping automatic sync attempts', async () => {
		let syncCalls = 0
		let release!: () => void
		const barrier = new Promise<void>((resolve) => {
			release = resolve
		})
		const fake = {
			listWorkspaces: async () => [storedWorkspace(1)],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => {
				syncCalls += 1
				await barrier
				return { workspace: storedWorkspace(1), changed: false }
			},
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService
		const runtime = new PrivateWorkspaceRuntime(fake)

		const first = runtime.syncWorkspace('workspace-1', false)
		const duplicate = runtime.syncWorkspace('workspace-1', false)
		await Promise.resolve()
		expect(syncCalls).toBe(1)
		release()
		await Promise.all([first, duplicate])

		expect(runtime.getSnapshot().syncByWorkspace['workspace-1']).toBe('current')
	})

	test('does not publish snapshots for a repeated no-op background sync', async () => {
		const workspace = storedWorkspace(1)
		const fake = {
			listWorkspaces: async () => [workspace],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => ({ workspace, changed: false }),
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService
		const runtime = new PrivateWorkspaceRuntime(fake)
		await runtime.refresh()
		await runtime.syncWorkspace('workspace-1', false)

		let notifications = 0
		const unsubscribe = runtime.subscribe(() => notifications++)
		await runtime.syncWorkspace('workspace-1', false)

		expect(notifications).toBe(0)
		unsubscribe()
	})
})
