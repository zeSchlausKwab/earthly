import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
// RED (Wave 0): `./optimize` does not exist yet — it lands in Waves 2/3. A NAMESPACE
// import (06-01 idiom) means a missing named export is a runtime assertion failure at
// call time, not a module-load crash that takes the rest of the suite down with it.
import * as optimizeMod from './optimize'
import { makeOversizedTrailFixture } from './fixture'

/**
 * GEO-01 / GEO-02 behavior contract for the pure `optimize(fc, budget)` pipeline,
 * written FIRST. These tests are RED on landing (the production symbol does not exist);
 * Waves 2-3 turn them green. The four blocks below mirror the RESEARCH "Phase
 * Requirements → Test Map" `-t` filters: report / topology / merge / unreachable.
 */

type FC = { type: 'FeatureCollection'; features: EditorFeature[] }

function lineFeature(
	id: string,
	coordinates: [number, number][],
	properties: Record<string, unknown> = {},
): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'LineString', coordinates },
		properties,
	} as EditorFeature
}

function fc(features: EditorFeature[]): FC {
	return { type: 'FeatureCollection', features }
}

describe('optimize — report (GEO-02 before/after metrics)', () => {
	it('carries bytes/vertices/features before+after and a microgapJoins count', () => {
		const input = makeOversizedTrailFixture()
		const { report } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		for (const key of [
			'bytesBefore',
			'bytesAfter',
			'verticesBefore',
			'verticesAfter',
			'featuresBefore',
			'featuresAfter',
			'microgapJoins',
		]) {
			expect(typeof (report as Record<string, unknown>)[key]).toBe('number')
		}
		expect(report.featuresBefore).toBe(input.features.length)
		// The messy fixture has microgaps within the dissolve tolerance → joins happen.
		expect(report.microgapJoins).toBeGreaterThan(0)
	})
})

describe('optimize — topology (GEO-02 D-06 relative reject)', () => {
	it('does not introduce MORE self-intersections than the baseline', () => {
		// A hand-built collection where an aggressive simplify tolerance could fold the
		// line into a NEW self-crossing. The guardrail must reject such a step.
		const input = fc([
			lineFeature('z', [
				[0, 0],
				[1, 0.0001],
				[2, 0],
				[1, -0.0001],
				[0.5, 0.5],
				[1.5, 0.5],
			]),
		])
		const { result } = optimizeMod.optimize(input, 64)
		const kinks = (geom: EditorFeature[]) => optimizeMod.countSelfIntersections(geom)
		expect(kinks(result.features)).toBeLessThanOrEqual(kinks(input.features))
	})
})

describe('optimize — merge (GEO-02 D-05 lossless identical-props)', () => {
	it('merges identical-props same-type features to one Multi*, keeps differing-props separate, preserves every value', () => {
		const shared = { name: 'Trail', description: 'segment' }
		const input = fc([
			lineFeature(
				'a',
				[
					[0, 0],
					[1, 1],
				],
				{ ...shared },
			),
			lineFeature(
				'b',
				[
					[2, 2],
					[3, 3],
				],
				{ ...shared },
			),
			lineFeature(
				'c',
				[
					[4, 4],
					[5, 5],
				],
				{ name: 'Other', description: 'different' },
			),
		])
		const { result } = optimizeMod.optimize(input, BLOSSOM_UPLOAD_THRESHOLD_BYTES)

		// a + b (identical props) collapse to one MultiLineString; c stays separate.
		const multi = result.features.filter((f) => f.geometry.type === 'MultiLineString')
		expect(multi.length).toBe(1)
		expect(result.features.length).toBeLessThan(input.features.length)

		// Every input property VALUE still present on some output feature.
		const allValues = new Set<string>()
		for (const f of result.features) {
			for (const v of Object.values(f.properties ?? {})) allValues.add(String(v))
		}
		for (const v of ['Trail', 'segment', 'Other', 'different']) {
			expect(allValues.has(v)).toBe(true)
		}
	})
})

describe('optimize — unreachable budget (GEO-03 / D-07 best-effort, no throw)', () => {
	it('returns reachedBudget:false WITHOUT throwing and still reduces bytes', () => {
		const input = makeOversizedTrailFixture()
		// An impossibly small budget cannot be reached without breaking the guardrail.
		const { result, report } = optimizeMod.optimize(input, 1)
		expect(report.reachedBudget).toBe(false)
		expect(report.bytesAfter).toBeLessThan(report.bytesBefore)
		expect(result.features.length).toBeGreaterThan(0)
	})
})
