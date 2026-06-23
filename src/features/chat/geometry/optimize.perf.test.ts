import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import * as optimizeMod from './optimize'

/**
 * Phase-7 UAT crash regression (07-05), written FIRST (RED).
 *
 * The existing many-small-features fixture (`fixture.ts`, 300 SMALL features) does NOT
 * exercise the pathology that crashed the UAT user: HIGH PER-FEATURE vertex count. The
 * old `optimize()` ran `turf.kinks` topology validation per binary-search iteration over
 * the FULL feature set, which is O(V^2) per high-vertex feature; on a few features of
 * ~30k-50k vertices each it exceeds the worker's 30s timeout and runs for minutes.
 *
 * This fixture builds a FEW (4) LineString features, each with ~40k near-collinear
 * vertices (~160k vertices total, a few MB serialized). Against the OLD quadratic code
 * this test would blow the hard wall-clock bound (effectively hang); after bounding
 * `optimize()` to near-linear cost it completes in well under the bound.
 */

type FC = { type: 'FeatureCollection'; features: EditorFeature[] }

/** Tiny deterministic PRNG (mulberry32) — same idiom as `fixture.ts`. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function round(value: number): number {
	return Math.round(value * 1e7) / 1e7
}

/**
 * A FEW (3-6) LineString features, each with a HIGH per-feature vertex count
 * (~30k-50k near-collinear vertices), so total vertices are ~100k-200k. This is the
 * case the many-small-features fixture does NOT cover — high per-feature V is what made
 * the per-iteration `turf.kinks` validation O(V^2) pathological. Deterministic + pure;
 * type-only `EditorFeature` import (mirrors `fixture.ts`).
 */
export function makeFewLargeFeaturesFixture(
	opts: { lineCount?: number; pointsPerLine?: number; seed?: number } = {},
): FC {
	const lineCount = opts.lineCount ?? 4
	const pointsPerLine = opts.pointsPerLine ?? 40_000
	const rand = mulberry32(opts.seed ?? 0xc0ffee)

	const features: EditorFeature[] = []
	for (let i = 0; i < lineCount; i++) {
		// Each feature is a long, mostly-straight, easting line at its own latitude band, so
		// the lines do NOT cross each other (clean topology baseline). Superfluous tiny
		// near-collinear jitter inflates the vertex count without bending the visible shape.
		const startLon = 130
		const lat = 5 + i * 5
		const span = 30 // degrees of longitude traversed
		const coords: [number, number][] = []
		for (let p = 0; p < pointsPerLine; p++) {
			const t = p / (pointsPerLine - 1)
			const baseLon = startLon + span * t
			const jitter = (rand() - 0.5) * 1e-6
			coords.push([round(baseLon + jitter), round(lat + jitter * 0.5)])
		}
		features.push({
			type: 'Feature',
			id: `big-${i}`,
			geometry: { type: 'LineString', coordinates: coords },
			properties: { name: `big-line-${i}`, segmentIndex: i },
		} as EditorFeature)
	}

	return { type: 'FeatureCollection', features }
}

describe('optimize.perf — few-large-features completes under a hard time bound (UAT crash regression)', () => {
	it('optimizes ~160k-vertex few-large-features within the bound and returns {result, report}', () => {
		const input = makeFewLargeFeaturesFixture()
		// Sanity: high per-feature vertex count, few features.
		expect(input.features.length).toBeLessThanOrEqual(6)
		expect(input.features.length).toBeGreaterThanOrEqual(3)

		const started = performance.now()
		const { result, report } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)
		const elapsed = performance.now() - started

		// HARD wall-clock bound — comfortably above the fixed near-linear cost, far below
		// the old quadratic minutes. A hang/quadratic run blows past this.
		expect(elapsed).toBeLessThan(10_000)

		// Always returns a usable result + report (never throws, never hangs).
		expect(result.features.length).toBeGreaterThan(0)
		expect(typeof report.bytesAfter).toBe('number')
	})

	it('returns an honest report (never inflates bytes or vertices)', () => {
		const input = makeFewLargeFeaturesFixture()
		const { report } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		expect(report.bytesAfter).toBeLessThanOrEqual(report.bytesBefore)
		expect(report.verticesAfter).toBeLessThanOrEqual(report.verticesBefore)
	})

	it('does not INTRODUCE new self-intersections vs input on a clean fixture (D-06 intent)', () => {
		const input = makeFewLargeFeaturesFixture()
		const { result } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		const kinks = (geom: EditorFeature[]) => optimizeMod.countSelfIntersections(geom)
		expect(kinks(result.features)).toBeLessThanOrEqual(kinks(input.features))
	})
})
