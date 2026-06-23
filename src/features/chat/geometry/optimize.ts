/**
 * Pure geometry-optimization pipeline (GEO-01/02/03) — the heart of Phase 7.
 *
 * `optimize(fc, targetBytes?)` runs the FIXED pipeline in the FIXED order (D-02):
 *
 *   STAGE 1  microgap stitch        (run ONCE, up front)
 *   STAGE 2  lossless identical-props merge-to-multi  (run ONCE, up front)
 *   STAGE 3  topology-guarded binary-search simplify to the byte budget (D-03/D-06)
 *
 * It writes almost NO new geometry math; it COMPOSES the existing pure leaf helpers
 * (`featureHelpers`, `geometry`, `geometryValidation`) + `@turf/turf` that the editor
 * managers already use — minus the editor binding and minus the lossy-merge bug
 * (`CombineManager.ts:43`, which the toolbar combine reuses; D-05 must NOT).
 *
 * BOUNDARY (T-07-08): imports ONLY leaf modules — NO editor, NO DOM, NO worker, NO
 * geo-editor api barrel. The grep acceptance criterion enforces this.
 * `geometryValidation` is imported by its DEEP path (geometryValidation module, not
 * the barrel) so its own leaf imports (turf + EditorFeature type) don't drag in
 * Nostr/pino.
 *
 * D-07: the binary search NEVER throws and NEVER shreds. When the budget is
 * unreachable without breaking the topology guardrail, it returns the gentlest
 * VALID candidate found and an honest `reachedBudget:false` report.
 *
 * PERFORMANCE (07-05, T-07-12/T-07-13): the search is bounded to near-linear cost.
 * The OLD pipeline ran `turf.kinks` topology validation per binary-search iteration
 * over the FULL feature set (O(V^2) per high-vertex feature) AND used the expensive
 * `turf.simplify({highQuality:true})` per iteration — on a FEW features of ~30k+
 * vertices each this exceeded the worker's 30s timeout and ran for minutes. The fix:
 *   (A) the binary search uses the CHEAP `turf.simplify({highQuality:false})` (the
 *       Radial-Distance/DP variant — weakly monotonic in tolerance just like
 *       highQuality, so the search is unaffected, but dramatically cheaper).
 *   (B) topology validation (`turf.kinks`) is NO LONGER run per-iteration. We use the
 *       "validate-once-at-end" strategy: the binary search converges on bytes-vs-budget
 *       ONLY (the `SIMPLIFY_TOLERANCE_MAX` ceiling still bounds aggressiveness), then
 *       topology is validated ONCE on the chosen candidate; if it introduces NEW
 *       problems vs the baseline we back off one step (re-simplify gentler) and
 *       re-validate once. This collapses N kinks passes into ~1-2.
 * Honest D-06 relaxation: the baseline + final validation skip features whose vertex
 * count exceeds `TOPOLOGY_VALIDATION_MAX_VERTICES` (the `turf.kinks` cost is the same
 * O(V^2) pathology there). On such high-vertex features the guard can no longer PROVE a
 * new self-intersection — the `SIMPLIFY_TOLERANCE_MAX` ceiling is the remaining
 * shred-guard. "No crash / always settles" outranks the per-iteration guard on huge
 * inputs.
 */

import * as turf from '@turf/turf'
import type { Feature, Geometry, Position } from 'geojson'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { validateGeometryFeatures } from '@/features/geo-editor/api/geometryValidation'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import {
	extractGeometryParts,
	getBaseGeometryType,
	mergeLinePartsBySharedEndpoints,
	normalizeLineCoordinates,
	toMultiGeometryType,
} from '@/features/geo-editor/core/utils/featureHelpers'
import { countGeometryVertices, isSimplifiableGeometryType } from '@/lib/geo/geometry'
import type { OptimizeFeatureCollection, OptimizeReport } from './types'

// ── Host-internal constants ──────────────────────────────────────────────────

/** The dissolve/stitch tolerance (matches `dissolveSelectedLines` default). */
const MICROGAP_TOLERANCE = 0.00001

/** Simplify tolerance bounds — mirrors SimplifyDialog.tsx:22-23 (MIN/MAX). */
const SIMPLIFY_TOLERANCE_MIN = 1e-8
/** Hard aggressiveness ceiling — the search NEVER exceeds this (D-06). */
const SIMPLIFY_TOLERANCE_MAX = 1e-3

/** Bounded binary-search iterations (D-03; T-07-07 DoS cap). */
const MAX_ITERS = 12

