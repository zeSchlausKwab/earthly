import { describe, expect, test } from 'bun:test'
import {
	localNodeStatusSchema,
	nativeSchemas,
	pairingInvitationSchema,
	remoteNodeRecordSchema,
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
			version: 1,
			nodeId: descriptor.nodeId,
			descriptor,
			claimId: 'b'.repeat(64),
			peerPubkey: 'c'.repeat(64),
			peerName: 'Trail phone',
			capabilities: ['relay-write', 'blob-read'],
			status: { state: 'pending' },
			updatedAt: 1_900_000_000,
		}
		expect(remoteNodeRecordSchema.parse(remote)).toEqual(remote)
	})

	test('accepts a bounded native sync result and its durable checkpoint', () => {
		const remoteNode = {
			version: 1,
			nodeId: descriptor.nodeId,
			descriptor,
			claimId: 'b'.repeat(64),
			peerPubkey: 'c'.repeat(64),
			capabilities: ['relay-read'],
			status: { state: 'accepted' },
			updatedAt: 1_900_000_000,
			lastSync: { syncedAt: 1_900_000_000, receivedEvents: 0 },
		}
		const result = {
			nodeId: descriptor.nodeId,
			receivedEvents: 0,
			hydratedEvents: 0,
			eventsTruncated: false,
			events: [],
			remoteNode,
		}
		expect(remoteSyncResultSchema.parse(result)).toEqual(result)
	})
})
