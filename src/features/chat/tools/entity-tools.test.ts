import { describe, expect, it } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { parseEntityReference } from './entity-tools'

const PUBKEY = 'a'.repeat(64)

describe('parseEntityReference', () => {
	it('decodes a bare naddr', () => {
		const naddr = nip19.naddrEncode({ kind: 37520, pubkey: PUBKEY, identifier: 'my-story' })
		expect(parseEntityReference(naddr)).toEqual({
			kind: 37520,
			pubkey: PUBKEY,
			identifier: 'my-story',
		})
	})

	it('strips the nostr: prefix and a #featureId fragment', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'lanes' })
		expect(parseEntityReference(`nostr:${naddr}#feature-7`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'lanes',
		})
	})

	it('accepts a kind:pubkey:d coordinate', () => {
		expect(parseEntityReference(`37518:${PUBKEY}:topic-1`)).toEqual({
			kind: 37518,
			pubkey: PUBKEY,
			identifier: 'topic-1',
		})
	})

	it('keeps colons inside the d-tag of a coordinate', () => {
		expect(parseEntityReference(`37515:${PUBKEY}:a:b:c`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'a:b:c',
		})
	})

	it('rejects empty and malformed references', () => {
		expect(() => parseEntityReference('')).toThrow()
		expect(() => parseEntityReference(undefined)).toThrow()
		expect(() => parseEntityReference('naddr1notreal')).toThrow()
		expect(() => parseEntityReference('37515:onlytwo')).toThrow()
		expect(() => parseEntityReference('nan:pk:d')).toThrow()
	})
})