/**
 * Per-feature vertex ceiling above which the EXPENSIVE `turf.kinks` topology
 * validation is NOT run (T-07-12). Rationale: `turf.kinks` is O(V^2) per feature —
 * empirically ~5k verts ≈ ~2.1s for ONE feature, and it grows quadratically above
 * that. Validating high-vertex features per-iteration is exactly what made the old
 * pipeline blow the worker timeout on a few large features. Above this ceiling we do
 * not attempt to prove self-intersection; the `SIMPLIFY_TOLERANCE_MAX` aggressiveness
 * ceiling is the remaining shred-guard there (the honest D-06 relaxation).
 */
const TOPOLOGY_VALIDATION_MAX_VERTICES = 5_000

const BYTE_ENCODER = new TextEncoder()

// ── Byte measurement (matches usePublishing.getCollectionSize / SimplifyDialog) ──

/**
 * Serialized byte size of a feature list — the EXACT measurement the publish gate
 * and `SimplifyDialog` use, so the budget compares apples-to-apples with
 * `BLOSSOM_UPLOAD_THRESHOLD_BYTES`.
 */
function bytesOf(features: EditorFeature[]): number {
	return BYTE_ENCODER.encode(JSON.stringify({ type: 'FeatureCollection', features })).length
}

function totalVertices(features: EditorFeature[]): number {
	let sum = 0
	for (const f of features) {
		if (f.geometry) sum += countGeometryVertices(f.geometry as Geometry)
	}
	return sum
}

// ── Public topology helper (the Wave-2 name the RED tests pin) ────────────────

/**
 * Total number of self-intersecting features in a list — the public topology
 * metric the tests assert against (`optimizeMod.countSelfIntersections`). Driven
 * by the same `validateGeometryFeatures` reporter the binary-search reject uses.
 */
export function countSelfIntersections(features: EditorFeature[]): number {
	return validateGeometryFeatures(features).withSelfIntersections
}

// ── STAGE 2 helper: canonical props key (lossless merge grouping) ─────────────

/**
 * A stable, sorted-entries stringification of a feature's USER properties — the
 * merge grouping key (D-05). Editor-internal keys (`featureId`/`meta`) are stripped
 * so two features differing ONLY in those still merge. Two features with the SAME
 * key share byte-identical user props ⇒ safe to merge losslessly into one Multi*.
 */
