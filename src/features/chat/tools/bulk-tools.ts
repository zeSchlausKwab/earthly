/**
 * Chat tools — the AI bulk-transform toolset (Phase 6, TOOLS-03 / TOOLS-04).
 *
 * `registerBulkTools(register)` installs the bulk tools into the central registry
 * via the INJECTED-register idiom (mirrors `registerIngestTools` / `registerSandboxTools`):
 * the module imports ONLY a `type` from `./registry` and never the value `register`,
 * keeping the registry → bulk-tools edge one-way. A value import of `register` would
 * form the Phase-2 circular-init cycle that crashes the dev bundler at bootstrap
 * (a null `./registry` during HMR) — see Pitfall 4 / `primitives-tools.ts`.
 *
 * This plan (06-04) lands the two READ-ONLY tools:
 *   - `select_features`  (TOOLS-03 select half) — returns matched ids + a summary
 *     over the FULL bound dataset; NO gate, NO snapshot, NO mutation.
 *   - `validate_geometry` (TOOLS-04) — returns a per-feature topology report over the
 *     full bound dataset; READ-ONLY (Phase 7 owns fixing).
 *
 * Both resolve the live editor via `useEditorStore.getState().editor` and read the
 * FULL id-keyed set through `editor.getAllFeatures()` (SAFE-05 / Pitfall 1 — the host
 * owns the list; the schemas expose NO `features`/`featureIds` array param). Plan 06-05
 * EXTENDS this same registrar with the destructive tools (batch_edit_features,
 * dedup_features, style_by_attribute), so `registerBulkTools` is structured to grow.
 */

import { type Predicate, selectByPredicate } from '@/features/geo-editor/api/predicate'
import { validateGeometryFeatures } from '@/features/geo-editor/api/geometryValidation'
import { useEditorStore } from '@/features/geo-editor/store'
// TYPE-ONLY import from the registry (never the value `register`) — Pitfall 4.
import type { ToolEntry } from './registry'
import { schemaFor } from './schemas'

/**
 * Hard cap on how many features one `batch_edit_features` *intelligence*-mode call
 * may write (D-04b / D-05 DoS bound — mirrors `batch_geocode`'s cap). The host edits
 * up to this many and reports the remainder with a "rerun" hint rather than letting a
 * single model turn rewrite an unbounded dataset. Exported so the destructive tools in
 * Plan 06-05 (and the test contract) share the one source of truth.
 */
export const BULK_EDIT_MAX_FEATURES = 200

/** Max number of ids surfaced in the `sample` so a select reply stays compact. */
const SELECT_SAMPLE_SIZE = 15

/** The recognised predicate operators (the V5 validation allow-list, T-06-04a). */
const PREDICATE_OPS = new Set([
	'eq',
	'neq',
	'exists',
	'missing',
	'contains',
	'in',
	'lt',
	'lte',
	'gt',
	'gte',
])

/**
 * Resolve the live map editor or throw a descriptive, model-self-correctable error
 * (it surfaces to the loop as a ToolError, so the model can re-try after the user
 * opens the editor). The same idiom every host-builtin uses.
 */
function requireEditor() {
	const editor = useEditorStore.getState().editor
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}
	return editor
}

/**
 * Validate an untrusted predicate arg into a `Predicate` (V5 — T-06-04a). Rejects a
 * missing/ malformed clause list and any clause whose `op` is not in the allow-list or
 * whose `field` is not a string, throwing a CATCHABLE error so the model self-corrects.
 * The engine only ever COMPARES values — no clause path executes. An absent/empty
 * predicate is the vacuous-AND "all features" target.
 */
export function parsePredicate(raw: unknown): Predicate {
	if (raw === undefined || raw === null) return { all: [] }
	if (typeof raw !== 'object') {
		throw new Error('predicate must be an object of the form { all: [...] }')
	}
	const all = (raw as { all?: unknown }).all
	if (all === undefined) return { all: [] }
	if (!Array.isArray(all)) {
		throw new Error('predicate.all must be an array of clauses')
	}
	for (const clause of all) {
		if (typeof clause !== 'object' || clause === null) {
			throw new Error('each predicate clause must be an object { field, op, value? }')
		}
		const { field, op } = clause as { field?: unknown; op?: unknown }
		if (typeof field !== 'string' || field.length === 0) {
			throw new Error('each predicate clause requires a non-empty string `field`')
		}
		if (typeof op !== 'string' || !PREDICATE_OPS.has(op)) {
			throw new Error(
				`unknown predicate op '${String(op)}'. Allowed: ${[...PREDICATE_OPS].join(', ')}`,
			)
		}
	}
	// Shape-validated; the engine's matchers are themselves never-throw on bad values.
	return { all: all as Predicate['all'] }
}

/** A short, human-readable label for a feature (name property, falling back to id). */
function featureLabel(feature: {
	id?: unknown
	properties?: Record<string, unknown> | null
}): string {
	const name = feature.properties?.name
	if (typeof name === 'string' && name.trim() !== '') return name
	return String(feature.id)
}

/**
 * Register the bulk tools into the central registry. `register` is INJECTED (not
 * imported) to keep the registry ↔ bulk-tools edge one-way and avoid a dev-bundler
 * circular-init crash (Pitfall 4 / mirrors `registerIngestTools`).
 *
 * Plan 06-04 registers the two READ-ONLY tools below. Plan 06-05 extends this same
 * function with the gated destructive tools.
 */
export function registerBulkTools(register: (entry: ToolEntry) => void): void {
	// --- select_features (TOOLS-03 select) — READ-ONLY ----------------------
	register({
		name: 'select_features',
		kind: 'host-builtin',
		schema: schemaFor('select_features'),
		handler: (args) => {
			const editor = requireEditor()
			const predicate = parsePredicate(args.predicate)
			// Read the FULL id-keyed set — never the model's compacted sample (SAFE-05).
			const all = editor.getAllFeatures()
			const matched = selectByPredicate(all, predicate)
			const matchedIds = matched.map((f) => String(f.id))
			return {
				matched: matchedIds.length,
				total: all.length,
				matchedIds,
				sample: matched.slice(0, SELECT_SAMPLE_SIZE).map(featureLabel),
			}
		},
	})

	// --- validate_geometry (TOOLS-04) — READ-ONLY report --------------------
	register({
		name: 'validate_geometry',
		kind: 'host-builtin',
		schema: schemaFor('validate_geometry'),
		handler: (args) => {
			const editor = requireEditor()
			// An optional predicate pre-scopes the check; absent → the whole dataset.
			const predicate = args.predicate === undefined ? undefined : parsePredicate(args.predicate)
			// READ-ONLY: validateGeometryFeatures holds no editor reference and mutates
			// nothing — Phase 7 owns fixing. Return the report verbatim.
			return validateGeometryFeatures(editor.getAllFeatures(), predicate)
		},
	})
}
