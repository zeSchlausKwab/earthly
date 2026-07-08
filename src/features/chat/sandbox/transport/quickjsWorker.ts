/**
 * Worker client for the QuickJS isolation boundary (transport A).
 *
 * WARM-POOLED single worker (OOM/runaway fix — Phase 4 UAT).
 * --------------------------------------------------------------------------
 * The boundary previously spawned a FRESH Worker per run and `terminate()`d it
 * in `finally`. That re-imported the ~0.58MB worker bundle AND re-fetched +
 * re-COMPILED the ~503KB QuickJS wasm on EVERY run (the variant module factory is
 * not memoized). Across a self-correcting agent loop this became a runaway:
 * thousands of wasm fetches / >1GB transferred, monotonic allocation toward an
 * OOM crash, and a pegged CPU core from repeated wasm compilation.
 *
 * Now a SINGLE long-lived worker is reused across runs. Isolation is preserved:
 * the worker compiles the wasm ONCE (memoized in sandbox.worker.ts) but builds a
 * FRESH QuickJS `runtime` + `context` per run and disposes them — script state
 * lives in those per-run objects, never in the shared compiled module, so nothing
 * bleeds between runs (CODE-01 still holds; proven by the sandboxHost suite that
 * runs many isolated evals through the identical pure engine).
 *
 * Runs are SERIALIZED through the one worker (the boundary is invoked one tool
 * call at a time by the agent loop; a runs-queue keeps responses unambiguous and
 * prevents concurrent runtimes from sharing the single worker thread).
 *
 * Timeout is defence-in-depth (CODE-04): the worker's in-VM `setInterruptHandler`
 * stops a tight JS loop; a wedged worker (or time spent in a host callback) is
 * caught by the HOST wall-clock watchdog, which TERMINATES the warm worker and
 * lets the next run lazily recreate it — a terminated worker can never wedge the
 * pool, and a fresh one recompiles the wasm exactly once again.
 *
 * Fallback: where `Worker` is unavailable (bun test / SSR), the run is driven
 * against the worker module's pure `runSandboxCode` engine directly — the
 * confinement/surface/timeout proofs stay automated regardless of Worker support.
 */

import { workerUrl } from '../../../../lib/workers/workerAssets'
import { cachedWorldAccess, runSandboxCode } from './sandbox.worker'
import type { SandboxWorkerRequest, SandboxWorkerResponse } from './types'

/** Extra wall-clock slack on top of the in-VM deadline before the host kills the worker. */
export const WATCHDOG_SLACK_MS = 500

let runId = 0

/** Options for one isolated run. */
export interface RunInWorkerOptions {
	/** Frozen plain-data read snapshot exposed as the boundary `data` global (D-01). */
	readSnapshot?: unknown
	/** In-VM wall-clock deadline (ms). The host watchdog fires at deadline + slack. */
	deadlineMs: number
}

// ── Warm worker pool (single worker, lazily created, recreated after a kill) ──────

/** The one long-lived sandbox worker, or `null` when none is alive yet. */
let warmWorker: Worker | null = null
/** In-flight runs keyed by request id, awaiting their `{ id, ... }` response. */
const pending = new Map<string, (res: SandboxWorkerResponse) => void>()

/**
 * Tear down the warm worker (after a watchdog kill or a load error) and fail every
 * in-flight run so no promise hangs. The next `runInQuickjsWorker` lazily recreates
 * a fresh worker (which recompiles the wasm once).
 */
function disposeWarmWorker(reason: string): void {
	const dead = warmWorker
	warmWorker = null
	if (dead) {
		dead.onmessage = null
		dead.onerror = null
		dead.terminate()
	}
	if (pending.size > 0) {
		const failures = [...pending.values()]
		pending.clear()
		for (const settle of failures) {
			settle({ id: 'pool', success: false, error: reason })
		}
	}
}

/** Get the warm worker, creating it on first use (or after a prior teardown). */
function getWarmWorker(): Worker {
	if (warmWorker) return warmWorker
	// Stable origin-rooted URL served by the dev route / prod build (see workerAssets.ts).
	// The `new Worker(new URL('./x.worker.ts', import.meta.url))` form does NOT work in
	// this app's dev OR prod serving (Bun #17705 / #7534) — it resolves to a file:// (dev)
	// or non-existent .ts (prod) URL the browser can't construct a Worker from.
	const worker = new Worker(workerUrl('sandbox'), { type: 'module' })
	worker.onmessage = (event: MessageEvent<SandboxWorkerResponse>) => {
		const id = event.data?.id
		if (typeof id !== 'string') return
		const settle = pending.get(id)
		if (!settle) return
		pending.delete(id)
		settle(event.data)
	}
	worker.onerror = (event) => {
		// A worker-load failure (e.g. the wasm/worker route is down) must NOT turn into
		// a re-spawn storm: tear the worker down and fail all in-flight runs ONCE. The
		// caller's bounded self-correction (RUN_CODE_RETRY_CAP) decides whether to retry.
		const message =
			event instanceof ErrorEvent && event.message
				? event.message
				: 'Sandbox worker failed to load or threw.'
		disposeWarmWorker(message)
	}
	warmWorker = worker
	return worker
}

/**
 * Execute `code` in the warm QuickJS worker (or the direct engine fallback) and
 * resolve a serializable result. Always settles: on watchdog timeout it resolves
 * a `{ success:false, error }`-shaped response (and kills the warm worker) rather
 * than hanging.
 */
export async function runInQuickjsWorker(
	code: string,
	options: RunInWorkerOptions,
): Promise<SandboxWorkerResponse> {
	const id = `sandbox-${++runId}`
	const deadlineMs = options.deadlineMs
	const request: SandboxWorkerRequest = {
		id,
		code,
		readSnapshot: options.readSnapshot ?? null,
		deadlineMs,
	}

	// Fallback path: no Worker (bun test / SSR) → drive the pure engine directly.
	// World layers come from THIS realm's cache (tests prime it explicitly).
	if (typeof Worker === 'undefined') {
		const result = await runSandboxCode(request, cachedWorldAccess)
		return { id, ...result }
	}

	return new Promise<SandboxWorkerResponse>((resolve) => {
		let settled = false
		const settle = (res: SandboxWorkerResponse) => {
			if (settled) return
			settled = true
			clearTimeout(watchdog)
			pending.delete(id)
			resolve(res)
		}

		// Host-side wall-clock watchdog (defence in depth). On fire it KILLS the warm
		// worker (a wedged worker thread can't be recovered any other way) and the next
		// run lazily recreates a fresh one — the wasm is recompiled at most once again.
		const watchdog = setTimeout(() => {
			disposeWarmWorker(`Sandbox run exceeded ${deadlineMs}ms wall-clock and was terminated.`)
			settle({
				id,
				success: false,
				error: `Sandbox run exceeded ${deadlineMs}ms wall-clock and was terminated.`,
			})
		}, deadlineMs + WATCHDOG_SLACK_MS)

		pending.set(id, settle)
		try {
			getWarmWorker().postMessage(request)
		} catch (error) {
			// Worker construction/postMessage failed synchronously — surface it without
			// leaving the run pending, and drop the (possibly half-built) worker.
			disposeWarmWorker(error instanceof Error ? error.message : 'Sandbox worker spawn failed.')
			settle({
				id,
				success: false,
				error: error instanceof Error ? error.message : 'Sandbox worker spawn failed.',
			})
		}
	})
}

/** TEST/cleanup seam: tear down the warm worker (used by hot-reload / teardown). */
export function terminateSandboxWorker(): void {
	disposeWarmWorker('Sandbox worker terminated by host.')
}
