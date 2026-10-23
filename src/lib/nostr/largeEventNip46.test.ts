import { describe, expect, test } from 'bun:test'
import { NEVER } from 'rxjs'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import {
	EARTHLY_NIP46_PERMISSIONS,
	EarthlyNostrConnectAccount,
	EarthlyNostrConnectSigner,
} from './largeEventNip46'

const EDITOR_INLINE_DATASET_BYTES = 1024 * 1024
const NIP46_RELAY_CONTENT_BYTES = 7 * 1024 * 1024

function oneMiBFeatureCollection(): string {
	const serialize = (description: string) =>
		JSON.stringify({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: { description },
				},
			],
		})
	const emptyBytes = new TextEncoder().encode(serialize('')).byteLength
	const escapedPairs = Math.floor((EDITOR_INLINE_DATASET_BYTES - emptyBytes) / 4)
	const escaped = '"\\'.repeat(escapedPairs)
	const partlyFilled = serialize(escaped)
	const remainder = EDITOR_INLINE_DATASET_BYTES - new TextEncoder().encode(partlyFilled).byteLength
	const content = serialize(escaped + 'x'.repeat(remainder))
	expect(new TextEncoder().encode(content).byteLength).toBe(EDITOR_INLINE_DATASET_BYTES)
	return content
}

