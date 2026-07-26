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
	test('accepts a bounded durable native account session', () => {
		const session = {
			version: 1 as const,
			accountsJson: '[{"id":"nsec:abc","type":"nsec"}]',
			activeAccountId: 'nsec:abc',
		}

		expect(nativeSchemas.accountSession.parse(session)).toEqual(session)
		expect(() =>
			nativeSchemas.accountSession.parse({
				...session,
				accountsJson: 'x'.repeat(1024 * 1024 + 1),
			}),
		).toThrow()
	})

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
		expect(
			nativeSchemas.savedRegionDeletionRetention.parse({
				retainedEvents: 1,
				regionAttachments: 2,
			}),
		).toEqual({ retainedEvents: 1, regionAttachments: 2 })
	})

	test('requires saved-region hydration to account for every manifest event id', () => {
		const event = {
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			created_at: 1_900_000_000,
			kind: 37_515,
			tags: [['d', 'offline-dataset']],
			content: '{}',
			sig: 'c'.repeat(128),
		}
		const hydration = {
			regionId: 'weekend-hike',
			expectedEvents: 2,
			cursor: 0,
			nextCursor: null,
			events: [event],
			missingEventIds: ['d'.repeat(64)],
		}
		expect(nativeSchemas.savedRegionEventHydration.parse(hydration)).toEqual(hydration)
		expect(() =>
			nativeSchemas.savedRegionEventHydration.parse({
				...hydration,
				expectedEvents: 3,
			}),
		).toThrow('manifest count')
		expect(() =>
			nativeSchemas.savedRegionEventHydration.parse({
				...hydration,
				expectedEvents: 129,
				events: Array.from({ length: 128 }, (_, index) => ({
					...event,
					id: index.toString(16).padStart(64, '0'),
				})),
			}),
		).toThrow('record limit')
		expect(() =>
			nativeSchemas.savedRegionEventHydration.parse({
				...hydration,
				expectedEvents: 2,
				nextCursor: 1,
				events: [],
				missingEventIds: [],
			}),
		).toThrow('cursor is inconsistent')
		expect(
			nativeSchemas.savedRegionEventHydration.parse({
				...hydration,
				expectedEvents: 4_097,
				cursor: 4_096,
				nextCursor: null,
				events: [event],
				missingEventIds: [],
			}),
		).toMatchObject({ expectedEvents: 4_097, cursor: 4_096 })
	})

	test('accepts a redacted support report without identities or content', () => {
		const report = {
			schemaVersion: 1 as const,
			generatedAt: 1_900_000_000,
			app: { version: '0.0.1', targetOs: 'android', targetArch: 'aarch64' },
			privacy: { redacted: true as const, excludes: ['identities', 'geometry'] },
			localNode: {
				state: 'running' as const,
				endpointScope: 'loopback' as const,
				availability: 'process' as const,
				lanActive: false,
				globalPeerGrants: 0,
				fieldSessionGrants: 2,
				fieldSessionScopes: 1,
				pendingClaims: 0,
				remoteNodes: 1,
				remotePending: 0,
				remoteAccepted: 1,
				remoteRejected: 0,
				remoteFieldSessions: 1,
				discoveredBlobs: 2,
				mirroredBlobs: 1,
				storageAvailableBytes: 1_024,
				storageTotalBytes: 2_048,
				collectionErrors: [],
			},
			savedRegions: {
				total: 1,
				planned: 0,
				downloading: 0,
				ready: 1,
				failed: 0,
				activeDownloads: 0,
				blobReferences: 2,
				uniqueAvailableBlobs: 2,
				managedBlobs: 2,
				managedBytes: 1_024,
				orphanedManagedBlobs: 0,
			},
			publishOutbox: {
				total: 1,
				queued: 0,
				delivering: 0,
				delivered: 1,
				partial: 0,
				retryWait: 0,
				rejected: 0,
				discarded: 0,
				relayPending: 0,
				relayAcknowledged: 1,
				relayRejected: 0,
			},
		}
		expect(nativeSchemas.supportDiagnosticReport.parse(report)).toEqual(report)
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
