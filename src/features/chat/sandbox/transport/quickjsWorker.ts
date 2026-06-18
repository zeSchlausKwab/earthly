/**
 * Worker client for the QuickJS isolation boundary (transport A).
 *
 * FRESH-spawn-per-run (D-05 / Pitfall 6): every `runInQuickjsWorker` call builds
 * its OWN Worker and `terminate()`s it in `finally` — there is NO module-level
 * long-lived runtime, so no state bleeds between runs and HMR can't leak workers.
 *
 * The spawn form is the VERBATIM Phase 3 ingest pattern
 * (`new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`,
 * RESEARCH Pitfall 2) — that exact form is what makes the worker chunk emit under
 * the html-driven production `build.ts`.
 *
 * Timeout is defence-in-depth (RESEARCH Pitfall 3): the worker's in-VM
 * `setInterruptHandler` stops a tight JS loop, but a wedged worker (or time spent
 * in a host callback) needs the HOST-side wall-clock watchdog
 * `setTimeout(() => worker.terminate(), deadlineMs + slack)` to guarantee the run
 * promise always settles without freezing the app (CODE-04).
 *
 * Fallback: where `Worker` is unavailable (bun test / SSR), the run is driven
 * against the worker module's pure `runSandboxCode` engine directly — the
 * confinement/surface/timeout proofs stay automated regardless of Worker support.
 */

import { workerUrl } from '../../../../lib/workers/workerAssets'
import { runSandboxCode } from './sandbox.worker'
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

/**
 * Execute `code` in a fresh QuickJS worker (or the direct engine fallback) and
 * resolve a serializable result. Always settles: on watchdog timeout it resolves
 * a `{ success:false, error, timedOut }`-shaped response rather than hanging.
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
	if (typeof Worker === 'undefined') {
		const result = await runSandboxCode(request)
		return { id, ...result }
	}

	// Stable origin-rooted URL served by the dev route / prod build (see workerAssets.ts).
	// The `new Worker(new URL('./x.worker.ts', import.meta.url))` form does NOT work in
	// this app's dev OR prod serving (Bun #17705 / #7534) — it resolves to a file:// (dev)
	// or non-existent .ts (prod) URL the browser can't construct a Worker from.
	const worker = new Worker(workerUrl('sandbox'), { type: 'module' })

	return new Promise<SandboxWorkerResponse>((resolve) => {
		let settled = false
		const settle = (res: SandboxWorkerResponse) => {
			if (settled) return
			settled = true
			clearTimeout(watchdog)
			worker.terminate()
			resolve(res)
		}

		// Host-side wall-clock watchdog (Pitfall 3) — kills a wedged worker.
		const watchdog = setTimeout(() => {
			settle({
				id,
				success: false,
				error: `Sandbox run exceeded ${deadlineMs}ms wall-clock and was terminated.`,
			})
		}, deadlineMs + WATCHDOG_SLACK_MS)

		worker.onmessage = (event: MessageEvent<SandboxWorkerResponse>) => {
			if (event.data?.id !== id) return
			settle(event.data)
		}

		worker.onerror = (event) => {
			const message =
				event instanceof ErrorEvent && event.message
					? event.message
					: 'Sandbox worker failed to load or threw.'
			settle({ id, success: false, error: message })
		}

		worker.postMessage(request)
	})
}
