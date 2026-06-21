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

import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { EditorCommandArgs, EditorCommandExecutionResult, EditorCommandId } from '../commands'
import { executeEditorCommand } from '../commands'
import type { GeoEditor } from '../core/GeoEditor'
import type { EditorFeature } from '../core/types'
// In-feature import (D-07 allows `@/features/geo-editor/*`): the dataset-level
// metadata (collectionMeta) lives in the editor store, the SAME state the
// "Dataset info" panel edits and that publishing reads. This is host-side only —
// `setDatasetMetadata` runs during run_code REPLAY on the main thread, never in
// the sandbox worker — and it carries NO signer/wallet/secret surface.
import { useEditorStore } from '../store'
import type { CollectionMeta } from '../types'
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

/** The GeoJSON geometry `type` values we can wrap into a Feature (D-10 ergonomics). */
const GEOMETRY_TYPES = new Set([
	'Point',
	'MultiPoint',
	'LineString',
	'MultiLineString',
	'Polygon',
	'MultiPolygon',
	'GeometryCollection',
])

/** A bare GeoJSON Geometry (no `Feature` wrapper) the model commonly passes by mistake. */
function isBareGeometry(value: unknown): value is Geometry {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { type?: unknown }).type === 'string' &&
		GEOMETRY_TYPES.has((value as { type: string }).type)
	)
}

/**
 * Coerce sandbox/model input into a usable `Feature`, or return `null` if it is
 * genuinely not geometry. A bare `Geometry` (a frequent model mistake — passing
 * `turf.point(...).geometry` or a raw `{type:'Point',coordinates}`) is wrapped
 * into a Feature so it draws and counts, rather than silently no-op'ing (the bug
 * that made `run_code` report `created:0` despite the model intending a write).
 */
function coerceToFeature(input: unknown): Feature | null {
	if (isUsableFeature(input)) return input
	if (isBareGeometry(input)) {
		return { type: 'Feature', properties: {}, geometry: input }
	}
	return null
}

/**
 * Describe why an authoring input was rejected so the model can self-correct in
 * ONE shot (instead of trusting a misleading `created:0`). Authoring writes THROW
 * this rather than silently returning a zero-count result for non-geometry input.
 */
function describeUnusableFeature(input: unknown): string {
	if (input == null) return 'received null/undefined'
	if (typeof input !== 'object') return `received a ${typeof input}, expected a GeoJSON Feature`
	const type = (input as { type?: unknown }).type
	if (type === 'FeatureCollection') {
		return 'received a FeatureCollection — pass its `.features` to `writeGeoJSON`, or add features one at a time'
	}
	if (typeof type === 'string')
		return `received an object with type '${type}', expected a GeoJSON Feature or Geometry`
	return 'received an object with no GeoJSON `type` — expected a Feature (`{type:"Feature",geometry,...}`) or a bare Geometry'
}

/** A GeoJSON FeatureCollection (the wrapper the model commonly passes to writeGeoJSON). */
function isFeatureCollection(value: unknown): value is FeatureCollection {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { type?: unknown }).type === 'FeatureCollection' &&
		Array.isArray((value as { features?: unknown }).features)
	)
}

/**
 * Normalize the polymorphic `writeGeoJSON` input into a `Feature[]`, or THROW a
 * descriptive error for genuinely unusable input (never a silent `created:0`).
 *
 * Accepts: a `Feature[]`, a single `Feature`, a bare `Geometry` (auto-wrapped),
 * or a `FeatureCollection` (its `.features` are returned). The previous contract
 * took ONLY a `Feature[]` and quietly no-op'd on anything else — most painfully a
 * FeatureCollection object, which the model passes constantly (the run_code
 * `created:0` bug). We now coerce the common shapes and fail LOUD on the rest.
 */
