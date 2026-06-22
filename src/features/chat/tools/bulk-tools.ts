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
 * Plan 06-04 landed the two READ-ONLY tools:
 *   - `select_features`  (TOOLS-03 select half) — returns matched ids + a summary
 *     over the FULL bound dataset; NO gate, NO snapshot, NO mutation.
 *   - `validate_geometry` (TOOLS-04) — returns a per-feature topology report over the
 *     full bound dataset; READ-ONLY (Phase 7 owns fixing).
 *
 * Plan 06-05 ADDS the three DESTRUCTIVE tools, each fronted by the Phase 5
 * safe-editing gate (`gateBulkApply` — snapshot → real apply → classify → confirm/
 * cancel-to-zero):
 *   - `batch_edit_features` (TOOLS-02) — TWO modes: (a) DECLARATIVE
 *     `predicate → set/copy/template/fillIfMissing` applied host-side over ALL bound
 *     ids via `runFixAllRule` (unbounded, SAFE-05); (b) INTELLIGENCE explicit
 *     `id→value` map, capped at `BULK_EDIT_MAX_FEATURES` with an honest skip-and-report
 *     (no silent truncation, unknown ids skipped-and-counted).
 *   - `dedup_features` (TOOLS-03 dedup) — `findDuplicateGroups` then delete the
 *     non-survivors through the gate as `intent:'delete'` (keep-first; Level-2 confirms,
 *     Pitfall 6).
 *   - `style_by_attribute` (STYLE-01/STYLE-02) — resolve attribute buckets host-side and
 *     materialize `normalizeStyleOptions` output per matched feature via ONE
 *     `runFixAllRule` call (not O(N) recolors); unmatched untouched unless a `fallback`
 *     bucket is supplied (D-03); styles materialize as plain `properties.*` that render
 *     (LayerManager unchanged) and round-trip through the kind 37515 content for free
 *     (STYLE-02 — NO LayerManager/event-factory change).
 *
 * All resolve the live editor via `useEditorStore.getState().editor` and read the
 * FULL id-keyed set through `editor.getAllFeatures()` (SAFE-05 / Pitfall 1 — the host
 * owns the list; the rule-mode schemas expose NO `features`/`featureIds` array param).
 */

import { createAuthoring, deleteFeaturesById } from '@/features/geo-editor/api/authoring'
import { findDuplicateGroups } from '@/features/geo-editor/api/dedup'
import {
	type Predicate,
	matchesPredicate,
	selectByPredicate,
} from '@/features/geo-editor/api/predicate'
import { validateGeometryFeatures } from '@/features/geo-editor/api/geometryValidation'
import { normalizeStyleOptions } from '@/features/geo-editor/api/styleOptions'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { useEditorStore } from '@/features/geo-editor/store'
import { type FixAllRule, runFixAllRule } from '@/features/chat/safeEditing/fixAll'
import { gateBulkApply } from '@/features/chat/safeEditing/gateBulkEdit'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'
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
export const BULK_EDIT_MAX_FEATURES = 100

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
 * A4-inclusive "missing" test, mirroring the predicate engine's `isMissing`
 * (absent | null | '' | whitespace-only) so `fillIfMissing` writes ONLY when the
 * existing value is genuinely absent — the single source of fill semantics
 * (06-02 decision; A4).
 */
function isMissingValue(value: unknown): boolean {
	if (value === undefined || value === null) return true
	if (typeof value === 'string' && value.trim() === '') return true
	return false
}

/** One declarative edit op in `batch_edit_features` DECLARATIVE mode (D-04a). */
type DeclarativeOp =
	| { kind: 'set'; field: string; value: unknown }
	| { kind: 'copy'; field: string; source: string }
	| { kind: 'template'; field: string; template: string }
	| { kind: 'fillIfMissing'; field: string; value: unknown }

