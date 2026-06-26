/**
 * Web Worker for geometry optimization off the main thread (GEO-01).
 *
 * Mirrors `../ingest/ingest.worker.ts`: a single `self.onmessage` handler that
 * defers to the pure `optimize()` module, wraps the call in try/catch, and posts
 * a discriminated `{ id, success, ... }` response. An error NEVER throws out of
 * the handler — it is always converted to `{ success: false, error }` (T-07-09).
 *
 * LEAF IMPORTS ONLY: this module imports ONLY `./optimize`, `./types`, and the
 * zero-dependency `@/lib/isWorkerScope` guard. It must NEVER import
 * `@/features/geo-editor/api` (the barrel that drags
 * `createAuthoring → GeoEditor → Nostr → pino` into the worker bundle —
 * sandbox-worker-file-url-dev.md "SECONDARY ROOT CAUSE", threat T-07-08).
 */

import { isWorkerScope } from '@/lib/isWorkerScope'
import { optimize } from './optimize'
import type { OptimizeRequest, OptimizeResponse } from './types'

// Only register when running as an actual Worker. On the main thread `self === window`,
// so an unconditional `self.onmessage = …` would install `window.onmessage` and create a
// message → postMessage runaway loop if this module is ever value-imported there; under
// `bun test` the pure `./optimize` engine is exercised directly. `isWorkerScope` is a
// zero-dependency leaf, so it does not violate this module's LEAF IMPORTS ONLY constraint.
if (isWorkerScope()) {
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
}
