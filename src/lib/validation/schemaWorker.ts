/**
 * Main-thread client for the off-thread schema-validation boundary (SPEC-04).
 *
 * Mirrors `src/features/chat/sandbox/transport/quickjsWorker.ts`: a WARM single
 * worker is lazily spawned via the worker registry (`workerUrl('schema')`), runs
 * are serialized through it, and a HOST wall-clock watchdog terminates a wedged
 * worker and settles FAIL-CLOSED so an untrusted relay-authored schema (ReDoS,
 * recursive `$ref`, oversized/deep OOM) can never freeze or crash the tab.
 *
 *   - In-engine deadline `IN_ENGINE_DEADLINE_MS` (≤100ms) + `WATCHDOG_SLACK_MS`
 *     (500ms, mirrored from quickjsWorker.ts:40) wall-clock slack. On overrun the
 *     watchdog `terminate()`s the warm worker and settles `{ ok:false, error }`.
 *   - `onerror` (worker-load failure) also fails CLOSED — never fail-OPEN. A load
 *     failure tears the worker down and fails all in-flight runs ONCE (no re-spawn
 *     storm); the next call lazily recreates a fresh worker.
 *   - Where a real spawnable Worker is unavailable — SSR (`typeof Worker ===
 *     'undefined'`) OR a non-browser harness like `bun test` (no http(s) document
 *     origin to serve `/workers/schema.worker.js` from; Bun's runner defines a
 *     `Worker` global but cannot resolve the served entrypoint) — the same pure
 *     engine (`runSchemaValidation`) is driven SYNCHRONOUSLY, so the hardening proofs
 *     stay automated with the identical verdict shape. This mirrors the sandbox
 *     boundary's `browserWasmLocation()` http(s)-origin gate (sandbox.worker.ts).
 *
 * Registration is the anti-fail-open touchpoint (T-08-04-SPOOF): the worker is
 * declared in `workerAssets.ts` so `bun run build` emits its artifact. The forbidden
 * idiomatic import.meta.url URL spawn form is NEVER used (Bun #17705/#7534) — spawn
 * is via the stable origin-rooted `workerUrl('schema')` string.
 */

import { workerUrl } from '@/lib/workers/workerAssets'
import {
	__compileCount,
	__resetCompileCount,
	runSchemaValidation,
	type SchemaValidationVerdict,
	type SchemaWorkerRequest,
	type SchemaWorkerResponse,
} from './schema.worker'

/** In-engine wall-clock deadline (Assumption A2: ≤100ms in-engine). */
export const IN_ENGINE_DEADLINE_MS = 100
/** Extra wall-clock slack before the HOST kills the worker (mirror quickjsWorker.ts:40). */
export const WATCHDOG_SLACK_MS = 500

/** Re-export the test-only compile-cache hooks so the contract resolves through this seam. */
export { __compileCount, __resetCompileCount }

/** Options for one `validateSchema` call. */
export interface ValidateSchemaOptions {
	/** Stable content hash of the schema — the compile-once cache key. */
	schemaHash: string
}

let runId = 0

/**
 * Whether a REAL, spawnable Web Worker exists for this boundary: a `Worker`
 * constructor AND an http(s) document origin the served `/workers/schema.worker.js`
 * entrypoint can be resolved against. `bun test` defines a `Worker` global but has no
 * http(s) origin (and cannot serve the entrypoint), so this returns `false` there —
 * routing `validateSchema` through the synchronous pure-engine fallback. Mirrors the
 * sandbox boundary's `browserWasmLocation()` origin gate (sandbox.worker.ts).
 */
function hasSpawnableWorker(): boolean {
	if (typeof Worker === 'undefined') return false
	const loc = (globalThis as { location?: { protocol?: string } }).location
	return !!loc && (loc.protocol === 'http:' || loc.protocol === 'https:')
}

// ── Warm worker pool (single worker, lazily created, recreated after a kill) ──────

