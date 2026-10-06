import { describe, expect, test } from 'bun:test'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { convertGeoEventsToFeatureCollection } from '../utils'
import {
	countGeometryVertices,
	featureDetailDescription,
	featureDetailName,
	featureDetailProperties,
	formatFeatureProperty,
	resolveInspectedFeature,
} from './feature-details'

describe('Feature inspection details', () => {
	test('keeps source identities through tile queries and preserves indices after missing geometry', () => {
		const collection: FeatureCollection<Geometry | null> = {
			type: 'FeatureCollection' as const,
			features: [
				{ type: 'Feature' as const, properties: {}, geometry: null },
				{
					type: 'Feature' as const,
					properties: { name: 'Legacy feature' },
					geometry: { type: 'Point' as const, coordinates: [1, 2] },
				},
				{
					type: 'Feature' as const,
					id: 'mainz',
					properties: { name: 'Mainz' },
					geometry: { type: 'Point' as const, coordinates: [3, 4] },
				},
			],
		}
		const event = {
			id: 'event',
			datasetId: 'map',
			featureCollection: collection,
		} as unknown as GeoDataset
		const converted = convertGeoEventsToFeatureCollection([event])
		expect(converted.features.map((feature) => feature.properties?.featureId)).toEqual([
			'1',
			'mainz',
		])
		for (const rendered of converted.features) {
			expect(
				resolveInspectedFeature({ ...rendered, id: 0 } as Feature<Geometry>, collection).properties
					?.name,
			).toBe(rendered.properties?.name)
		}
	})
	test('resolves the full source feature even when a Story render ID and clipped geometry differ', () => {
		const source: Feature = {
			type: 'Feature',
			id: 0,
			properties: {
				name: 'Mainz',
				description: 'An archbishopric.',
				customProperties: { rulers: ['A', 'B'] },
			},
			geometry: {
				type: 'LineString',
				coordinates: [
					[1, 2],
					[3, 4],
					[5, 6],
				],
			},
		}
		const rendered: Feature<Geometry> = {
			...source,
			id: 'story-render-0',
			properties: { featureId: '0', earthlyPresentationLayerId: 'church' },
			geometry: {
				type: 'LineString',
				coordinates: [
					[1, 2],
					[2, 3],
				],
			},
		}
		const resolved = resolveInspectedFeature(
			rendered,
			{ type: 'FeatureCollection', features: [source] },
			'0',
		)
		expect(resolved).toBe(source)
		expect(featureDetailName(resolved)).toBe('Mainz')
		expect(featureDetailDescription(resolved)).toBe('An archbishopric.')
		expect(countGeometryVertices(resolved.geometry)).toBe(3)
		expect(featureDetailProperties(resolved)).toContainEqual(['rulers', ['A', 'B']])
	})
	test('keeps typed property values while removing renderer bookkeeping', () => {
		const feature: Feature = {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [1, 2] },
			properties: {
				featureId: 'f',
				datasetId: 'map',
				sourceEventId: 'event',
				proxyFeature: true,
				earthlyPresentationSource: 'source',
				population: 0,
				active: false,
				notes: null,
				customProperties: { period: { start: 1200 }, population: 12 },
			},
		}
		expect(featureDetailProperties(feature)).toEqual([
			['population', 12],
			['active', false],
			['notes', null],
			['period', { start: 1200 }],
		])
		expect(formatFeatureProperty({ start: 1200 })).toBe('{\n  "start": 1200\n}')
		expect(formatFeatureProperty(false)).toBe('false')
		expect(formatFeatureProperty(null)).toBe('null')
	})
	test('handles unnamed features, missing geometry and collection geometry', () => {
		expect(featureDetailName({ type: 'Feature', properties: {}, geometry: null })).toBe(
			'Unnamed feature',
		)
		expect(countGeometryVertices(null)).toBe(0)
		expect(
			countGeometryVertices({
				type: 'GeometryCollection',
				geometries: [
					{ type: 'Point', coordinates: [1, 2] },
					{
						type: 'LineString',
						coordinates: [
							[1, 2],
							[2, 3],
						],
					},
				],
			}),
		).toBe(3)
	})
})
