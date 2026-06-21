/**
 * Transport-AGNOSTIC sandbox host surface — the ONLY thing Waves 2–3 depend on.
 *
 * `runSandbox(code, opts)` is the stable contract. The QuickJS-in-a-Worker
 * transport (transport A, resolved by this spike) is an implementation detail
 * behind it — if the spike's fallback (inlined singlefile variant) or a future
 * transport swap is needed, only `transport/` changes; this surface does not.
 *
 * The result is normalized into {@link SandboxRunResult}: a serializable record
 * of recorded `authoring.*` calls (buffer-then-apply, replayed by Wave 2's
 * runCode.ts through `createAuthoring`), bounded console lines (D-10/D-14), the
 * script's JSON return value (D-10), an error string (full error → model, D-11),
 * and a `timedOut` flag (D-13 retryable timeout). This module imports NOTHING
 * from the editor / signer / wallet — the boundary stays statically provable.
 */

import { runInQuickjsWorker } from './transport/quickjsWorker'
import { runSandboxCode } from './transport/sandbox.worker'
import type { RecordedCall, SandboxWorkerResponse } from './transport/types'

/**
 * Pluggable transport runner (test seam). Defaults to the fresh-spawn QuickJS
 * worker. The proof suite injects the PURE engine (`runSandboxCode`) directly —
 * Bun's test runner can spawn Workers but QuickJS-WASM-inside-a-spawned-Worker
 * segfaults under `bun test` specifically, so the deterministic confinement /
 * surface / timeout proofs drive the identical pure engine (the VM is pure given
 * `{code, deadlineMs}`). Production never uses this override.
 */
export type SandboxTransport = (
	code: string,
	opts: { readSnapshot: unknown; deadlineMs: number },
) => Promise<SandboxWorkerResponse>

/** The in-process pure-engine transport (no Worker spawn). Used by the test suite. */
export const directEngineTransport: SandboxTransport = async (code, opts) => {
	const result = await runSandboxCode({
		code,
		readSnapshot: opts.readSnapshot,
		deadlineMs: opts.deadlineMs,
	})
	return { id: 'direct', ...result }
}

/** Default wall-clock deadline for one run (D-14). */
export const DEFAULT_SANDBOX_DEADLINE_MS = 3000

/** Options for one transport-agnostic sandbox run. */
export interface SandboxRunOptions {
	/** Frozen plain-data read snapshot exposed as the boundary `data` global (D-01). */
	readSnapshot?: unknown
	/** Wall-clock deadline (ms). Defaults to {@link DEFAULT_SANDBOX_DEADLINE_MS}. */
	deadlineMs?: number
	/**
	 * Reserved for an explicit per-run output cap override (D-14). The boundary
	 * already enforces the fixed line/byte caps from `outputCapture.ts`; this is a
	 * forward seam and is currently advisory only.
	 */
	outputCap?: number
	/**
	 * Transport override (test seam only). Defaults to the QuickJS worker. The
	 * proof suite passes {@link directEngineTransport} to drive the pure engine.
	 */
	transport?: SandboxTransport
}

/** Normalized result of a sandbox run — the shape Wave 2 consumes. */
export interface SandboxRunResult {
	/** True iff the script ran to completion without error or timeout. */
	ok: boolean
	/** Ordered `authoring.*` calls recorded during the run (replayed by Wave 2). */
	recordedCalls: RecordedCall[]
	/** Bounded captured console output (D-10/D-14). */
	consoleLines: string[]
	/** True iff console output hit a cap and was truncated. */
	truncated: boolean
	/**
	 * True iff the recorded-call write channel hit its count/byte cap (WR-04). The
	 * caller MUST reject the whole batch before replay — no silent partial apply.
	 */
	recordedCallsOverBudget: boolean
	/** The script's final return / expression value, JSON-dumpable (D-10). */
	returnValue?: unknown
	/** Full error string on failure (fed to the model, D-11); undefined on success. */
	error?: string
	/** True iff the run was killed by the wall-clock deadline (D-13 retryable). */
	timedOut: boolean
}

/** Heuristic: did this failure come from the wall-clock kill (D-13)? */
function isTimeout(error: string | undefined): boolean {
	if (!error) return false
	return /exceeded .*wall-clock|interrupted|deadline/i.test(error)
}

/**
 * Run untrusted `code` in the isolation boundary and return a normalized result.
 * Never throws — every failure (runtime error, timeout, worker load failure) is
 * captured into {@link SandboxRunResult} so the caller's self-correction loop
 * (D-06) can feed it back to the model.
 */
export async function runSandbox(
	code: string,
	options: SandboxRunOptions = {},
): Promise<SandboxRunResult> {
	const deadlineMs = options.deadlineMs ?? DEFAULT_SANDBOX_DEADLINE_MS
	const transport: SandboxTransport = options.transport ?? ((c, o) => runInQuickjsWorker(c, o))

	const raw = await transport(code, {
		readSnapshot: options.readSnapshot ?? null,
		deadlineMs,
	})

	const timedOut = !raw.success && isTimeout(raw.error)
	return {
		ok: raw.success,
		recordedCalls: raw.recordedCalls ?? [],
		consoleLines: raw.consoleLines ?? [],
		truncated: raw.truncated ?? false,
		recordedCallsOverBudget: raw.recordedCallsOverBudget ?? false,
		returnValue: raw.returnValue,
		error: raw.success ? undefined : (raw.error ?? 'Sandbox run failed'),
		timedOut,
	}
}

export type { RecordedCall } from './transport/types'
