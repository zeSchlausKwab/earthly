import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { buildInboxTargetHref } from './navigation'

const PUBKEY = 'a'.repeat(64)

describe('buildInboxTargetHref', () => {
	test('opens an entity comment on the canonical route and Comments tab', () => {
		const href = buildInboxTargetHref({
			type: 'entity',
			entityKind: 'map',
			coordinate: `${GEO_EVENT_KIND}:${PUBKEY}:river:west`,
			tab: 'comments',
			commentId: 'reply/one',
		})
		const expectedNaddr = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey: PUBKEY,
			identifier: 'river:west',
		})
		expect(href).toBe(`/map/${expectedNaddr}/comment/reply%2Fone?tab=comments`)
	})

	test('opens a person with an npub route and rejects malformed coordinates', () => {
		expect(buildInboxTargetHref({ type: 'person', pubkey: PUBKEY })).toBe(
			`/person/${nip19.npubEncode(PUBKEY)}`,
		)
		expect(
			buildInboxTargetHref({
				type: 'entity',
				entityKind: 'map',
				coordinate: 'not-a-coordinate',
				tab: 'details',
			}),
		).toBeNull()
	})
})
