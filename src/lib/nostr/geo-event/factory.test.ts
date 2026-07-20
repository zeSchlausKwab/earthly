import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import type { GeoDatasetEvent } from './helpers'
import { GeoDatasetFactory } from './factory'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

const featureCollection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

describe('GeoDatasetFactory.update', () => {
	test('creates a strictly newer addressable replacement', async () => {
		const previous = {
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
			kind: GEO_EVENT_KIND,
			created_at: 2_000_000_000,
			content: JSON.stringify(featureCollection),
			tags: [
				['d', 'dataset-lineage'],
				['v', '4'],
			],
		} satisfies GeoDatasetEvent

		const update = await GeoDatasetFactory.update(previous, featureCollection)

		expect(update.created_at).toBe(previous.created_at + 1)
		expect(update.tags).toContainEqual(['d', 'dataset-lineage'])
		expect(update.tags).toContainEqual(['v', '5'])
		expect(update.tags).toContainEqual(['p', previous.id])
	})
})
