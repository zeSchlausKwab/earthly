/**
 * The QuickJS isolation boundary — the greenfield spike deliverable (Wave 1).
 *
 * This Web Worker instantiates a QuickJS-WASM context with an EMPTY global and
 * injects EXACTLY six host objects — `authoring` (recording), `turf`, `data`,
 * `console`, `world` (read-only bundled reference layers), `pathfinder` (A*
 * over a LineString network) — and nothing else. Because no `fetch` /
 * `localStorage` / `document` / `window` / signer / wallet is ever created in
 * the context, CODE-01 confinement holds BY OMISSION (proven in
 * sandboxHost.test.ts). `world`/`pathfinder` data is fetched by the WORKER
 * (outside the VM) at spawn and handed in read-only — the VM still cannot
 * reach the network.
 *
 * Mirrors `src/features/chat/ingest/ingest.worker.ts` message discipline: a
 * single `self.onmessage` that branches on a discriminated `{ id, ... }` request,
 * wraps everything in try/catch, and ALWAYS posts a `{ id, success, ... }`
 * response — an error never throws out of the handler (it becomes
 * `{ success:false, error }` fed to the model for self-correction, D-11).
 *
 * Timeout (CODE-04): `setInterruptHandler(shouldInterruptAfterDeadline(...))`
 * stops a tight loop IN-VM (RESEARCH Pattern 1); the host adds a wall-clock
 * `worker.terminate()` watchdog on top (Pitfall 3, defence in depth).
 * Memory (T-04-03): `setMemoryLimit(64MB)` + `setMaxStackSize(512KB)`.
 *
 * Writes use buffer-then-apply (RESEARCH Pattern 2 A-sync): `authoring.*` methods
 * RECORD `{op,args}` and return immediately; the host replays the ordered batch
 * through `createAuthoring` in Wave 2. This plan stops at RECORDING — the worker
 * holds NO `createAuthoring` / editor / signer / wallet import, so the boundary
 * stays statically provable.
 *
 * NOTE: this file is executed both as a real Worker (browser/bundler via the
 * `new URL(...)` spawn in quickjsWorker.ts) AND its pure engine is driven
 * directly by the test suite. The engine lives in the exported `runSandboxCode`
 * so the confinement/surface/timeout proofs stay automated even where the test
 * environment can't spawn a real Worker (sandboxHost.test.ts adaptation note).
 */

import {
	getQuickJS,
	newQuickJSWASMModuleFromVariant,
	newVariant,
	type QuickJSContext,
	type QuickJSHandle,
	type QuickJSWASMModule,
	RELEASE_SYNC,
	shouldInterruptAfterDeadline,
} from 'quickjs-emscripten'
import { getLoadedWorldLayer, loadWorldLayer, WORLD_LAYER_IDS } from '@/lib/geo/worldData'
import { isWorkerScope } from '@/lib/isWorkerScope'
import { assertSandboxDistanceWithinCap, curatedTurf } from '../curatedTurf'
import { createOutputCapture } from '../outputCapture'
import { runPathfinder } from '../sandboxPathfinder'
import type {
	RecordedCall,
	SandboxWorkerRequest,
	SandboxWorkerResponse,
	SandboxWorldAccess,
} from './types'

/**
 * The served path of the QuickJS `.wasm` asset emitted by `build.ts` (Phase 4
 * criterion c). The release-sync emscripten variant fetches its WebAssembly at
 * RUNTIME from a separate file; under the html-driven production build the worker
 * chunk lands hashed under a nested path, so the emscripten default of resolving
 * the wasm RELATIVE to the chunk 404s. We pin it to this stable, root-served URL.
 */
const SERVED_WASM_FILENAME = 'emscripten-module.wasm'

/**
 * Whether we are running inside a REAL browser/Worker with an http(s) origin.
 *
 * Critical (Pitfall #1): in `bun test` the worker module is imported in-process
 * under Node, where the emscripten glue loads the wasm from node_modules via the
 * filesystem. We must NOT redirect `locateFile` to an HTTP URL there or the test
 * path breaks. Only override when an actual http(s) origin exists (browser/Worker).
 */