/**
 * Validate the untrusted `ops` arg into a typed `DeclarativeOp[]` (V5 — reject a
 * malformed op rather than silently skipping it, so the model self-corrects).
 */
function parseDeclarativeOps(raw: unknown): DeclarativeOp[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error('declarative mode requires a non-empty `ops` array')
	}
	return raw.map((entry) => {
		if (typeof entry !== 'object' || entry === null) {
			throw new Error('each op must be an object { kind, field, ... }')
		}
		const op = entry as Record<string, unknown>
		const { kind, field } = op
		if (typeof field !== 'string' || field.length === 0) {
			throw new Error('each op requires a non-empty string `field`')
		}
		switch (kind) {
			case 'set':
				return { kind, field, value: op.value }
			case 'fillIfMissing':
				return { kind, field, value: op.value }
			case 'copy':
				if (typeof op.source !== 'string' || op.source.length === 0) {
					throw new Error("op kind 'copy' requires a non-empty string `source`")
				}
				return { kind, field, source: op.source }
			case 'template':
				if (typeof op.template !== 'string') {
					throw new Error("op kind 'template' requires a string `template`")
				}
				return { kind, field, template: op.template }
			default:
				throw new Error(
					`unknown op kind '${String(kind)}'. Allowed: set, copy, template, fillIfMissing`,
				)
		}
	})
}

/**
 * Interpolate `{propKey}` references in a template against a feature's properties
 * (properties only — no nesting, no expressions). A referenced key that is missing
 * renders as the empty string (documented contract).
 */
function renderTemplate(template: string, props: Record<string, unknown>): string {
	return template.replace(/\{([^{}]+)\}/g, (_match, rawKey: string) => {
		const value = props[rawKey.trim()]
		return value === undefined || value === null ? '' : String(value)
	})
}

/**
 * Apply the declarative ops to a COPY of a feature's properties, returning the new
 * properties object (the feature itself is never mutated in place — fixAll owns
 * routing the change through the facade).
 */
function applyDeclarativeOps(
	props: Record<string, unknown>,
	ops: DeclarativeOp[],
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...props }
	for (const op of ops) {
		switch (op.kind) {
			case 'set':
				next[op.field] = op.value
				break
			case 'copy':
				next[op.field] = next[op.source]
				break
			case 'template':
				next[op.field] = renderTemplate(op.template, next)
				break
			case 'fillIfMissing':
				if (isMissingValue(next[op.field])) next[op.field] = op.value
				break
		}
	}
	return next
}

/** One style bucket in `style_by_attribute` (predicate → forgiving style bag). */
interface StyleBucket {
	predicate: Predicate
	style: Record<string, unknown>
}

