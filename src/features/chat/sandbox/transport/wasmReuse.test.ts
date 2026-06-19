/**
 * Regression proofs for the Phase-4 OOM/CPU runaway fix.
 *
 * The runaway had two roots: (1) the worker re-fetched + re-COMPILED the ~503KB
 * QuickJS wasm and allocated a fresh heap on EVERY run (the variant module factory
 * is not memoized), and (2) the host spawned a fresh worker per run with no reuse.
 *
 * The fix memoizes the compiled module inside the worker and reuses one warm worker
 * across runs. The load-bearing INVARIANT that makes module reuse SAFE is that no
 * script state survives between runs — all state lives in the per-run runtime/context
 * that `runSandboxCode` creates and disposes. These tests pin that invariant: many
 * sequential runs through the SAME worker module stay perfectly isolated, so reusing
 * the compiled wasm module cannot leak data, redefine globals, or weaken confinement.
 *
 * (The "fetched exactly once across N runs" half is verified out-of-band with the
 * real browser bundle + a counting wasm server — see the debug session — because
 * `bun test` resolves the wasm from node_modules via the memoized getQuickJS() path,
 * not the http locateFile path the browser worker uses.)
 */

import { describe, expect, it } from 'bun:test'
import { runSandboxCode } from './sandbox.worker'

const run = (code: string) => runSandboxCode({ code, readSnapshot: null, deadlineMs: 3000 })

describe('sandbox module reuse — sequential runs stay isolated (runaway fix)', () => {
	it('a global set in one run does NOT bleed into the next run', async () => {
		const set = await run('globalThis.__bleed = 777; "set"')
		expect(set.success).toBe(true)

		const read = await run('typeof globalThis.__bleed')
		expect(read.success).toBe(true)
		// If the module reuse accidentally shared a runtime/context, this would be "number".
		expect(read.returnValue).toBe('undefined')
	})

	it('forbidden host globals stay undefined across many reused-module runs (CODE-01)', async () => {
		for (let i = 0; i < 5; i++) {
			const r = await run('[typeof fetch, typeof window, typeof XMLHttpRequest].join(",")')
			expect(r.success).toBe(true)
			expect(r.returnValue).toBe('undefined,undefined,undefined')
		}
	})

	it('recordedCalls do not accumulate across runs (fresh capture per run)', async () => {
		const first = await run('authoring.circle([14.5,47.5], 100, { units: "meters" }); "a"')
		expect(first.recordedCalls.length).toBe(1)

		const second = await run('"no authoring here"')
		// A leaked capture buffer would carry the previous run's circle into this one.
		expect(second.recordedCalls.length).toBe(0)
	})

	it('the timeout interrupt still fires on a reused module (CODE-04 not weakened)', async () => {
		const ok = await run('1 + 1')
		expect(ok.success).toBe(true)

		const timed = await run('while (true) {}')
		expect(timed.success).toBe(false)

		// And a normal run after a timeout still works (module not wedged).
		const after = await run('6 * 7')
		expect(after.success).toBe(true)
		expect(after.returnValue).toBe(42)
	})
})