function browserWasmLocation(): string | undefined {
	const loc = (globalThis as { location?: { origin?: string; protocol?: string } }).location
	if (!loc || typeof loc.origin !== 'string') return undefined
	if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return undefined
	return new URL(`/${SERVED_WASM_FILENAME}`, loc.origin).href
}

/**
 * Compile-the-wasm-ONCE memoization (OOM/runaway fix).
 *
 * `newQuickJSWASMModuleFromVariant(newVariant(...))` is NOT memoized by the library
 * (only `getQuickJS()` is, via its internal singletonPromise). Calling it per run
 * re-FETCHES + re-COMPILES the ~503KB QuickJS wasm and allocates a fresh wasm heap
 * every time — which, multiplied across many runs, drives the worker toward OOM and
 * pegs a CPU core on repeated compilation (Phase 4 UAT runaway). The COMPILED module
 * is stateless and safe to reuse: all script state lives in the per-run `runtime` /
 * `context` created and disposed inside {@link runSandboxCode}, so reusing the module
 * does NOT bleed state between runs (confinement, CODE-01, is unaffected). We memoize
 * the module promise so a long-lived (pooled) worker compiles the wasm exactly once.
 */
let quickJsModulePromise: Promise<QuickJSWASMModule> | undefined

/**
 * Load the QuickJS WASM module, pointing the emscripten loader at the served
 * `.wasm` asset when in a real browser/Worker, and falling back to the default
 * filesystem resolution (via `getQuickJS()`) in Node / the bun-test harness.
 *
 * MEMOIZED: the first call compiles the wasm; every subsequent call (every run in
 * the same worker) reuses the already-compiled module — no re-fetch, no re-compile.
 */
function loadQuickJS(): Promise<QuickJSWASMModule> {
	if (quickJsModulePromise) return quickJsModulePromise
	const wasmLocation = browserWasmLocation()
	const promise = wasmLocation
		? newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmLocation }))
		: getQuickJS()
	// On a failed compile, clear the cache so a later run can retry from scratch
	// (a one-off failure must not permanently wedge the worker).
	quickJsModulePromise = promise.catch((error) => {
		quickJsModulePromise = undefined
		throw error
	})
	return quickJsModulePromise
}

/** Memory cap for one run (T-04-03). */
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024
/** Stack cap for one run (T-04-03). */
const MAX_STACK_SIZE_BYTES = 512 * 1024
/** Default in-VM wall-clock deadline if the host omits one (D-14). */
export const DEFAULT_DEADLINE_MS = 3000

/**
 * WR-04 recorded-call write-channel caps (T-05-06 / Pitfall 4).
 *
 * The console cap (`outputCapture`) bounds the READ-back channel; this bounds the
 * WRITE channel. Untrusted sandbox code can call `authoring.*` arbitrarily — each
 * call is recorded and later replayed SYNCHRONOUSLY on the host main thread, so an
 * unbounded batch is a DoS even though every individual op is allow-listed. Mirror
 * the console cap: stop appending once EITHER budget is exceeded and flag the
 * response; the host (`runCode.ts`) rejects the whole over-budget batch before
 * replaying a single op (T-05-08 — no silent partial apply).
 *
 * Values are planner discretion, on the order of the console caps:
 *  - `MAX_RECORDED_CALLS = 2000` — a legitimate authoring run is well under this;
 *    a million-iteration loop of recorded authoring calls (a write-path DoS) is not.
 *  - `MAX_RECORDED_ARG_BYTES = 4 MiB` — total serialized arg bytes across the run
 *    (above the 256 KiB console cap because a single legitimate `writeGeoJSON`
 *    FeatureCollection can be large, but still bounded).
 */
export const MAX_RECORDED_CALLS = 2000
export const MAX_RECORDED_ARG_BYTES = 4 * 1024 * 1024

