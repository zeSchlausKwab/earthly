import { describe, expect, it } from 'bun:test'
import { compactToolMessageContentForPrompt } from './helpers'

/**
 * UAT 21-round detour fix: a `search_location` result carries, per hit, a huge
 * `geojson` boundary polygon + verbose `extratags` that bury the `coordinates`.
 * The model-facing compaction seam must drop that noise while ALWAYS keeping
 * coordinates so the model can pick a hit without a reverse_lookup detour.
 */
describe('compactToolMessageContentForPrompt — geo result trimming', () => {
	function fatSearchLocationResult() {
		// Shape after extractMcpToolResult unwraps envelope.result.
		return {
			query: 'Berlin',
			count: 1,
			results: [
				{
					placeId: 240109189,
					displayName: 'Berlin, Germany',
					osmType: 'relation',
					osmId: 62422,
					coordinates: { lat: 52.5170365, lon: 13.3888599 },
					boundingbox: [52.3, 52.7, 13.0, 13.8],
					type: 'administrative',
					class: 'boundary',
					importance: 0.9,
					address: { city: 'Berlin', country: 'Germany' },
					extratags: {
						population: '3769495',
						wikidata: 'Q64',
						'name:en': 'Berlin',
						'name:fr': 'Berlin',
						admin_level: '4',
						capital: 'yes',
					},
					geojson: {
						type: 'Polygon',
						coordinates: [
							Array.from({ length: 1000 }, (_, i) => [13.0 + i * 0.0001, 52.3 + i * 0.0001]),
						],
					},
				},
			],
		}
	}

	it('drops geojson boundary polygon and extratags but keeps coordinates', () => {
		const compacted = compactToolMessageContentForPrompt(JSON.stringify(fatSearchLocationResult()))
		const parsed = JSON.parse(compacted)
		const item = (parsed.sampleResults ?? parsed.results)[0]

		// Noise stripped.
		expect(compacted).not.toContain('geojson')
		expect(compacted).not.toContain('extratags')
		expect(compacted).not.toContain('wikidata')
		expect(compacted).not.toContain('Q64')

		// Essentials retained.
		expect(item.coordinates).toEqual({ lat: 52.5170365, lon: 13.3888599 })
		expect(item.displayName).toBe('Berlin, Germany')
		expect(item.osmType).toBe('relation')
		expect(item.osmId).toBe(62422)
		expect(item.boundingbox).toEqual([52.3, 52.7, 13.0, 13.8])
	})

	it('keeps coordinates for a nested reverse_lookup result', () => {
		const reverseResult = {
			coordinates: { lat: 52.51, lon: 13.38 },
			zoom: 18,
			result: {
				placeId: 1,
				displayName: 'Brandenburg Gate, Berlin',
				osmType: 'way',
				osmId: 518071791,
				coordinates: { lat: 52.5162746, lon: 13.3777041 },
				type: 'attraction',
				class: 'tourism',
				address: { road: 'Pariser Platz' },
				extratags: { wikidata: 'Q82425', heritage: '2' },
				geojson: { type: 'Point', coordinates: [13.3777041, 52.5162746] },
			},
		}
		const compacted = compactToolMessageContentForPrompt(JSON.stringify(reverseResult))
		const parsed = JSON.parse(compacted)

		expect(compacted).not.toContain('extratags')
		expect(compacted).not.toContain('Q82425')
		expect(parsed.result.coordinates).toEqual({ lat: 52.5162746, lon: 13.3777041 })
		expect(parsed.result.displayName).toBe('Brandenburg Gate, Berlin')
	})

	it('leaves non-geo tool results untouched', () => {
		const plain = { foo: 'bar', items: [1, 2, 3] }
		const compacted = compactToolMessageContentForPrompt(JSON.stringify(plain))
		expect(JSON.parse(compacted)).toEqual(plain)
	})
})
