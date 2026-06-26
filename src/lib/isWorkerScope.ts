/**
 * The single, can't-get-it-wrong guard every Web Worker entrypoint uses to decide
 * whether to install its `self.onmessage` handler.
 *
 * THE BUG THIS PREVENTS: on the main thread `self === window`, so a naive
 * `if (typeof self !== 'undefined' && self)` is ALWAYS true there. If a worker
 * module is ever value-imported on the main thread (e.g. a synchronous fallback
 * path), that guard installs `window.onmessage`, and the handler's own
 * `self.postMessage(...)` re-dispatches a `message` event to `window` — a runaway
 * message → postMessage CPU loop that pegs a core.
 *
 * `WorkerGlobalScope` exists ONLY inside a real Worker realm; on the main thread
 * (`window`) and under `bun test` it is `undefined`. So `self instanceof
 * WorkerGlobalScope` is true exclusively when we are actually running as a Worker —
 * the only place message-handler registration is correct. Under `bun test` the
 * pure engines are exercised directly via their exported functions, so this
 * returns `false` and no handler is registered (the desired behaviour).
 *
 * ZERO-DEPENDENCY LEAF: this module imports nothing so it is safe to pull into any
 * worker bundle without dragging transitive deps (cf. the "LEAF IMPORTS ONLY"
 * constraint in `optimize.worker.ts`).
 *
 * PLACEMENT — do NOT move this into `src/lib/workers/`. That directory holds the
 * server-only worker *bundling* infra (`buildWorker.ts`, `workerAssets.ts`); a worker
 * entrypoint that imports a sibling from there forms a self-referential module graph
 * that, under `bun test`'s shared resolver, intermittently poisons unrelated `@/…`
 * resolutions (observed: 18 spurious "Cannot find module" failures stemming from the
 * ingest worker's heavy exceljs graph). Keeping the helper here, beside the runtime,
 * avoids it.
 */
export function isWorkerScope(): boolean {
	const WorkerScope = (globalThis as Record<string, unknown>).WorkerGlobalScope as
		| (new () => unknown)
		| undefined
	return typeof WorkerScope !== 'undefined' && globalThis.self instanceof WorkerScope
}