/**
 * The authoring method names the boundary exposes (RECORDING only this phase).
 *
 * Two CLASSES of sandbox-reachable op live here:
 *  - the interceptor-gated feature WRITES (addFeature/writeGeoJSON/circle/buffer):
 *    every one flows through `runInterceptors()` on host replay (D-03/D-08) so the
 *    Phase 5 safe-editing gate catches it for free;
 *  - the benign dataset-METADATA op (setDatasetMetadata): it sets only the
 *    FeatureCollection-level name/description/color/props (no geometry, no
 *    secrets), so it is allow-listed WITHOUT an interceptor gate. It is the
 *    correct way for the model to NAME a dataset instead of stamping
 *    `dataset_name` onto every feature.
 *
 * CR-01: `editorCommand` is DELIBERATELY excluded. It is a raw passthrough to
 * `executeEditorCommand` (no interceptor, no allow-list), so exposing it to the
 * sandbox would route arbitrary editor commands AROUND the gate the whole phase
 * relies on. It stays available to TRUSTED (non-sandbox) callers of
 * `createAuthoring`; only this sandbox-facing surface omits it. `getDatasetMetadata`
 * is also omitted — reads happen via the host `get_editor_state` snapshot, not via
 * the record/replay write channel.
 */
const AUTHORING_METHODS = [
	'addFeature',
	'writeGeoJSON',
	'circle',
	'buffer',
	'setDatasetMetadata',
] as const

/**
 * Run untrusted `code` inside a fresh QuickJS context and return a serializable
 * result. PURE given its input — no Worker/DOM dependency — so it is unit-driven
 * directly by the test suite AND wrapped by the `self.onmessage` shell below.
 *
 * Every QuickJS handle is disposed in `finally`; the runtime/context are torn
 * down per call (fresh-per-run, D-05 / Pitfall 6) — no module-level VM survives.
 */