/** The one long-lived schema worker, or `null` when none is alive yet. */
let warmWorker: Worker | null = null
/** In-flight runs keyed by request id, awaiting their `{ id, ... }` response. */
const pending = new Map<string, (res: SchemaWorkerResponse) => void>()

/**
 * Tear down the warm worker (after a watchdog kill or a load error) and FAIL every
 * in-flight run closed so no promise hangs. The next `validateSchema` lazily recreates
 * a fresh worker.
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
			settle({ id: 'pool', ok: false, error: reason })
		}
	}
}

/** Get the warm worker, creating it on first use (or after a prior teardown). */
function getWarmWorker(): Worker {
	if (warmWorker) return warmWorker
	// Stable origin-rooted URL served by the dev route / prod build (see workerAssets.ts).
	// The idiomatic import.meta.url URL spawn form does NOT work in this app's dev OR
	// prod serving (Bun #17705 / #7534) — always spawn from the registry's stable string.
	const worker = new Worker(workerUrl('schema'), { type: 'module' })
	worker.onmessage = (event: MessageEvent<SchemaWorkerResponse>) => {
		const id = event.data?.id
		if (typeof id !== 'string') return
		const settle = pending.get(id)
		if (!settle) return
		pending.delete(id)
		settle(event.data)
	}
	worker.onerror = (event) => {
		// A worker-load failure must FAIL CLOSED (never fail-open) and must NOT turn into
		// a re-spawn storm: tear the worker down and fail all in-flight runs ONCE.
		const message =
			event instanceof ErrorEvent && event.message
				? event.message
				: 'Schema worker failed to load or threw.'
		disposeWarmWorker(message)
	}
	warmWorker = worker
	return worker
}

/**
 * Validate `data` against an untrusted `schema`, off the main thread when a real
 * `Worker` exists. ALWAYS settles: on watchdog overrun it resolves a fail-closed
 * `{ ok:false, error }` (and terminates the warm worker) rather than hanging.
 * Under `bun test` / SSR it drives the pure engine synchronously.
 */
export async function validateSchema(
	schema: unknown,
	data: unknown,
	options: ValidateSchemaOptions,
): Promise<SchemaValidationVerdict> {
	const id = `schema-${++runId}`
	const request: SchemaWorkerRequest = { id, schema, data, schemaHash: options.schemaHash }

	// Fallback path: no spawnable Worker (bun test / SSR — `typeof Worker === 'undefined'`
	// or no http(s) origin) → drive the pure fail-closed engine directly.
	if (!hasSpawnableWorker()) {
		return runSchemaValidation(request)
	}

	return new Promise<SchemaValidationVerdict>((resolve) => {
		let settled = false
		const settle = (res: SchemaWorkerResponse) => {
			if (settled) return
			settled = true
			clearTimeout(watchdog)
			pending.delete(id)
			resolve({ ok: res.ok, error: res.error })
		}

		// Host-side wall-clock watchdog (defence in depth). On fire it KILLS the warm
		// worker (a wedged worker thread can't be recovered any other way) and the next
		// run lazily recreates a fresh one.
		const watchdog = setTimeout(() => {
			disposeWarmWorker('Schema validation exceeded its wall-clock budget and was terminated.')
			settle({ id, ok: false, error: 'could not validate' })
		}, IN_ENGINE_DEADLINE_MS + WATCHDOG_SLACK_MS)

		pending.set(id, settle)
		try {
			getWarmWorker().postMessage(request)
		} catch (error) {
			// Worker construction/postMessage failed synchronously — fail closed without
			// leaving the run pending, and drop the (possibly half-built) worker.
			disposeWarmWorker(error instanceof Error ? error.message : 'Schema worker spawn failed.')
			settle({ id, ok: false, error: 'could not validate' })
		}
	})
}

/** TEST/cleanup seam: tear down the warm worker (used by hot-reload / teardown). */
export function terminateSchemaWorker(): void {
	disposeWarmWorker('Schema worker terminated by host.')
}
