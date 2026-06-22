import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
// RED (Wave 0): these symbols do not exist yet — they land in Plan 03. The import
// itself must fail to resolve so this file is red on landing (intended W0 state).
import { type GeometryValidationReport, validateGeometryFeatures } from './geometryValidation'

/**
 * TOOLS-04 acceptance contract, written FIRST.
 *
 * `validateGeometryFeatures(features)` is READ-ONLY (no editor mutation) and
 * returns a per-feature + aggregate report driven by turf:
 *   - self-intersection via `kinks` → withSelfIntersections
 *   - near-zero-area sliver via `area` below a threshold → withZeroArea
 *   - invalid ring (too few points / unclosed) → invalidRings
 * Aggregate shape: { checked, withSelfIntersections, withZeroArea, invalidRings,
 *   issues: [{ featureId, issues: [...] }] }.
 *
 * OUT OF SCOPE (A3, deferred): cross-feature gap/sliver detection (the expensive
 * topology check) — this module is per-feature only.
 */

function polygonFeature(id: string, rings: [number, number][][]): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Polygon', coordinates: rings },
		properties: {},
	}
}

/** A clean, closed, non-degenerate square (first == last, positive area). */
const cleanSquare: [number, number][] = [
	[0, 0],
	[0, 1],
	[1, 1],
	[1, 0],
	[0, 0],
]

/** A self-intersecting "bowtie" closed ring (turf.kinks finds the crossing). */
const bowtie: [number, number][] = [
	[0, 0],
	[1, 1],
	[1, 0],
	[0, 1],
	[0, 0],
]

/** A near-zero-area sliver (a hair-thin closed ring). */
const sliver: [number, number][] = [
	[0, 0],
	[1, 0],
	[1, 0.0000001],
	[0, 0.0000001],
	[0, 0],
]

describe('validateGeometryFeatures — aggregate report shape (TOOLS-04, read-only)', () => {
	it('reports the aggregate keys with a clean polygon (no issues)', () => {
		const report: GeometryValidationReport = validateGeometryFeatures([
			polygonFeature('clean', [cleanSquare]),
		])
		expect(report.checked).toBe(1)
		expect(report.withSelfIntersections).toBe(0)
		expect(report.withZeroArea).toBe(0)
		expect(report.invalidRings).toBe(0)
		expect(report.issues).toEqual([])
	})

	it('flags a self-intersecting polygon (turf kinks) → withSelfIntersections', () => {
		const report = validateGeometryFeatures([polygonFeature('x', [bowtie])])
		expect(report.withSelfIntersections).toBe(1)
		const entry = report.issues.find((e) => e.featureId === 'x')
		expect(entry).toBeDefined()
		expect(entry?.issues).toContain('self-intersection')
	})

	it('flags a near-zero-area sliver polygon (turf area below threshold) → withZeroArea', () => {
		const report = validateGeometryFeatures([polygonFeature('s', [sliver])])
		expect(report.withZeroArea).toBe(1)
		const entry = report.issues.find((e) => e.featureId === 's')
		expect(entry?.issues).toContain('zero-area')
	})

	it('flags an invalid ring (too few points / unclosed) → invalidRings', () => {
		// A "ring" with only two distinct positions, unclosed — not a valid polygon ring.
		const badRing: [number, number][] = [
			[0, 0],
			[1, 1],
		]
		const report = validateGeometryFeatures([polygonFeature('r', [badRing])])
		expect(report.invalidRings).toBe(1)
		const entry = report.issues.find((e) => e.featureId === 'r')
		expect(entry?.issues).toContain('invalid-ring')
	})
})

describe('validateGeometryFeatures — read-only (no mutation, TOOLS-04 contract)', () => {
	it('does not mutate the input features or list', () => {
		const features = [polygonFeature('x', [bowtie]), polygonFeature('clean', [cleanSquare])]
		const snapshot = JSON.stringify(features)
		validateGeometryFeatures(features)
		expect(JSON.stringify(features)).toBe(snapshot)
	})

	it('checks every feature passed and counts them in `checked`', () => {
		const report = validateGeometryFeatures([
			polygonFeature('a', [cleanSquare]),
			polygonFeature('b', [bowtie]),
			polygonFeature('c', [sliver]),
		])
		expect(report.checked).toBe(3)
	})
})
