/**
 * Authoring API — read-only per-feature geometry validation reporter (TOOLS-04).
 *
 * `validateGeometryFeatures(features, predicate?)` produces a per-feature + aggregate
 * REPORT of geometry problems over a feature set. It is strictly READ-ONLY: it holds
 * NO editor reference, mutates nothing, and is NOT a mutation/gate path. (A destructive
 * bug here would delete/alter features under the guise of "validation" — T-06-03b — so
 * this module never imports or touches the editor; the acceptance grep proves it.)
 *
 * Three per-feature checks, turf-driven where applicable:
 *   - self-intersection — `turf.kinks(feature).features.length > 0` → `withSelfIntersections`
 *   - near-zero-area sliver — `turf.area(feature) < ZERO_AREA_THRESHOLD_M2` → `withZeroArea`
 *     (only when the polygon is NOT self-intersecting — a self-intersecting ring makes
 *     turf report area 0, which is a self-intersection artifact, not a real sliver).
 *   - invalid ring — a polygon ring with too few positions or that is unclosed
 *     (first !== last) → `invalidRings`.
 *
 * Non-polygon geometry (points / lines) is checked only for the applicable checks and
 * never throws.
 *
 * OUT OF SCOPE (A3, DEFERRED): cross-feature topology — gaps/slivers BETWEEN features.
 * That expensive pairwise check is explicitly NOT part of this per-feature reporter.
 *
 * Boundary (D-07): imports ONLY the `EditorFeature` type from `../core/types`, the
 * optional `Predicate`/`selectByPredicate` from `./predicate` (for optional
 * pre-scoping), and `@turf/turf` (turf is NOT in the forbidden list) — NOTHING from
 * chat, the tool registry, or Nostr. `boundary.test.ts` auto-scans + enforces this.
 */

import * as turf from '@turf/turf'
import type { EditorFeature } from '../core/types'
import { type Predicate, selectByPredicate } from './predicate'

/**
 * Square-metre threshold below which a polygon counts as a near-zero-area sliver.
 * Chosen well above a hair-thin degenerate ring (~10^3 m²) yet far below any real
 * mapped area (a clean 1°×1° square is ~10^10 m²), so genuine features never trip it
 * while degenerate slivers do. Documented constant rather than a magic literal.
 */
export const ZERO_AREA_THRESHOLD_M2 = 1e4

/** One feature's recorded issues (only present when it has at least one). */
export interface GeometryIssueEntry {
	featureId: string
	issues: string[]
}

/**
 * Aggregate read-only report over the validated feature set. Counters tally how many
 * features tripped each check; `issues` lists the per-feature detail (one entry per
 * feature that has at least one problem). `checked` is every feature passed.
 */
export interface GeometryValidationReport {
	checked: number
	withSelfIntersections: number
	withZeroArea: number
	invalidRings: number
	issues: GeometryIssueEntry[]
}

/** All linear rings of a feature's geometry (Polygon + MultiPolygon), else `[]`. */
function polygonRings(feature: EditorFeature): number[][][] {
	const geometry = feature.geometry
	if (!geometry) return []
	if (geometry.type === 'Polygon') {
		return geometry.coordinates as number[][][]
	}
	if (geometry.type === 'MultiPolygon') {
		return (geometry.coordinates as number[][][][]).flat()
	}
	return []
}

/**
 * A ring is invalid when it has fewer than 4 positions (a closed triangle needs 4:
 * three corners + the repeated first) or when it is unclosed (first !== last).
 * Mirrors the closeRing/min-points logic used in the ingest tools.
 */
function hasInvalidRing(feature: EditorFeature): boolean {
	const rings = polygonRings(feature)
	for (const ring of rings) {
		if (ring.length < 4) return true
		const first = ring[0]
		const last = ring[ring.length - 1]
		if (!first || !last) return true
		if (first[0] !== last[0] || first[1] !== last[1]) return true
	}
	return false
}

/** Whether the feature self-intersects (turf kinks). Never throws on bad input. */
function hasSelfIntersection(feature: EditorFeature): boolean {
	try {
		return turf.kinks(feature as turf.AllGeoJSON).features.length > 0
	} catch {
		return false
	}
}

/** The feature's area in m² (0 on non-areal geometry or turf failure). */
function safeArea(feature: EditorFeature): number {
	try {
		return turf.area(feature as turf.AllGeoJSON)
	} catch {
		return 0
	}
}

/**
 * Validate a feature set and return a read-only report. Mutates nothing and holds no
 * editor reference. When a `predicate` is supplied, only the matching subset is
 * checked (optional pre-scoping via the shared predicate engine); `checked` reflects
 * the scoped count.
 */
export function validateGeometryFeatures(
	features: EditorFeature[],
	predicate?: Predicate,
): GeometryValidationReport {
	const scoped = predicate ? selectByPredicate(features, predicate) : features

	let withSelfIntersections = 0
	let withZeroArea = 0
	let invalidRings = 0
	const issues: GeometryIssueEntry[] = []

	for (const feature of scoped) {
		const featureIssues: string[] = []
		const rings = polygonRings(feature)
		const isAreal = rings.length > 0

		// Invalid ring is a structural defect — check it regardless of the others.
		const ringInvalid = isAreal && hasInvalidRing(feature)
		if (ringInvalid) {
			invalidRings++
			featureIssues.push('invalid-ring')
		}

		const selfIntersects = hasSelfIntersection(feature)
		if (selfIntersects) {
			withSelfIntersections++
			featureIssues.push('self-intersection')
		}

		// Zero-area only for a structurally-valid, non-self-intersecting areal ring —
		// a self-intersecting OR malformed ring reports turf area 0 as an artifact of
		// its defect (already flagged above), not as a genuine near-zero-area sliver.
		//
		// GRANULARITY (WR-05): `safeArea` measures the WHOLE feature. For a MultiPolygon
		// this is the SUM across parts, so a feature with one large valid part and one
		// degenerate sliver part is NOT flagged zero-area (the aggregate stays above the
		// threshold). `withZeroArea` therefore counts features whose TOTAL area is
		// near-zero, NOT per-part slivers. Per-part sliver detection is intentionally out
		// of scope here (it would change the counter's meaning and the report shape).
		if (isAreal && !ringInvalid && !selfIntersects && safeArea(feature) < ZERO_AREA_THRESHOLD_M2) {
			withZeroArea++
			featureIssues.push('zero-area')
		}

		if (featureIssues.length > 0) {
			issues.push({ featureId: String(feature.id), issues: featureIssues })
		}
	}

	return {
		checked: scoped.length,
		withSelfIntersections,
		withZeroArea,
		invalidRings,
		issues,
	}
}
