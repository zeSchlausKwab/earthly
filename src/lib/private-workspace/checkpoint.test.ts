import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { GEO_COMMENT_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	createWorkspaceCheckpointManifest,
	currentMapCheckpointEnvelopes,
	parseWorkspaceCheckpointManifest,
} from './checkpoint'
import { createPrivateEnvelope } from './envelope'
import { createAdministratorPolicyTransition, initialAdministratorPolicy } from './policy'
import type { StoredWorkspace } from './storage'

const secretKey = generateSecretKey()
const pubkey = getPublicKey(secretKey)
const memberPubkey = 'b'.repeat(64)
const groupId = 'earthly:checkpoint-test'
const signer = {
	signEvent: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, secretKey),
}

async function envelope(kind: number, content: string, d?: string) {
	return createPrivateEnvelope({
		signer,
		groupId,
		pubkey,
		kind,
		content,
		tags: d ? [['d', d]] : [],
	})
}

describe('private workspace checkpoints', () => {
	test('selects accepted policy and only the latest current dataset heads', async () => {
		const policy = createAdministratorPolicyTransition(initialAdministratorPolicy(pubkey), {
			pubkey: memberPubkey,
			administrator: true,
		})
		const policyEnvelope = await envelope(37524, JSON.stringify(policy), 'administrator-policy')
		const oldTrail = await envelope(GEO_EVENT_KIND, '{"name":"old trail"}', 'trail')
		const currentTrail = await envelope(GEO_EVENT_KIND, '{"name":"current trail"}', 'trail')
		const camp = await envelope(GEO_EVENT_KIND, '{"name":"camp"}', 'camp')
		const historicalComment = await envelope(
			GEO_COMMENT_KIND,
			'{"text":"before the new member joined"}',
			'comment-1',
		)
		const workspace = {
			adminPubkey: pubkey,
			envelopes: [policyEnvelope, oldTrail, historicalComment, currentTrail, camp],
		} as StoredWorkspace

		const selected = currentMapCheckpointEnvelopes(workspace)

		expect(selected.map((item) => item.id)).toEqual([policyEnvelope.id, currentTrail.id, camp.id])
		expect(selected).not.toContain(historicalComment)
	})

	test('round-trips a bounded current-map manifest and rejects duplicate ids', () => {
		const manifest = createWorkspaceCheckpointManifest({
			basisCursor: 42,
			envelopeIds: ['a'.repeat(64), 'b'.repeat(64)],
		})

		expect(parseWorkspaceCheckpointManifest(JSON.stringify(manifest))).toEqual(manifest)
		expect(() =>
			createWorkspaceCheckpointManifest({
				basisCursor: 42,
				envelopeIds: ['a'.repeat(64), 'a'.repeat(64)],
			}),
		).toThrow('unique')
	})
})
