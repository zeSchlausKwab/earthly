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
import {
	buildEncryptedMediaImetaTag,
	CORDN_ENCRYPTED_MEDIA_VERSION,
	EARTHLY_PERSISTENT_MEDIA_VERSION,
} from './media'
import { getWorkspaceSyncHealth, PrivateWorkspaceService } from './service'
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

	test('persists epochMediaKeys on creation and resolves cordn-em-v1 and earthly-pm-v1 keys', async () => {
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
			createCoordinator: () =>
				({
					disconnect: async () => undefined,
				}) as unknown as PrivateWorkspaceCoordinator,
		})

		const workspace = await service.createWorkspace({ name: 'Media Circle' })
		const initialEpochKey = workspace.epochMediaKeys?.['0']
		expect(initialEpochKey).toMatch(/^[0-9a-f]{64}$/u)
		if (!initialEpochKey) throw new Error('Expected initial epoch 0 media key')
		expect(getWorkspaceSyncHealth(workspace)).toBe('healthy')

		const derived = await service.deriveWorkspaceMediaKey(workspace.workspaceId)
		expect(derived.epoch).toBe(0)
		expect(derived.keyHex).toBe(initialEpochKey)

		const resolvedCordn = await service.resolveMediaKeyForAttachment(workspace, {
			url: 'https://blossom.earthly.city/a',
			mime: 'image/jpeg',
			filename: 'a.jpg',
			x: '11'.repeat(32),
			n: '22'.repeat(12),
			v: CORDN_ENCRYPTED_MEDIA_VERSION,
		})
		expect(resolvedCordn).toEqual(derived.key)

		const pmKeyHex = 'ab'.repeat(32)
		const resolvedPm = await service.resolveMediaKeyForAttachment(workspace, {
			url: 'https://blossom.earthly.city/b',
			mime: 'image/webp',
			filename: 'b.webp',
			x: '33'.repeat(32),
			n: '44'.repeat(12),
			v: EARTHLY_PERSISTENT_MEDIA_VERSION,
			k: pmKeyHex,
		})
		expect(resolvedPm.byteLength).toBe(32)
	})

	test('tracks consecutive decrypt errors into behind/forked health and repairs sync state', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const store = new MemoryPrivateWorkspaceStore()
		let messagesToServe: Array<{ cursor: number; gid: string; msg_64: string; at: number }> = []
		let disconnectCalls = 0
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			createCoordinator: () =>
				({
					fetchMessages: async () => ({ messages: messagesToServe }),
					disconnect: async () => {
						disconnectCalls += 1
					},
				}) as unknown as PrivateWorkspaceCoordinator,
		})

		const workspace = await service.createWorkspace({ name: 'Health Circle' })

		// 2 consecutive invalid v0.5 messages (omitting `encrypted` => defaults to true) -> 'behind'
		messagesToServe = [
			{ cursor: 1, gid: workspace.groupId, msg_64: 'AAAA', at: 1 },
			{ cursor: 2, gid: workspace.groupId, msg_64: 'BBBB', at: 2 },
		]
		const afterTwo = await service.syncWorkspace(workspace.workspaceId)
		expect(afterTwo.consecutiveDecryptErrors).toBe(2)
		expect(getWorkspaceSyncHealth(afterTwo)).toBe('behind')

		// 3 more consecutive invalid messages (total 5) -> 'forked'
		messagesToServe = [
			{ cursor: 3, gid: workspace.groupId, msg_64: 'CCCC', at: 3 },
			{ cursor: 4, gid: workspace.groupId, msg_64: 'DDDD', at: 4 },
			{ cursor: 5, gid: workspace.groupId, msg_64: 'EEEE', at: 5 },
		]
		const afterFive = await service.syncWorkspace(workspace.workspaceId)
		expect(afterFive.consecutiveDecryptErrors).toBe(5)
		expect(getWorkspaceSyncHealth(afterFive)).toBe('forked')

		// Repair resets error counter, drops skipped list, resets coordinator connection, and re-syncs
		messagesToServe = []
		const repaired = await service.repairWorkspaceSyncState(workspace.workspaceId)
		expect(repaired.consecutiveDecryptErrors).toBe(0)
		expect(getWorkspaceSyncHealth(repaired)).toBe('healthy')
		expect(repaired.skippedCoordinatorMessages).toBeUndefined()
		expect(disconnectCalls).toBe(1)
	})

	test('toggles autoApproveJoins and batches pollAndAutoApproveJoinRequests safely', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const store = new MemoryPrivateWorkspaceStore()
		let fetchedJoinRequests = 0
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			createCoordinator: () =>
				({
					fetchMessages: async () => ({ messages: [] }),
					takeJoinRequests: async () => {
						fetchedJoinRequests += 1
						return {
							requests: [
								{ pk: 'c'.repeat(64), kp_ref: 'missing-kp-1', at: 10 },
								{ pk: 'd'.repeat(64), kp_ref: 'missing-kp-2', at: 11 },
							],
						}
					},
					takeKeyPackage: async () => ({ keyPackage: null }),
					disconnect: async () => undefined,
				}) as unknown as PrivateWorkspaceCoordinator,
		})

		const workspace = await service.createWorkspace({ name: 'Auto Approve Circle' })
		// Disabled by default: should not contact coordinator
		const skipped = await service.pollAndAutoApproveJoinRequests(workspace.workspaceId)
		expect(skipped.approved).toEqual([])
		expect(fetchedJoinRequests).toBe(0)

		const enabled = await service.setAutoApproveJoins(workspace.workspaceId, true)
		expect(enabled.autoApproveJoins).toBe(true)

		// Respects maxBatch = 1 and isolates individual approval errors cleanly
		const polled = await service.pollAndAutoApproveJoinRequests(workspace.workspaceId, 1)
		expect(fetchedJoinRequests).toBe(1)
		expect(polled.approved).toHaveLength(0)
		expect(polled.failed).toHaveLength(1)
		expect(polled.failed[0]?.request.kp_ref).toBe('missing-kp-1')
	})

	test('sends comment and dataset with validated encrypted media imeta tags', async () => {
		const secretKey = generateSecretKey()
		const ownerPubkey = getPublicKey(secretKey)
		const store = new MemoryPrivateWorkspaceStore()
		let cursor = 0
		const posted: Array<{ cursor: number; gid: string; msg_64: string; at: number }> = []
		const service = new PrivateWorkspaceService({
			signer: {
				getPublicKey: async () => ownerPubkey,
				signEvent: async (event) => finalizeEvent(event, secretKey),
			} as NostrSigner,
			store,
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			createCoordinator: () =>
				({
					fetchMessages: async ({ after }: { gid: string; after?: number }) => ({
						messages: posted.filter((m) => m.cursor > (after ?? 0)),
					}),
					postMessage: async ({ gid, msg_64 }: { gid: string; msg_64: string }) => {
						cursor += 1
						const entry = { cursor, gid, msg_64, at: cursor }
						posted.push(entry)
						return { cursor, gid, at: cursor }
					},
					disconnect: async () => undefined,
				}) as unknown as PrivateWorkspaceCoordinator,
		})

		const workspace = await service.createWorkspace({ name: 'Media Posts' })
		const imeta = buildEncryptedMediaImetaTag({
			url: 'https://blossom.earthly.city/img1',
			mime: 'image/jpeg',
			filename: 'abc.jpg',
			x: '11'.repeat(32),
			n: '22'.repeat(12),
			v: CORDN_ENCRYPTED_MEDIA_VERSION,
		})
		const pmImeta = buildEncryptedMediaImetaTag({
			url: 'https://blossom.earthly.city/map1',
			mime: 'image/png',
			filename: 'map.png',
			x: '33'.repeat(32),
			n: '44'.repeat(12),
			v: EARTHLY_PERSISTENT_MEDIA_VERSION,
			k: '55'.repeat(32),
		})

		const commentEnv = await service.sendCommentWithMedia(workspace.workspaceId, '', undefined, [
			imeta,
		])
		expect(commentEnv.tags).toContainEqual(imeta)

		const datasetEnv = await service.sendDatasetWithMedia(
			workspace.workspaceId,
			{ type: 'FeatureCollection', features: [] },
			{ datasetId: 'ds-media', name: 'Media Map', mediaImetaTags: [pmImeta] },
		)
		expect(datasetEnv.tags).toContainEqual(pmImeta)

		const [persisted] = await service.listWorkspaces()
		if (!persisted) throw new Error('Expected persisted workspace')
		expect(persisted.envelopeEpochs?.[commentEnv.id]).toBe(0)
		expect(persisted.envelopeEpochs?.[datasetEnv.id]).toBe(0)

		// Rejects invalid imeta tag without version `v`
		await expect(
			service.sendCommentWithMedia(workspace.workspaceId, 'bad', undefined, [
				['imeta', 'url https://blossom.earthly.city/bad'],
			]),
		).rejects.toThrow('Missing or unsupported')
	})
})
