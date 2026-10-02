import { describe, expect, test } from 'bun:test'
import { area, bbox, booleanPointInPolygon, polygon } from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import {
	performPolygonBoolean,
	POLYGON_BOOLEAN_MAX_VERTICES,
	PolygonBooleanError,
	type PolygonGeometry,
} from './polygonBoolean'

function square(west = 0, south = 0, east = 10, north = 10): Feature<Polygon> {
	return polygon([
		[
			[west, south],
			[east, south],
			[east, north],
			[west, north],
			[west, south],
		],
	])
}

function outerRing(feature: Feature<Polygon>) {
	const ring = feature.geometry.coordinates[0]
	if (!ring) throw new Error('Expected an outer ring')
	return ring
}

function resultFeature(
	geometry: ReturnType<typeof performPolygonBoolean>['geometry'],
): Feature<PolygonGeometry> {
	if (!geometry) throw new Error('Expected a polygon result')
	return { type: 'Feature', geometry, properties: {} }
}

describe('shared polygon Boolean primitive', () => {
	test('intersection clips to the union of masks, retaining disjoint pieces', () => {
		const source = square()
		const masks = [square(-1, 1, 3, 9), square(7, 1, 11, 9)]
		const before = structuredClone([source, ...masks])
		const result = performPolygonBoolean(source, masks, 'intersection')
		expect(result.emptyResult).toBe(false)
		expect(result.geometry?.type).toBe('MultiPolygon')
		const output = resultFeature(result.geometry)
		expect(booleanPointInPolygon([1, 5], output)).toBe(true)
		expect(booleanPointInPolygon([9, 5], output)).toBe(true)
		expect(booleanPointInPolygon([5, 5], output)).toBe(false)
		expect(area(output)).toBeCloseTo(area(square(0, 1, 3, 9)) + area(square(7, 1, 10, 9)), 2)
		expect([source, ...masks]).toEqual(before)
	})

	test('difference preserves holes and subtracts every mask exactly once', () => {
		const source = square()
		const result = performPolygonBoolean(
			source,
			[square(1, 1, 3, 3), square(2, 2, 4, 4)],
			'difference',
		)
		const output = resultFeature(result.geometry)
		expect(output.geometry.type).toBe('Polygon')
		expect(booleanPointInPolygon([0.5, 0.5], output)).toBe(true)
		expect(booleanPointInPolygon([1.5, 1.5], output)).toBe(false)
		expect(booleanPointInPolygon([3.5, 3.5], output)).toBe(false)
		expect((output.geometry as Polygon).coordinates).toHaveLength(2)
	})

	test('union includes MultiPolygon components and valid isolated point contacts', () => {
		const source: Feature = {
			type: 'Feature',
			properties: {},
			geometry: {
				type: 'MultiPolygon',
				coordinates: [
					square(0, 0, 1, 1).geometry.coordinates,
					square(1, 1, 2, 2).geometry.coordinates,
				],
			},
		}
		const output = resultFeature(
			performPolygonBoolean(source, [square(3, 3, 4, 4)], 'union').geometry,
		)
		expect(bbox(output)).toEqual([0, 0, 4, 4])
		expect(booleanPointInPolygon([3.5, 3.5], output)).toBe(true)
	})

	test('empty intersection and fully subtracted difference explicitly return no geometry', () => {
		for (const [operation, mask] of [
			['intersection', square(20, 20, 30, 30)],
			['difference', square(-1, -1, 11, 11)],
		] as const) {
			expect(performPolygonBoolean(square(), [mask], operation)).toMatchObject({
				geometry: null,
				emptyResult: true,
				outputVertices: 0,
			})
		}
	})

	test('rejects invalid topology, out-of-range/3D coordinates and ambiguous date-line crossings', () => {
		const invalid: Feature[] = [
			{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
			polygon([
				[
					[0, 0],
					[2, 2],
					[0, 2],
					[2, 0],
					[0, 0],
				],
			]),
			{
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[0, 0],
							[1, 0],
							[1, 1],
							[0, 1],
						],
					],
				},
			},
			polygon([
				[
					[0, 0],
					[181, 0],
					[181, 1],
					[0, 0],
				],
			]),
			polygon([
				[
					[0, 0, 1],
					[1, 0, 1],
					[1, 1, 1],
					[0, 0, 1],
				],
			]),
			polygon([
				[
					[179, 0],
					[-179, 0],
					[-179, 2],
					[179, 2],
					[179, 0],
				],
			]),
			polygon([outerRing(square()), outerRing(square(20, 20, 21, 21))]),
			polygon([outerRing(square()), outerRing(square(1, 1, 4, 4)), outerRing(square(2, 2, 3, 3))]),
		]
		for (const input of invalid)
			expect(() => performPolygonBoolean(input, [square()], 'intersection')).toThrow(
				PolygonBooleanError,
			)
	})

	test('checks geometry budgets before quadratic topology work', () => {
		const coordinates = Array.from({ length: POLYGON_BOOLEAN_MAX_VERTICES + 1 }, (_, index) => [
			index % 2,
			0,
		])
		coordinates.push(coordinates[0] ?? [0, 0])
		const source: Feature = {
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [coordinates] },
		}
		expect(() => performPolygonBoolean(source, [square()], 'difference')).toThrow('positions')
		expect(() => performPolygonBoolean(square(), [], 'union')).toThrow('between 1 and 50')
		expect(() =>
			performPolygonBoolean(
				square(),
				Array.from({ length: 51 }, () => square()),
				'union',
			),
		).toThrow('between 1 and 50')
	})
})
