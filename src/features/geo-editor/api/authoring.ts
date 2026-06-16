/**
 * Authoring API — the single geometry-mutation facade (INFRA-02 / D-10).
 *
 * `createAuthoring(editor)` returns the one object through which Phases 3–7 mutate
 * editor geometry. It is pure, AI-agnostic, and framework-agnostic: it holds a
 * `GeoEditor` reference internally and exposes ONLY geometry methods. There is no
 * signer/wallet/store/getState re-export — that is the V4 access-control control
 * and the Phase 4 sandbox confinement boundary (T-02-03), enforced by
 * `boundary.test.ts`.
 *
 * Behaviour preservation (T-02-04): `addFeature`/`writeGeoJSON` reuse the EXISTING
 * `toEditorFeature` normalization and the dedup-by-id logic from
 * `importFeaturesToEditor` VERBATIM — no reimplementation, no drift. Plan 03 adds
 * the full OLD-vs-NEW golden gate.
 *
 * Boundary (D-07): imports ONLY from `@/features/geo-editor/*` + geojson types.
 * NOTHING from chat, the tool registry, or Nostr.
 *
 * Note for Plan 03: `editor.setFeatures` (the replace path) does NOT emit a
 * `create`/`update` event today, so the Zustand store mirror is not yet driven by
 * the replace path. This plan must not depend on that emit; Plan 03 fixes the
 * mirror before the replace path's store sync works.
 */

import type { Feature, Geometry } from 'geojson'
import type { EditorCommandArgs, EditorCommandExecutionResult, EditorCommandId } from '../commands'
import { executeEditorCommand } from '../commands'
import type { GeoEditor } from '../core/GeoEditor'
import type { EditorFeature } from '../core/types'
import { toEditorFeature } from '../utils'
import {
	type MakeBufferOptions,
	type MakeCircleOptions,
	makeBuffer,
	makeCircle,
} from './primitives'
import type { MutationCounts, MutationResult } from './results'
import { runInterceptors } from './interceptor'

/** Default import source recorded on features written through the facade. */
const DEFAULT_SOURCE = 'chat_tool'

function emptyCounts(): MutationCounts {
	return { created: 0, updated: 0, deleted: 0, skippedDuplicates: 0 }
}

/** Boundary guard: a usable GeoJSON Feature with a geometry. */
function isUsableFeature(feature: unknown): feature is Feature {
	return (
		typeof feature === 'object' &&
		feature !== null &&
		(feature as Feature).type === 'Feature' &&
		(feature as Feature).geometry != null
	)
}

/**
 * The Authoring facade surface (D-10). Geometry-only — exported for sandbox/mock
 * use in Phase 4. Do NOT add signer/wallet/store/getState here (V4).
 */
export interface Authoring {
	/**
	 * Add a single feature. Normalizes via `toEditorFeature` (preserving
	 * `importSource`), classifies `intent:'add'`, and appends to the editor.
	 */
	addFeature(feature: Feature, source?: string): MutationResult
	/**
	 * Write a batch of features. `replace:true` clears and sets the editor's
	 * feature set (replace semantics); `replace:false` appends, skipping any id
	 * already present (dedup-by-id, reused verbatim from `importFeaturesToEditor`).
	 */
	writeGeoJSON(features: Feature[], options: { replace: boolean }): MutationResult
	/**
	 * Thin passthrough to the existing editor-command execution. Scaffold only —
	 * Plan 04's registry wires real dispatch + validation. Returns the native
	 * command result (not a MutationResult) deliberately, since this is not a
	 * geometry-write method.
	 */
	editorCommand(id: EditorCommandId, args?: EditorCommandArgs): EditorCommandExecutionResult
	/**
	 * Draw a parametric circle (TOOLS-01 / D-13/D-14). `center` is `[lon,lat]`,
	 * `radius` is numeric with an explicit `units` (default `'meters'`, D-14; no
	 * magic default radius). Validates radius (V5) — throws on
	 * non-finite/negative/zero/absurd — then draws the polygon AND returns a
	 * `MutationResult` carrying the created id.
	 */
	circle(center: [number, number], radius: number, options?: MakeCircleOptions): MutationResult
	/**
	 * Buffer a feature by id (primary, D-15) or a raw GeoJSON Feature/Geometry,
	 * by `distance` (explicit `units`, default `'meters'`). Returns a
	 * `MutationResult` carrying BOTH the source id (when by-id) and the new id
	 * (D-11/D-15 composition). Returns `{ ok:false }` — never throws — for an
	 * unknown feature id OR a degenerate input where turf yields `undefined`
	 * (T-02-15/T-02-16). Throws only on an invalid distance (V5).
	 */
	buffer(
		target: string | Feature | Geometry,
		distance: number,
		options?: MakeBufferOptions,
	): MutationResult
}

