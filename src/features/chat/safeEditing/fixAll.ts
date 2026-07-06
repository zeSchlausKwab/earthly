/**
 * fixAll — host-side "fix all" rule runner over the FULL bound dataset (SAFE-05).
 *
 * The model only ever sees a COMPACTED view of the dataset: `summarizeFeaturesFor
 * Prompt` (chat/tools/helpers.ts) sends `sampleNames`/`sampleIds` capped at a
 * handful of ids plus aggregate counts — NOT the full feature list (Pitfall 2).
 * If a "fix all everything matching X" operation iterated the model's list, it
 * would silently skip every out-of-context feature (T-05-16).
 *
 * The contract is therefore inverted: the MODEL supplies the RULE (a `predicate`
 * + a `transform`), the HOST supplies the LIST. This runner reads the canonical
 * id-keyed set from `editor.getAllFeatures()` (GeoEditor's full, un-compacted
 * Map) and applies the rule to EVERY matching feature — including ids the model
 * never saw. It takes NO `features` array argument (the A3 / Pitfall-2 guard:
 * there is no way to scope it to a stale model list).
 *
 * Each per-feature change routes through the Plan-01 `modifyFeature` FACADE verb
 * (intent:'modify' → runInterceptors), NOT `editor.updateFeature` directly — so
 * fixAll is interceptor-routed and, when invoked under the AuthoringGate, is
 * gate-/snapshot-aware (A3 stays clean).
 *
 * SCOPE (Open Question 1): this is the SEAM + one proof. The model-facing bulk
 * attribute-edit TOOL is Phase 6 (TOOLS-02) — this plan ships the host-side
 * runner the bulk tool builds on, not the tool itself.
 */

import { createAuthoring } from '@/features/geo-editor/api/authoring'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import type { EditorFeature } from '@/features/geo-editor/core/types'

/**
 * The RULE the model supplies. `predicate` selects which features to touch;
 * `transform` returns the replacement feature (a new object — fixAll does not
 * mutate in place). Neither receives or returns a feature LIST — the host owns
 * the list (SAFE-05).
 */
export interface FixAllRule {
	/** Select the features this rule applies to. Evaluated over the FULL set. */
	predicate(feature: EditorFeature): boolean
	/** Produce the replacement feature for a matched feature (id is preserved). */
	transform(feature: EditorFeature): EditorFeature
}

/** Summary of what a fixAll run touched over the FULL id-keyed set. */
export interface FixAllResult {
	/** How many features matched the predicate over `getAllFeatures()`. */
	matched: number
	/** How many features were actually modified through the facade. */
	modified: number
	/** The ids modified (for the diff / snapshot label). */
	modifiedIds: string[]
}

/**
 * Apply a model-supplied rule to EVERY matching feature in the editor's full
 * id-keyed set. Reads `editor.getAllFeatures()` (never a passed-in list), routes
 * each change through the `modifyFeature` facade verb, and returns the counts.
 */
export function runFixAllRule(editor: GeoEditor, rule: FixAllRule): FixAllResult {
	const authoring = createAuthoring(editor)

	// SOURCE OF TRUTH: the full, un-compacted, id-keyed set — never a model list.
	const all = editor.getAllFeatures()

	const modifiedIds: string[] = []
	let matched = 0

	for (const feature of all) {
		if (!rule.predicate(feature)) continue
		matched += 1

		const next = rule.transform(feature)
		// Route through the facade (intent:'modify' → runInterceptors), preserving id.
		const result = authoring.modifyFeature(feature.id, {
			type: 'Feature',
			geometry: next.geometry,
			properties: next.properties,
		})
		if (result.ok) modifiedIds.push(feature.id)
	}

	return { matched, modified: modifiedIds.length, modifiedIds }
}