export async function runSandboxCode(
	req: Pick<SandboxWorkerRequest, 'code' | 'readSnapshot' | 'deadlineMs'>,
	world?: SandboxWorldAccess,
): Promise<Omit<SandboxWorkerResponse, 'id'>> {
	const deadlineMs = req.deadlineMs > 0 ? req.deadlineMs : DEFAULT_DEADLINE_MS
	const recordedCalls: RecordedCall[] = []
	// WR-04 running accumulators (T-05-06). Once EITHER budget is exceeded we stop
	// appending and latch `recordedCallsOverBudget` so the host rejects the batch.
	let recordedArgBytes = 0
	let recordedCallsOverBudget = false
	const output = createOutputCapture()

	const QuickJS = await loadQuickJS()
	const runtime = QuickJS.newRuntime()
	runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
	runtime.setMaxStackSize(MAX_STACK_SIZE_BYTES)
	runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + deadlineMs))

	const vm = runtime.newContext()
	const toDispose: QuickJSHandle[] = []

	try {
		// (1) authoring — RECORDING host object (buffer-then-apply, Pattern 2 A-sync).
		const authoringObj = vm.newObject()
		toDispose.push(authoringObj)
		for (const op of AUTHORING_METHODS) {
			const fn = vm.newFunction(op, (...argHandles) => {
				// WR-04: once either the call-count or the serialized-byte budget is hit,
				// STOP appending and latch the over-budget flag (mirrors the console cap).
				// We still return undefined so the script keeps running to completion — the
				// host rejects the WHOLE batch on the flag, so nothing recorded gets applied.
				if (recordedCallsOverBudget) return vm.undefined
				const args = argHandles.map((h) => vm.dump(h))
				// Accept this call, THEN check the caps (bounded overshoot of one call,
				// matching the outputCapture idiom).
				recordedCalls.push({ op, args })
				recordedArgBytes += serializedByteLength(args)
				if (
					recordedCalls.length >= MAX_RECORDED_CALLS ||
					recordedArgBytes >= MAX_RECORDED_ARG_BYTES
				) {
					recordedCallsOverBudget = true
				}
				return vm.undefined // A-sync: return immediately, no MutationResult marshalled.
			})
			vm.setProp(authoringObj, op, fn)
			fn.dispose()
		}
		vm.setProp(vm.global, 'authoring', authoringObj)

		// (2) turf — the frozen curated subset, marshalled in as a plain object.
		const turfObj = vm.newObject()
		toDispose.push(turfObj)
		for (const key of Object.keys(curatedTurf)) {
			const fn = vm.newFunction(key, (...argHandles) => {
				const args = argHandles.map((h) => vm.dump(h))
				try {
					// WR-01: range-check distance-bearing ops against the DoS cap BEFORE
					// invoking turf, so an absurd radius can't burn CPU on this (worker)
					// thread — the in-VM interrupt cannot preempt a synchronous turf call.
					assertSandboxDistanceWithinCap(key, args)
					const result = (curatedTurf as Record<string, (...a: unknown[]) => unknown>)[key](...args)
					return jsToHandle(vm, result)
				} catch (error) {
					// Surface turf errors INSIDE the VM so user code can catch them.
					const msg = error instanceof Error ? error.message : String(error)
					return vm.newString(`__turf_error__:${msg}`)
				}
			})
			vm.setProp(turfObj, key, fn)
			fn.dispose()
		}
		vm.setProp(vm.global, 'turf', turfObj)

		// (2b) world — bundled read-only reference layers (AI_GEO_AWARENESS §4).
		// `world.layers` lists the ids; `world.get(id)` marshals ONE layer into the
		// VM on demand (lazy — a run that never touches world data pays nothing).
		// The accessor is realm-local and synchronous: the worker prefetches every
		// layer at spawn, so a miss means "not loaded / unknown id", reported via
		// the same tagged-error-string convention as turf.
		const worldObj = vm.newObject()
		toDispose.push(worldObj)
		const layerIds = world ? world.layers() : []
		const layersHandle = jsToHandle(vm, layerIds)
		vm.setProp(worldObj, 'layers', layersHandle)
		layersHandle.dispose()
		const worldGetFn = vm.newFunction('get', (idHandle) => {
			const id = String(vm.dump(idHandle))
			const layer = world?.get(id) ?? null
			if (!layer) {
				return vm.newString(
					`__world_error__:layer "${id}" is not available${
						layerIds.length > 0 ? ` (known layers: ${layerIds.join(', ')})` : ' in this environment'
					}`,
				)
			}
			return jsToHandle(vm, layer)
		})
		vm.setProp(worldObj, 'get', worldGetFn)
		worldGetFn.dispose()
		vm.setProp(vm.global, 'world', worldObj)

		// (2c) pathfinder — A* shortest path over a LineString network (§3). The
		// network is a world layer id (routed WITHOUT marshalling the network into
		// the VM, and with a warm per-layer graph cache) or an inline
		// FeatureCollection. Runs synchronously on the worker thread like turf, so
		// the network size is hard-capped inside runPathfinder (WR-01 idiom).
		const pathfinderFn = vm.newFunction('pathfinder', (...argHandles) => {
			const args = argHandles.map((h) => vm.dump(h))
			try {
				const [network, from, to] = args
				const resolved =
					typeof network === 'string' ? (world?.get(network) ?? null) : (network ?? null)
				if (!resolved || typeof resolved !== 'object') {
					throw new Error(
						typeof network === 'string'
							? `network layer "${network}" is not available${
									layerIds.length > 0 ? ` (known layers: ${layerIds.join(', ')})` : ''
								}`
							: 'network must be a world layer id string or a GeoJSON FeatureCollection',
					)
				}
				const result = runPathfinder(resolved as GeoJSON.FeatureCollection, from, to)
				return jsToHandle(vm, result)
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				return vm.newString(`__pathfinder_error__:${msg}`)
			}
		})
		vm.setProp(vm.global, 'pathfinder', pathfinderFn)
		pathfinderFn.dispose()

		// (3) data — the frozen plain-data read snapshot (D-01). Pass-through this phase.
		const dataHandle = jsToHandle(vm, req.readSnapshot ?? null)
		vm.setProp(vm.global, 'data', dataHandle)
		dataHandle.dispose()

		// (4) console — log/warn/error routed into the bounded capture (D-10/D-14).
		const consoleObj = vm.newObject()
		toDispose.push(consoleObj)
		for (const level of ['log', 'warn', 'error'] as const) {
			const fn = vm.newFunction(level, (...argHandles) => {
				const line = argHandles.map((h) => stringifyDump(vm.dump(h))).join(' ')
				output.push(level === 'log' ? line : `[${level}] ${line}`)
				return vm.undefined
			})
			vm.setProp(consoleObj, level, fn)
			fn.dispose()
		}
		vm.setProp(vm.global, 'console', consoleObj)

		// Execute the untrusted code.
		//
		// DX (D-10): the model frequently writes a natural top-level `return <expr>`
		// even though the contract is "the last expression is the value". A bare
		// program rejects that with `SyntaxError: return not in a function`. We run
		// the code as a PROGRAM first (so last-expression-as-value still holds), and
		// only if it fails with that specific syntax error do we re-run it wrapped in
		// a function body — which makes a top-level `return` valid while the wrapped
		// function's return value becomes the result. Side effects (authoring.* /
		// console) are not duplicated because the first attempt threw at PARSE time,
		// before any statement ran.
		let evalResult = vm.evalCode(req.code)
		if (evalResult.error && isTopLevelReturnSyntaxError(vm, evalResult.error)) {
			evalResult.error.dispose()
			evalResult = vm.evalCode(`(function(){\n${req.code}\n})()`)
		}
		const drained = output.drain()

		if (evalResult.error) {
			const errVal = vm.dump(evalResult.error)
			evalResult.error.dispose()
			return {
				success: false,
				error: formatVmError(errVal),
				recordedCalls,
				recordedCallsOverBudget,
				consoleLines: drained.lines,
				truncated: drained.truncated,
			}
		}

		const returnValue = vm.dump(evalResult.value)
		evalResult.value.dispose()
		return {
			success: true,
			recordedCalls,
			recordedCallsOverBudget,
			consoleLines: drained.lines,
			truncated: drained.truncated,
			returnValue,
		}
	} catch (error) {
		// Engine-level failure (e.g. interrupt thrown as a host exception, OOM).
		const drained = output.drain()
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			recordedCalls,
			recordedCallsOverBudget,
			consoleLines: drained.lines,
			truncated: drained.truncated,
		}
	} finally {
		for (const handle of toDispose) {
			if (handle.alive) handle.dispose()
		}
		vm.dispose()
		runtime.dispose()
	}
}

