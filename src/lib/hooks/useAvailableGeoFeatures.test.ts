import { describe, expect, it } from 'bun:test'
import { getOsmReferenceForFeature } from './useAvailableGeoFeatures'

describe('getOsmReferenceForFeature', () => {
	it('recognizes OSM-derived GeoJSON ids', () => {
		expect(
			getOsmReferenceForFeature({
				type: 'Feature',
				id: 'relation/62504',
				properties: {},
				geometry: { type: 'Point', coordinates: [0, 0] },
			}),
		).toBe('https://www.openstreetmap.org/relation/62504')
	})

	it('recognizes split osm_type/osm_id properties', () => {
		expect(
			getOsmReferenceForFeature({
				type: 'Feature',
				properties: { osm_type: 'way', osm_id: 42 },
				geometry: { type: 'LineString', coordinates: [] },
			}),
		).toBe('https://www.openstreetmap.org/way/42')
	})

	it('does not mistake ordinary ids for OSM elements', () => {
		expect(
			getOsmReferenceForFeature({
				type: 'Feature',
				id: 'checkpoint-alpha',
				properties: {},
				geometry: { type: 'Point', coordinates: [0, 0] },
			}),
		).toBeNull()
	})
})
