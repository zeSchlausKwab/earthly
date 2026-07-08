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

/**
 * Realm-local accessor for the bundled world reference layers (AI_GEO_AWARENESS
 * §4). NOT part of the postMessage contract — each realm (worker shell, main-
 * thread fallback) builds its own from its own `worldData` cache and hands it
 * to `runSandboxCode` directly. Synchronous by design: the VM eval cannot
 * await, so `get` returns whatever is already cached (the worker prefetches
 * all layers at spawn) or null.
 */
export interface SandboxWorldAccess {
	/** The known layer ids (advertised as `world.layers` inside the VM). */
	layers(): string[]
	/** The resolved FeatureCollection for a layer, or null when not cached. */
	get(id: string): unknown | null
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
	/**
	 * True iff the recorded-call write channel hit its count OR serialized-byte cap
	 * (WR-04 / T-05-06). When set, the host MUST reject the whole batch before replay
	 * — an over-budget batch is a write-path DoS the console cap does not cover.
	 */
	recordedCallsOverBudget?: boolean
	/** The script's final return / expression value, JSON-dumped (D-10). */
	returnValue?: unknown
	/** Full error string on failure (fed to the model for self-correction, D-11). */
	error?: string
}
