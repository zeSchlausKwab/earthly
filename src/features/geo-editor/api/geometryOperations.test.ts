import { describe, expect, it } from 'bun:test'
import { area, booleanPointInPolygon, point } from '@turf/turf'
import type { Feature, LineString, Polygon } from 'geojson'
import { GeometryOperationError, performGeometryOperation } from './geometryOperations'

const line: Feature<LineString> = {
	type: 'Feature',
	id: 'line-1',
	properties: { name: 'Main line' },
	geometry: {
		type: 'LineString',
		coordinates: [
			[0, 0],
			[0.01, 0],
		],
	},
}

const square: Feature<Polygon> = {
	type: 'Feature',
	id: 'polygon-1',
	properties: { name: 'Square' },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[0, 0],
				[0.01, 0],
				[0.01, 0.01],
				[0, 0.01],
				[0, 0],
			],
		],
	},
}

describe('performGeometryOperation', () => {
	it('splits a line with a nearby point projected onto it', () => {
		const result = performGeometryOperation(line, {
			kind: 'split',
			cutter: { type: 'Point', coordinates: [0.005, 0.00001] },
			pointSnapToleranceMeters: 5,
		})

		expect(result.features).toHaveLength(2)
		expect(result.features.every((feature) => feature.geometry.type === 'LineString')).toBe(true)
		expect(result.features[0]?.properties?.name).toBe('Main line')
		expect(result.features[0]?.properties?.['earthly:derivedFrom']).toBe('line-1')
	})

	it('splits a long east-west line at its rendered Web Mercator midpoint', () => {
		const source: Feature<LineString> = {
			type: 'Feature',
			id: 'east-west',
			properties: {},
			geometry: {
				type: 'LineString',
				coordinates: [
					[-20, 15],
					[30, 15],
				],
			},
		}

		const result = performGeometryOperation(source, {
			kind: 'split',
			cutter: point([5, 15]),
		})

		expect(result.features).toHaveLength(2)
		expect(result.features.every((feature) => feature.geometry.type === 'LineString')).toBe(true)
	})

	it('splits a line at every intersection with a crossing polyline', () => {
		const result = performGeometryOperation(line, {
			kind: 'split',
			cutter: {
				type: 'LineString',
				coordinates: [
					[0.003, -0.01],
					[0.003, 0.01],
					[0.007, 0.01],
					[0.007, -0.01],
				],
			},
		})

		expect(result.features).toHaveLength(3)
	})

	it('rejects a point beyond the line snap tolerance without returning geometry', () => {
		expect(() =>
			performGeometryOperation(line, {
				kind: 'split',
				cutter: { type: 'Point', coordinates: [0.005, 0.01] },
				pointSnapToleranceMeters: 10,
			}),
		).toThrow(GeometryOperationError)
	})

	it('splits a polygon with a crossing line', () => {
		const result = performGeometryOperation(square, {
			kind: 'split',
			cutter: {
				type: 'LineString',
				coordinates: [
					[-0.01, 0.005],
					[0.02, 0.005],
				],
			},
		})

		expect(result.features).toHaveLength(2)
		const totalArea = result.features.reduce((sum, feature) => sum + area(feature), 0)
		expect(Math.abs(totalArea - area(square)) / area(square)).toBeLessThan(1e-8)
	})

	it('splits map-drawn polygons when Turf intersection nodes differ below topology precision', () => {
		const mapDrawnPolygon: Feature<Polygon> = {
			type: 'Feature',
			id: 'map-drawn-polygon',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[-3.691406250002103, 18.22935133838716],
						[32.87109374999787, 18.22935133838716],
						[32.87109374999787, -21.043491216802906],
						[-3.691406250002103, -21.043491216802906],
						[-3.691406250002103, 18.22935133838716],
					],
				],
			},
		}
		const result = performGeometryOperation(mapDrawnPolygon, {
			kind: 'split',
			cutter: {
				type: 'LineString',
				coordinates: [
					[-14.76562500000179, -1.4939713066291205],
					[43.769531249997755, -1.4939713066291205],
				],
			},
		})

		expect(result.features).toHaveLength(2)
	})

	it('splits a map-drawn polygon with cutter endpoints snapped to its boundary', () => {
		const mapDrawnPolygon: Feature<Polygon> = {
			type: 'Feature',
			id: 'snapped-boundary-polygon',
			properties: {},
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[-3.691406250002103, 18.22935133838716],
						[32.87109374999787, 18.22935133838716],
						[32.87109374999787, -21.043491216802906],
						[-3.691406250002103, -21.043491216802906],
						[-3.691406250002103, 18.22935133838716],
					],
				],
			},
		}
		const result = performGeometryOperation(mapDrawnPolygon, {
			kind: 'split',
			cutter: {
				type: 'LineString',
				coordinates: [
					[14.58984374999787, 18.229351338387165],
					[14.58984374999787, -21.043491216802906],
				],
			},
		})

		expect(result.features).toHaveLength(2)
	})

	it('preserves a polygon hole when the cutting line does not cross it', () => {
		const polygonWithHole: Feature<Polygon> = {
			...square,
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[0.01, 0],
						[0.01, 0.01],
						[0, 0.01],
						[0, 0],
					],
					[
						[0.004, 0.004],
						[0.006, 0.004],
						[0.006, 0.006],
						[0.004, 0.006],
						[0.004, 0.004],
					],
				],
			},
		}
		const result = performGeometryOperation(polygonWithHole, {
			kind: 'split',
			cutter: {
				type: 'LineString',
				coordinates: [
					[-0.01, 0.002],
					[0.02, 0.002],
				],
			},
		})

		expect(result.features).toHaveLength(2)
		expect(
			result.features.some(
				(feature) =>
					feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length === 2,
			),
		).toBe(true)
		expect(
			result.features.some((feature) =>
				booleanPointInPolygon(point([0.005, 0.005]), feature as Feature<Polygon>),
			),
		).toBe(false)
	})

	it('rejects a polygon cutter that never crosses the polygon', () => {
		expect(() =>
			performGeometryOperation(square, {
				kind: 'split',
				cutter: {
					type: 'LineString',
					coordinates: [
						[-0.01, -0.01],
						[-0.005, -0.005],
					],
				},
			}),
		).toThrow(/must cross the polygon/)
	})

	it('expands and insets polygons by a numeric distance', () => {
		const outward = performGeometryOperation(square, {
			kind: 'offset-polygon',
			distance: 100,
			units: 'meters',
			direction: 'outward',
		})
		const inward = performGeometryOperation(square, {
			kind: 'offset-polygon',
			distance: 100,
			units: 'meters',
			direction: 'inward',
		})

		expect(area(outward.features[0]!)).toBeGreaterThan(area(square))
		expect(area(inward.features[0]!)).toBeLessThan(area(square))
	})

	it('creates a left or right parallel line', () => {
		const left = performGeometryOperation(line, {
			kind: 'offset-line',
			distance: 100,
			units: 'meters',
			side: 'left',
		})
		const right = performGeometryOperation(line, {
			kind: 'offset-line',
			distance: 100,
			units: 'meters',
			side: 'right',
		})
		const leftCoords = (left.features[0]!.geometry as LineString).coordinates
		const rightCoords = (right.features[0]!.geometry as LineString).coordinates

		expect(leftCoords[0]![1]).toBeGreaterThan(0)
		expect(rightCoords[0]![1]).toBeLessThan(0)
	})

	it('creates a polygon corridor using total width', () => {
		const result = performGeometryOperation(line, {
			kind: 'corridor',
			width: 200,
			units: 'meters',
		})

		expect(['Polygon', 'MultiPolygon']).toContain(result.features[0]?.geometry.type ?? '')
		expect(area(result.features[0]!)).toBeGreaterThan(0)
	})
})
