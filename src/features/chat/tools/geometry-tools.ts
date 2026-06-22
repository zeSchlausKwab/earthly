/**
 * Chat tools — the AI geometry-optimization tool (Phase 7, GEO-01/02/03).
 *
 * `registerGeometryTools(register)` installs the `optimize_geometry` tool into the
 * central registry via the INJECTED-`register` idiom (mirrors `registerBulkTools` /
 * `registerIngestTools` / `registerSandboxTools`): this module imports ONLY a `type`
 * from `./registry` and never the value `register`, keeping the registry →
 * geometry-tools edge one-way. A value import of `register` would form the Phase-2
 * circular-init cycle that crashes the dev bundler at bootstrap (Pitfall 6).
 *
 * `optimize_geometry` shrinks the ENTIRE bound dataset toward a serialized byte
 * budget via the fixed stitch → lossless merge → topology-guarded simplify pipeline,
 * run OFF-THREAD through `runOptimize` (07-03), then applies the converged result as
 * ONE gated `'modify'` snapshot through the Phase-5 safe-editing gate. Contract:
 *
 *   - SAFE-05 / D-01 / D-04: the model supplies NO geometry/ids — the ONLY model-facing
 *     arg is an optional `targetBytes`. The host reads the FULL id-keyed bound set via
 *     `editor.getAllFeatures()` itself (never the model's compacted view).
 *   - D-04b / SAFE-06: the result applies via `gateBulkApply(editor, …, 'modify', …)` —
 *     one undoable apply, one before/after diff block carrying a metrics-aware headline.
 *   - A3 boundary: the apply routes through `createAuthoring(editor).writeGeoJSON(...,
 *     { replace: true })` (the facade → `runInterceptors`), NEVER a raw `editor.*`
 *     mutation from chat/**.
 *   - D-07: NO auto-export. After optimize the user reviews before/after and ships it
 *     via the normal flow; an unreachable budget yields an honest `reachedBudget:false`
 *     report (and a "still over limit" headline note) and the dataset can still take the
 *     existing Blossom external-upload path.
 *   - V5 / T-07-11: `targetBytes` is validated/clamped — a non-finite/negative/zero/absurd
 *     value defaults to `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (the 1MB upload limit).
 */

import { runOptimize } from '@/features/chat/geometry/optimizeClient'
import type { OptimizeFeatureCollection, OptimizeReport } from '@/features/chat/geometry/types'
import { gateBulkApply } from '@/features/chat/safeEditing/gateBulkEdit'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'
import { createAuthoring } from '@/features/geo-editor/api/authoring'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { useEditorStore } from '@/features/geo-editor/store'
// TYPE-ONLY import from the registry (never the value `register`) — Pitfall 6.
import type { ToolEntry } from './registry'
import { schemaFor } from './schemas'

/**
 * An absurd-ceiling guard for `targetBytes` (V5 / T-07-11 DoS). A budget above this is
 * treated as unset (defaulted to the upload threshold) — the bounded binary search
 * (07-03 `MAX_ITERS`) caps work regardless, but rejecting an absurd value keeps the
 * report honest (a 10TB "budget" is never the user's real intent). Defaulted to the
 * upload threshold below.
 */
const TARGET_BYTES_MAX = 1024 * 1024 * 1024 // 1GB ceiling

/**
 * Resolve the live map editor or throw a descriptive, model-self-correctable error
 * (surfaces to the loop as a ToolError so the model can retry after the user opens the
 * editor). The same idiom every host-builtin uses (mirrors `bulk-tools.requireEditor`).
 */
function requireEditor(): GeoEditor {
	const editor = useEditorStore.getState().editor
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}
	return editor
}

