/**
 * The QuickJS isolation boundary — the greenfield spike deliverable (Wave 1).
 *
 * This Web Worker instantiates a QuickJS-WASM context with an EMPTY global and
 * injects EXACTLY four host objects — `authoring` (recording), `turf`, `data`,
 * `console` — and nothing else. Because no `fetch` / `localStorage` / `document`
 * / `window` / signer / wallet is ever created in the context, CODE-01
 * confinement holds BY OMISSION (proven in sandboxHost.test.ts).
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
import { curatedTurf } from '../curatedTurf'
import { createOutputCapture } from '../outputCapture'
import type { RecordedCall, SandboxWorkerRequest, SandboxWorkerResponse } from './types'

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
 * Load the QuickJS WASM module, pointing the emscripten loader at the served
 * `.wasm` asset when in a real browser/Worker, and falling back to the default
 * filesystem resolution (via `getQuickJS()`) in Node / the bun-test harness.
 */
async function loadQuickJS(): Promise<QuickJSWASMModule> {
	const wasmLocation = browserWasmLocation()
	if (wasmLocation) {
		return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmLocation }))
	}
	return getQuickJS()
}

/** Memory cap for one run (T-04-03). */
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024
/** Stack cap for one run (T-04-03). */
const MAX_STACK_SIZE_BYTES = 512 * 1024
/** Default in-VM wall-clock deadline if the host omits one (D-14). */
export const DEFAULT_DEADLINE_MS = 3000

/**
 * The authoring method names the boundary exposes (RECORDING only this phase).
 *
 * CR-01: `editorCommand` is DELIBERATELY excluded. Every sandbox-reachable write
 * MUST flow through `runInterceptors()` on host replay (D-03/D-08) so the Phase 5
 * safe-editing gate at the interceptor seam catches it for free. `editorCommand`
 * is a raw passthrough to `executeEditorCommand` (no interceptor, no allow-list),
 * so exposing it to the sandbox would route arbitrary editor commands AROUND the
 * gate the whole phase relies on. It stays available to TRUSTED (non-sandbox)
 * callers of `createAuthoring`; only this sandbox-facing surface omits it.
 */
const AUTHORING_METHODS = ['addFeature', 'writeGeoJSON', 'circle', 'buffer'] as const

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
): Promise<Omit<SandboxWorkerResponse, 'id'>> {
	const deadlineMs = req.deadlineMs > 0 ? req.deadlineMs : DEFAULT_DEADLINE_MS
	const recordedCalls: RecordedCall[] = []
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
				recordedCalls.push({ op, args: argHandles.map((h) => vm.dump(h)) })
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
		const evalResult = vm.evalCode(req.code)
		const drained = output.drain()

		if (evalResult.error) {
			const errVal = vm.dump(evalResult.error)
			evalResult.error.dispose()
			return {
				success: false,
				error: formatVmError(errVal),
				recordedCalls,
				consoleLines: drained.lines,
				truncated: drained.truncated,
			}
		}

		const returnValue = vm.dump(evalResult.value)
		evalResult.value.dispose()
		return {
			success: true,
			recordedCalls,
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

/** Build a full error string for the model (D-11) from a dumped VM error value. */
function formatVmError(errVal: unknown): string {
	if (errVal && typeof errVal === 'object') {
		const e = errVal as { name?: string; message?: string; stack?: string }
		const head = [e.name, e.message].filter(Boolean).join(': ')
		return e.stack ? `${head}\n${e.stack}` : head || JSON.stringify(errVal)
	}
	return String(errVal)
}

// ── Worker message shell ────────────────────────────────────────────────────
// Only registers when running as an actual Worker (self.onmessage exists). In the
// bun test environment this module is imported for `runSandboxCode` directly, so
// guarding avoids touching `self` where it isn't a worker global.
declare const self:
	| {
			onmessage: ((event: MessageEvent<SandboxWorkerRequest>) => void) | null
			postMessage: (message: SandboxWorkerResponse) => void
	  }
	| undefined

if (typeof self !== 'undefined' && self) {
	self.onmessage = async (event: MessageEvent<SandboxWorkerRequest>) => {
		const { id, code, readSnapshot, deadlineMs } = event.data
		try {
			const result = await runSandboxCode({ code, readSnapshot, deadlineMs })
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
