import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import {
	collectCalloutMedia,
	getFeatureCallouts,
	MAP_CALLOUTS_PROPERTY,
	normalizeMapCallout,
	withFeatureCallouts,
} from './callouts'

describe('map callout model', () => {
	test('normalizes content, media, and placement without accepting malformed entries', () => {
		expect(
			normalizeMapCallout({
				id: ' c1 ',
				text: 'Plain text',
				media: [{ url: ' https://example.test/photo.jpg ', mimeType: 'image/jpeg' }, {}],
				placement: { side: 'right', offset: [12, -4], leader: 'line' },
			}),
		).toEqual({
			id: 'c1',
			text: 'Plain text',
			media: [{ url: 'https://example.test/photo.jpg', mimeType: 'image/jpeg' }],
			placement: { side: 'right', offset: [12, -4], leader: 'line' },
		})
		expect(normalizeMapCallout({ id: '', text: 'missing id' })).toBeNull()
	})

	test('round-trips the namespaced feature property and removes it when empty', () => {
		const feature = {
			type: 'Feature' as const,
			id: 'f1',
			geometry: { type: 'Point' as const, coordinates: [16.37, 48.21] },
			properties: { name: 'Vienna' },
		}
		const next = withFeatureCallouts(feature, [{ id: 'c1', text: 'Center' }])
		expect(getFeatureCallouts(next)).toEqual([{ id: 'c1', text: 'Center' }])
		expect(
			(withFeatureCallouts(next, []).properties as Record<string, unknown>)[MAP_CALLOUTS_PROPERTY],
		).toBeUndefined()
	})

	test('preserves unknown extension fields while normalizing known fields', () => {
		expect(
			normalizeMapCallout({
				id: 'extended',
				text: 'Future data',
				futureField: { version: 3 },
				placement: { side: 'top', futurePlacement: 'kept' },
			}),
		).toMatchObject({
			futureField: { version: 3 },
			placement: { side: 'top', futurePlacement: 'kept' },
		})
	})

	test('collects unique structured media across the dataset', () => {
		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [0, 0] },
					properties: {
						[MAP_CALLOUTS_PROPERTY]: [
							{ id: 'a', text: 'A', media: [{ url: 'https://x.test/a.jpg' }] },
							{ id: 'b', text: 'B', media: [{ url: 'https://x.test/a.jpg' }] },
						],
					},
				},
			],
		}
		expect(collectCalloutMedia(collection)).toEqual([{ url: 'https://x.test/a.jpg' }])
	})
})