/** Marshal a plain JS value into a QuickJS handle via JSON round-trip (serializable only). */
function jsToHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
	if (value === undefined) return vm.undefined
	if (value === null) return vm.null
	// Round-trip through JSON inside the VM so nested structures become VM-native
	// objects (turf returns plain GeoJSON; data is plain rows). Non-serializable
	// values fail closed (JSON.stringify throws → caught by callers).
	const json = JSON.stringify(value)
	if (json === undefined) return vm.undefined
	const jsonHandle = vm.newString(json)
	const parseResult = vm.evalCode(`(json) => JSON.parse(json)`)
	if (parseResult.error) {
		parseResult.error.dispose()
		jsonHandle.dispose()
		return vm.undefined
	}
	const parsed = vm.callFunction(parseResult.value, vm.undefined, jsonHandle)
	parseResult.value.dispose()
	jsonHandle.dispose()
	if (parsed.error) {
		parsed.error.dispose()
		return vm.undefined
	}
	return parsed.value
}

/** Render a dumped console arg the way `console.log` would (objects → JSON). */
function stringifyDump(value: unknown): string {
	if (typeof value === 'string') return value
	if (value === undefined) return 'undefined'
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}

/**
 * UTF-8 byte counter for the WR-04 cap. MUST be TextEncoder, not Buffer: this
 * file runs as a BROWSER worker where Node's `Buffer` does not exist — the old
 * `Buffer.byteLength` compiled fine, passed bun tests (Node globals present),
 * then threw `ReferenceError: Buffer is not defined` on the FIRST recorded
 * `authoring.*` call of every real in-browser run. Guarded by
 * `noNodeGlobals.test.ts`.
 */
const utf8 = new TextEncoder()

/**
 * Approximate the serialized UTF-8 byte size of a recorded call's args (WR-04).
 * Used to bound the cumulative write-channel payload; JSON.stringify is the same
 * serialization the host replays, so this is a faithful proxy. A non-serializable
 * arg (cycle) falls back to its string length — still a positive bound.
 */
function serializedByteLength(args: unknown[]): number {
	let total = 0
	for (const arg of args) {
		total += utf8.encode(stringifyDump(arg)).length
	}
	return total
}

/**
 * Detect QuickJS's `SyntaxError: return not in a function` WITHOUT consuming the
 * error handle (so the caller can dispose it / reuse the value). This is the ONE
 * parse error we recover from by re-running the code wrapped in a function body,
 * letting the model's natural top-level `return <expr>` work (DX, fix #2). Any
 * other syntax error is a genuine bug surfaced to the model unchanged.
 */
