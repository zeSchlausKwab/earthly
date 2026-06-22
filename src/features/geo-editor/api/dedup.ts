/**
 * Authoring API — pure duplicate-grouping primitive (TOOLS-03 dedup half).
 *
 * `findDuplicateGroups(features, { by, keys? })` groups features that are
 * duplicates of one another — by geometry, by a chosen attribute-key tuple, or by
 * BOTH — and returns each group's keep-first survivor plus the non-survivor ids a
 * tool will delete. It is PURE: it mutates nothing, holds NO editor reference, and
 * performs NO delete. The actual gate-routed delete lives in the Wave-4 dedup tool,
 * which feeds `duplicateIds` into `authoring.deleteFeatures` through the safe-editing
 * gate (intent:'delete'). Keeping the grouping here, headless and unit-tested,
 * isolates the genuinely-new logic from the tool wiring (06-RESEARCH §TOOLS-03; A2).
 *
 * Survivor selection is KEEP-FIRST: the first feature in input order
 * (`getAllFeatures()` order = input order) wins; the rest of the group are the
 * `duplicateIds`. A feature with no duplicate forms no group (so a no-duplicates
 * input returns `[]`).
 *
 * Boundary (D-07): imports ONLY the `EditorFeature` type from `../core/types` and
 * `@turf/turf` (turf is NOT in the forbidden list) — NOTHING from chat, the tool
 * registry, or Nostr. `boundary.test.ts` auto-scans every `api/*.ts` and enforces it.
 */

import type { EditorFeature } from '../core/types'

/**
 * How two features are compared for duplication.
 *   - `geometry`   — structurally-equal geometry (the identical-import common case).
 *   - `attributes` — an equal tuple over the chosen `keys` (ignores geometry).
 *   - `both`       — geometry AND the chosen attribute tuple must match.
 *
 * `geometry` is the tool's DEFAULT (A2) — plan-review-overridable.
 */
export type DedupBy = 'geometry' | 'attributes' | 'both'

/**
 * One group of duplicates: the kept survivor plus the non-survivor ids to delete.
 * A tool wires `duplicateIds` into the gated delete; this module never deletes.
 */
export interface DuplicateGroup {
	/** Keep-first survivor — first member of the group in input order. */
	survivorId: string
	/** The non-survivor ids (everything in the group except the survivor). */
	duplicateIds: string[]
}

/**
 * Structural deep-equality for plain JSON values (geometry / attribute values).
 * Mirrors the private `deepEqual` in `diff.ts` (not exported there) so geometry
 * comparison stays deterministic and dependency-free for the common identical-import
 * case — cheaper than `turf.booleanEqual` and exactly what an exact-duplicate scan
 * needs.
 */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (typeof a !== typeof b) return false
	if (a === null || b === null) return a === b
	if (typeof a !== 'object') return false

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false
		if (a.length !== b.length) return false
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false
		}
		return true
	}

	const aObj = a as Record<string, unknown>
	const bObj = b as Record<string, unknown>
	const aKeys = Object.keys(aObj)
	const bKeys = Object.keys(bObj)
	if (aKeys.length !== bKeys.length) return false
	for (const key of aKeys) {
		if (!Object.hasOwn(bObj, key)) return false
		if (!deepEqual(aObj[key], bObj[key])) return false
	}
	return true
}

/** The attribute tuple a feature contributes for `by:'attributes'`/`'both'`. */
function attributeTuple(feature: EditorFeature, keys: string[]): unknown[] {
	const props = (feature.properties ?? {}) as Record<string, unknown>
	return keys.map((k) => props[k])
}

/**
 * Whether two features are duplicates under the chosen comparison. For `attributes`
 * and `both`, `keys` selects the property tuple compared (empty/absent keys make
 * every feature's attribute tuple equal — caller's responsibility to supply keys).
 */
function isDuplicate(a: EditorFeature, b: EditorFeature, by: DedupBy, keys: string[]): boolean {
	const geometryMatches = () => deepEqual(a.geometry, b.geometry)
	const attributesMatch = () => deepEqual(attributeTuple(a, keys), attributeTuple(b, keys))

	switch (by) {
		case 'geometry':
			return geometryMatches()
		case 'attributes':
			return attributesMatch()
		case 'both':
			return geometryMatches() && attributesMatch()
		default:
			return false
	}
}

/**
 * Group duplicate features and report each group's keep-first survivor + the
 * non-survivor ids to delete. Pure — no side effects, no editor reference, no
 * mutation of the input list or its features. A unique feature forms no group, so
 * a no-duplicates input returns `[]`.
 */
export function findDuplicateGroups(
	features: EditorFeature[],
	opts: { by: DedupBy; keys?: string[] },
): DuplicateGroup[] {
	const { by, keys = [] } = opts
	const groups: DuplicateGroup[] = []
	// Track which input indices have already been folded into a group so a feature
	// is reported exactly once (as either a survivor or a duplicate).
	const consumed = new Set<number>()

	for (let i = 0; i < features.length; i++) {
		if (consumed.has(i)) continue
		const survivor = features[i]
		if (!survivor) continue

		const duplicateIds: string[] = []
		for (let j = i + 1; j < features.length; j++) {
			if (consumed.has(j)) continue
			const candidate = features[j]
			if (!candidate) continue
			if (isDuplicate(survivor, candidate, by, keys)) {
				consumed.add(j)
				duplicateIds.push(candidate.id)
			}
		}

		if (duplicateIds.length > 0) {
			consumed.add(i)
			groups.push({ survivorId: survivor.id, duplicateIds })
		}
	}

	return groups
}
