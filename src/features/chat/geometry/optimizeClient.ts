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
 *  - a SAFE timeout (07-05, T-07-13): when a spawned worker hangs, the timer
 *    TERMINATES the worker and then decides by a SIZE GATE —
 *      • input UNDER `SYNC_FALLBACK_MAX_BYTES` → settle via the synchronous
 *        `optimize()` (trivially-small datasets are cheap on the main thread);
 *      • input AT/OVER the gate → REJECT with a model-relayable "timed out / too
 *        large" error. It NEVER re-runs `optimize()` synchronously on the main
 *        thread for an over-threshold dataset — that unbounded main-thread block is
 *        exactly what froze + OOM-crashed the UAT user's tab.
 *    The `onerror` handler (a worker that fails to LOAD) applies the SAME size gate:
 *    under-threshold pendings sync-fall-back, over-threshold pendings reject.
 *  - the no-worker / `workerBroken` / SSR fast paths (no worker was EVER spawned —
 *    test runner / SSR) use the SYNCHRONOUS `optimize()` for ALL sizes; there is no
 *    UI to freeze there and bun tests depend on it. The size gate applies ONLY to the
 *    timeout/onerror fallbacks, where a real worker hung/failed.
 *
 * Per-request timers are captured and `clearTimeout`'d on settle and in
 * `terminateOptimizeWorker()` (subsumes the WR-05 timer-leak review item).
 *
 * The worker and every sync fallback share the SAME pure `optimize()` from `./optimize`,
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
	/** Per-request timeout before the safe-timeout path fires (default 30_000ms). */
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Size gate (07-05): only datasets whose serialized size is UNDER this are cheap
 * enough that a main-thread synchronous `optimize()` fallback is acceptable when a
 * spawned worker hangs/fails. Anything larger must NOT be sync-re-run on the main
 * thread — that unbounded block is what crashed the UAT tab; those reject instead.
 * 256KiB is comfortably below the publish threshold (1MiB) yet well within what the
 * bounded near-linear `optimize()` handles instantly on the main thread.
 */
const SYNC_FALLBACK_MAX_BYTES = 256 * 1024

const BYTE_ENCODER = new TextEncoder()

/** Serialized byte size of a FeatureCollection — the same measure the optimizer uses. */
function collectionBytes(fc: OptimizeFeatureCollection): number {
	return BYTE_ENCODER.encode(JSON.stringify({ type: 'FeatureCollection', features: fc.features }))
		.length
}

/** The model-relayable error for an over-threshold input the worker could not finish. */
function tooLargeError(): Error {
	return new Error(
		'Geometry optimization timed out — the dataset is too large to optimize in one pass. ' +
			'Try optimizing a smaller selection or a higher target byte budget.',
	)
}

interface PendingRequest {
	resolve: (res: OptimizeResult) => void
	reject: (error: Error) => void
	id: string
	featureCollection: OptimizeFeatureCollection
	targetBytes?: number
	/** Per-request timeout handle, cleared on settle / teardown (subsumes WR-05). */
	timer?: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let workerBroken = false // latched true once the worker fails to load/run
let requestId = 0
const pendingRequests = new Map<string, PendingRequest>()

/**
 * Synchronously run the pure `optimize()` and adapt it to the resolve/reject of a
 * pending request. Used by the no-worker / `workerBroken` / SSR paths (all sizes) and
 * the size-gated under-threshold timeout/onerror fallback.
 */
function runSync(pending: PendingRequest): void {
	try {
		const { result, report } = optimize(pending.featureCollection, pending.targetBytes)
		pending.resolve({ result, report })
	} catch (error) {
		pending.reject(error instanceof Error ? error : new Error('Geometry optimization failed'))
	}
}

/**
 * Settle a hung/failed pending request: clear its timer, drop it from the map, then
 * decide by the SIZE GATE — under-threshold inputs settle via the synchronous
 * `optimize()`; over-threshold inputs REJECT with the relayable too-large error (NEVER
 * a main-thread sync re-run — that is the UAT crash, T-07-13).
 */
function settleSizeGated(pending: PendingRequest): void {
	if (pending.timer) clearTimeout(pending.timer)
	pendingRequests.delete(pending.id)
	if (collectionBytes(pending.featureCollection) < SYNC_FALLBACK_MAX_BYTES) {
		runSync(pending)
	} else {
		pending.reject(tooLargeError())
	}
}

/** Tear the worker down (broken latch + terminate) so future calls skip it. */
function killWorker(): void {
	workerBroken = true
	worker?.terminate()
	worker = null
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
			if (pending.timer) clearTimeout(pending.timer) // happy-path timer clear (WR-05).
			pendingRequests.delete(res.id)
			if (res.success && res.result && res.report) {
				pending.resolve({ result: res.result, report: res.report })
			} else {
				pending.reject(new Error(res.error ?? 'Geometry optimization failed'))
			}
		}

		worker.onerror = (error) => {
			console.warn('Optimize worker error:', error)
			// A worker that fails to LOAD: settle every pending by the SAME size gate
			// (under-threshold → sync; over-threshold → reject) before tearing it down.
			for (const pending of [...pendingRequests.values()]) {
				settleSizeGated(pending)
			}
			killWorker()
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
 * (no UI freeze, no hang). On a hung/failed worker the timeout/onerror paths are
 * size-gated: small inputs sync-fall-back, large inputs REJECT with a relayable
 * "timed out / too large" error (NEVER a main-thread sync re-run — T-07-13).
 *
 * @param featureCollection plain GeoJSON FeatureCollection of EditorFeatures
 * @param targetBytes       target serialized byte budget (defaults to publish threshold)
 * @param options           `{ timeoutMs }` — per-request safe-timeout (default 30s)
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

	// Skip the worker entirely once it has previously failed to load → SYNC (all sizes:
	// no worker was spawned, so there is no UI thread to crash and tests depend on it).
	if (workerBroken) {
		return new Promise<OptimizeResult>((resolve, reject) => {
			runSync({ ...pendingBase, resolve, reject })
		})
	}

	const w = getWorker()

	// No worker available (SSR / test runner / unsupported / creation failed) → SYNC (all sizes).
	if (!w) {
		return new Promise<OptimizeResult>((resolve, reject) => {
			runSync({ ...pendingBase, resolve, reject })
		})
	}

	return new Promise<OptimizeResult>((resolve, reject) => {
		const pending: PendingRequest = { ...pendingBase, resolve, reject }
		pendingRequests.set(id, pending)

		// Plain structured clone — no transferables (the FeatureCollection clones plainly).
		w.postMessage({ id, featureCollection, targetBytes })

		// SAFE timeout (T-07-13): a stuck/hung worker → terminate the worker, then
		// size-gate the fallback (small → sync; large → reject). NEVER a main-thread
		// sync re-run of a large dataset (the UAT crash).
		pending.timer = setTimeout(() => {
			const stuck = pendingRequests.get(id)
			if (!stuck) return // already settled by onmessage.
			console.warn('Optimize worker timeout — terminating worker and applying the size gate')
			// Terminate the still-running worker so it stops consuming CPU/memory.
			killWorker()
			settleSizeGated(stuck)
		}, timeoutMs)
	})
}

/** Terminate the worker and clear pending state + timers (cleanup / testing). */
export function terminateOptimizeWorker(): void {
	if (worker) {
		worker.terminate()
		worker = null
	}
	for (const pending of pendingRequests.values()) {
		if (pending.timer) clearTimeout(pending.timer)
	}
	pendingRequests.clear()
	workerBroken = false
}
