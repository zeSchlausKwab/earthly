import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
// RED (Wave 0): `./optimize` lands in Waves 2/3. Namespace import (06-01 idiom).
import * as optimizeMod from './optimize'
import { fixtureBytes, makeOversizedTrailFixture } from './fixture'

/**
 * GEO-03 acceptance bar, written FIRST — the West Pacific Trail surrogate.
 *
 * The deterministic >1MB messy fixture, run through `optimize(fc, budget)` at the
 * default publish budget, must come out UNDER `BLOSSOM_UPLOAD_THRESHOLD_BYTES` with
 * fewer vertices, no more features, at least one microgap join, and no NEW topology
 * problems relative to the post-stitch/merge baseline. RED until Waves 2-3.
 */

describe('optimize.acceptance — GEO-03 oversized trail → under the publish limit', () => {
	it('brings the >1MB fixture under BLOSSOM_UPLOAD_THRESHOLD_BYTES with no new topology problems', () => {
		const input = makeOversizedTrailFixture()
		// Sanity: the fixture really is oversized to begin with.
		expect(fixtureBytes(input)).toBeGreaterThan(BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		const { result, report } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		expect(report.bytesAfter).toBeLessThan(BLOSSOM_UPLOAD_THRESHOLD_BYTES)
		expect(report.verticesAfter).toBeLessThan(report.verticesBefore)
		expect(report.featuresAfter).toBeLessThanOrEqual(report.featuresBefore)
		expect(report.microgapJoins).toBeGreaterThan(0)

		// No NEW self-intersections vs. the baseline (D-06 relative reject).
		const kinks = (geom: EditorFeature[]) => optimizeMod.countSelfIntersections(geom)
		expect(kinks(result.features)).toBeLessThanOrEqual(kinks(input.features))
	})
})
