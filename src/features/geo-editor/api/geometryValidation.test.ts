import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
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

function multiPolygonFeature(id: string, polygons: [number, number][][][]): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'MultiPolygon', coordinates: polygons },
		properties: {},
	}
}

function square(minX: number, minY: number, maxX: number, maxY: number): [number, number][] {
	return [
		[minX, minY],
		[maxX, minY],
		[maxX, maxY],
		[minX, maxY],
		[minX, minY],
	]
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

describe('MultiPolygon component contacts', () => {
	it('allows separate polygon interiors to touch at one corner', () => {
		const feature = multiPolygonFeature('corners', [[square(0, 0, 1, 1)], [square(1, 1, 2, 2)]])
		expect(validateGeometryFeatures([feature]).issues).toEqual([])
	})

	it('allows an isolated vertex touching the middle of another component edge', () => {
		const feature = multiPolygonFeature('edge-point', [
			[square(0, 0, 2, 1)],
			[
				[
					[1, 1],
					[1.5, 2],
					[0.5, 2],
					[1, 1],
				],
			],
		])
		expect(validateGeometryFeatures([feature]).issues).toEqual([])
	})

	it('keeps bow-tie warnings inside one component', () => {
		const report = validateGeometryFeatures([
			multiPolygonFeature('bow-tie-part', [[bowtie], [square(3, 3, 4, 4)]]),
		])
		expect(report.withSelfIntersections).toBe(1)
		expect(report.issues[0]?.issues).toContain('self-intersection')
	})

	it('does not let a malformed part hide a bow-tie in another component', () => {
		const report = validateGeometryFeatures([
			multiPolygonFeature('malformed-and-crossing', [
				[
					[
						[3, 3],
						[4, 4],
					],
				],
				[bowtie],
			]),
		])
		expect(report.invalidRings).toBe(1)
		expect(report.withSelfIntersections).toBe(1)
	})

	it.each([
		['crossing boundaries', square(0.5, 0.5, 1.5, 1.5)],
		['contained overlapping interior', square(0.2, 0.2, 0.8, 0.8)],
		['identical parts', square(0, 0, 1, 1)],
		['shared edge', square(1, 0, 2, 1)],
	] as const)('warns for %s between components', (_description, other) => {
		const feature = multiPolygonFeature('overlap', [[square(0, 0, 1, 1)], [other]])
		expect(validateGeometryFeatures([feature]).withSelfIntersections).toBe(1)
	})

	it('warns for a partial shared edge with neither full segment contained in the other', () => {
		const feature = multiPolygonFeature('partial-edge', [
			[square(0, 0, 2, 1)],
			[square(1, 1, 3, 2)],
		])
		expect(validateGeometryFeatures([feature]).withSelfIntersections).toBe(1)
	})

	it('allows a separate part inside a hole, including a point contact with its boundary', () => {
		const feature = multiPolygonFeature('hole-island', [
			[square(0, 0, 5, 5), square(1, 1, 4, 4)],
			[
				[
					[1, 1],
					[2, 1.5],
					[1.5, 2],
					[1, 1],
				],
			],
		])
		const snapshot = JSON.stringify(feature)
		expect(validateGeometryFeatures([feature]).issues).toEqual([])
		expect(JSON.stringify(feature)).toBe(snapshot)
	})

	it('preserves hole/shell crossing warnings within a Polygon', () => {
		const feature = polygonFeature('crossing-hole', [square(0, 0, 3, 3), square(2, 1, 4, 2)])
		expect(validateGeometryFeatures([feature]).withSelfIntersections).toBe(1)
	})

	it('does not treat nearby parallel diagonal edges as a shared edge', () => {
		const gap = 1e-12
		const feature = multiPolygonFeature('nearby-edges', [
			[
				[
					[0, 0],
					[1, 0],
					[0, 1],
					[0, 0],
				],
			],
			[
				[
					[1, 1],
					[1, gap],
					[gap, 1],
					[1, 1],
				],
			],
		])
		expect(validateGeometryFeatures([feature]).issues).toEqual([])
	})

	it('does not mutate coordinates while checking component overlap', () => {
		const feature = multiPolygonFeature('read-only-overlap', [
			[square(0, 0, 2, 1)],
			[square(1, 1, 3, 2)],
		])
		const snapshot = JSON.stringify(feature)
		validateGeometryFeatures([feature])
		expect(JSON.stringify(feature)).toBe(snapshot)
	})
})
