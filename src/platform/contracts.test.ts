import { describe, expect, test } from 'bun:test'
import {
	localNodeStatusSchema,
	nativeSchemas,
	pairingInvitationSchema,
	remoteNodeRecordSchema,
	remoteBlobMirrorResultSchema,
	remoteSyncResultSchema,
} from './contracts'

const descriptor = {
	version: 1,
	nodeId: 'a'.repeat(64),
	relayUrl: 'ws://127.0.0.1:17447/',
	blossomUrl: 'http://127.0.0.1:17448/',
	scope: 'loopback',
	availability: 'process',
} as const

describe('local node platform contracts', () => {
	test('accepts the versioned running status returned by Rust', () => {
		expect(nativeSchemas.status.parse({ state: 'running', descriptor })).toEqual({
			state: 'running',
			descriptor,
		})
	})

	test('represents browser support honestly', () => {
		expect(
			localNodeStatusSchema.parse({
				state: 'unsupported',
				reason: 'Native app required',
			}),
		).toEqual({ state: 'unsupported', reason: 'Native app required' })
	})

	test('rejects an invitation that is not bound to the Earthly v1 envelope', () => {
		expect(() =>
			pairingInvitationSchema.parse({
				version: 1,
				encoded: 'https://example.com/invite',
				expiresAt: 1_900_000_000,
				capabilities: ['relay-write'],
				descriptor,
			}),
		).toThrow()
	})

	test('accepts a durable pending remote-node relationship', () => {
		const remote = {
			version: 1 as const,
			nodeId: descriptor.nodeId,
			descriptor,
			claimId: 'b'.repeat(64),
			peerPubkey: 'c'.repeat(64),
			peerName: 'Trail phone',
			capabilities: ['relay-write', 'blob-read'],
			status: { state: 'pending' },
			updatedAt: 1_900_000_000,
		}
		expect(remoteNodeRecordSchema.parse(remote)).toEqual({
			...remote,
			discoveredBlobHashes: [],
			mirroredBlobHashes: [],
		})
	})

	test('accepts a bounded native sync result and its durable checkpoint', () => {
		const remoteNode = {
			version: 1 as const,
			nodeId: descriptor.nodeId,
			descriptor,
			claimId: 'b'.repeat(64),
			peerPubkey: 'c'.repeat(64),
			capabilities: ['relay-read'],
			status: { state: 'accepted' },
			updatedAt: 1_900_000_000,
			lastSync: { syncedAt: 1_900_000_000, receivedEvents: 0 },
			discoveredBlobHashes: ['d'.repeat(64)],
			mirroredBlobHashes: [],
		}
		const result = {
			nodeId: descriptor.nodeId,
			receivedEvents: 0,
			hydratedEvents: 0,
			eventsTruncated: false,
			events: [],
			discoveredBlobHashes: ['d'.repeat(64)],
			remoteNode,
		}
		expect(remoteSyncResultSchema.parse(result)).toEqual(result)
	})

	test('accepts a verified remote-blob mirror result', () => {
		const hash = 'd'.repeat(64)
		const remoteNode = remoteNodeRecordSchema.parse({
			version: 1,
			nodeId: descriptor.nodeId,
			descriptor,
			claimId: 'b'.repeat(64),
			peerPubkey: 'c'.repeat(64),
			capabilities: ['blob-read'],
			status: { state: 'accepted' },
			updatedAt: 1_900_000_000,
			discoveredBlobHashes: [hash],
			mirroredBlobHashes: [hash],
		})
		const result = {
			nodeId: descriptor.nodeId,
			items: [{ sha256: hash, state: 'mirrored' as const }],
			remoteNode,
		}
		expect(remoteBlobMirrorResultSchema.parse(result)).toEqual(result)
	})
})
