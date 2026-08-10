import { describe, expect, it } from 'bun:test'
import {
	decodeNostrFeatureId,
	dedupeNostrAddressReferences,
	encodeNostrFeatureId,
	extractNostrAddressReferences,
	parseNostrAddressReference,
	stringifyNostrAddressReference,
} from './references'

const NADDR = `naddr1${'q'.repeat(80)}`

describe('fine-grained Nostr address references', () => {
	it('keeps legacy simple fragments backwards compatible', () => {
		expect(parseNostrAddressReference(`nostr:${NADDR}#checkpoint-alpha`)).toEqual({
			address: NADDR,
			featureId: 'checkpoint-alpha',
		})
	})

	it('round-trips arbitrary GeoJSON ids through an encoded fragment', () => {
		const reference = { address: NADDR, featureId: 'relation/62504.v2' }
		const text = stringifyNostrAddressReference(reference)
		expect(text).toBe(`nostr:${NADDR}#relation%2F62504%2Ev2`)
		expect(parseNostrAddressReference(text)).toEqual(reference)
	})

	it('extracts encoded feature references without swallowing prose punctuation', () => {
		const text = `Cross nostr:${NADDR}#way%2F42. Then continue via nostr:${NADDR}.`
		expect(extractNostrAddressReferences(text)).toEqual([
			{ address: NADDR, featureId: 'way/42' },
			{ address: NADDR, featureId: undefined },
		])
	})

	it('handles unicode ids and rejects malformed escapes', () => {
		const encoded = encodeNostrFeatureId('Grenzübergang/α')
		expect(decodeNostrFeatureId(encoded)).toBe('Grenzübergang/α')
		expect(parseNostrAddressReference(`nostr:${NADDR}#bad%escape`)).toBeNull()
	})

	it('deduplicates exact selectors while keeping dataset and feature refs distinct', () => {
		expect(
			dedupeNostrAddressReferences([
				{ address: NADDR },
				{ address: NADDR, featureId: 'way/42' },
				{ address: NADDR, featureId: 'way/42' },
			]),
		).toHaveLength(2)
	})
})