function toFeatureArray(input: unknown): Feature[] {
	if (Array.isArray(input)) return input as Feature[]
	if (isFeatureCollection(input)) return input.features
	const single = coerceToFeature(input)
	if (single) return [single]
	throw new Error(
		`authoring.writeGeoJSON: not a usable GeoJSON input — ${describeUnusableFeature(input)}. ` +
			'Pass a Feature[], a FeatureCollection, or a single Feature.',
	)
}

/**
 * Dataset-level (FeatureCollection-level) metadata an authoring caller may set:
 * the dataset's `name` / `description` / `color` and arbitrary collection-level
 * `properties`. This is METADATA only — it sets no geometry and exposes no
 * secrets — so `setDatasetMetadata` is a benign op that does NOT route through
 * `runInterceptors` (it is not a feature mutation). It is the correct place to
 * name a dataset; the model should NOT stamp `dataset_name` onto every feature.
 */
export interface DatasetMetadataInput {
	name?: string
	description?: string
	color?: string
	/** Arbitrary FeatureCollection-level props, MERGED into `customProperties`. */
	properties?: Record<string, string | number | boolean>
}

/** Structured outcome of a `setDatasetMetadata` call. */
export interface DatasetMetadataResult {
	ok: boolean
	name: string
	description: string
	color: string
	customPropertyCount: number
}

/**
 * The Authoring facade surface (D-10). Geometry + dataset-metadata — exported for
 * sandbox/mock use in Phase 4. Do NOT add signer/wallet/store/getState here (V4).
 */
export interface Authoring {
	/**
	 * Add a single feature. Normalizes via `toEditorFeature` (preserving
	 * `importSource`), classifies `intent:'add'`, and appends to the editor.
	 */
	addFeature(feature: Feature, source?: string): MutationResult
	/**
	 * Write a batch of features. Accepts a `Feature[]`, a single `Feature`, OR a
	 * whole `FeatureCollection` (its `.features` are extracted) — the model
	 * frequently passes a FeatureCollection object, which used to silently no-op
	 * (`created:0`). A bare `Geometry` in the batch is auto-wrapped (same ergonomics
	 * as `addFeature`). Genuinely unusable input (null/undefined, a non-GeoJSON
	 * value, or an object that is neither a Feature/FeatureCollection nor an array)
	 * THROWS a descriptive error rather than returning a misleading zero-count.
	 *
	 * `replace:true` clears and sets the editor's feature set (replace semantics);
	 * `replace:false` appends, skipping any id already present (dedup-by-id, reused
	 * verbatim from `importFeaturesToEditor`). `options` is OPTIONAL — when omitted
	 * (e.g. a positional FeatureCollection with no options bag), `replace` defaults
	 * to `false` (append), the safer non-destructive default.
	 */
	writeGeoJSON(
		input: Feature[] | FeatureCollection | Feature,
		options?: { replace?: boolean },
	): MutationResult
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
	 *
	 * Per-feature STYLE + metadata is accepted in the same `options` bag and
	 * applied to the drawn feature so it renders styled (UAT gap-closure):
	 * `color` / `fillColor` / `strokeColor` / `fillOpacity` / `strokeOpacity` /
	 * `strokeWidth` / `radius` / `label` / `name` / `description` (plus aliases
	 * `fill`/`stroke`/`width`/`opacity`). UNKNOWN options throw
	 * `InvalidStyleOptionError` (catchable) so callers self-correct.
	 */
	circle(center: [number, number], radius: number, options?: MakeCircleOptions): MutationResult
	/**
	 * Buffer a feature by id (primary, D-15) or a raw GeoJSON Feature/Geometry,
	 * by `distance` (explicit `units`, default `'meters'`). Returns a
	 * `MutationResult` carrying BOTH the source id (when by-id) and the new id
	 * (D-11/D-15 composition). Returns `{ ok:false }` — never throws — for an
	 * unknown feature id OR a degenerate input where turf yields `undefined`
	 * (T-02-15/T-02-16). Throws on an invalid distance (V5) or an unknown/invalid
	 * style option (`InvalidStyleOptionError`).
	 *
	 * Per-feature STYLE + metadata is accepted in `options` and applied to the
	 * buffered feature (same option set as `circle`).
	 */
	buffer(
		target: string | Feature | Geometry,
		distance: number,
		options?: MakeBufferOptions,
	): MutationResult
	/**
	 * Modify an existing feature by id (INFRA-02, intent:'modify'). Normalizes the
	 * replacement via `toEditorFeature` (PRESERVING the original id), classifies
	 * `intent:'modify'` through `runInterceptors`, and updates the editor in place.
	 *
	 * Contract mirrors `addFeature` (V5): an unknown `featureId` is a QUIET no-op
	 * (`{ ok:false }`, never a throw, never a crash — T-05-03); a non-geometry
	 * `feature` THROWS a descriptive `authoring.modifyFeature:` error rather than
	 * silently reporting `updated:0` (loud-not-silent — T-05-02). Returns a
	 * synchronous `MutationResult` with `updated:1` on success.
	 */
	modifyFeature(featureId: string, feature: Feature, source?: string): MutationResult
	/**
	 * Delete features by id (INFRA-02, intent:'delete'). Filters to the ids
	 * actually present in the editor (unknown ids are dropped, never a crash —
	 * T-05-03), classifies `intent:'delete'` through `runInterceptors`, then
	 * removes them. Returns a synchronous `MutationResult` whose `deleted` count
	 * reflects ONLY the present ids.
	 */
	deleteFeatures(featureIds: string[]): MutationResult
	/**
	 * Set DATASET-level (FeatureCollection-level) metadata: the dataset's name /
	 * description / color and arbitrary collection-level properties. `name` /
	 * `description` / `color` set the top-level fields; `properties` MERGE into
	 * `collectionMeta.customProperties` (existing keys not named are preserved).
	 *
	 * This is the discoverable, correct way to NAME a dataset — the model must NOT
	 * stamp `dataset_name` / `dataset_description` onto every feature. It is a
	 * benign METADATA op: no geometry mutation, no interceptor gate, no secrets.
	 * Returns the post-merge metadata snapshot.
	 */
	setDatasetMetadata(meta: DatasetMetadataInput): DatasetMetadataResult
	/** Read the current dataset-level metadata snapshot (name/description/color/props). */
	getDatasetMetadata(): DatasetMetadataResult
}

