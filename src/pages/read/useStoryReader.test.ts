import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { decodeStoryAddress, resolveStoryReaderRelays } from './useStoryReader'

describe('canonical Story reader address', () => {
	test('decodes one exact kind-37520 coordinate and keeps WebSocket hints', () => {
		const naddr = nip19.naddrEncode({
			kind: ARTICLE_KIND,
			pubkey: '11'.repeat(32),
			identifier: 'western-front',
			relays: ['wss://relay.example', 'https://not-a-relay.example'],
		})
		expect(decodeStoryAddress(naddr)).toEqual({
			naddr,
			pubkey: '11'.repeat(32),
			identifier: 'western-front',
			relays: ['wss://relay.example'],
		})
	})

	test('rejects malformed and wrong-kind addresses', () => {
		expect(decodeStoryAddress('not-an-naddr')).toBeNull()
		expect(
			decodeStoryAddress(
				nip19.naddrEncode({
					kind: GEO_EVENT_KIND,
					pubkey: '22'.repeat(32),
					identifier: 'a-map',
				}),
			),
		).toBeNull()
	})

	test('uses allowed hints first but always retains configured content relays', () => {
		expect(
			resolveStoryReaderRelays(
				{ relays: ['wss://hint.example', 'wss://blocked.example'] },
				['wss://content.example', 'wss://hint.example'],
				(relay) => relay !== 'wss://blocked.example',
			),
		).toEqual(['wss://hint.example', 'wss://content.example'])
	})
})
