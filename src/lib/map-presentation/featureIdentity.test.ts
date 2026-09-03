import { describe, expect, test } from 'bun:test'
import type { Feature, FeatureCollection } from 'geojson'
import { getPresentationFeatureId, selectPresentationFeatures } from './featureIdentity'

function point(id: Feature['id'], properties: Record<string, unknown> = {}): Feature {
	return {
		type: 'Feature',
		...(id !== undefined ? { id } : {}),
		properties,
		geometry: { type: 'Point', coordinates: [0, 0] },
	}
}

const collection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		point('canonical', { featureId: 'secondary', id: 'tertiary' }),
		point(undefined, { featureId: 42 }),
		point(undefined, { id: 'property-id' }),
		point(undefined, { name: 'unaddressable' }),
	],
}

describe('presentation feature identity', () => {
	test('uses feature.id, then properties.featureId, then properties.id', () => {
		expect(collection.features.map(getPresentationFeatureId)).toEqual([
			'canonical',
			'42',
			'property-id',
			undefined,
		])
	})

	test('undefined selects the whole source while [] intentionally selects nothing', () => {
		expect(selectPresentationFeatures(collection).featureCollection).toBe(collection)
		const empty = selectPresentationFeatures(collection, [])
		expect(empty.featureCollection.features).toEqual([])
		expect(empty.missingFeatureIds).toEqual([])
	})

	test('reports partial and missing selectors without widening', () => {
		const selected = selectPresentationFeatures(collection, ['property-id', 'gone', 'canonical'])
		expect(selected.featureCollection.features.map(getPresentationFeatureId)).toEqual([
			'canonical',
			'property-id',
		])
		expect(selected.matchedFeatureIds).toEqual(['property-id', 'canonical'])
		expect(selected.missingFeatureIds).toEqual(['gone'])
	})
})
