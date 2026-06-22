/**
 * Web Worker for geometry optimization off the main thread (GEO-01).
 *
 * Mirrors `../ingest/ingest.worker.ts`: a single `self.onmessage` handler that
 * defers to the pure `optimize()` module, wraps the call in try/catch, and posts
 * a discriminated `{ id, success, ... }` response. An error NEVER throws out of
 * the handler — it is always converted to `{ success: false, error }` (T-07-09).
 *
 * LEAF IMPORTS ONLY: this module imports ONLY `./optimize` and `./types`. It must
 * NEVER import `@/features/geo-editor/api` (the barrel that drags
 * `createAuthoring → GeoEditor → Nostr → pino` into the worker bundle —
 * sandbox-worker-file-url-dev.md "SECONDARY ROOT CAUSE", threat T-07-08).
 */

import { optimize } from './optimize'
import type { OptimizeRequest, OptimizeResponse } from './types'

self.onmessage = (event: MessageEvent<OptimizeRequest>) => {
	const { id, featureCollection, targetBytes } = event.data

	try {
		const { result, report } = optimize(featureCollection, targetBytes)
		const response: OptimizeResponse = { id, success: true, result, report }
		self.postMessage(response)
	} catch (error) {
		const response: OptimizeResponse = {
			id,
			success: false,
			error: error instanceof Error ? error.message : 'Geometry optimization failed',
		}
		self.postMessage(response)
	}
}
