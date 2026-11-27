import { describe, expect, test } from 'bun:test'
import type { CoordinatorMessage } from './contracts'
import { CordnUnsupportedStreamingError } from './coordinator'
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

	test('creates a read-only invitation while a coordinator sync is still pending', async () => {
		let release!: () => void
		const barrier = new Promise<void>((resolve) => {
			release = resolve
		})
		const fake = {
			listWorkspaces: async () => [storedWorkspace(1)],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => {
				await barrier
				return { workspace: storedWorkspace(1), changed: false }
			},
			createInvitation: async () => 'signed-local-invitation',
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService
		const runtime = new PrivateWorkspaceRuntime(fake)
		const pendingSync = runtime.syncWorkspace('workspace-1', false)
		await Promise.resolve()

		const invitation = await Promise.race([
			runtime.createInvitation('workspace-1'),
			new Promise<string>((_, reject) =>
				setTimeout(() => reject(new Error('Invitation waited for the coordinator queue')), 100),
			),
		])

		expect(invitation).toBe('signed-local-invitation')
		release()
		await pendingSync
	})

	test('checks join requests while a background coordinator sync is still pending', async () => {
		let release!: () => void
		const barrier = new Promise<void>((resolve) => {
			release = resolve
		})
		const requests = [
			{
				workspaceId: 'workspace-1',
				pk: 'c'.repeat(64),
				kp_ref: 'pending-key-package',
				at: 1_700_000_001,
			},
		]
		const fake = {
			listWorkspaces: async () => [storedWorkspace(1)],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => {
				await barrier
				return { workspace: storedWorkspace(1), changed: false }
			},
			fetchJoinRequests: async () => requests,
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService
		const runtime = new PrivateWorkspaceRuntime(fake)
		const pendingSync = runtime.syncWorkspace('workspace-1', false)
		await Promise.resolve()

		const result = await Promise.race([
			runtime.fetchJoinRequests('workspace-1'),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('Join-request check waited for the coordinator queue')),
					100,
				),
			),
		])

		expect(result).toEqual(requests)
		release()
		await pendingSync
	})

	test('streams live v0.5 messages into the serialized queue and closes stream on unwatch', async () => {
		let currentCursor = 1
		let pushMessage!: (message: CoordinatorMessage) => Promise<void>
		let streamClosed = false
		let streamCloseResolve!: () => void
		const closedPromise = new Promise<void>((resolve) => {
			streamCloseResolve = resolve
		})

		const fake = {
			listWorkspaces: async () => [storedWorkspace(currentCursor)],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => ({
				workspace: storedWorkspace(currentCursor),
				changed: false,
			}),
			ingestStreamedMessage: async (_workspaceId: string, msg: CoordinatorMessage) => {
				currentCursor = msg.cursor
				return { workspace: storedWorkspace(currentCursor), changed: true }
			},
			openWorkspaceStream: async (
				_workspaceId: string,
				handlers: { onMessage: (msg: CoordinatorMessage) => Promise<void> },
			) => {
				pushMessage = handlers.onMessage
				return {
					get active() {
						return !streamClosed
					},
					closed: closedPromise,
					async close() {
						streamClosed = true
						streamCloseResolve()
					},
				}
			},
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService

		const runtime = new PrivateWorkspaceRuntime(fake, 50)
		const unwatch = runtime.watchWorkspace('workspace-1')
		await new Promise((resolve) => setTimeout(resolve, 15))

		expect(runtime.getSnapshot().transportByWorkspace?.['workspace-1']).toBe('streaming')

		await pushMessage({ cursor: 7, gid: 'group-1', msg_64: 'live-payload', at: 700 })
		expect(runtime.getSnapshot().workspaces[0]?.cursor).toBe(7)
		expect(runtime.getSnapshot().syncByWorkspace['workspace-1']).toBe('current')

		unwatch()
		await closedPromise
		expect(streamClosed).toBe(true)
	})

	test('falls back seamlessly to polling when coordinator rejects msg_sub_many (v0.4)', async () => {
		let syncCalls = 0
		let streamAttempts = 0
		const fake = {
			listWorkspaces: async () => [storedWorkspace(1)],
			listPendingJoins: async () => [],
			syncWorkspaceResult: async () => {
				syncCalls += 1
				return { workspace: storedWorkspace(1), changed: false }
			},
			openWorkspaceStream: async () => {
				streamAttempts += 1
				throw new CordnUnsupportedStreamingError('v0.4 coordinator')
			},
			resetConnections: async () => undefined,
			dispose: async () => undefined,
		} as unknown as PrivateWorkspaceService

		const runtime = new PrivateWorkspaceRuntime(fake, 15)
		const unwatch = runtime.watchWorkspace('workspace-1')
		await new Promise((resolve) => setTimeout(resolve, 60))

		expect(streamAttempts).toBe(1)
		expect(syncCalls).toBeGreaterThanOrEqual(2)
		expect(runtime.getSnapshot().transportByWorkspace?.['workspace-1']).toBe('polling')

		unwatch()
		await runtime.dispose()
	})
})
