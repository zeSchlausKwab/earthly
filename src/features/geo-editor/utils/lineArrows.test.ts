import { describe, expect, test } from 'bun:test'
import type { Feature, LineString, MultiLineString } from 'geojson'
import { lineArrowFeatures } from './lineArrows'

describe('lineArrowFeatures', () => {
	test('creates outward-facing start and end arrowheads', () => {
		const feature: Feature<LineString> = {
			type: 'Feature',
			id: 'route',
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 0],
				],
			},
			properties: { arrowStart: true, arrowEnd: true, strokeColor: '#ef4444' },
		}

		const arrows = lineArrowFeatures(feature)
		expect(arrows).toHaveLength(2)
		expect(arrows[0]?.geometry.coordinates).toEqual([0, 0])
		expect(Math.abs(Math.abs(arrows[0]?.properties.arrowBearing ?? 0) - 90)).toBeLessThan(0.01)
		expect(arrows[1]?.geometry.coordinates).toEqual([1, 0])
		expect(arrows[1]?.properties.arrowBearing).toBeCloseTo(90, 4)
		expect(arrows[1]?.properties.strokeColor).toBe('#ef4444')
	})

	test('adds endpoint arrows for every multiline part and skips degenerate parts', () => {
		const feature: Feature<MultiLineString> = {
			type: 'Feature',
			id: 'routes',
			geometry: {
				type: 'MultiLineString',
				coordinates: [
					[
						[0, 0],
						[0, 1],
					],
					[
						[2, 2],
						[2, 2],
					],
				],
			},
			properties: { arrowEnd: true },
		}

		const arrows = lineArrowFeatures(feature)
		expect(arrows).toHaveLength(1)
		expect(arrows[0]?.geometry.coordinates).toEqual([0, 1])
		expect(arrows[0]?.properties.arrowBearing).toBeCloseTo(0, 4)
	})
})
