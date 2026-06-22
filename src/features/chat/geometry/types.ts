/**
 * Message shapes for the off-thread geometry-optimization worker.
 *
 * Mirrors the discriminated request/response contract of `../ingest/types.ts`
 * (`IngestParseRequest`/`IngestParseResponse`): every worker reply carries the
 * originating `id` plus a `success` flag, so the host client can key pending
 * requests by id and never has an error throw out of the worker `onmessage`
 * handler.
 *
 * Boundary: imports ONLY the `EditorFeature` TYPE (no editor/DOM/worker/Nostr
 * runtime), keeping the worker bundle secret-free (T-07-08).
 */

import type { EditorFeature } from '@/features/geo-editor/core/types'

/** A plain FeatureCollection of EditorFeatures — the shape the optimizer consumes. */
export interface OptimizeFeatureCollection {
	type: 'FeatureCollection'
	features: EditorFeature[]
}

/**
 * An optimize request posted to the worker. Carries plain GeoJSON + an optional
 * target byte budget; both structured-clone plainly (no transferables, Pitfall 5).
 */
export interface OptimizeRequest {
	id: string
	featureCollection: OptimizeFeatureCollection
	/** Target serialized byte budget; defaults to the publish threshold when omitted. */
	targetBytes?: number
}

/**
 * Before/after metrics for one optimize run (GEO-02). `reachedBudget` is the
 * honest D-07 flag (false ⇒ best-effort gentlest-valid candidate, still over
 * budget). `baselineSelfIntersections`/`baselineZeroArea` are the post-stitch/merge
 * counts the binary-search rejects RELATIVE to (D-06 — reject only NEW problems).
 */
export interface OptimizeReport {
	bytesBefore: number
	bytesAfter: number
	verticesBefore: number
	verticesAfter: number
	featuresBefore: number
	featuresAfter: number
	/** How many input line-parts collapsed into fewer output parts via the microgap stitch. */
	microgapJoins: number
	/** True iff the converged result landed at-or-under the byte budget (D-03/D-07). */
	reachedBudget: boolean
	/** Self-intersecting feature count of the post-stitch/merge baseline (D-06). */
	baselineSelfIntersections: number
	/** Near-zero-area feature count of the post-stitch/merge baseline (D-06). */
	baselineZeroArea: number
}

/**
 * An optimize response posted back from the worker. On success `result` + `report`
 * are present; on any failure `success` is `false` and `error` holds the message.
 */
export interface OptimizeResponse {
	id: string
	success: boolean
	result?: OptimizeFeatureCollection
	report?: OptimizeReport
	/** Present iff `success === false`. */
	error?: string
}