describe('EarthlyNostrConnectSigner', () => {
	test('signs a one-MiB dataset through the upstream NIP-46 transport', async () => {
		const remoteSigner = new PrivateKeySigner()
		const remotePubkey = await remoteSigner.getPublicKey()
		let requestEncryption: 'nip04' | 'nip44' | undefined
		let requestContentBytes = 0
		let requestPlaintextBytes = 0
		let responseContentBytes = 0
		let responsePlaintextBytes = 0
		let client!: EarthlyNostrConnectSigner

		client = new EarthlyNostrConnectSigner({
			relays: ['ws://signer-relay.invalid'],
			remote: remotePubkey,
			pubkey: remotePubkey,
			subscriptionMethod: () => NEVER,
			publishMethod: async (_relays, requestEvent) => {
				requestContentBytes = new TextEncoder().encode(requestEvent.content).byteLength
				requestEncryption = requestEvent.content.includes('?iv=') ? 'nip04' : 'nip44'
				const plaintext = await remoteSigner.nip44.decrypt(
					requestEvent.pubkey,
					requestEvent.content,
				)
				requestPlaintextBytes = new TextEncoder().encode(plaintext).byteLength
				const request = JSON.parse(plaintext) as {
					id: string
					method: string
					params: [string]
				}
				expect(request.method).toBe('sign_event')
				const signed = await remoteSigner.signEvent(JSON.parse(request.params[0] ?? '{}'))
				const responsePlaintext = JSON.stringify({
					id: request.id,
					result: JSON.stringify(signed),
				})
				responsePlaintextBytes = new TextEncoder().encode(responsePlaintext).byteLength
				const responseContent = await remoteSigner.nip44.encrypt(
					requestEvent.pubkey,
					responsePlaintext,
				)
				responseContentBytes = new TextEncoder().encode(responseContent).byteLength
				const response = await remoteSigner.signEvent({
					kind: 24_133,
					created_at: Math.floor(Date.now() / 1000),
					tags: [['p', requestEvent.pubkey]],
					content: responseContent,
				})
				await client.handleEvent(response as NostrEvent)
				return [{ from: 'ws://signer-relay.invalid', ok: true, message: '' }]
			},
		})
		client.isConnected = true
		const content = oneMiBFeatureCollection()

		const signed = await client.signEvent({
			kind: 37_515,
			created_at: 1_700_000_000,
			tags: [
				['d', 'one-mib-dataset'],
				['bbox', '-180,-90,180,90'],
				['g', 'u4pruy'],
				['g', 'u4pru'],
				['g', 'u4pr'],
				['g', 'u4p'],
				['g', 'u4'],
				['g', 'u'],
				['checksum', '0'.repeat(64)],
				['size', String(EDITOR_INLINE_DATASET_BYTES)],
			],
			content,
		})

		expect(new TextEncoder().encode(signed.content).byteLength).toBe(EDITOR_INLINE_DATASET_BYTES)
		expect(signed.pubkey).toBe(remotePubkey)
		expect(requestEncryption).toBe('nip44')
		expect(requestContentBytes).toBeGreaterThan(EDITOR_INLINE_DATASET_BYTES)
		expect(requestPlaintextBytes).toBeGreaterThan(4 * 1024 * 1024)
		expect(requestContentBytes).toBeGreaterThan(6 * 1024 * 1024)
		expect(requestContentBytes).toBeLessThanOrEqual(NIP46_RELAY_CONTENT_BYTES)
		expect(responsePlaintextBytes).toBeGreaterThan(4 * 1024 * 1024)
		expect(responseContentBytes).toBeGreaterThan(6 * 1024 * 1024)
		expect(responseContentBytes).toBeLessThanOrEqual(NIP46_RELAY_CONTENT_BYTES)
		await client.close()
	})

	test('preserves the persisted account shape and client key with upstream signers', async () => {
		const previousSubscriptionMethod = NostrConnectSigner.subscriptionMethod
		const previousPublishMethod = NostrConnectSigner.publishMethod
		NostrConnectSigner.subscriptionMethod = () => NEVER
		NostrConnectSigner.publishMethod = async () => []

		try {
			const remote = new PrivateKeySigner()
			const remotePubkey = await remote.getPublicKey()
			const legacyClientKey = new PrivateKeySigner()
			const signer = new EarthlyNostrConnectSigner({
				relays: ['wss://relay.example'],
				remote: remotePubkey,
				pubkey: remotePubkey,
				signer: legacyClientKey,
			})
			expect(signer.signer).toBeInstanceOf(PrivateKeySigner)
			expect(signer.signer.key).toEqual(legacyClientKey.key)

			const restored = EarthlyNostrConnectAccount.fromJSON(
				new EarthlyNostrConnectAccount(remotePubkey, signer).toJSON(),
			)
			expect(restored.signer).toBeInstanceOf(EarthlyNostrConnectSigner)
			expect(restored.signer.signer).toBeInstanceOf(PrivateKeySigner)
			expect(restored.signer.signer.key).toEqual(legacyClientKey.key)
		} finally {
			NostrConnectSigner.subscriptionMethod = previousSubscriptionMethod
			NostrConnectSigner.publishMethod = previousPublishMethod
		}
	})

	test('requests the signing and NIP-44 capabilities used by Earthly', () => {
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('sign_event:37515')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('sign_event:22242')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('sign_event:24242')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('sign_event:37526')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('sign_event:30078')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('nip44_encrypt')
		expect(EARTHLY_NIP46_PERMISSIONS).toContain('nip44_decrypt')
		expect(EARTHLY_NIP46_PERMISSIONS).not.toContain('sign_event:34444')
	})
})

test('restoring nbunksec does not re-send a used connect secret', async () => {
	const remote = new PrivateKeySigner()
	const signer = new PrivateKeySigner()
	const client = new EarthlyNostrConnectSigner({
		relays: ['wss://relay.example'],
		remote: await remote.getPublicKey(),
		signer,
		bunkerSecret: 'already-used',
		publishMethod: async () => [],
		subscriptionMethod: () => NEVER,
	})
	let published = 0
	const restored = await EarthlyNostrConnectSigner.fromNbunksec(client.getNbunksec(), {
		subscriptionMethod: () => NEVER,
		publishMethod: async () => {
			published++
			return []
		},
	})
	expect(published).toBe(0)
	expect(restored.signer.key).toEqual(signer.key)
	await restored.close()
	await client.close()
})
