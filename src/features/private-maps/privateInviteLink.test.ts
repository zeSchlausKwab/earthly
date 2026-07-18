import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import {
	createPrivateMapInvitation,
	encodePrivateMapInvitation,
	PRIVATE_MAP_INVITATION_TTL_SECONDS,
	type PrivateMapInvitation,
} from '@/lib/private-workspace'
import { parsePrivateInviteLink } from './privateInviteLink'

function invitationToken(workspaceId = 'workspace one') {
	const invitation: PrivateMapInvitation = {
		version: 1,
		workspaceId,
		groupId: 'group-1',
		adminPubkey: 'a'.repeat(64),
		coordinatorPubkey: 'b'.repeat(64),
		relays: ['wss://relay.earthly.city'],
		nonce: 'scan-test',
	}
	return encodePrivateMapInvitation(invitation)
}

describe('private invite QR links', () => {
	test('extracts a validated invitation from the canonical shared route', () => {
		const invitation = invitationToken()
		const url = `https://earthly.city/privategroup/workspace%20one?private-invite=${invitation}`

		expect(parsePrivateInviteLink(url)).toEqual({
			workspaceId: 'workspace one',
			invitation,
		})
	})

	test('accepts surrounding whitespace from a pasted invitation link', () => {
		const invitation = invitationToken('workspace-1')
		const url = `https://earthly.city/privategroup/workspace-1?private-invite=${invitation}`

		expect(parsePrivateInviteLink(`  ${url}\n`)).toEqual({
			workspaceId: 'workspace-1',
			invitation,
		})
	})

	test('accepts the earlier hyphenated preview route', () => {
		const invitation = invitationToken('workspace-1')

		expect(
			parsePrivateInviteLink(
				`http://localhost:3000/private-group/workspace-1?private-invite=${invitation}`,
			),
		).toEqual({ workspaceId: 'workspace-1', invitation })
	})

	test('rejects a route whose workspace does not match the signed invitation', () => {
		const invitation = invitationToken('workspace-1')

		expect(() =>
			parsePrivateInviteLink(
				`https://earthly.city/privategroup/workspace-2?private-invite=${invitation}`,
			),
		).toThrow('does not match')
	})

	test('rejects unrelated QR content', () => {
		expect(() => parsePrivateInviteLink('https://example.com/not-an-invite')).toThrow(
			'private-group route',
		)
	})

	test('rejects an expired signed invitation', async () => {
		const secretKey = generateSecretKey()
		const issuedAt = 1_700_000_000
		const invitation = await createPrivateMapInvitation({
			signer: { signEvent: async (event) => finalizeEvent(event, secretKey) },
			workspaceId: 'workspace-1',
			groupId: 'group-1',
			adminPubkey: getPublicKey(secretKey),
			coordinatorPubkey: 'b'.repeat(64),
			relays: ['wss://relay.earthly.city'],
			nonce: 'expired-scan-test',
			issuedAt,
		})
		const url = `https://earthly.city/privategroup/workspace-1?private-invite=${invitation}`

		expect(() =>
			parsePrivateInviteLink(url, (issuedAt + PRIVATE_MAP_INVITATION_TTL_SECONDS) * 1000),
		).toThrow('expired')
	})
})
