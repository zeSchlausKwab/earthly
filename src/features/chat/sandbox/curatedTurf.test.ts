/**
 * Task 2 (TDD) — curated turf surface proof (D-02).
 *
 * The boundary exposes exactly the RESEARCH-verified turf subset and nothing
 * else, frozen, every value a function. It also re-exports the DoS distance cap
 * (MAX_DISTANCE_METERS) reused from the Authoring API primitives — never a
 * redefined literal — so a sandbox loop generating absurd geometry is bounded.
 */

import { describe, expect, it } from 'bun:test'
import { MAX_DISTANCE_METERS } from '@/features/geo-editor/api'
import {
	assertSandboxDistanceWithinCap,
	curatedTurf,
	SandboxDistanceCapError,
	SANDBOX_MAX_DISTANCE_METERS,
} from './curatedTurf'

const EXPECTED_KEYS = [
	'circle',
	'distance',
	'buffer',
	'area',
	'length',
	'bearing',
	'destination',
	'point',
	'lineString',
	'multiLineString',
	'along',
	'nearestPointOnLine',
	'booleanPointInPolygon',
	'centroid',
	// Geometry-construction extensions (AI_GEO_AWARENESS follow-up 2026-07-08).
	'bbox',
	'bboxPolygon',
	'booleanIntersects',
	'cleanCoords',
	'difference',
	'explode',
	'featureCollection',
	'intersect',
	'lineSlice',
	'nearestPoint',
	'polygonToLine',
	'simplify',
	'union',
].sort()

describe('curatedTurf surface (D-02)', () => {
	it('Test 1: exposes exactly the RESEARCH-verified function set, frozen', () => {
		expect(Object.keys(curatedTurf).sort()).toEqual(EXPECTED_KEYS)
		for (const key of EXPECTED_KEYS) {
			expect(typeof (curatedTurf as Record<string, unknown>)[key]).toBe('function')
		}
		expect(Object.isFrozen(curatedTurf)).toBe(true)
	})

	it('Test 4: re-exports the MAX_DISTANCE_METERS DoS cap from the Authoring API', () => {
		// The cap value flows from primitives.ts via the api barrel — not redefined here.
		// It is a SEPARATE export, not a key on the frozen turf surface, so Test 1's
		// "surface is exactly the curated functions" invariant stays clean.
		expect(MAX_DISTANCE_METERS).toBe(40_075_000)
		expect(SANDBOX_MAX_DISTANCE_METERS).toBe(MAX_DISTANCE_METERS)
	})

	it('the curated functions actually compute (smoke: distance + circle)', () => {
		const d = curatedTurf.distance([0, 0], [0, 1], { units: 'kilometers' })
		expect(d).toBeGreaterThan(100)
		const c = curatedTurf.circle([14.5, 47.5], 1, { units: 'kilometers' })
		expect(c.geometry.type).toBe('Polygon')
	})

	it('constructs a MultiLineString for batched river fragments', () => {
		const feature = curatedTurf.multiLineString([
			[
				[85.2, 28.1],
				[85.21, 28.05],
			],
			[
				[85.21, 28.05],
				[85.22, 28],
			],
		])
		expect(feature.geometry.type).toBe('MultiLineString')
	})
})

describe('assertSandboxDistanceWithinCap (WR-01 — DoS distance cap is ENFORCED)', () => {
	const center = [14.5, 47.5]

	it('passes a sane in-bounds distance for every distance-bearing op', () => {
		expect(() =>
			assertSandboxDistanceWithinCap('circle', [center, 100, { units: 'meters' }]),
		).not.toThrow()
		expect(() =>
			assertSandboxDistanceWithinCap('buffer', [center, 5, { units: 'kilometers' }]),
		).not.toThrow()
		expect(() =>
			assertSandboxDistanceWithinCap('destination', [center, 10, 90, { units: 'kilometers' }]),
		).not.toThrow()
		expect(() => assertSandboxDistanceWithinCap('along', [center, 1])).not.toThrow()
	})

	it('is a no-op for ops that carry no distance arg', () => {
		expect(() => assertSandboxDistanceWithinCap('area', [center])).not.toThrow()
		expect(() => assertSandboxDistanceWithinCap('distance', [center, center])).not.toThrow()
		expect(() => assertSandboxDistanceWithinCap('centroid', [{}])).not.toThrow()
	})

	it('rejects a distance over the cap (meters) — closes the "tested-for-existence-only" gap', () => {
		expect(() =>
			assertSandboxDistanceWithinCap('circle', [
				center,
				SANDBOX_MAX_DISTANCE_METERS + 1,
				{ units: 'meters' },
			]),
		).toThrow(SandboxDistanceCapError)
	})

	it('rejects an over-cap distance after normalizing km/miles to meters', () => {
		// 50,000 km == 50,000,000 m > 40,075,000 m cap.
		expect(() =>
			assertSandboxDistanceWithinCap('buffer', [center, 50_000, { units: 'kilometers' }]),
		).toThrow(SandboxDistanceCapError)
		// Default unit is kilometers (turf default) when no options object is supplied.
		expect(() => assertSandboxDistanceWithinCap('circle', [center, 50_000])).toThrow(
			SandboxDistanceCapError,
		)
	})

	it('rejects NaN / Infinity / zero / negative distances', () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -100]) {
			expect(() => assertSandboxDistanceWithinCap('circle', [center, bad])).toThrow(
				SandboxDistanceCapError,
			)
		}
	})
})
