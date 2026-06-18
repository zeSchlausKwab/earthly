/**
 * Message contract for the QuickJS sandbox worker transport.
 *
 * Only SERIALIZABLE data crosses the worker boundary (RESEARCH trust boundaries):
 * the host posts a code string + a frozen plain-data read snapshot + a deadline;
 * the worker posts back recorded authoring calls + captured console lines + a
 * JSON-dumpable return value. NO live object (editor / signer / wallet / Map)
 * ever crosses — that is what keeps CODE-01 confinement provable.
 */

/** A recorded `authoring.*` call (buffer-then-apply, RESEARCH Pattern 2 A-sync). */
export interface RecordedCall {
	/**
	 * Authoring method name: addFeature | writeGeoJSON | circle | buffer.
	 * `editorCommand` is NOT sandbox-reachable (CR-01) — every replayed op must
	 * route through `runInterceptors()` on the host.
	 */
	op: string
	/** Serializable arguments the host replays through `createAuthoring` in Wave 2. */
	args: unknown[]
}

/** Request posted host → worker to execute one run. */
export interface SandboxWorkerRequest {
	id: string
	/** Untrusted JS source to execute inside the QuickJS context. */
	code: string
	/** Frozen plain-data read snapshot exposed as the boundary `data` global (D-01). */
	readSnapshot: unknown
	/** Wall-clock deadline in ms for the in-VM interrupt handler (CODE-04). */
	deadlineMs: number
}

/** Response posted worker → host after a run (success or failure — never throws out). */
export interface SandboxWorkerResponse {
	id: string
	success: boolean
	/** Ordered `authoring.*` calls recorded during the run (replayed by the host). */
	recordedCalls?: RecordedCall[]
	/** Captured console output (already bounded by createOutputCapture, D-14). */
	consoleLines?: string[]
	/** True iff console output hit a cap and was truncated. */
	truncated?: boolean
	/** The script's final return / expression value, JSON-dumped (D-10). */
	returnValue?: unknown
	/** Full error string on failure (fed to the model for self-correction, D-11). */
	error?: string
}
