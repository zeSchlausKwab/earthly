/**
 * `run_code` — the code-interpreter tool (Wave 2 of Phase 4).
 *
 * This is where Plan 01's proven isolation boundary (`runSandbox`) becomes a real,
 * dispatchable tool. The handler:
 *   1. resolves the active editor and builds the D-01 read snapshot (ingest rows
 *      by handle + current features as frozen plain data — buildReadSnapshot);
 *   2. runs the untrusted code through `runSandbox` (the QuickJS-in-a-Worker
 *      transport from Plan 01), which RECORDS `authoring.*` calls rather than
 *      applying them;
 *   3. on a runtime error OR a wall-clock timeout, THROWS the FULL error so
 *      `registry.dispatch` wraps it into `ToolError(handler_error)` fed back to the
 *      model loop for self-correction (CODE-03 / D-11 / D-13). A per-run attempt
 *      counter (bounded by RUN_CODE_RETRY_CAP, D-06) is attached to the thrown
 *      message so the bounded self-correction is observable; timeouts count against
 *      the cap (D-13);
 *   4. on success, REPLAYS the recorded calls IN ORDER through `createAuthoring(editor)`
 *      so every write flows through `runInterceptors()` for free (D-03 / D-08 — this
 *      phase builds NO safety gate of its own; Phase 5 owns the gate at the
 *      interceptor seam), accumulates the per-call `MutationCounts`, returns D-10 output
 *      shape: `{ ok, counts, consoleLines, truncated, returnValue }`.
 *
 * Importing `run_code` into the registry (an app-graph module) is what finally
 * pulls the QuickJS transport into the build graph so the `.wasm` becomes
 * reachable.
 *
 * Boundary: the REPLAY (`createAuthoring`) happens HERE, on the host main thread —
 * never inside the worker/transport (that would defeat the statically-provable
 * confinement). This module imports the Authoring facade + the ingest read seam +
 * a tool-registry TYPE only; nothing key-holding / payment / relay-client.
 *
 * Circular-import note (mirrors primitives-tools.ts): `register` is INJECTED by
 * `bootstrapRegistry`, not imported from `./registry`. registry.ts imports THIS
 * module for the bootstrap, so importing `register` back at runtime would form a
 * cycle that the dev HMR bundler resolves to a null `./registry` reference,
 * crashing at bootstrap. Only a `type ToolEntry` import remains here (erased at
 * runtime).
 */

import { createAuthoring } from '@/features/geo-editor/api'
import type { MutationCounts } from '@/features/geo-editor/api'
import { useEditorStore } from '@/features/geo-editor/store'
import type { ToolEntry } from '@/features/chat/tools/registry'
import type { Tool } from '@/features/chat/tools/types'
import { buildReadSnapshot } from './readSnapshot'
import { DEFAULT_SANDBOX_DEADLINE_MS, type SandboxTransport, runSandbox } from './sandboxHost'

/**
 * Bounded self-correction cap (D-06, planner discretion = 3). Timeouts count
 * against it (D-13). The COUNTER is local to `run_code` self-correction — the
 * store loop's natural re-prompt-on-`role:'tool'` behaviour does the retrying;
 * the handler does NOT fork the loop (RESEARCH A3 / Open Question 3). The attempt
 * count is attached to each thrown error so the bound is observable to the model.
 */
export const RUN_CODE_RETRY_CAP = 3

/** Output line cap forwarded to the boundary (the boundary enforces the real caps). */
const OUTPUT_CAP = 1000

/**
 * Test-only transport override. Production leaves this `undefined` so `runSandbox`
 * uses the QuickJS worker. The proof suite injects `directEngineTransport` because
 * QuickJS-WASM-inside-a-spawned-Worker segfaults under `bun test` (Plan 01 note).
 */
let testTransport: SandboxTransport | undefined

/** TEST SEAM ONLY: inject (or clear) the sandbox transport. Never called in prod. */
export function setSandboxTransportForTests(transport: SandboxTransport | undefined): void {
	testTransport = transport
}

/**
 * Per-run self-correction attempt counter (D-06). Incremented on every failed
 * `run_code` run, reset to 0 on success. Module-level because each dispatch is a
 * fresh sandbox (D-05) and the model retries by re-calling the tool — the counter
 * is what makes the cap a HARD stop after RUN_CODE_RETRY_CAP failures.
 */
let consecutiveFailures = 0

