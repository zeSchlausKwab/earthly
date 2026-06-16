import { beforeEach, describe, expect, it } from 'bun:test'
import type { Feature, Point } from 'geojson'
import { createHeadlessEditor } from '../core/test-harness'
import type { GeoEditor } from '../core/GeoEditor'
import type { Authoring } from './authoring'
import { createAuthoring } from './authoring'
import {
	DEFAULT_UNITS,
	InvalidPrimitiveArgError,
	MAX_DISTANCE_METERS,
	makeBuffer,
	makeCircle,
} from './primitives'

const BERLIN: [number, number] = [13.4, 52.5]

function pointFeature(coords: [number, number], id = 'src-point'): Feature<Point> {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: coords },
		properties: { name: 'Source' },
	}
}

describe('makeCircle (D-13/D-14, V5 bound)', () => {
	it('returns a Polygon whose ring has steps+1 points (default steps)', () => {
		const feature = makeCircle(BERLIN, 1, { units: 'kilometers' })
		expect(feature.type).toBe('Feature')
		expect(feature.geometry.type).toBe('Polygon')
		// turf default steps is 64; the ring is closed → steps + 1 coordinates.
		const ring = feature.geometry.coordinates[0]
		expect(ring).toHaveLength(65)
		// Closed ring: first === last.
		expect(ring[0]).toEqual(ring[ring.length - 1])
	})

	it('honors an explicit steps option', () => {
		const feature = makeCircle(BERLIN, 1, { units: 'kilometers', steps: 8 })
		expect(feature.geometry.coordinates[0]).toHaveLength(9)
	})

	it('defaults to meters (D-14) — meters circle is far smaller than a km circle', () => {
		expect(DEFAULT_UNITS).toBe('meters')
		const metersRing = makeCircle(BERLIN, 100).geometry.coordinates[0]
		const kmRing = makeCircle(BERLIN, 100, { units: 'kilometers' }).geometry.coordinates[0]
		// Same radius value, different units → the km circle spans a wider lon range.
		const span = (ring: number[][]) =>
			Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]))
		expect(span(kmRing)).toBeGreaterThan(span(metersRing) * 5)
	})

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, 0])(
		'rejects an invalid radius (%p) — no geometry produced (V5)',
		(radius) => {
			expect(() => makeCircle(BERLIN, radius as number)).toThrow(InvalidPrimitiveArgError)
		},
	)

	it('rejects an absurdly large radius beyond the cap (V5 DoS bound)', () => {
		expect(() => makeCircle(BERLIN, MAX_DISTANCE_METERS + 1, { units: 'meters' })).toThrow(
			InvalidPrimitiveArgError,
		)
	})
})

describe('makeBuffer (D-15 raw, T-02-15 undefined)', () => {
	it('buffers a point Feature into a Polygon', () => {
		const result = makeBuffer(pointFeature(BERLIN), 500, { units: 'meters' })
		expect(result).toBeDefined()
		expect(result?.geometry.type === 'Polygon' || result?.geometry.type === 'MultiPolygon').toBe(
			true,
		)
	})

	it('accepts a bare Geometry (not just a Feature)', () => {
		const result = makeBuffer({ type: 'Point', coordinates: BERLIN }, 500)
		expect(result).toBeDefined()
	})

	it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, 0])(
		'rejects an invalid distance (%p) (V5)',
		(distance) => {
			expect(() => makeBuffer(pointFeature(BERLIN), distance as number)).toThrow(
				InvalidPrimitiveArgError,
			)
		},
	)
})

describe('authoring.circle (TOOLS-01 / D-11)', () => {
	let editor: GeoEditor
	let authoring: Authoring

	beforeEach(() => {
		editor = createHeadlessEditor()
		authoring = createAuthoring(editor)
	})

	it('draws the polygon and returns intent:add + created:1 with an id', () => {
		const result = authoring.circle(BERLIN, 500, { units: 'meters' })
		expect(result.ok).toBe(true)
		expect(result.intent).toBe('add')
		expect(result.featureIds).toHaveLength(1)
		expect(result.counts.created).toBe(1)

		const stored = editor.getAllFeatures()
		expect(stored).toHaveLength(1)
		expect(stored[0]?.geometry.type).toBe('Polygon')
		expect(stored[0]?.id).toBe(result.featureIds[0])
	})

	it('rejects an invalid radius by throwing (no geometry drawn)', () => {
		expect(() => authoring.circle(BERLIN, -1)).toThrow(InvalidPrimitiveArgError)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})
})

describe('authoring.buffer (D-15 by-id + raw, T-02-15/T-02-16)', () => {
	let editor: GeoEditor
	let authoring: Authoring

	beforeEach(() => {
		editor = createHeadlessEditor()
		authoring = createAuthoring(editor)
	})

	it('buffers a feature by id: draws + returns BOTH source and new ids (D-11 composition)', () => {
		const seed = authoring.addFeature(pointFeature(BERLIN, 'seed-point'))
		expect(seed.ok).toBe(true)
		const sourceId = seed.featureIds[0]

		const result = authoring.buffer(sourceId, 500, { units: 'meters' })
		expect(result.ok).toBe(true)
		expect(result.counts.created).toBe(1)
		// Source id first, then the new buffered id.
		expect(result.featureIds[0]).toBe(sourceId)
		expect(result.featureIds).toHaveLength(2)
		expect(result.featureIds[1]).not.toBe(sourceId)

		// editor now holds the source + the buffer.
		expect(editor.getAllFeatures()).toHaveLength(2)
	})

	it('buffers raw GeoJSON (no id): draws + returns only the new id', () => {
		const result = authoring.buffer(pointFeature(BERLIN), 500)
		expect(result.ok).toBe(true)
		expect(result.featureIds).toHaveLength(1)
		expect(editor.getAllFeatures()).toHaveLength(1)
	})

	it('unknown feature id → { ok:false }, no crash, editor untouched (T-02-16)', () => {
		const result = authoring.buffer('does-not-exist', 500)
		expect(result.ok).toBe(false)
		expect(result.featureIds).toEqual([])
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	it('degenerate buffer (turf returns undefined) → { ok:false }, no crash (T-02-15)', () => {
		// An empty GeometryCollection drives turf buffer to return undefined.
		const degenerate = {
			type: 'Feature',
			geometry: { type: 'GeometryCollection', geometries: [] },
			properties: {},
		} as unknown as Feature
		const result = authoring.buffer(degenerate, 500)
		expect(result.ok).toBe(false)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	it('rejects an invalid distance by throwing', () => {
		const seed = authoring.addFeature(pointFeature(BERLIN, 'seed-point'))
		expect(() => authoring.buffer(seed.featureIds[0], Number.NaN)).toThrow(
			InvalidPrimitiveArgError,
		)
	})
})
