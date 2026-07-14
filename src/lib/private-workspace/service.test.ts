import { describe, expect, test } from 'bun:test'
import type { NostrSigner } from '@contextvm/sdk'
import type { PrivateWorkspaceCoordinator } from './contracts'
import { PrivateWorkspaceService } from './service'
import { MemoryPrivateWorkspaceStore, type StoredWorkspace } from './storage'

describe('PrivateWorkspaceService synchronization', () => {
	test('does not decode or rewrite MLS state when the coordinator has no new records', async () => {
		const ownerPubkey = 'a'.repeat(64)
		const workspace: StoredWorkspace = {
			workspaceId: 'workspace-1',
			groupId: 'group-1',
			ownerPubkey,
			adminPubkey: ownerPubkey,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			role: 'administrator',
			status: 'active',
			stateBase64: 'deliberately-not-an-mls-state',
			cursor: 12,
			envelopes: [],
			createdAt: 1,
		}
		const store = new MemoryPrivateWorkspaceStore()
		await store.putWorkspace(workspace)
		let fetches = 0
		const coordinator = {
			fetchMessages: async () => {
				fetches += 1
				return { messages: [] }
			},
			disconnect: async () => undefined,
		} as unknown as PrivateWorkspaceCoordinator
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
			} as unknown as NostrSigner,
			store,
			coordinatorPubkey: workspace.coordinatorPubkey,
			relays: workspace.relays,
			createCoordinator: () => coordinator,
		})

		const result = await service.syncWorkspaceResult(workspace.workspaceId)

		expect(fetches).toBe(1)
		expect(result.changed).toBe(false)
		expect(result.workspace.cursor).toBe(12)
	})
})
