import { expect, test } from 'bun:test'
import {
	normalizeGeoJsonToFeatureCollection,
	normalizeRenderableFeatureCollection,
} from './normalizeGeoJSON'

test('normalization retains nullable metadata; rendering rejects invalid geometry without mutating input', () => {
	const input = {
		type: 'FeatureCollection',
		name: 'Imported map',
		features: [
			{
				type: 'Feature',
				id: 'valid',
				properties: { name: 'Place' },
				geometry: { type: 'Point', coordinates: [16, 48] },
			},
			{
				type: 'Feature',
				id: 'invalid',
				properties: { source: 'retained' },
				geometry: { type: 'Point', coordinates: ['bad', 48] },
			},
			{ type: 'Feature', id: 'missing', properties: {}, geometry: null },
		],
	}
	const before = structuredClone(input)
	const normalized = normalizeGeoJsonToFeatureCollection(input)
	expect(normalized.features.map((feature) => feature.geometry)).toEqual([
		{ type: 'Point', coordinates: [16, 48] },
		null,
		null,
	])
	expect(normalized.features[1]?.properties).toEqual({ source: 'retained' })
	const renderable = normalizeRenderableFeatureCollection(input)
	expect(renderable).toMatchObject({ name: 'Imported map', features: [input.features[0]] })
	expect(renderable.features).toHaveLength(1)
	expect(input).toEqual(before)
})

test('nested feature geometry preserves outer metadata and valid collection geometries', () => {
	const result = normalizeRenderableFeatureCollection({
		type: 'Feature',
		id: 'outer',
		properties: { name: 'Outer' },
		geometry: {
			type: 'Feature',
			id: 'inner',
			properties: { name: 'Inner', source: 'nested' },
			geometry: {
				type: 'GeometryCollection',
				geometries: [{ type: 'Point', coordinates: [0, 0] }],
			},
		},
	})
	expect(result.features[0]).toMatchObject({
		id: 'outer',
		properties: { name: 'Outer', source: 'nested' },
		geometry: { type: 'GeometryCollection' },
	})
	expect(
		normalizeRenderableFeatureCollection({ type: 'FeatureCollection', features: 'invalid' })
			.features,
	).toEqual([])
})
