import { describe, expect, test } from 'bun:test'
import {
	localBlobAccessSchema,
	localNodeStatusSchema,
	nativeSchemas,
	outboxItemSchema,
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
	test('accepts a short-lived authenticated local blob endpoint', () => {
		expect(
			localBlobAccessSchema.parse({
				url: `http://127.0.0.1:17448/${'a'.repeat(64)}`,
				authorization: 'Nostr signed-event',
				expiresAt: 1_800_000_000,
			}),
		).toMatchObject({ authorization: 'Nostr signed-event' })
	})

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
			capabilities: ['relay-write', 'blob-read'] as Array<'relay-write' | 'blob-read'>,
			status: { state: 'pending' as const },
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
			capabilities: ['relay-read'] as Array<'relay-read'>,
			status: { state: 'accepted' as const },
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

	test('keeps saved-region progress and storage cleanup contracts distinct', () => {
		const progress = {
			regionId: 'weekend-hike',
			status: 'downloading' as const,
			bytesTotal: 1_024,
			bytesDone: 512,
			blobsTotal: 2,
			blobsDone: 1,
			currentHash: 'd'.repeat(64),
			errorCode: null,
			message: null,
		}
		expect(nativeSchemas.savedRegionProgress.parse(progress)).toEqual(progress)
		expect(
			nativeSchemas.savedRegionGarbageCollection.parse({
				removedBlobs: 2,
				reclaimedBytes: 1_024,
				retainedBlobs: 1,
			}),
		).toEqual({ removedBlobs: 2, reclaimedBytes: 1_024, retainedBlobs: 1 })
	})

	test('accepts the versioned native outbox delivery state', () => {
		const eventId = 'e'.repeat(64)
		const item = {
			version: 1,
			id: eventId,
			eventJson: '{}',
			eventId,
			eventKind: 1,
			routing: 'reply',
			targetPubkey: 'f'.repeat(64),
			state: 'retryWait',
			attemptCount: 1,
			nextAttemptAt: 1_900_000_005,
			createdAt: 1_900_000_000,
			updatedAt: 1_900_000_000,
			lastError: 'offline',
			relays: [
				{
					relayUrl: 'wss://relay.example/',
					required: true,
					state: 'rejected',
					attempts: 1,
					lastError: 'offline',
				},
			],
		}
		expect(outboxItemSchema.parse(item).id).toBe(eventId)
		expect(nativeSchemas.outboxItems.parse([item])).toHaveLength(1)
		const { eventJson: _signedBytes, ...summary } = item
		expect(nativeSchemas.outboxItemSummaries.parse([summary])).toHaveLength(1)
	})
})
