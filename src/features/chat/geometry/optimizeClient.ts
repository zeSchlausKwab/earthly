/**
 * Host-side RPC client for the off-thread geometry-optimization worker (GEO-01).
 *
 * Mirrors `../ingest/ingestClient.ts` — the proven no-freeze machinery that
 * guarantees the optimize promise ALWAYS settles (no UI freeze, no hang):
 *
 *  - a lazy `getWorker()` that guards `typeof Worker === 'undefined'` and builds
 *    `new Worker(workerUrl('optimize'), { type: 'module' })` (the stable
 *    origin-rooted served URL — NOT the import-meta-url Worker form, which
 *    silently fails in this app's dev/prod serving, see workerAssets.ts);
 *  - an id-keyed `pendingRequests` Map so concurrent runs never cross-talk;
 *  - an `onerror` handler that sync-runs ALL pending requests via the SAME pure
 *    `optimize()` the worker uses, latches `workerBroken = true`, and terminates
 *    (a worker that fails to load degrades to sync, never hangs);
 *  - a 30s (injectable) per-request `setTimeout` that falls back to a synchronous
 *    `optimize()` (a stuck/hung worker on a pathological collection still settles,
 *    T-07-07).
 *
 * The worker and every fallback share the SAME pure `optimize()` from `./optimize`,
 * so the two code paths can never diverge. The FeatureCollection structured-clones
 * plainly — NO transferable-buffer complexity (Pitfall 5).
 */

import { workerUrl } from '@/lib/workers/workerAssets'
import { optimize } from './optimize'
import type { OptimizeFeatureCollection, OptimizeReport, OptimizeResponse } from './types'

/** The resolved shape of a successful optimize run. */
export interface OptimizeResult {
	result: OptimizeFeatureCollection
	report: OptimizeReport
}

/** Optional knobs (timeout is injectable so the stuck-worker path is testable). */
export interface RunOptimizeOptions {
	/** Per-request timeout before the sync fallback fires (default 30_000ms). */
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

interface PendingRequest {
	resolve: (res: OptimizeResult) => void
	reject: (error: Error) => void
	id: string
	featureCollection: OptimizeFeatureCollection
	targetBytes?: number
}

let worker: Worker | null = null
let workerBroken = false // latched true once the worker fails to load/run
let requestId = 0
const pendingRequests = new Map<string, PendingRequest>()

/**
 * Synchronously run the pure `optimize()` and adapt it to the resolve/reject of a
 * pending request. Shared by the no-worker path, the `onerror` fallback, and the
 * timeout fallback so the worker and fallback never diverge.
 */
function runSync(pending: PendingRequest): void {
	try {
		const { result, report } = optimize(pending.featureCollection, pending.targetBytes)
		pending.resolve({ result, report })
	} catch (error) {
		pending.reject(error instanceof Error ? error : new Error('Geometry optimization failed'))
	}
}

/** Settle a pending request via the synchronous fallback, then drop it. */
function settleViaSync(pending: PendingRequest): void {
	pendingRequests.delete(pending.id)
	runSync(pending)
}

function getWorker(): Worker | null {
	if (worker) return worker

	// Not a browser environment with Worker support → caller uses the sync path.
	if (typeof Worker === 'undefined') {
		return null
	}

	try {
		// Stable origin-rooted URL served by the dev route / prod build (workerAssets.ts).
		worker = new Worker(workerUrl('optimize'), { type: 'module' })

		worker.onmessage = (event: MessageEvent<OptimizeResponse>) => {
			const res = event.data
			const pending = pendingRequests.get(res.id)
			if (!pending) return
			pendingRequests.delete(res.id)
			if (res.success && res.result && res.report) {
				pending.resolve({ result: res.result, report: res.report })
			} else {
				pending.reject(new Error(res.error ?? 'Geometry optimization failed'))
			}
		}

		worker.onerror = (error) => {
			console.warn('Optimize worker error, falling back to sync optimize:', error)
			// Sync-fallback every pending request before tearing the worker down.
			for (const pending of [...pendingRequests.values()]) {
				settleViaSync(pending)
			}
			// Latch broken + terminate so future calls skip the worker entirely.
			workerBroken = true
			worker?.terminate()
			worker = null
		}

		return worker
	} catch (error) {
		console.warn('Failed to create optimize worker:', error)
		return null
	}
}

/**
 * Optimize a FeatureCollection toward a byte budget off the main thread via the
 * worker when available, otherwise synchronously — the promise ALWAYS settles
 * (no UI freeze, no hang). Rejects only when `optimize()` itself throws (it never
 * does for an unreachable budget — that returns `reachedBudget:false`).
 *
 * @param featureCollection plain GeoJSON FeatureCollection of EditorFeatures
 * @param targetBytes       target serialized byte budget (defaults to publish threshold)
 * @param options           `{ timeoutMs }` — per-request sync-fallback timeout (default 30s)
 */
export function runOptimize(
	featureCollection: OptimizeFeatureCollection,
	targetBytes?: number,
	options: RunOptimizeOptions = {},
): Promise<OptimizeResult> {
	const id = `optimize-${++requestId}`
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

	const pendingBase: PendingRequest = {
		resolve: () => {},
		reject: () => {},
		id,
		featureCollection,
		targetBytes,
	}

	// Skip the worker entirely once it has previously failed to load.
	if (workerBroken) {
		return new Promise<OptimizeResult>((resolve, reject) => {
			runSync({ ...pendingBase, resolve, reject })
		})
	}

	const w = getWorker()

	// No worker available (SSR / test runner / unsupported / creation failed) → sync.
	if (!w) {
		return new Promise<OptimizeResult>((resolve, reject) => {
			runSync({ ...pendingBase, resolve, reject })
		})
	}

	return new Promise<OptimizeResult>((resolve, reject) => {
		pendingRequests.set(id, { ...pendingBase, resolve, reject })

		// Plain structured clone — no transferables (the FeatureCollection clones plainly).
		w.postMessage({ id, featureCollection, targetBytes })

		// Stuck/hung worker → fall back to a synchronous optimize (T-07-07).
		setTimeout(() => {
			const pending = pendingRequests.get(id)
			if (!pending) return
			console.warn('Optimize worker timeout, falling back to sync optimize')
			settleViaSync(pending)
		}, timeoutMs)
	})
}

/** Terminate the worker and clear pending state (cleanup / testing). */
export function terminateOptimizeWorker(): void {
	if (worker) {
		worker.terminate()
		worker = null
	}
	pendingRequests.clear()
	workerBroken = false
}
