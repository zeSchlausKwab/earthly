import { describe, expect, test } from 'bun:test'
import { dupIdCollection, emptyFeatureCollection, singlePointCollection } from './geo'

describe('shared geo fixtures', () => {
	test('emptyFeatureCollection is an empty FeatureCollection', () => {
		expect(emptyFeatureCollection.type).toBe('FeatureCollection')
		expect(emptyFeatureCollection.features).toHaveLength(0)
	})

	test('singlePointCollection has one Point feature with a stable id and name', () => {
		expect(singlePointCollection.type).toBe('FeatureCollection')
		expect(singlePointCollection.features).toHaveLength(1)
		const feature = singlePointCollection.features[0]
		expect(feature?.id).toBe('test-point-1')
		expect(feature?.geometry.type).toBe('Point')
		expect(feature?.properties?.name).toBe('Test Point')
	})

	test('dupIdCollection has two features sharing one id', () => {
		expect(dupIdCollection.type).toBe('FeatureCollection')
		expect(dupIdCollection.features).toHaveLength(2)
		expect(dupIdCollection.features[0]?.id).toBe(dupIdCollection.features[1]?.id)
	})
})
