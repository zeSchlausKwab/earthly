import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools'
import { createPrivateEnvelope, decodePrivateEnvelope, encodePrivateEnvelope } from './envelope'
import {
	decodePrivateMapInvitation,
	encodePrivateMapInvitation,
	type PrivateMapInvitation,
} from './invitation'

describe('private workspace envelope', () => {
	const groupId = 'earthly:test-group'
	const secretKey = generateSecretKey()
	const pubkey = getPublicKey(secretKey)
	const signer = {
		signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
			finalizeEvent(event, secretKey),
	}

	test('round-trips an authorized envelope while keeping the payload unsigned', async () => {
		const envelope = await createPrivateEnvelope({
			signer,
			groupId,
			pubkey,
			kind: 37515,
			createdAt: 1_700_000_000,
			tags: [['d', 'ridge-notes']],
			content: '{"type":"FeatureCollection","features":[]}',
		})
		const decoded = decodePrivateEnvelope(encodePrivateEnvelope(envelope), groupId)

		expect(decoded).toEqual(envelope)
		expect(decoded).not.toHaveProperty('sig')
		expect(decoded.authorization.event.sig).toHaveLength(128)
		expect(decoded.authorization.event.content).not.toContain(groupId)
		expect(decoded.authorization.event.content).not.toContain(envelope.content)
	})

	test('rejects content tampering', async () => {
		const envelope = await createPrivateEnvelope({
			signer,
			groupId,
			pubkey,
			kind: 9,
			createdAt: 1,
			content: 'original',
		})
		const tampered = new TextEncoder().encode(JSON.stringify({ ...envelope, content: 'changed' }))

		expect(() => decodePrivateEnvelope(tampered, groupId)).toThrow('id mismatch')
	})

	test('rejects a forged envelope author even when its payload id is recomputed', async () => {
		const envelope = await createPrivateEnvelope({
			signer,
			groupId,
			pubkey,
			kind: 9,
			createdAt: 1,
			content: 'original',
		})
		const forgedPubkey = 'b'.repeat(64)
		const forgedUnsigned = { ...envelope, pubkey: forgedPubkey }
		const forged = {
			...forgedUnsigned,
			id: getEventHash({
				pubkey: forgedPubkey,
				created_at: forgedUnsigned.created_at,
				kind: forgedUnsigned.kind,
				tags: forgedUnsigned.tags,
				content: forgedUnsigned.content,
			}),
		}

		expect(() =>
			decodePrivateEnvelope(new TextEncoder().encode(JSON.stringify(forged)), groupId),
		).toThrow('author mismatch')
	})

	test('rejects a tampered authorization signature', async () => {
		const envelope = await createPrivateEnvelope({
			signer,
			groupId,
			pubkey,
			kind: 9,
			content: 'signed',
		})
		const tampered = {
			...envelope,
			authorization: {
				...envelope.authorization,
				event: { ...envelope.authorization.event, sig: '0'.repeat(128) },
			},
		}

		expect(() =>
			decodePrivateEnvelope(new TextEncoder().encode(JSON.stringify(tampered)), groupId),
		).toThrow('signature')
	})

	test('rejects replay into another MLS group', async () => {
		const envelope = await createPrivateEnvelope({
			signer,
			groupId,
			pubkey,
			kind: 9,
			content: 'group bound',
		})

		expect(() =>
			decodePrivateEnvelope(encodePrivateEnvelope(envelope), 'earthly:another-group'),
		).toThrow('another envelope or MLS group')
	})

	test('rejects unsigned legacy envelopes', () => {
		const unsigned = {
			pubkey,
			created_at: 1,
			kind: 9,
			tags: [],
			content: 'legacy',
		}
		const legacy = { ...unsigned, id: getEventHash(unsigned) }

		expect(() =>
			decodePrivateEnvelope(new TextEncoder().encode(JSON.stringify(legacy)), groupId),
		).toThrow('authorization')
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
