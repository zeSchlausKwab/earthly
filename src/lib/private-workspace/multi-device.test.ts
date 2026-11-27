import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { bytesToHex } from './codec'
import { createPrivateEnvelope } from './envelope'
import {
	createLocalMultiDeviceNip44Signer,
	createMultiDeviceTipEvent,
	decodeMultiDeviceDocument,
	encodeMultiDeviceDocument,
	exportWorkspaceToGroupDocument,
	generateMultiDeviceDek,
	MULTI_DEVICE_SCHEMA_VERSION,
	MULTI_DEVICE_TIP_D_TAG,
	MULTI_DEVICE_TIP_KIND,
	multiDeviceDekFromPointer,
	openMultiDeviceTipEvent,
	reconcileRemoteGroupDocument,
	reconcileRemoteMetaDocument,
	sealMultiDeviceDocument,
	sealMultiDeviceDocumentBytes,
	unsealMultiDeviceDocument,
	type MultiDeviceGroupDocument,
	type MultiDeviceMetaDocument,
} from './multi-device'
import { MemoryPrivateWorkspaceStore, type StoredWorkspace } from './storage'

describe('Cordn multi-device sync (spec/applications/multi-device.md)', () => {
	const secretKey = generateSecretKey()
	const ownerPubkey = getPublicKey(secretKey)
	const coordinator = 'b'.repeat(64)

	test('encodes, NIP-44 v2 seals, and unseals Group and Meta documents with a 32-byte DEK', () => {
		const dek = generateMultiDeviceDek()
		const groupDoc: MultiDeviceGroupDocument = {
			schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
			type: 'group',
			issuedAt: 1_760_000_000,
			prev: null,
			gid: 'earthly:sync-group-1',
			coordinator,
			coordinatorRelays: ['wss://relay.earthly.city'],
			clientState: 'bWxzLXN0YXRlLXYx',
			cursor: 42,
			workspaceId: 'ws-1',
			adminPubkey: ownerPubkey,
			metadata: { name: 'Alpine Survey' },
			epochMediaKeys: { '0': '11'.repeat(32) },
			envelopeEpochs: { ['c'.repeat(64)]: 0 },
			autoApproveJoins: true,
		}

		const encoded = encodeMultiDeviceDocument(groupDoc)
		expect(encoded).toContain('"prev":null')
		expect(decodeMultiDeviceDocument(encoded)).toEqual(groupDoc)

		// Defensively accept omitted `prev` from older producers as `null`
		const { prev: _omittedPrev, ...withoutPrev } = groupDoc
		expect(decodeMultiDeviceDocument(JSON.stringify(withoutPrev))).toEqual(groupDoc)

		const sealed = sealMultiDeviceDocument(groupDoc, dek)
		expect(sealed).not.toContain('Alpine Survey')
		expect(unsealMultiDeviceDocument(sealed, dek)).toEqual(groupDoc)

		const wrongDek = generateMultiDeviceDek()
		expect(() => unsealMultiDeviceDocument(sealed, wrongDek)).toThrow()

		const metaDoc: MultiDeviceMetaDocument = {
			schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
			type: 'meta',
			issuedAt: 1_760_000_100,
			removed: [{ gid: 'earthly:old-group', removedAt: 1_760_000_050 }],
			lastResortKeyPackage: {
				kpRef: 'ab'.repeat(32),
				kp64: 'a3AtNjQ=',
				createdAt: 1_760_000_000,
			},
		}
		const sealedBytes = sealMultiDeviceDocumentBytes(metaDoc, dek)
		expect(sealedBytes.sha256Hex).toMatch(/^[0-9a-f]{64}$/u)
		expect(unsealMultiDeviceDocument(sealedBytes.bytes, dek)).toEqual(metaDoc)
	})

	test('creates and verifies NIP-78 kind 30078 self-encrypted tip pointer events', async () => {
		const signer = createLocalMultiDeviceNip44Signer(secretKey)
		const dek = generateMultiDeviceDek()
		const pointer = {
			schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
			dekHex: bytesToHex(dek),
			blossomServers: ['https://blossom.earthly.city'],
			groups: {
				'earthly:sync-group-1': {
					x: 'aa'.repeat(32),
					urls: ['https://blossom.earthly.city/aa'],
					issuedAt: 1_760_000_000,
				},
			},
			meta: {
				x: 'bb'.repeat(32),
				urls: [],
				issuedAt: 1_760_000_010,
			},
		}

		const tipEvent = await createMultiDeviceTipEvent(signer, pointer, 1_760_000_020)
		expect(tipEvent.kind).toBe(MULTI_DEVICE_TIP_KIND)
		expect(tipEvent.tags).toEqual([['d', MULTI_DEVICE_TIP_D_TAG]])
		expect(tipEvent.content).not.toContain(pointer.dekHex)

		const opened = await openMultiDeviceTipEvent(signer, tipEvent)
		expect(opened).toEqual({ ...pointer, updatedAt: 1_760_000_020 })
		expect(multiDeviceDekFromPointer(opened)).toEqual(dek)

		// Decodes cross-stack tip payload with explicit `meta: null` and legacy single `url`
		const legacyContent = await signer.nip44Encrypt(
			ownerPubkey,
			JSON.stringify({
				schemaVersion: 1,
				dekHex: bytesToHex(dek),
				blossomServers: ['https://blossom.earthly.city'],
				groups: {
					'earthly:sync-group-1': {
						x: 'aa'.repeat(32),
						url: 'https://blossom.earthly.city/aa',
						issuedAt: 1_760_000_000,
					},
				},
				meta: null,
			}),
		)
		const legacyEvent = await signer.signEvent({
			kind: MULTI_DEVICE_TIP_KIND,
			created_at: 1_760_000_025,
			tags: [['d', MULTI_DEVICE_TIP_D_TAG]],
			content: legacyContent,
		})
		const openedLegacy = await openMultiDeviceTipEvent(signer, legacyEvent)
		expect(openedLegacy).toEqual({
			schemaVersion: 1,
			dekHex: bytesToHex(dek),
			blossomServers: ['https://blossom.earthly.city'],
			groups: {
				'earthly:sync-group-1': {
					x: 'aa'.repeat(32),
					urls: ['https://blossom.earthly.city/aa'],
					issuedAt: 1_760_000_000,
				},
			},
		})

		// Another account must not accept or decrypt this tip event
		const otherSigner = createLocalMultiDeviceNip44Signer(generateSecretKey())
		await expect(openMultiDeviceTipEvent(otherSigner, tipEvent)).rejects.toThrow(
			'does not belong to the active account',
		)
	})

	test('reconciles remote group & meta documents without regressing newer local MLS state', async () => {
		const store = new MemoryPrivateWorkspaceStore()
		const envSigner = {
			signEvent: async (ev: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(ev, secretKey),
		}
		const env1 = await createPrivateEnvelope({
			signer: envSigner,
			groupId: 'earthly:sync-group-1',
			pubkey: ownerPubkey,
			kind: 9,
			content: 'first note',
			createdAt: 1_760_000_001,
		})
		const env2 = await createPrivateEnvelope({
			signer: envSigner,
			groupId: 'earthly:sync-group-1',
			pubkey: ownerPubkey,
			kind: 9,
			content: 'second note',
			createdAt: 1_760_000_002,
		})

		const docV1: MultiDeviceGroupDocument = {
			schemaVersion: 1,
			type: 'group',
			issuedAt: 1_760_000_010,
			prev: null,
			gid: 'earthly:sync-group-1',
			coordinator,
			coordinatorRelays: ['wss://relay.earthly.city'],
			clientState: 'state-v1',
			cursor: 10,
			workspaceId: 'ws-sync-1',
			adminPubkey: ownerPubkey,
			metadata: { name: 'Field Circle' },
			envelopes: [env1],
			epochMediaKeys: { '0': '11'.repeat(32) },
			envelopeEpochs: { [env1.id]: 0 },
		}

		// 1. Adopt new workspace on Device B
		const adopted = await reconcileRemoteGroupDocument(store, ownerPubkey, docV1)
		expect(adopted.action).toBe('adopted')
		expect(adopted.workspace.cursor).toBe(10)
		expect(adopted.workspace.envelopes).toHaveLength(1)

		// 2. Advance when remote is strictly ahead
		const docV2: MultiDeviceGroupDocument = {
			...docV1,
			issuedAt: 1_760_000_020,
			clientState: 'state-v2',
			cursor: 15,
			envelopes: [env1, env2],
			epochMediaKeys: { '0': '11'.repeat(32), '1': '22'.repeat(32) },
			envelopeEpochs: { [env1.id]: 0, [env2.id]: 1 },
		}
		const updated = await reconcileRemoteGroupDocument(store, ownerPubkey, docV2)
		expect(updated.action).toBe('updated')
		expect(updated.workspace.stateBase64).toBe('state-v2')
		expect(updated.workspace.cursor).toBe(15)
		expect(updated.workspace.epochMediaKeys?.['1']).toBe('22'.repeat(32))

		// 3. Do NOT regress when older snapshot arrives, while still preserving/merging any missing media keys
		const olderDocWithExtraKey: MultiDeviceGroupDocument = {
			...docV1,
			cursor: 8,
			clientState: 'stale-state',
			epochMediaKeys: { '99': '99'.repeat(32) },
		}
		const merged = await reconcileRemoteGroupDocument(store, ownerPubkey, olderDocWithExtraKey)
		expect(merged.action).toBe('merged-envelopes')
		expect(merged.workspace.stateBase64).toBe('state-v2')
		expect(merged.workspace.cursor).toBe(15)
		expect(merged.workspace.epochMediaKeys?.['99']).toBe('99'.repeat(32))

		// 4. Export back to GroupDocument
		const exported = exportWorkspaceToGroupDocument(merged.workspace as StoredWorkspace)
		expect(exported.gid).toBe('earthly:sync-group-1')
		expect(exported.cursor).toBe(15)

		// 5. Reconcile remote meta tombstone
		const removed = await reconcileRemoteMetaDocument(store, ownerPubkey, {
			schemaVersion: 1,
			type: 'meta',
			issuedAt: 1_760_000_500,
			removed: [{ gid: 'earthly:sync-group-1', removedAt: 1_760_000_400 }],
		})
		expect(removed).toEqual(['ws-sync-1'])
		expect(await store.listWorkspaces(ownerPubkey)).toEqual([])
	})
})