function canonicalPropsKey(props: Record<string, unknown> | null | undefined): string {
	const entries = Object.entries(props ?? {})
		.filter(([k]) => k !== 'featureId' && k !== 'meta')
		.sort(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(entries)
}

// ── STAGE 1: microgap stitch (run ONCE) ───────────────────────────────────────

interface StitchResult {
	features: EditorFeature[]
	microgapJoins: number
}

/** Tolerance-quantized endpoint key (matches the stitch grid), for property attribution. */
function endpointKey(position: Position): string {
	const lon = Math.round((position[0] as number) / MICROGAP_TOLERANCE)
	const lat = Math.round((position[1] as number) / MICROGAP_TOLERANCE)
	return `${lon}:${lat}`
}

/**
 * Stitch line features whose endpoints fall within `MICROGAP_TOLERANCE` — mirrors
 * `LineOperationsManager.dissolveSelectedLines` (which joins endpoint-touching line
 * parts across the whole selection). All line parts are normalized then merged by
 * shared endpoints; `microgapJoins` counts how many input parts collapsed into
 * fewer output parts. Non-line features pass through unchanged.
 *
 * Output line parts are re-emitted as individual LineString features. Properties
 * survive the later lossless identical-props MERGE stage; the stitch itself keeps
 * the first contributing line's properties on each joined part (the dissolve
 * precedent), and the merge then groups identical-props features into Multi*.
 */
function stitchMicrogaps(features: EditorFeature[]): StitchResult {
	const lineFeatures: EditorFeature[] = []
	const passthrough: EditorFeature[] = []

	for (const f of features) {
		const base = f.geometry ? getBaseGeometryType(f.geometry.type) : null
		if (base === 'LineString') {
			lineFeatures.push(f)
		} else {
			passthrough.push(f)
		}
	}

	// No line features (or a single one) → nothing to stitch.
	if (lineFeatures.length < 2) {
		return { features, microgapJoins: 0 }
	}

	// Collect & normalize every line part across all line features, remembering which
	// source feature each part came from so unchanged parts keep their OWN properties
	// (D-05 lossless: stitch must not smear the first feature's props over everything).
	const parts: Position[][] = []
	const partSource: EditorFeature[] = []
	const endpointOwner = new Map<string, EditorFeature>()
	for (const f of lineFeatures) {
		const coords = extractGeometryParts(f.geometry as Geometry, 'LineString') as Position[][]
		for (const part of coords) {
			const normalized = normalizeLineCoordinates(part, MICROGAP_TOLERANCE)
			if (normalized.length < 2) continue
			parts.push(normalized)
			partSource.push(f)
			// Index BOTH endpoints → owning feature, so a merged part can be attributed.
			const a = normalized[0] as Position
			const b = normalized[normalized.length - 1] as Position
			if (!endpointOwner.has(endpointKey(a))) endpointOwner.set(endpointKey(a), f)
			if (!endpointOwner.has(endpointKey(b))) endpointOwner.set(endpointKey(b), f)
		}
	}

	const partsBefore = parts.length
	const merged = mergeLinePartsBySharedEndpoints(parts, MICROGAP_TOLERANCE)
	// merge can fail to cover degenerate parts; fall back to the normalized parts.
	const outParts = merged.length > 0 ? merged : parts
	const microgapJoins = Math.max(0, partsBefore - outParts.length)

	// Re-emit each merged part as a LineString. Attribute properties from the feature
	// that owned the part's start endpoint (falls back to the first line). An UNCHANGED
	// part is owned 1:1 by its source feature, so its props survive verbatim; a genuinely
	// joined part takes one contributing line's props (the dissolve precedent).
	const fallback = lineFeatures[0] as EditorFeature
	const stitched: EditorFeature[] = outParts.map((coordinates, idx) => {
		const start = (coordinates as Position[])[0] as Position
		const end = (coordinates as Position[])[(coordinates as Position[]).length - 1] as Position
		const owner =
			endpointOwner.get(endpointKey(start)) ?? endpointOwner.get(endpointKey(end)) ?? fallback
		return {
			...owner,
			id: `${owner.id}-stitch-${idx}`,
			geometry: { type: 'LineString', coordinates },
		} as EditorFeature
	})

	return { features: [...stitched, ...passthrough], microgapJoins }
}

// ── STAGE 2: lossless identical-props merge-to-multi (run ONCE) ───────────────

/**
 * Group features by `(baseGeometryType, canonicalPropsKey)`; within an
 * identical-props group of size ≥ 2 build ONE Multi* via `extractGeometryParts` +
 * `toMultiGeometryType`, keeping the group's shared properties (D-05 lossless).
 * Singletons and differing-props features pass through UNCHANGED.
 *
 * NEVER calls the lossy toolbar combine primitive (first-props-wins, CombineManager.ts:43).
 */
function mergeIdenticalProps(features: EditorFeature[]): EditorFeature[] {
	const groups = new Map<string, EditorFeature[]>()
	const order: string[] = []

	for (const f of features) {
		const base = f.geometry ? getBaseGeometryType(f.geometry.type) : null
		if (!base) {
			// Unmergeable (e.g. GeometryCollection) — keep as its own singleton group.
			const key = `__pass__:${order.length}`
			groups.set(key, [f])
			order.push(key)
			continue
		}
		const key = `${base}::${canonicalPropsKey(f.properties as Record<string, unknown>)}`
		if (!groups.has(key)) {
			groups.set(key, [])
			order.push(key)
		}
		;(groups.get(key) as EditorFeature[]).push(f)
	}

	const out: EditorFeature[] = []
	for (const key of order) {
		const group = groups.get(key) as EditorFeature[]
		if (group.length === 1) {
			out.push(group[0] as EditorFeature)
			continue
		}

		const template = group[0] as EditorFeature
		const base = getBaseGeometryType((template.geometry as Geometry).type)
		const multiType = base ? toMultiGeometryType(base) : null
		if (!base || !multiType) {
			// Cannot merge — keep them separate.
			out.push(...group)
			continue
		}

		const allParts: unknown[] = []
		for (const f of group) {
			const parts = extractGeometryParts(f.geometry as Geometry, base)
			for (const part of parts) allParts.push(part)
		}

		out.push({
			...template,
			geometry: { type: multiType, coordinates: allParts } as Geometry,
		} as EditorFeature)
	}

	return out
}

// ── STAGE 3: topology-guarded binary-search simplify ──────────────────────────

/**
 * Simplify the simplifiable features at `tolerance`; pass others through.
 *
 * Uses the CHEAP `highQuality:false` variant (Radial-Distance/DP) during the binary
 * search (07-05 fix A): it is dramatically cheaper than the Douglas-Peucker
 * `highQuality:true` variant yet weakly monotonic in `tolerance` in the same way, so
 * the byte-vs-budget binary search is unaffected. This avoids the per-iteration
 * `highQuality:true` cost that compounded the old quadratic pathology.
 */
function simplifyAll(features: EditorFeature[], tolerance: number): EditorFeature[] {
	return features.map((f) => {
		if (!f.geometry || !isSimplifiableGeometryType(f.geometry.type)) return f
		try {
			const simplified = turf.simplify(f as Feature, { tolerance, highQuality: false })
			return { ...f, geometry: simplified.geometry } as EditorFeature
		} catch {
			// A simplify failure on a degenerate feature → keep the original (no shred).
			return f
		}
	})
}

/**
 * Validate topology over ONLY the below-threshold features (07-05 fix B). The
 * expensive `turf.kinks` check (O(V^2) per feature) is skipped for features whose
 * vertex count exceeds `TOPOLOGY_VALIDATION_MAX_VERTICES` — running it on high-vertex
 * features is the pathology that blew the worker timeout. Above-threshold features are
 * excluded CONSISTENTLY from both the baseline and the candidate counts, so a
 * comparison between two such snapshots stays apples-to-apples (D-06 relative reject is
 * preserved for the features it can afford to check).
 */
function validateBelowThreshold(features: EditorFeature[]): {
	selfIntersections: number
	zeroArea: number
} {
	const checkable = features.filter(
		(f) =>
			f.geometry != null &&
			countGeometryVertices(f.geometry as Geometry) <= TOPOLOGY_VALIDATION_MAX_VERTICES,
	)
	const report = validateGeometryFeatures(checkable)
	return { selfIntersections: report.withSelfIntersections, zeroArea: report.withZeroArea }
}

/**
 * True iff `candidate` has MORE self-intersecting OR zero-area features than the
 * baseline (D-06 — reject only NEW problems, not pre-existing ones; Pitfall 3). Only
 * below-threshold features are measured (see {@link validateBelowThreshold}); this is
 * run ONCE on the final candidate (07-05), never per binary-search iteration.
 */
function introducesNewTopologyProblems(
	candidate: EditorFeature[],
	baseline: { selfIntersections: number; zeroArea: number },
): boolean {
	const report = validateBelowThreshold(candidate)
	return (
		report.selfIntersections > baseline.selfIntersections || report.zeroArea > baseline.zeroArea
	)
}

// ── Public entry point ─────────────────────────────────────────────────────────

/**
 * Run the fixed stitch → merge → binary-search-simplify pipeline over a plain
 * FeatureCollection, converging toward `targetBytes` (default: the publish
 * threshold). Returns the optimized collection + an honest before/after report.
 * Pure: no editor, no DOM, no worker, no api barrel.
 */
export function optimize(
	fc: OptimizeFeatureCollection,
	targetBytes?: number,
): { result: OptimizeFeatureCollection; report: OptimizeReport } {
	const inputFeatures = fc.features ?? []

	const budget =
		typeof targetBytes === 'number' && Number.isFinite(targetBytes) && targetBytes > 0
			? targetBytes
			: BLOSSOM_UPLOAD_THRESHOLD_BYTES

	const bytesBefore = bytesOf(inputFeatures)
	const verticesBefore = totalVertices(inputFeatures)
	const featuresBefore = inputFeatures.length

	// STAGE 1: stitch microgaps (once).
	const stitch = stitchMicrogaps(inputFeatures)

	// STAGE 2: lossless identical-props merge (once).
	const merged = mergeIdenticalProps(stitch.features)

	// BASELINE: record post-stitch/merge topology so the search rejects only NEW problems.
	// Measured over BELOW-THRESHOLD features only (07-05) — the `turf.kinks` cost on
	// high-vertex features is the quadratic pathology; measuring it once would already be
	// expensive, and the per-iteration loop no longer runs it at all.
	const baseline = validateBelowThreshold(merged)

	// STAGE 3: binary-search the simplify tolerance to land just under budget (D-03).
	// 07-05: the search converges on BYTES vs budget ONLY (no per-iteration topology
	// reject — that was the O(V^2) hot spot). The SIMPLIFY_TOLERANCE_MAX ceiling still
	// bounds aggressiveness. Topology is validated ONCE after the search (below).
	let lo = SIMPLIFY_TOLERANCE_MIN
	let hi = SIMPLIFY_TOLERANCE_MAX
	let underBudget: EditorFeature[] | null = null
	let underBudgetTolerance = 0
	// The gentlest (smallest-tolerance) candidate seen, as the D-07 best-effort floor.
	let gentlest: EditorFeature[] | null = null
	let gentlestTolerance = 0
	let gentlestBytes = Number.POSITIVE_INFINITY

	for (let i = 0; i < MAX_ITERS; i++) {
		const mid = Math.sqrt(lo * hi) // geometric mid — tolerance is log-scaled.
		const candidate = simplifyAll(merged, mid)
		const bytes = bytesOf(candidate)

		// Track the gentlest (smallest-tolerance) candidate as the best-effort floor.
		if (bytes < gentlestBytes) {
			gentlest = candidate
			gentlestTolerance = mid
			gentlestBytes = bytes
		}

		if (bytes <= budget) {
			underBudget = candidate // under budget → record + try gentler.
			underBudgetTolerance = mid
			hi = mid
		} else {
			lo = mid // over budget → push harder.
		}
	}

	// VALIDATE ONCE on the winning candidate (07-05 fix B). If it introduces NEW topology
	// problems vs the baseline, back off ONE step to the previous (gentler) tolerance and
	// re-validate once — collapsing N kinks passes into ~1-2. This preserves the D-06
	// INTENT (do not INTRODUCE new self-intersections / zero-area) for the common case.
	let best: EditorFeature[] | null = null
	if (underBudget) {
		if (!introducesNewTopologyProblems(underBudget, baseline)) {
			best = underBudget
		} else {
			// Back off to a gentler tolerance (geometric mid between min and the chosen one).
			const gentlerTol = Math.sqrt(SIMPLIFY_TOLERANCE_MIN * underBudgetTolerance)
			const backoff = simplifyAll(merged, gentlerTol)
			// Accept the back-off only if it both stays under budget AND is topology-clean.
			if (bytesOf(backoff) <= budget && !introducesNewTopologyProblems(backoff, baseline)) {
				best = backoff
			}
		}
	}

	const reachedBudget = best !== null
	// D-07: if no topology-clean under-budget candidate exists, return the gentlest VALID
	// candidate (gentlest if it does not introduce new problems, else a gentler re-simplify,
	// else the post-stitch/merge collection — NEVER the raw input, NEVER a throw).
	let resultFeatures: EditorFeature[]
	if (best) {
		resultFeatures = best
	} else if (gentlest && !introducesNewTopologyProblems(gentlest, baseline)) {
		resultFeatures = gentlest
	} else if (gentlest) {
		// The gentlest search candidate added a problem — fall back to an even gentler pass.
		const gentlerTol = Math.sqrt(
			SIMPLIFY_TOLERANCE_MIN * Math.max(gentlestTolerance, SIMPLIFY_TOLERANCE_MIN),
		)
		const fallback = simplifyAll(merged, gentlerTol)
		resultFeatures = introducesNewTopologyProblems(fallback, baseline) ? merged : fallback
	} else {
		resultFeatures = merged
	}

	// NEVER INFLATE (WR-04): the STAGE 1 stitch re-emits parts with longer ids and the
	// STAGE 2 merge can, on a degenerate no-op input, produce a serialized collection LARGER
	// than the input. The caller asked to REDUCE bytes — if the pipeline did not actually
	// shrink them, return the original input unchanged. This is honest (the report's
	// `bytesAfter <= bytesBefore` invariant is GUARANTEED, not incidental) and lossless (the
	// raw input is by definition lossless). This outer safety net is distinct from the D-07
	// topology/budget fallback chain above (which never returns raw input mid-search).
	if (bytesOf(resultFeatures) > bytesBefore) {
		resultFeatures = inputFeatures
	}

	const report: OptimizeReport = {
		bytesBefore,
		bytesAfter: bytesOf(resultFeatures),
		verticesBefore,
		verticesAfter: totalVertices(resultFeatures),
		featuresBefore,
		featuresAfter: resultFeatures.length,
		microgapJoins: stitch.microgapJoins,
		reachedBudget,
		baselineSelfIntersections: baseline.selfIntersections,
		baselineZeroArea: baseline.zeroArea,
	}

	return { result: { type: 'FeatureCollection', features: resultFeatures }, report }
}
