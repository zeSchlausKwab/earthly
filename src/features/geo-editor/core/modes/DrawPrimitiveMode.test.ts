import { describe, expect, test } from 'bun:test'
import type { MapMouseEvent } from 'maplibre-gl'
import { createMockMap } from '../test-harness'
import type { PrimitiveShape } from '../types'
import { DrawPrimitiveMode } from './DrawPrimitiveMode'

function pointer(x: number, y: number): MapMouseEvent {
	return {
		lngLat: { lng: x, lat: y },
		point: { x, y },
	} as MapMouseEvent
}

describe('DrawPrimitiveMode', () => {
	test.each([
		['rectangle', 5],
		['square', 5],
		['circle', 49],
		['triangle', 4],
		['diamond', 5],
	] as Array<
		[PrimitiveShape, number]
	>)('draws a %s from an anchor and a size point', (shape, expectedRingLength) => {
		const mode = new DrawPrimitiveMode()
		mode.onAdd(createMockMap())
		mode.setShape(shape)

		expect(mode.onClick(pointer(100, 100))).toBeNull()
		mode.onMove(pointer(180, 150))
		const preview = mode.getCurrentFeature()
		expect(preview?.properties?.meta).toBe('feature-temp')
		expect(preview?.properties?.primitiveShape).toBe(shape)

		const feature = mode.onClick(pointer(180, 150))
		expect(feature?.geometry.type).toBe('Polygon')
		if (feature?.geometry.type !== 'Polygon') throw new Error('Expected polygon')
		expect(feature.geometry.coordinates[0]).toHaveLength(expectedRingLength)
		expect(feature.properties?.meta).toBe('feature')
		expect(feature.properties?.primitiveShape).toBe(shape)
		expect(mode.getCurrentFeature()).toBeUndefined()
	})

	test('constrains a square to equal screen-space sides', () => {
		const mode = new DrawPrimitiveMode()
		mode.onAdd(createMockMap())
		mode.setShape('square')
		mode.onClick(pointer(20, 30))
		const feature = mode.onClick(pointer(100, 70))
		if (feature?.geometry.type !== 'Polygon') throw new Error('Expected square')

		const ring = feature.geometry.coordinates[0]
		if (!ring) throw new Error('Expected square ring')
		expect(Math.abs((ring[1]?.[0] ?? 0) - (ring[0]?.[0] ?? 0))).toBe(80)
		expect(Math.abs((ring[2]?.[1] ?? 0) - (ring[1]?.[1] ?? 0))).toBe(80)
	})
})
