import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND } from '../kinds'
import { getStoryReaderPath } from './routes'

describe('getStoryReaderPath', () => {
	test('builds the canonical reader route', () => {
		const pubkey = 'a'.repeat(64)
		const path = getStoryReaderPath({ pubkey, dTag: 'western-front', kind: ARTICLE_KIND })
		expect(path?.startsWith('/read/naddr1')).toBe(true)
		const decoded = nip19.decode(path?.slice('/read/'.length) ?? '')
		expect(decoded).toEqual({
			type: 'naddr',
			data: { pubkey, kind: ARTICLE_KIND, identifier: 'western-front', relays: [] },
		})
	})

	test('does not create a reader route without an addressable identifier', () => {
		expect(getStoryReaderPath({ pubkey: 'a'.repeat(64), dTag: '' })).toBeNull()
	})
})