/** Validate the untrusted `buckets` arg into typed `StyleBucket[]` (V5). */
function parseStyleBuckets(raw: unknown): StyleBucket[] {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error('`buckets` must be a non-empty array of { predicate, style }')
	}
	return raw.map((entry) => {
		if (typeof entry !== 'object' || entry === null) {
			throw new Error('each bucket must be an object { predicate, style }')
		}
		const bucket = entry as Record<string, unknown>
		const style = bucket.style
		if (typeof style !== 'object' || style === null || Array.isArray(style)) {
			throw new Error('each bucket requires a `style` object')
		}
		return {
			predicate: parsePredicate(bucket.predicate),
			style: style as Record<string, unknown>,
		}
	})
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

	// --- batch_edit_features (TOOLS-02) — DECLARATIVE + INTELLIGENCE, GATED -----
	register({
		name: 'batch_edit_features',
		kind: 'authoring-primitive',
		schema: schemaFor('batch_edit_features'),
		handler: async (args) => {
			const editor = requireEditor()
			// Mode is selected by `mode` (or inferred from which args are present).
			const mode =
				args.mode === 'intelligence' || (args.mode === undefined && args.valuesById !== undefined)
					? 'intelligence'
					: 'declarative'

			if (mode === 'declarative') {
				// D-04a: the MODEL supplies the RULE, the HOST supplies the LIST — the
				// rule runs over editor.getAllFeatures() via runFixAllRule (SAFE-05),
				// touching EVERY matching id incl. ones the model never saw (Pitfall 1).
				const predicate = parsePredicate(args.predicate)
				const ops = parseDeclarativeOps(args.ops)
				const rule: FixAllRule = {
					predicate: (f) => matchesPredicate(f, predicate),
					transform: (f) => ({
						...f,
						properties: applyDeclarativeOps(
							(f.properties ?? {}) as Record<string, unknown>,
							ops,
						) as EditorFeature['properties'],
					}),
				}
				const outcome = await gateBulkApply(
					editor,
					{ getSafetyLevel, label: 'Batch edit features' },
					'modify',
					() => {
						runFixAllRule(editor, rule)
					},
				)
				const matched = selectByPredicate(editor.getAllFeatures(), predicate).length
				return {
					mode,
					cancelled: outcome.status === 'cancelled',
					edited: outcome.diff.modified.length,
					matched,
				}
			}

			// INTELLIGENCE (D-04b/D-05): explicit id→value map, CAPPED, honest-report.
			const field = typeof args.field === 'string' ? args.field : ''
			if (!field) throw new Error('intelligence mode requires a string `field`')
			const valuesById = args.valuesById
			if (typeof valuesById !== 'object' || valuesById === null || Array.isArray(valuesById)) {
				throw new Error('intelligence mode requires a `valuesById` object of { id: value }')
			}

			const entries = Object.entries(valuesById as Record<string, unknown>)
			const total = entries.length
			// Validate ids against the FULL set; unknown ids are skipped-and-counted
			// (never a crash — mirrors deleteFeatures filtering, T-05-03).
			const known = new Set(editor.getAllFeatures().map((f) => f.id))
			const knownEntries = entries.filter(([id]) => known.has(id))
			const skippedUnknown = total - knownEntries.length
			// Cap the applied set (V5 DoS bound) — the remainder is counted, not dropped.
			const capped = knownEntries.slice(0, BULK_EDIT_MAX_FEATURES)
			const skippedOverCap = knownEntries.length - capped.length
			const capById = new Map(capped)

			const outcome = await gateBulkApply(
				editor,
				{ getSafetyLevel, label: 'Batch edit features (intelligence)' },
				'modify',
				() => {
					const authoring = createAuthoring(editor)
					for (const [id, value] of capById) {
						const existing = editor.getFeature(id)
						if (!existing) continue
						authoring.modifyFeature(id, {
							type: 'Feature',
							geometry: existing.geometry,
							properties: { ...(existing.properties ?? {}), [field]: value },
						})
					}
				},
			)

			const edited = outcome.status === 'cancelled' ? 0 : outcome.diff.modified.length
			const remainder = total - edited
			return {
				mode,
				cancelled: outcome.status === 'cancelled',
				edited,
				total,
				skippedUnknown,
				skippedOverCap,
				message:
					remainder > 0
						? `Edited ${edited} of ${total}; rerun with the remaining ${remainder} ids to continue.`
						: `Edited ${edited} of ${total}.`,
			}
		},
	})

	// --- dedup_features (TOOLS-03 dedup) — GATED DELETE (intent:'delete') -------
	register({
		name: 'dedup_features',
		kind: 'authoring-primitive',
		schema: schemaFor('dedup_features'),
		handler: async (args) => {
			const editor = requireEditor()
			// Optional predicate pre-scopes the dedup; absent → the whole dataset.
			const scoped =
				args.predicate === undefined
					? editor.getAllFeatures()
					: selectByPredicate(editor.getAllFeatures(), parsePredicate(args.predicate))
			const by = args.by === 'attributes' || args.by === 'both' ? args.by : ('geometry' as const)
			const keys = Array.isArray(args.keys)
				? (args.keys.filter((k) => typeof k === 'string') as string[])
				: undefined
			const groups = findDuplicateGroups(scoped, { by, keys })
			const duplicateIds = groups.flatMap((g) => g.duplicateIds)

			if (duplicateIds.length === 0) {
				return { groups: 0, deleted: 0, survivors: 0, message: 'No duplicates found.' }
			}

			// Route the drop through the gate as intent:'delete' so the dropped ids
			// classify as DELETIONS and a Level-2 user is asked to confirm (Pitfall 6).
			const outcome = await gateBulkApply(
				editor,
				{ getSafetyLevel, label: 'Dedup features' },
				'delete',
				() => {
					// Route through the api/ facade helper (NOT a raw editor verb in chat/**)
					// so the delete passes runInterceptors and the A3 boundary stays clean.
					deleteFeaturesById(editor, duplicateIds)
				},
			)

			const deleted = outcome.status === 'cancelled' ? 0 : outcome.diff.deleted.length
			return {
				groups: groups.length,
				deleted,
				survivors: groups.length,
				cancelled: outcome.status === 'cancelled',
				message:
					outcome.status === 'cancelled'
						? 'Dedup cancelled — no features deleted.'
						: `Deleted ${deleted} duplicate(s), kept ${groups.length} survivor(s).`,
			}
		},
	})

	// --- style_by_attribute (STYLE-01/STYLE-02) — GATED RESTYLE (materialize) ---
	register({
		name: 'style_by_attribute',
		kind: 'authoring-primitive',
		schema: schemaFor('style_by_attribute'),
		handler: async (args) => {
			const editor = requireEditor()
			const buckets = parseStyleBuckets(args.buckets)
			// Optional fallback bucket (D-03): applied ONLY to features no bucket matched.
			let fallbackStyle: Record<string, unknown> | undefined
			if (args.fallback !== undefined) {
				const fb = args.fallback
				if (typeof fb !== 'object' || fb === null || Array.isArray(fb)) {
					throw new Error('`fallback` must be an object { style }')
				}
				const style = (fb as Record<string, unknown>).style
				if (typeof style !== 'object' || style === null || Array.isArray(style)) {
					throw new Error('`fallback.style` must be a style object')
				}
				fallbackStyle = style as Record<string, unknown>
			}

			// ONE rule call over the full set (NOT O(N) recolors — STYLE-01 anti-pattern
			// ban). A feature matches the rule iff a bucket matches OR a fallback exists.
			const rule: FixAllRule = {
				predicate: (f) =>
					buckets.some((b) => matchesPredicate(f, b.predicate)) || fallbackStyle !== undefined,
				transform: (f) => {
					const chosen =
						buckets.find((b) => matchesPredicate(f, b.predicate))?.style ?? fallbackStyle
					// Unmatched + no fallback → untouched (smallest diff, D-03).
					if (!chosen) return f
					// normalizeStyleOptions throws InvalidStyleOptionError on an unknown key
					// → surfaces as a ToolError so the model self-corrects (Pitfall 3).
					const styleProps = normalizeStyleOptions(chosen)
					return {
						...f,
						properties: {
							...(f.properties ?? {}),
							...styleProps,
						} as EditorFeature['properties'],
					}
				},
			}

			// Styles materialize as plain properties.* — they render (LayerManager
			// unchanged) and round-trip through the kind 37515 content for free
			// (STYLE-02: do NOT touch LayerManager or the geo-event factory).
			const outcome = await gateBulkApply(
				editor,
				{ getSafetyLevel, label: 'Style by attribute' },
				'modify',
				() => {
					runFixAllRule(editor, rule)
				},
			)

			return {
				cancelled: outcome.status === 'cancelled',
				restyled: outcome.diff.modified.length,
				buckets: buckets.length,
				fallback: fallbackStyle !== undefined,
			}
		},
	})
}
