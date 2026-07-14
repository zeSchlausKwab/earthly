import { describe, expect, test } from 'bun:test'
import type { NostrSigner } from '@contextvm/sdk'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { PrivateWorkspaceCoordinator } from './contracts'
import { createPrivateEnvelope } from './envelope'
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

	test('promotes a locally acknowledged envelope whose echo cursor was already passed', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const signer = {
			getPublicKey: async () => ownerPubkey,
			signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
				finalizeEvent(event, secretKey),
		} as unknown as NostrSigner
		const envelope = await createPrivateEnvelope({
			signer,
			groupId: 'group-1',
			pubkey: ownerPubkey,
			kind: 9,
			content: 'acknowledged before the cursor advanced',
		})
		const workspace: StoredWorkspace = {
			workspaceId: 'workspace-1',
			groupId: 'group-1',
			ownerPubkey,
			adminPubkey: ownerPubkey,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			role: 'administrator',
			status: 'active',
			stateBase64: 'already-advanced-local-mls-state',
			cursor: 12,
			envelopes: [],
			pendingOutbound: [{ cursor: 12, envelope }],
			createdAt: 1,
		}
		const store = new MemoryPrivateWorkspaceStore()
		await store.putWorkspace(workspace)
		const service = new PrivateWorkspaceService({
			signer,
			store,
			coordinatorPubkey: workspace.coordinatorPubkey,
			relays: workspace.relays,
			createCoordinator: () =>
				({
					fetchMessages: async () => ({ messages: [] }),
					disconnect: async () => undefined,
				}) as unknown as PrivateWorkspaceCoordinator,
		})

		const result = await service.syncWorkspaceResult(workspace.workspaceId)

		expect(result.changed).toBe(true)
		expect(result.workspace.envelopes.map((item) => item.id)).toEqual([envelope.id])
		expect(result.workspace.pendingOutbound).toBeUndefined()
	})
})
