import { describe, expect, it } from 'bun:test'
import { area, booleanPointInPolygon, distance, kinks, point } from '@turf/turf'
import type { Feature, LineString, MultiLineString, Polygon, MultiPolygon } from 'geojson'
import { GeometryOperationError, performGeometryOperation } from './geometryOperations'
import type { LineBandOptions } from './lineBand'

const line: Feature<LineString> = {
	type: 'Feature',
	id: 'flow',
	properties: { name: 'Flow', fill: '#ff0000', sourceUrl: 'https://example.com/data' },
	geometry: {
		type: 'LineString',
		coordinates: [
			[0, 0],
			[0.01, 0],
		],
	},
}

function band(
	options: LineBandOptions,
	kind: 'fat-line' | 'fat-arrow' = 'fat-line',
	source: Feature = line,
) {
	return performGeometryOperation(source, { kind, ...options }).features[0]! as Feature<
		Polygon | MultiPolygon
	>
}

describe('line extrusion', () => {
	it('makes a flat-ended band with total geographic width and keeps source properties', () => {
		const source = structuredClone(line)
		const result = band({ width: 200 })
		expect(result.geometry.type).toBe('Polygon')
		expect(area(result)).toBeCloseTo(1111.95 * 200, -3)
		expect(result.properties).toMatchObject({
			name: 'Flow',
			fill: '#ff0000',
			sourceUrl: 'https://example.com/data',
			'earthly:derivedFrom': 'flow',
			'earthly:geometryOperation': 'fat-line',
		})
		expect(result.id).not.toBe(line.id)
		expect(line).toEqual(source)
		expect(booleanPointInPolygon(point([-0.0001, 0]), result)).toBe(false)
	})
	it('tapers linearly by path length, including a pointed zero-width end', () => {
		const source: Feature<LineString> = {
			...line,
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0.0025, 0],
					[0.01, 0],
				],
			},
		}
		const result = band({ width: 200, endWidth: 0 }, 'fat-line', source)
		expect(area(result) / area(band({ width: 200 }))).toBeCloseTo(0.5, 4)
		expect(booleanPointInPolygon(point([0.0025, 0.0006]), result)).toBe(true)
		expect(booleanPointInPolygon(point([0.009, 0.0006]), result)).toBe(false)
		expect(kinks(result).features).toHaveLength(0)
	})
	it('accepts a zero-width start and widening band', () => {
		expect(area(band({ width: 0, endWidth: 200 }))).toBeGreaterThan(0)
	})
	it('extrudes to either side relative to coordinate order', () => {
		const left = band({ width: 200, side: 'left' })
		const right = band({ width: 200, side: 'right' })
		expect(booleanPointInPolygon(point([0.005, 0.001]), left)).toBe(true)
		expect(booleanPointInPolygon(point([0.005, -0.001]), left)).toBe(false)
		expect(booleanPointInPolygon(point([0.005, -0.001]), right)).toBe(true)
		const reversed: Feature<LineString> = {
			...line,
			geometry: { type: 'LineString', coordinates: [...line.geometry.coordinates].reverse() },
		}
		expect(
			booleanPointInPolygon(
				point([0.005, -0.001]),
				band({ width: 200, side: 'left' }, 'fat-line', reversed),
			),
		).toBe(true)
	})
	it('converts units consistently and corrects Mercator width at high latitude', () => {
		expect(band({ width: 0.2, units: 'kilometers' }).geometry).toEqual(
			band({ width: 200 }).geometry,
		)
		expect(band({ width: 200 / 1609.344, units: 'miles' }).geometry).toEqual(
			band({ width: 200 }).geometry,
		)
		const source: Feature<LineString> = {
			...line,
			geometry: {
				type: 'LineString',
				coordinates: [
					[15, 60],
					[15.1, 60],
				],
			},
		}
		const result = band({ width: 200 }, 'fat-line', source)
		const ring = (result.geometry as Polygon).coordinates[0]!
		const atStart = ring.filter((p) => Math.abs(p[0]! - 15) < 1e-8)
		expect(distance(point(atStart[0]!), point(atStart[1]!), { units: 'meters' })).toBeCloseTo(
			200,
			0,
		)
	})
	it('makes a wider arrowhead reaching the exact endpoint', () => {
		const result = band({ width: 100, arrowHeadLength: 300, arrowHeadWidth: 300 }, 'fat-arrow')
		const ring = (result.geometry as Polygon).coordinates[0]!
		expect(ring.some((p) => Math.abs(p[0]! - 0.01) < 1e-10 && Math.abs(p[1]!) < 1e-10)).toBe(true)
		expect(booleanPointInPolygon(point([0.0074, 0.001]), result)).toBe(true)
		expect(booleanPointInPolygon(point([0.0099, 0.001]), result)).toBe(false)
		expect(kinks(result).features).toHaveLength(0)
	})
	it('fits a default arrowhead to a short line even when the band is wide', () => {
		expect(area(band({ width: 2000 }, 'fat-arrow'))).toBeGreaterThan(0)
	})
	it('joins bends and self-crossings without self-intersections', () => {
		for (const coordinates of [
			[
				[0, 0],
				[0.01, 0],
				[0.01, 0.01],
			],
			[
				[0, 0],
				[0.01, 0.01],
				[0, 0.01],
				[0.01, 0],
			],
			[
				[0, 0],
				[0.01, 0],
				[0, 0],
			],
		]) {
			const result = band({ width: 200, endWidth: 100 }, 'fat-line', {
				...line,
				geometry: { type: 'LineString', coordinates },
			})
			expect(area(result)).toBeGreaterThan(0)
			expect(kinks(result).features).toHaveLength(0)
		}
	})
	it('keeps wide map-drawn arrows connected across oblique joins and the arrowhead base', () => {
		const source: Feature<LineString> = {
			...line,
			geometry: {
				type: 'LineString',
				coordinates: [
					[-8.96484375000568, 7.536764322089282],
					[8.7890624999946, 3.1624555302429496],
					[26.542968749994913, 7.536764322089282],
				],
			},
		}
		const result = band({ width: 500, endWidth: 100, units: 'kilometers' }, 'fat-arrow', source)
		expect(result.geometry.type).toBe('Polygon')
		expect(kinks(result).features).toHaveLength(0)
	})
	it('extrudes long intercontinental paths into continuous bands and arrows', () => {
		const source: Feature<LineString> = {
			...line,
			geometry: {
				type: 'LineString',
				coordinates: [
					[56.55, 26.5],
					[57.1, 25.5],
					[59, 24],
					[60.4, 22.7],
					[60, 18],
					[58, 12],
					[55, 5],
					[49, -4],
					[44, -13],
					[40, -21],
					[36, -28],
					[29, -35],
					[20, -37],
					[13, -35],
					[5, -28],
					[-2, -17],
					[-7, -3],
					[-13, 14],
					[-16, 29],
					[-12, 41],
					[-7, 47],
					[-3, 50],
				],
			},
		}
		for (const kind of ['fat-line', 'fat-arrow'] as const) {
			const result = band(
				{ width: 75, units: 'kilometers', arrowHeadWidth: 123.75, arrowHeadLength: 150 },
				kind,
				source,
			)
			expect(result.geometry.type).toBe('Polygon')
			expect(area(result)).toBeGreaterThan(0)
			expect(kinks(result).features).toHaveLength(0)
			for (const coordinate of source.geometry.coordinates.slice(1, -1)) {
				expect(booleanPointInPolygon(point(coordinate), result)).toBe(true)
			}
			if (kind === 'fat-arrow') {
				const endpoint = source.geometry.coordinates.at(-1)!
				expect(
					(result.geometry as Polygon).coordinates[0]!.some(
						(coordinate) =>
							Math.abs(coordinate[0]! - endpoint[0]!) < 1e-9 &&
							Math.abs(coordinate[1]! - endpoint[1]!) < 1e-9,
					),
				).toBe(true)
			}
		}
	})

	it('handles duplicate vertices and disconnected multipart lines', () => {
		const source: Feature<MultiLineString> = {
			...line,
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[0, 0],
						[0, 0],
						[0.01, 0],
					],
					[
						[1, 1],
						[1.01, 1],
					],
				],
			},
		}
		const result = band({ width: 100 }, 'fat-arrow', source)
		expect(result.geometry.type).toBe('MultiPolygon')
		expect((result.geometry as MultiPolygon).coordinates).toHaveLength(2)
	})
	it('rejects invalid dimensions and degenerate lines before creating features', () => {
		for (const options of [
			{ width: -1 },
			{ width: Number.NaN },
			{ width: Infinity },
			{ width: 0, endWidth: 0 },
			{ width: 1, endWidth: -1 },
		]) {
			expect(() => band(options)).toThrow(GeometryOperationError)
		}
		expect(() => band({ width: 100, endWidth: 0 }, 'fat-arrow')).toThrow(/positive end width/)
		expect(() => band({ width: 100, arrowHeadLength: 2000 }, 'fat-arrow')).toThrow(/shorter/)
		expect(() => band({ width: 100, arrowHeadWidth: 50 }, 'fat-arrow')).toThrow(/at least/)
		expect(() =>
			band({ width: 100 }, 'fat-line', {
				...line,
				geometry: {
					type: 'LineString',
					coordinates: [
						[0, 0],
						[0, 0],
					],
				},
			}),
		).toThrow(/distinct/)
		expect(() =>
			band({ width: 100 }, 'fat-line', {
				...line,
				geometry: { type: 'Point', coordinates: [0, 0] },
			}),
		).toThrow(/LineString/)
	})
	it('rejects antimeridian crossings rather than creating a world-spanning band', () => {
		expect(() =>
			band({ width: 100 }, 'fat-line', {
				...line,
				geometry: {
					type: 'LineString',
					coordinates: [
						[179, 0],
						[-179, 0],
					],
				},
			}),
		).toThrow(/antimeridian/)
	})
})
