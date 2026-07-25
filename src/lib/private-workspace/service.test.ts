import { describe, expect, test } from 'bun:test'
import type { NostrSigner } from '@contextvm/sdk'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { PrivateWorkspaceCoordinator } from './contracts'
import { createPrivateEnvelope } from './envelope'
import {
	createPrivateMapInvitation,
	decodePrivateMapInvitation,
	PRIVATE_MAP_INVITATION_TTL_SECONDS,
} from './invitation'
import { PrivateWorkspaceService } from './service'
import { MemoryPrivateWorkspaceStore, type StoredWorkspace } from './storage'

describe('PrivateWorkspaceService synchronization', () => {
	test('deletes a private workspace from the current installation', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const store = new MemoryPrivateWorkspaceStore()
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			createCoordinator: () => {
				throw new Error('Local deletion must not contact Cordn')
			},
		})
		const workspace = await service.createWorkspace({ name: 'Delete me' })

		await service.deleteWorkspace(workspace.workspaceId)

		expect(await service.listWorkspaces()).toEqual([])
	})

	test('creates an administrator invitation from local MLS state without contacting Cordn', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const coordinatorPubkey = 'b'.repeat(64)
		let coordinatorConnections = 0
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store: new MemoryPrivateWorkspaceStore(),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			createCoordinator: () => {
				coordinatorConnections += 1
				throw new Error('Invitation creation must not require Cordn')
			},
			now: () => 1_700_000_000_000,
		})
		const workspace = await service.createWorkspace({ name: 'Offline invite' })

		const invitation = decodePrivateMapInvitation(
			await service.createInvitation(workspace.workspaceId),
		)

		expect(invitation.workspaceId).toBe(workspace.workspaceId)
		expect(invitation.adminPubkey).toBe(ownerPubkey)
		expect(coordinatorConnections).toBe(0)
	})

	test('checks join requests without waiting for an unrelated message sync', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const coordinatorPubkey = 'b'.repeat(64)
		const coordinator = {
			fetchMessages: async () => new Promise<never>(() => undefined),
			takeJoinRequests: async () => ({
				requests: [
					{
						pk: 'c'.repeat(64),
						kp_ref: 'pending-key-package',
						at: 1_700_000_001,
					},
				],
			}),
			disconnect: async () => undefined,
		} as unknown as PrivateWorkspaceCoordinator
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store: new MemoryPrivateWorkspaceStore(),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			createCoordinator: () => coordinator,
		})
		const workspace = await service.createWorkspace({ name: 'Request check' })

		const requests = await Promise.race([
			service.fetchJoinRequests(workspace.workspaceId),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error('Join-request check waited for an unrelated message sync')),
					100,
				),
			),
		])

		expect(requests).toEqual([
			{
				workspaceId: workspace.workspaceId,
				pk: 'c'.repeat(64),
				kp_ref: 'pending-key-package',
				at: 1_700_000_001,
			},
		])
	})

	test('recovers a join request from transient Cordn response loss', async () => {
		const adminSecretKey = generateSecretKey()
		const guestSecretKey = generateSecretKey()
		const guestPubkey = getPublicKey(guestSecretKey)
		const coordinatorPubkey = 'b'.repeat(64)
		const issuedAt = 1_700_000_000
		const invitation = await createPrivateMapInvitation({
			signer: {
				signEvent: async (event) => finalizeEvent(event, adminSecretKey),
			},
			workspaceId: 'workspace-1',
			groupId: 'group-1',
			adminPubkey: getPublicKey(adminSecretKey),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			nonce: 'response-loss',
			issuedAt,
		})
		let publishedRef = ''
		let publishedLastResort = false
		let publishAttempts = 0
		let joinRequestAttempts = 0
		const coordinator = {
			publishKeyPackage: async ({ kp_ref }: { kp_ref: string; kp_64: string }) => {
				publishAttempts += 1
				publishedRef = kp_ref
				publishedLastResort = true
				throw new Error('MCP error -32001: Request timed out')
			},
			listKeyPackages: async () => ({
				keyPackages: [
					{
						pk: guestPubkey,
						kp_ref: publishedRef,
						last_resort: publishedLastResort,
						at: issuedAt,
					},
				],
			}),
			storeJoinRequest: async () => {
				joinRequestAttempts += 1
				if (joinRequestAttempts === 1) throw new Error('MCP error -32001: Request timed out')
				return { at: issuedAt + 1 }
			},
			disconnect: async () => undefined,
		} as unknown as PrivateWorkspaceCoordinator
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => guestPubkey,
				signEvent: async (event) => finalizeEvent(event, guestSecretKey),
			} as NostrSigner,
			store: new MemoryPrivateWorkspaceStore(),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			createCoordinator: () => coordinator,
			now: () => issuedAt * 1000,
		})

		const pending = await service.requestToJoin(invitation)

		expect(pending.workspaceId).toBe('workspace-1')
		expect(publishAttempts).toBe(1)
		expect(joinRequestAttempts).toBe(2)
	})

	test('rejects an expired signed invitation before contacting its coordinator', async () => {
		const adminSecretKey = generateSecretKey()
		const guestSecretKey = generateSecretKey()
		const issuedAt = 1_700_000_000
		const coordinatorPubkey = 'b'.repeat(64)
		const invitation = await createPrivateMapInvitation({
			signer: {
				signEvent: async (event) => finalizeEvent(event, adminSecretKey),
			},
			workspaceId: 'workspace-1',
			groupId: 'group-1',
			adminPubkey: getPublicKey(adminSecretKey),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			nonce: 'expired-nonce',
			issuedAt,
		})
		let coordinatorConnections = 0
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => getPublicKey(guestSecretKey),
				signEvent: async (event) => finalizeEvent(event, guestSecretKey),
			} as NostrSigner,
			store: new MemoryPrivateWorkspaceStore(),
			coordinatorPubkey,
			relays: ['ws://localhost:3334'],
			createCoordinator: () => {
				coordinatorConnections += 1
				return {} as PrivateWorkspaceCoordinator
			},
			now: () => (issuedAt + PRIVATE_MAP_INVITATION_TTL_SECONDS) * 1000,
		})

		await expect(service.requestToJoin(invitation)).rejects.toThrow('expired')
		expect(coordinatorConnections).toBe(0)
	})

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