/** Format a byte count compactly (e.g. `12.0MB`, `0.9MB`, `8.4kB`, `512B`). */
function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}kB`
	return `${bytes}B`
}

/** Format a vertex/point count compactly (e.g. `41k`, `3.2k`, `312`). */
function formatCount(n: number): string {
	if (n >= 100_000) return `${Math.round(n / 1000)}k`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return `${n}`
}

/**
 * Build the metrics-aware optimization headline (D-04b / GEO-02) rendered verbatim by
 * `DatasetDiffDisclosure` in place of the generic `+N · ~N · −N` counts wall — e.g.
 * `12.0MB → 0.9MB · 41k→3.2k pts · 312→18 features · 47 joins`. When the budget was
 * unreachable (D-07) a "still over limit" note is appended so the user is never misled.
 */
export function buildOptimizeHeadline(report: OptimizeReport): string {
	const parts = [
		`${formatBytes(report.bytesBefore)} → ${formatBytes(report.bytesAfter)}`,
		`${formatCount(report.verticesBefore)}→${formatCount(report.verticesAfter)} pts`,
		`${report.featuresBefore}→${report.featuresAfter} features`,
	]
	if (report.microgapJoins > 0) {
		parts.push(`${report.microgapJoins} joins`)
	}
	let headline = parts.join(' · ')
	if (!report.reachedBudget) {
		headline += ' · still over limit'
	}
	return headline
}

/**
 * Apply the converged optimized collection back to the editor through the FACADE
 * (`createAuthoring(editor).writeGeoJSON(..., { replace: true })`) — replace-in-place
 * so the whole collection is swapped for the optimized one. This runs through
 * `runInterceptors`, keeping the A3 boundary clean (NO raw `editor.*` mutation in
 * chat/**). Per approach (a) the headline is the user-facing truth: `classifyMutation`
 * is id-keyed and the merge stage mints new ids, so the per-row diff list is secondary.
 */
export function applyOptimizedCollection(
	editor: GeoEditor,
	result: OptimizeFeatureCollection,
): void {
	createAuthoring(editor).writeGeoJSON(result.features, { replace: true })
}

/**
 * Register the geometry tools into the central registry. `register` is INJECTED (not
 * imported) to keep the registry ↔ geometry-tools edge one-way and avoid a dev-bundler
 * circular-init crash (Pitfall 6 / mirrors `registerBulkTools`).
 */
export function registerGeometryTools(register: (entry: ToolEntry) => void): void {
	// --- optimize_geometry (GEO-01/02/03) — GATED whole-dataset MODIFY -----------
	register({
		name: 'optimize_geometry',
		kind: 'authoring-primitive',
		schema: schemaFor('optimize_geometry'),
		handler: async (args) => {
			const editor = requireEditor()
			// Read the FULL id-keyed bound set — never the model's compacted view (SAFE-05).
			const all = editor.getAllFeatures()

			// V5 / T-07-11: validate + clamp `targetBytes`. A non-finite/negative/zero/absurd
			// value defaults to the 1MB upload budget so an attacker can neither starve nor
			// blow up the optimizer via the budget arg (the bounded binary search caps work
			// regardless; this just keeps the request honest).
			const raw = args.targetBytes
			const budget =
				typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= TARGET_BYTES_MAX
					? raw
					: BLOSSOM_UPLOAD_THRESHOLD_BYTES

			const collection: OptimizeFeatureCollection = { type: 'FeatureCollection', features: all }
			// Off-thread (always-settling RPC client; worker + sync-fallback + 30s timeout).
			const { result, report } = await runOptimize(collection, budget)

			// ONE gated 'modify' apply with the metrics-aware headline (D-04b). The result
			// routes through createAuthoring (facade → runInterceptors) — NO raw editor.*
			// mutation, NO auto-export (D-07).
			const outcome = await gateBulkApply(
				editor,
				{ getSafetyLevel, label: 'Optimize geometry', headline: buildOptimizeHeadline(report) },
				'modify',
				() => {
					applyOptimizedCollection(editor, result)
				},
			)

			// Return the metrics + reachedBudget so the model sees the before/after and the
			// honest unreachable-budget signal (the user ships it via the normal flow).
			return { cancelled: outcome.status === 'cancelled', ...report }
		},
	})
}