/**
 * Construct the Authoring facade bound to a `GeoEditor` instance. The editor
 * reference is captured in the closure and never exposed.
 */
export function createAuthoring(editor: GeoEditor): Authoring {
	function addFeature(feature: Feature, source: string = DEFAULT_SOURCE): MutationResult {
		if (!isUsableFeature(feature)) {
			return { ok: false, intent: 'add', featureIds: [], counts: emptyCounts() }
		}

		const normalized = toEditorFeature(feature, source)
		const { intent } = runInterceptors({ intent: 'add', featureIds: [normalized.id] })
		editor.addFeature(normalized)

		return {
			ok: true,
			intent,
			featureIds: [normalized.id],
			counts: { ...emptyCounts(), created: 1 },
		}
	}

	function writeGeoJSON(features: Feature[], options: { replace: boolean }): MutationResult {
		if (!Array.isArray(features)) {
			return { ok: false, intent: 'add', featureIds: [], counts: emptyCounts() }
		}

		const normalized: EditorFeature[] = features
			.filter(isUsableFeature)
			.map((f) => toEditorFeature(f, DEFAULT_SOURCE))

		// Replace path: clear + set. `editor.setFeatures` does not emit yet (Plan 03).
		if (options.replace) {
			const { intent } = runInterceptors({
				intent: 'add',
				featureIds: normalized.map((f) => f.id),
			})
			editor.setFeatures(normalized)
			return {
				ok: true,
				intent,
				featureIds: normalized.map((f) => f.id),
				counts: { ...emptyCounts(), created: normalized.length },
			}
		}

		// Append path: dedup-by-id, reused VERBATIM from importFeaturesToEditor.
		const existingIds = new Set(editor.getAllFeatures().map((f) => f.id))
		const addedIds: string[] = []
		let skippedDuplicates = 0

		for (const feature of normalized) {
			if (existingIds.has(feature.id)) {
				skippedDuplicates += 1
				continue
			}
			editor.addFeature(feature)
			existingIds.add(feature.id)
			addedIds.push(feature.id)
		}

		const { intent } = runInterceptors({ intent: 'add', featureIds: addedIds })
		return {
			ok: true,
			intent,
			featureIds: addedIds,
			counts: { ...emptyCounts(), created: addedIds.length, skippedDuplicates },
		}
	}

	function editorCommand(
		id: EditorCommandId,
		args: EditorCommandArgs = {},
	): EditorCommandExecutionResult {
		return executeEditorCommand(id, args)
	}

	function circle(
		center: [number, number],
		radius: number,
		options: MakeCircleOptions = {},
	): MutationResult {
		// makeCircle validates radius (V5) and throws InvalidPrimitiveArgError on a
		// bad value — callers/tools surface that as a structured error.
		const feature = makeCircle(center, radius, options)
		// Reuse the canonical add path so normalization/intent/result stay consistent.
		return addFeature(feature)
	}

	function buffer(
		target: string | Feature | Geometry,
		distance: number,
		options: MakeBufferOptions = {},
	): MutationResult {
		// Resolve the buffer SOURCE: a feature id (primary, D-15) or raw geometry.
		let sourceId: string | undefined
		let geom: Feature | Geometry
		if (typeof target === 'string') {
			const existing = editor.getFeature(target)
			if (!existing) {
				// Unknown feature id → structured no-op (T-02-16), not a crash.
				return { ok: false, intent: 'add', featureIds: [], counts: emptyCounts() }
			}
			sourceId = existing.id
			geom = existing
		} else {
			geom = target
		}

		// makeBuffer validates distance (V5, throws on bad value) and returns
		// `undefined` for degenerate input (T-02-15) — null-check, never coerce.
		const buffered = makeBuffer(geom, distance, options)
		if (!buffered) {
			return { ok: false, intent: 'add', featureIds: [], counts: emptyCounts() }
		}

		const result = addFeature(buffered)
		if (!result.ok) return result

		// D-11/D-15 composition: surface BOTH the source id (when by-id) and the
		// new id so Phase 4 can chain ("buffer the circle I just drew").
		const featureIds = sourceId ? [sourceId, ...result.featureIds] : result.featureIds
		return { ...result, featureIds }
	}

	return { addFeature, writeGeoJSON, editorCommand, circle, buffer }
}