function isTopLevelReturnSyntaxError(vm: QuickJSContext, errorHandle: QuickJSHandle): boolean {
	const dumped = vm.dump(errorHandle) as { name?: string; message?: string } | undefined
	if (!dumped || typeof dumped !== 'object') return false
	const message = typeof dumped.message === 'string' ? dumped.message : ''
	return /return\s+not\s+in\s+a\s+function/i.test(message)
}

/** Build a full error string for the model (D-11) from a dumped VM error value. */
function formatVmError(errVal: unknown): string {
	if (errVal && typeof errVal === 'object') {
		const e = errVal as { name?: string; message?: string; stack?: string }
		const head = [e.name, e.message].filter(Boolean).join(': ')
		return e.stack ? `${head}\n${e.stack}` : head || JSON.stringify(errVal)
	}
	return String(errVal)
}

// ── World layer access (realm-local) ────────────────────────────────────────

/**
 * The world accessor backed by THIS realm's `worldData` cache. Exported so the
 * main-thread fallback path (`quickjsWorker.ts`, bun test / no-Worker) hands
 * the same shape to `runSandboxCode`; tests prime layers via
 * `primeWorldLayerForTest`.
 */
export const cachedWorldAccess: SandboxWorldAccess = {
	layers: () => [...WORLD_LAYER_IDS],
	get: (id) =>
		(WORLD_LAYER_IDS as string[]).includes(id)
			? getLoadedWorldLayer(id as (typeof WORLD_LAYER_IDS)[number])
			: null,
}

/** Bound on how long the FIRST run waits for the spawn-time world prefetch. */
const WORLD_PREFETCH_WAIT_MS = 2500

let worldPrefetchPromise: Promise<unknown> | null = null

/**
 * Kick off (once) the fetch of every world layer on the WORKER thread — eager
 * per the AI_GEO_AWARENESS decision, so `world.get` is warm by the time user
 * code runs. Individual failures are swallowed: an unavailable layer degrades
 * to the in-VM `__world_error__` string, never a run failure.
 */
function ensureWorldPrefetch(): Promise<unknown> {
	if (!worldPrefetchPromise) {
		worldPrefetchPromise = Promise.allSettled(WORLD_LAYER_IDS.map((id) => loadWorldLayer(id)))
	}
	return worldPrefetchPromise
}

/** Await the prefetch, but never let a slow fetch stall a run past the bound. */
async function worldReadyBounded(): Promise<void> {
	await Promise.race([
		ensureWorldPrefetch(),
		new Promise((resolve) => setTimeout(resolve, WORLD_PREFETCH_WAIT_MS)),
	])
}

// ── Worker message shell ────────────────────────────────────────────────────
// Only registers when `isWorkerScope()` confirms we are in a real Worker realm. On the
// main thread `self === window`, so an unconditional handler would install
// `window.onmessage` and create a message → postMessage runaway loop if this module is
// ever value-imported there (as `sandboxHost.ts` does for its synchronous fallback). In
// the bun test environment this module is imported for `runSandboxCode` directly, so the
// guard skips registration (WorkerGlobalScope is undefined there). See `isWorkerScope`.
declare const self: {
	onmessage: ((event: MessageEvent<SandboxWorkerRequest>) => void) | null
	postMessage: (message: SandboxWorkerResponse) => void
}

if (isWorkerScope()) {
	// Eager world prefetch at worker spawn (the worker realm has fetch; the VM
	// does not — data crosses INTO the VM only via the world accessor above).
	ensureWorldPrefetch()
	self.onmessage = async (event: MessageEvent<SandboxWorkerRequest>) => {
		const { id, code, readSnapshot, deadlineMs } = event.data
		try {
			await worldReadyBounded()
			const result = await runSandboxCode({ code, readSnapshot, deadlineMs }, cachedWorldAccess)
			self.postMessage({ id, ...result })
		} catch (error) {
			self.postMessage({
				id,
				success: false,
				error: error instanceof Error ? error.message : 'Sandbox run failed',
			})
		}
	}
}
