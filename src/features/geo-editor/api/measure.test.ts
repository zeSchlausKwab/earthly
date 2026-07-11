import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
import {
	aggregateMeasurements,
	formatAreaKm2,
	formatGeometryMeasurement,
	formatLengthKm,
	measureFeatures,
	summarizeFeatureMeasurements,
} from './measure'

function feature(id: string, geometry: GeoJSON.Geometry, name?: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		properties: name ? { name } : {},
		geometry,
	} as EditorFeature
}

// ~111 km along the equator (1° of longitude).
const oneDegreeLine = feature('line-1', {
	type: 'LineString',
	coordinates: [
		[0, 0],
		[1, 0],
	],
})

// 1°×1° square at the equator (~12,300 km²).
const unitSquare = feature('poly-1', {
	type: 'Polygon',
	coordinates: [
		[
			[0, 0],
			[1, 0],
			[1, 1],
			[0, 1],
			[0, 0],
		],
	],
})

describe('measureFeatures', () => {
	it('length sums line kilometers', () => {
		const result = measureFeatures('length', [oneDegreeLine]) as {
			totalKm: number
			features: { featureId: string; value: number }[]
		}
		expect(result.totalKm).toBeGreaterThan(110)
		expect(result.totalKm).toBeLessThan(112)
		expect(result.features[0]?.featureId).toBe('line-1')
	})

	it('area reports km²', () => {
		const result = measureFeatures('area', [unitSquare]) as { totalKm2: number }
		expect(result.totalKm2).toBeGreaterThan(12000)
		expect(result.totalKm2).toBeLessThan(12500)
	})

	it('perimeter measures polygon boundaries only', () => {
		const result = measureFeatures('perimeter', [unitSquare, oneDegreeLine]) as {
			totalKm: number
			features: { featureId: string }[]
		}
		expect(result.totalKm).toBeGreaterThan(440)
		expect(result.features).toHaveLength(1)
		expect(result.features[0]?.featureId).toBe('poly-1')
	})

	it('distance between explicit points needs no features', () => {
		const result = measureFeatures('distance', [], { from: [0, 0], to: [1, 0] }) as { km: number }
		expect(result.km).toBeGreaterThan(110)
		expect(result.km).toBeLessThan(112)
	})

	it('distance between exactly two features uses centroids', () => {
		const a = feature('a', { type: 'Point', coordinates: [0, 0] })
		const b = feature('b', { type: 'Point', coordinates: [0, 1] })
		const result = measureFeatures('distance', [a, b]) as { km: number; basis: string }
		expect(result.km).toBeGreaterThan(110)
		expect(result.basis).toContain('centroids')
	})

	it('distance without endpoints or a feature pair throws a self-correctable error', () => {
		expect(() => measureFeatures('distance', [oneDegreeLine])).toThrow(/from\+to|two target/)
	})

	it('bearing runs due north as ~0°', () => {
		const result = measureFeatures('bearing', [], { from: [0, 0], to: [0, 1] }) as {
			degrees: number
		}
		expect(Math.abs(result.degrees)).toBeLessThan(0.5)
	})

	it('bbox covers the whole set', () => {
		const result = measureFeatures('bbox', [oneDegreeLine, unitSquare]) as { bbox: number[] }
		expect(result.bbox).toEqual([0, 0, 1, 1])
	})

	it('centroid returns per-feature and overall centroids', () => {
		const result = measureFeatures('centroid', [unitSquare]) as {
			centroids: { coordinates: number[] }[]
			overall: number[]
		}
		expect(result.centroids[0]?.coordinates[0]).toBeCloseTo(0.5, 1)
		expect(result.overall[1]).toBeCloseTo(0.5, 1)
	})

	it('nearest_point finds the closest vertex among targets', () => {
		const result = measureFeatures('nearest_point', [oneDegreeLine, unitSquare], {
			from: [1.1, 0.9],
		}) as { nearest: { featureId: string; coordinates: number[] } }
		expect(result.nearest.featureId).toBe('poly-1')
		expect(result.nearest.coordinates).toEqual([1, 1])
	})

	it('rejects unknown operations with the valid list', () => {
		expect(() => measureFeatures('volume' as never, [])).toThrow(/Valid:/)
	})
})

describe('summarizeFeatureMeasurements', () => {
	it('lines get lengthKm, polygons areaKm2, points nothing', () => {
		expect(summarizeFeatureMeasurements(oneDegreeLine)?.lengthKm).toBeGreaterThan(110)
		expect(summarizeFeatureMeasurements(unitSquare)?.areaKm2).toBeGreaterThan(12000)
		expect(
			summarizeFeatureMeasurements(feature('p', { type: 'Point', coordinates: [0, 0] })),
		).toBeNull()
	})
})

describe('aggregateMeasurements', () => {
	it('totals length and area with per-type counts', () => {
		const aggregates = aggregateMeasurements([oneDegreeLine, unitSquare])
		expect(aggregates?.lineCount).toBe(1)
		expect(aggregates?.totalLengthKm).toBeGreaterThan(110)
		expect(aggregates?.polygonCount).toBe(1)
		expect(aggregates?.totalAreaKm2).toBeGreaterThan(12000)
	})

	it('returns null for point-only sets', () => {
		expect(aggregateMeasurements([feature('p', { type: 'Point', coordinates: [0, 0] })])).toBeNull()
	})
})

describe('display formatters', () => {
	it('formatLengthKm switches to metres below 1 km', () => {
		expect(formatLengthKm(0.832)).toBe('832 m')
		expect(formatLengthKm(12.44)).toBe('12.4 km')
		expect(formatLengthKm(1234.5)).toBe('1,235 km')
	})

	it('formatAreaKm2 switches to m² below 0.01 km²', () => {
		expect(formatAreaKm2(0.0043)).toBe('4,300 m²')
		expect(formatAreaKm2(3.416)).toBe('3.42 km²')
	})

	it('formatGeometryMeasurement covers lines, polygons, points', () => {
		expect(formatGeometryMeasurement(oneDegreeLine.geometry)).toMatch(/km$/)
		expect(formatGeometryMeasurement(unitSquare.geometry)).toContain('perimeter')
		expect(formatGeometryMeasurement({ type: 'Point', coordinates: [0, 0] })).toBeNull()
		expect(formatGeometryMeasurement(null)).toBeNull()
	})
})
