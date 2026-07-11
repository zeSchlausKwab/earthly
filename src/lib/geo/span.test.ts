import { describe, expect, test } from 'bun:test'
import { bboxDiagonalKm, IMPLAUSIBLE_SPAN_KM } from './span'

describe('bboxDiagonalKm — implausible-scale guardrail signal', () => {
	test('a point has zero span', () => {
		expect(bboxDiagonalKm({ type: 'Point', coordinates: [16.37, 48.21] })).toBe(0)
	})

	test('a city-scale line stays far below the warning threshold', () => {
		// ~2 km across central Vienna.
		const span = bboxDiagonalKm({
			type: 'LineString',
			coordinates: [
				[16.36, 48.2],
				[16.38, 48.21],
			],
		})
		expect(span).toBeGreaterThan(1)
		expect(span).toBeLessThan(5)
		expect(span).toBeLessThan(IMPLAUSIBLE_SPAN_KM)
	})

	test('a continent-scale polygon exceeds the warning threshold', () => {
		// Roughly Lisbon → Kyiv, the audit's accidental world-zoom shape class.
		const span = bboxDiagonalKm({
			type: 'Polygon',
			coordinates: [
				[
					[-9.1, 38.7],
					[30.5, 50.4],
					[10.0, 45.0],
					[-9.1, 38.7],
				],
			],
		})
		expect(span).toBeGreaterThan(IMPLAUSIBLE_SPAN_KM)
		expect(span).toBeGreaterThan(2000)
	})

	test('unmeasurable geometry is 0, never NaN', () => {
		expect(bboxDiagonalKm(null)).toBe(0)
		expect(bboxDiagonalKm({ type: 'LineString', coordinates: [] })).toBe(0)
	})
})