const runCodeSchema: Tool = {
	type: 'function',
	function: {
		name: 'run_code',
		description:
			'Run JavaScript inside an isolated sandbox to author map geometry programmatically or compute over ingested data. ' +
			'The sandbox exposes exactly: `authoring` (the map-mutation API: addFeature, writeGeoJSON, editorCommand, circle, buffer), ' +
			'`turf` (a curated @turf/turf subset: circle, distance, buffer, area, length, bearing, destination, point, lineString, along, nearestPointOnLine, booleanPointInPolygon, centroid), ' +
			'`data` (read-only: `data.datasets[handleId]` = full ingested rows for handles you pass in `handles`; `data.features` = current map features as GeoJSON), ' +
			"and `console`. There is NO fetch/network/DOM/storage. The script's final expression is returned as the result. " +
			'Drawing happens via `authoring.*` — its calls apply to the map after the run. Keep runs short; there is a wall-clock timeout.',
		parameters: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description:
						'The JavaScript source to run in the sandbox. The final expression is the return value (e.g. a summary string or a computed result object).',
				},
				handles: {
					type: 'array',
					description:
						'Optional ingest dataset handle ids whose FULL rows the script may read via `data.datasets[handleId]` (e.g. routing/CSV input). Omit if the script needs no ingested data.',
					items: { type: 'string' },
				},
			},
			required: ['code'],
		},
	},
}

/** Resolve the active editor, or throw a model-facing error. */
function getEditorOrThrow() {
	const { editor } = useEditorStore.getState()
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}
	return editor
}

function emptyCounts(): MutationCounts {
	return { created: 0, updated: 0, deleted: 0, skippedDuplicates: 0 }
}

function addCounts(acc: MutationCounts, c: MutationCounts): void {
	acc.created += c.created
	acc.updated += c.updated
	acc.deleted += c.deleted
	acc.skippedDuplicates += c.skippedDuplicates
}

/**
 * Register `run_code` (kind:'code-interpreter'). `register` is injected — see the
 * circular-import note in the module doc comment.
 */
export function registerSandboxTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'run_code',
		kind: 'code-interpreter',
		schema: runCodeSchema,
		handler: async (args) => {
			const code = typeof args.code === 'string' ? args.code : ''
			if (!code.trim()) {
				throw new Error('run_code requires a non-empty `code` string.')
			}
			const handles = Array.isArray(args.handles)
				? args.handles.filter((h): h is string => typeof h === 'string')
				: []

			// (1) resolve editor + build the D-01 read snapshot BEFORE the boundary runs.
			const editor = getEditorOrThrow()
			const readSnapshot = buildReadSnapshot(handles, editor)

			// (2) run the untrusted code in the isolation boundary (Plan 01 locked values).
			const result = await runSandbox(code, {
				readSnapshot,
				deadlineMs: DEFAULT_SANDBOX_DEADLINE_MS,
				outputCap: OUTPUT_CAP,
				...(testTransport ? { transport: testTransport } : {}),
			})

			// (3) runtime error OR timeout → throw the FULL error so registry.dispatch
			// wraps it into ToolError(handler_error) for the model (CODE-03 / D-11 / D-13).
			if (!result.ok) {
				consecutiveFailures += 1
				const attempt = consecutiveFailures
				const base = result.timedOut
					? `script exceeded ${DEFAULT_SANDBOX_DEADLINE_MS}ms, terminated`
					: (result.error ?? 'Sandbox run failed')
				const capNote =
					attempt >= RUN_CODE_RETRY_CAP
						? ` (attempt ${attempt}/${RUN_CODE_RETRY_CAP} — retry cap reached, stop and report the failure to the user)`
						: ` (attempt ${attempt}/${RUN_CODE_RETRY_CAP})`
				throw new Error(base + capNote)
			}

			// Success — reset the self-correction counter (D-06).
			consecutiveFailures = 0

			// (4) replay recorded authoring.* calls IN ORDER through the facade (D-03/D-08).
			const authoring = createAuthoring(editor) as unknown as Record<
				string,
				(...a: unknown[]) => { counts?: MutationCounts } | unknown
			>
			const counts = emptyCounts()
			for (const call of result.recordedCalls) {
				const method = authoring[call.op]
				if (typeof method !== 'function') {
					// An unknown op recorded by the boundary should never happen (the worker
					// only exposes the Authoring method names); fail loudly if it does.
					throw new Error(`run_code recorded an unknown authoring op: '${call.op}'`)
				}
				const mutation = method(...call.args) as { counts?: MutationCounts } | undefined
				if (mutation && typeof mutation === 'object' && mutation.counts) {
					addCounts(counts, mutation.counts)
				}
			}

			return {
				ok: true,
				counts,
				consoleLines: result.consoleLines,
				truncated: result.truncated,
				returnValue: result.returnValue,
			}
		},
	})
}