/**
 * Construct the Authoring facade bound to a `GeoEditor` instance. The editor
 * reference is captured in the closure and never exposed.
 */
export function createAuthoring(editor: GeoEditor): Authoring {
	function addFeature(feature: Feature, source: string = DEFAULT_SOURCE): MutationResult {
		// Null/undefined stays a quiet { ok:false } no-op (existing boundary contract).
		if (feature == null) {
			return { ok: false, intent: 'add', featureIds: [], counts: emptyCounts() }
		}
		const usable = coerceToFeature(feature)
		if (!usable) {
			// Non-null but not geometry → fail LOUD (not a silent created:0) so a
			// sandbox/model caller self-corrects in one shot instead of trusting a
			// misleading zero-count result (the run_code `created:0` confusion).
			throw new Error(
				`authoring.addFeature: not a usable GeoJSON Feature — ${describeUnusableFeature(feature)}.`,
			)
		}

		const normalized = toEditorFeature(usable, source)
		const { intent } = runInterceptors({ intent: 'add', featureIds: [normalized.id] })
		editor.addFeature(normalized)

		return {
			ok: true,
			intent,
			featureIds: [normalized.id],
			counts: { ...emptyCounts(), created: 1 },
		}
	}

	function writeGeoJSON(
		input: Feature[] | FeatureCollection | Feature,
		options: { replace?: boolean } = {},
	): MutationResult {
		// Coerce the polymorphic input (Feature[] | FeatureCollection | Feature |
		// bare Geometry) into a Feature[]. Genuinely unusable input THROWS here
		// (never a silent created:0 — the run_code FeatureCollection no-op bug).
		const features = toFeatureArray(input)
		// `replace` defaults to false (append) when options is omitted — the safe,
		// non-destructive default for a positional FeatureCollection call.
		const replace = options.replace === true

		// Coerce bare geometries into Features (same ergonomics as addFeature), then
		// drop anything that is genuinely not geometry. writeGeoJSON tolerates a mixed
		// batch (it is the batch entrypoint) rather than throwing on the first bad item.
		const normalized: EditorFeature[] = features
			.map((f) => coerceToFeature(f))
			.filter((f): f is Feature => f !== null)
			.map((f) => toEditorFeature(f, DEFAULT_SOURCE))

		// Replace path: clear + set. `editor.setFeatures` does not emit yet (Plan 03).
		if (replace) {
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

	function modifyFeature(
		featureId: string,
		feature: Feature,
		source: string = DEFAULT_SOURCE,
	): MutationResult {
		// Unknown id → quiet no-op (V5: validate, don't crash — T-05-03).
		const existing = editor.getFeature(featureId)
		if (!existing) {
			return { ok: false, intent: 'modify', featureIds: [], counts: emptyCounts() }
		}
		// Non-geometry input → fail LOUD (never a silent updated:0 — T-05-02),
		// mirroring addFeature's loud-not-silent contract.
		const usable = coerceToFeature(feature)
		if (!usable) {
			throw new Error(
				`authoring.modifyFeature: not a usable GeoJSON Feature — ${describeUnusableFeature(feature)}.`,
			)
		}

		const { intent } = runInterceptors({ intent: 'modify', featureIds: [featureId] })
		// PRESERVE the original id so the update lands on the same feature.
		editor.updateFeature(featureId, { ...toEditorFeature(usable, source), id: featureId })

		return {
			ok: true,
			intent,
			featureIds: [featureId],
			counts: { ...emptyCounts(), updated: 1 },
		}
	}

	function deleteFeatures(featureIds: string[]): MutationResult {
		// Filter to ids actually present — unknown ids are dropped (no crash, T-05-03).
		const present = featureIds.filter((id) => editor.getFeature(id) !== undefined)
		const { intent } = runInterceptors({ intent: 'delete', featureIds: present })
		editor.deleteFeatures(present)
		return {
			ok: true,
			intent,
			featureIds: present,
			counts: { ...emptyCounts(), deleted: present.length },
		}
	}

	function snapshotMeta(meta: CollectionMeta): DatasetMetadataResult {
		return {
			ok: true,
			name: meta.name,
			description: meta.description,
			color: meta.color,
			customPropertyCount: Object.keys(meta.customProperties).length,
		}
	}

	function getDatasetMetadata(): DatasetMetadataResult {
		return snapshotMeta(useEditorStore.getState().collectionMeta)
	}

	function setDatasetMetadata(meta: DatasetMetadataInput): DatasetMetadataResult {
		const store = useEditorStore.getState()
		const current = store.collectionMeta
		// MERGE: only set fields the caller provided; merge properties into the
		// existing customProperties (do not clobber unrelated keys).
		const next: CollectionMeta = {
			name: typeof meta.name === 'string' ? meta.name : current.name,
			description: typeof meta.description === 'string' ? meta.description : current.description,
			color: typeof meta.color === 'string' ? meta.color : current.color,
			customProperties: meta.properties
				? { ...current.customProperties, ...meta.properties }
				: current.customProperties,
		}
		store.setCollectionMeta(next)
		return snapshotMeta(next)
	}

	return {
		addFeature,
		writeGeoJSON,
		editorCommand,
		circle,
		buffer,
		modifyFeature,
		deleteFeatures,
		setDatasetMetadata,
		getDatasetMetadata,
	}
}
