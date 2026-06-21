/**
 * Authoring API — pure add/modify/delete diff classifier (SAFE-02 / D-06).
 *
 * `classifyMutation(current, proposed, intent)` buckets a proposed feature set
 * against the current bound set, BY FEATURE ID, into:
 *   - `added`    — proposed ids not present in `current`.
 *   - `modified` — same-id pairs whose geometry, a canonical style key, or
 *                  `properties` differ (identical pairs are NOT a modify).
 *   - `deleted`  — current ids absent from `proposed`, populated ONLY when
 *                  `intent === 'delete'` (an add-intent colliding id is the
 *                  append-path skippedDuplicate, not a modify — 05-RESEARCH 216).
 *
 * This is the host-side mechanism SAFE-03's preview, SAFE-04's gating, and
 * SAFE-06's undo all sit on top of. It mirrors `interceptor.ts`: a single
 * exported type + a pure, side-effect-free function, holding NO editor reference.
 *
 * Boundary (D-07): imports ONLY the intent enum from `./interceptor`, the
 * canonical style-key set from `./styleOptions`, and the `EditorFeature` type —
 * NOTHING from chat, the tool registry, or Nostr. `boundary.test.ts` enforces it.
 */

import type { EditorFeature } from '../core/types'
import type { MutationIntent } from './interceptor'
import { CANONICAL_STYLE_KEYS } from './styleOptions'

/**
 * The classified shape of a proposed mutation against the bound dataset (D-06).
 * `modified` carries both the `before` (current) and `after` (proposed) feature
 * so SAFE-03's preview can render the change and SAFE-06's undo can restore it.
 */
export interface DatasetDiff {
	added: EditorFeature[]
	modified: { before: EditorFeature; after: EditorFeature }[]
	deleted: EditorFeature[]
}

/** Structural deep-equality for plain JSON values (geometry / properties). */
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

/**
 * Whether two same-id features differ in any way the diff treats as a `modify`:
 * geometry, any canonical style key, or `properties`. We compare the enumerated
 * fields (geometry + the single-source `CANONICAL_STYLE_KEYS` + properties) —
 * we do NOT hand-roll a geometry walker beyond a structural deep-equal of the
 * matched pair's geometry.
 */
function isModified(before: EditorFeature, after: EditorFeature): boolean {
	if (!deepEqual(before.geometry, after.geometry)) return true

	const beforeProps = before.properties ?? {}
	const afterProps = after.properties ?? {}
	for (const key of CANONICAL_STYLE_KEYS) {
		if (
			!deepEqual(
				(beforeProps as Record<string, unknown>)[key],
				(afterProps as Record<string, unknown>)[key],
			)
		) {
			return true
		}
	}

	if (!deepEqual(beforeProps, afterProps)) return true
	return false
}

/**
 * Classify a proposed feature set against the current bound set by feature id.
 * Pure — no side effects, no editor reference, no forbidden imports.
 */
export function classifyMutation(
	current: EditorFeature[],
	proposed: EditorFeature[],
	intent: MutationIntent,
): DatasetDiff {
	const currentById = new Map(current.map((f) => [f.id, f]))
	const proposedById = new Map(proposed.map((f) => [f.id, f]))

	const added: EditorFeature[] = []
	const modified: { before: EditorFeature; after: EditorFeature }[] = []
	const deleted: EditorFeature[] = []

	for (const after of proposed) {
		const before = currentById.get(after.id)
		if (!before) {
			added.push(after)
			continue
		}
		// A same-id collision under intent:'add' is the append-path
		// skippedDuplicate (05-RESEARCH 216), NOT a modify — only classify a
		// matched pair as `modified` when the write intends to modify.
		if (intent !== 'add' && isModified(before, after)) {
			modified.push({ before, after })
		}
	}

	if (intent === 'delete') {
		for (const before of current) {
			if (!proposedById.has(before.id)) {
				deleted.push(before)
			}
		}
	}

	return { added, modified, deleted }
}
