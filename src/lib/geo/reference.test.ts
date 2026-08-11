import { describe, expect, it } from 'bun:test'
import { extractGeoReferences, parseGeoReference, stringifyGeoReference } from './reference'

const NADDR = `naddr1${'z'.repeat(80)}`

describe('geo references', () => {
	it('uses RFC 5870 latitude,longitude order for coordinate references', () => {
		const reference = { kind: 'coordinate' as const, latitude: 52.516275, longitude: 13.377704 }
		expect(stringifyGeoReference(reference)).toBe('geo:52.516275,13.377704')
		expect(parseGeoReference('geo:52.516275,13.377704')).toEqual(reference)
	})

	it('validates coordinate bounds', () => {
		expect(parseGeoReference('geo:91,13')).toBeNull()
		expect(parseGeoReference('geo:52,181')).toBeNull()
	})

	it('normalizes OpenStreetMap element URLs', () => {
		expect(parseGeoReference('https://openstreetmap.org/relation/62422/')).toEqual({
			kind: 'osm',
			elementType: 'relation',
			id: '62422',
		})
		expect(stringifyGeoReference({ kind: 'osm', elementType: 'way', id: '123' })).toBe(
			'https://www.openstreetmap.org/way/123',
		)
	})

	it('extracts mixed spatial references from prose', () => {
		const text = `At geo:52.516275,13.377704, see nostr:${NADDR}#relation%2F62504 and https://www.openstreetmap.org/way/123.`
		const matches = extractGeoReferences(text)
		expect(matches.map((match) => match.reference.kind)).toEqual(['coordinate', 'nostr', 'osm'])
		expect(matches[1]?.reference).toEqual({
			kind: 'nostr',
			address: NADDR,
			featureId: 'relation/62504',
		})
	})
})
