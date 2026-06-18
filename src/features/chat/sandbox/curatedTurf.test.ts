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
import { curatedTurf, SANDBOX_MAX_DISTANCE_METERS } from './curatedTurf'

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
	'along',
	'nearestPointOnLine',
	'booleanPointInPolygon',
	'centroid',
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
})
