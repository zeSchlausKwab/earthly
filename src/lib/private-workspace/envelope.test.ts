import { describe, expect, test } from 'bun:test'
import { createPrivateEnvelope, decodePrivateEnvelope, encodePrivateEnvelope } from './envelope'
import {
	decodePrivateMapInvitation,
	encodePrivateMapInvitation,
	type PrivateMapInvitation,
} from './invitation'

describe('private workspace envelope', () => {
	test('round-trips a deterministic Nostr-shaped envelope without a signature', () => {
		const envelope = createPrivateEnvelope({
			pubkey: 'a'.repeat(64),
			kind: 37515,
			createdAt: 1_700_000_000,
			tags: [['d', 'ridge-notes']],
			content: '{"type":"FeatureCollection","features":[]}',
		})
		const decoded = decodePrivateEnvelope(encodePrivateEnvelope(envelope))

		expect(decoded).toEqual(envelope)
		expect(decoded).not.toHaveProperty('sig')
	})

	test('rejects content tampering', () => {
		const envelope = createPrivateEnvelope({
			pubkey: 'a'.repeat(64),
			kind: 9,
			createdAt: 1,
			content: 'original',
		})
		const tampered = new TextEncoder().encode(JSON.stringify({ ...envelope, content: 'changed' }))

		expect(() => decodePrivateEnvelope(tampered)).toThrow('id mismatch')
	})
})

describe('private map invitation', () => {
	test('contains rendezvous data but no workspace metadata or epoch secret', () => {
		const invitation: PrivateMapInvitation = {
			version: 1,
			workspaceId: 'workspace-id',
			groupId: 'opaque-group-id',
			adminPubkey: 'a'.repeat(64),
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['ws://localhost:3334'],
			nonce: 'one-use-nonce',
		}
		const encoded = encodePrivateMapInvitation(invitation)

		expect(decodePrivateMapInvitation(encoded)).toEqual(invitation)
		expect(encoded).not.toContain('workspace name')
		expect(encoded).not.toContain('epoch')
	})
})
