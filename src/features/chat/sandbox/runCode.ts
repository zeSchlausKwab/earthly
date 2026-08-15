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
import { buildPostWriteValidation } from '@/features/chat/safeEditing/autoValidate'
import { gateRunCodeBatch } from '@/features/chat/safeEditing/gateRunCode'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'

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
 * Host-side recorded-call ceiling (WR-04 defence-in-depth). The worker already
 * caps the count + serialized bytes and flags `recordedCallsOverBudget`; this is a
 * second, independent guard (mirroring the `REPLAYABLE_AUTHORING_OPS` allow-list)
 * so a foreign/hand-crafted batch that arrives WITHOUT the flag is still rejected
 * before the synchronous replay loop. Kept equal to the worker's `MAX_RECORDED_CALLS`
 * so the two boundaries agree.
 */
const MAX_REPLAY_CALLS = 2000

/**
 * The ONLY authoring ops the host will replay from a sandbox run (CR-01).
 *
 * Two CLASSES of allow-listed op:
 *  - interceptor-gated feature WRITES (addFeature / writeGeoJSON / circle / buffer):
 *    each routes through `runInterceptors()`, so the Phase 5 safe-editing gate at the
 *    interceptor seam catches every sandbox-reachable geometry mutation for free.
 *  - a benign dataset-METADATA op (setDatasetMetadata): it sets only the
 *    FeatureCollection-level name/description/color/customProperties — no geometry,
 *    no secrets — so it is allow-listed WITHOUT an interceptor gate. It is distinct
 *    from the feature-write ops on purpose; do NOT route it through runInterceptors.
 *
 * `editorCommand` is intentionally ABSENT: it is a raw passthrough to
 * `executeEditorCommand` with NO interceptor, so replaying it would let untrusted
 * sandbox code dispatch arbitrary editor commands AROUND the Phase 5 safe-editing
 * gate (D-03/D-08). The worker no longer exposes it (`AUTHORING_METHODS`), and this
 * host-side allow-list is the defence-in-depth guarantee: even a hand-crafted
 * recorded batch naming a NON-allow-listed op is rejected before it can mutate the
 * editor. CR-01 invariant preserved: nothing outside this set replays.
 */
const REPLAYABLE_AUTHORING_OPS = new Set([
	'addFeature',
	'writeGeoJSON',
	'commitDataset',
	'circle',
	'buffer',
	'setDatasetMetadata',
])

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
 * TEST SEAM ONLY: reset the consecutive-failure counter between tests. In production
 * the counter persists across a chat session on purpose (the HARD self-correction
 * cap, D-06) and is reset by a successful run — but the module-level counter would
 * otherwise leak across independent test cases, so the suite clears it per test.
 */
export function resetRunCodeFailureCounterForTests(): void {
	consecutiveFailures = 0
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
			'The sandbox exposes EXACTLY six globals — `authoring` (the map-mutation API: addFeature, writeGeoJSON, commitDataset, circle, buffer, setDatasetMetadata), ' +
			'`turf` (a curated @turf/turf subset: circle, distance, buffer, area, length, bearing, destination, point, lineString, along, nearestPointOnLine, booleanPointInPolygon, centroid, bbox, bboxPolygon, booleanIntersects, cleanCoords, difference, explode, featureCollection, intersect, lineSlice, nearestPoint, polygonToLine, simplify, union), ' +
			'`data` (read-only: `data.datasets[handleId]` = the ARRAY of ingested rows for that handle (only for handles you pass in `handles`); ' +
			'`data.features` = an ARRAY of GeoJSON Features for the current map — iterate it directly, e.g. `data.features.find(...)` / `data.features.map(...)`, NOT `data.features.features` (it is a Feature[], not a FeatureCollection)), ' +
			'`console`, `world` (bundled read-only reference layers: `world.layers` lists ids like land_110m, coastline_110m, countries_110m, borders_110m, rivers_110m, rivers_50m, lakes_110m, cities_110m, land_50m, maritime_network; `world.get(id)` returns that FeatureCollection — REAL anchors, so construct geometry FROM them instead of emitting coordinates from memory. rivers_50m features carry a `name` for ~450 major rivers — for "trace river X": `world.get("rivers_50m").features.filter(f => f.properties.name === "Danube")`. Also three fast HOST-side point helpers — `world.isOnLand([lon,lat])` (1:50m land-mask check), `world.countryAt([lon,lat])` (country name or null), `world.describe([lon,lat])` (→ { onLand, country, nearestCity, coastDistanceKm, text }) — ALWAYS use these instead of hand-rolling point-in-polygon loops over world layers (far faster and no coordinate-order bugs)), ' +
			'and `pathfinder(network, [fromLon,fromLat], [toLon,toLat])` (A* shortest path over any LineString network; `network` is a world layer id like "maritime_network" or an inline FeatureCollection; endpoints auto-snap to the nearest network vertex; returns { path (LineString Feature), lengthKm, from/to snap info }. Prefer the dedicated `route_over_network` host tool over sandbox `pathfinder` for ordinary maritime or line-network routes; use this primitive only when routing is part of a larger atomic code computation) ' +
			'— and NOTHING else. Node/host globals are NOT available: no `fetch`, `Buffer`, `process`, `require`, `XMLHttpRequest`, `localStorage`, `window`, or `document`. ' +
			'RETURN: either end with a bare expression (its value is the result) OR write a top-level `return <value>` — both work. ' +
			'Drawing happens via `authoring.*` — pass a GeoJSON Feature (a bare Geometry is auto-wrapped). ' +
			'`authoring.writeGeoJSON(input, { replace? })` accepts a Feature[], a FeatureCollection object, OR a single Feature; ' +
			'`replace` defaults to false (append). ' +
			'For a complete researched result, prefer ONE `authoring.commitDataset({ featureCollection, metadata?, requireFeatureProvenance? })` call: it validates the whole collection before atomically replacing geometry + metadata. Set requireFeatureProvenance:true when rows came from wikipedia_extract. ' +
			'To set DATASET-level metadata (name/description/arbitrary collection properties), call ' +
			'`authoring.setDatasetMetadata({ name?, description?, color?, properties? })` (or the `set_dataset_metadata` tool outside run_code) — ' +
			'do NOT stamp `dataset_name`/`dataset_description` onto every feature. After a successful run, TRUST the returned `counts` ' +
			'(created/updated/deleted): do NOT re-verify a write with capture_map_snapshot or get_editor_state. There is a ~10s wall-clock budget per run — for heavy sweeps, pre-filter by bbox, use the world.* host helpers, and avoid nested per-vertex × per-polygon turf loops. ALL coordinates everywhere are [lon, lat] — never [lat, lon]. ' +
			'STYLING: to color/style what you draw, pass style keys in the options object (3rd arg): ' +
			'`authoring.circle([lon,lat], radius, { units?, steps?, color?, fillColor?, strokeColor?, fillOpacity?, strokeOpacity?, strokeWidth?, radius?, label?, name?, description? })` ' +
			'(same style keys in the options object on `authoring.buffer(target, distance, { units?, ...style })`). ' +
			'`color` colors fill+stroke; `fillColor`/`strokeColor` override per layer. Opacities are 0..1; widths/radii are positive numbers. For line patterns, `lineDash` accepts only `solid`, `dashed`, or `dotted` — never CSS/array syntax such as `"4,4"` or an empty string. ' +
			'For raw features passed to `authoring.writeGeoJSON` / `authoring.addFeature`, set style in `properties` (e.g. `properties.fillColor`, `properties.strokeColor`, `properties.color`). ' +
			'Unknown style options are REJECTED with an error (so you can correct them) — they are not silently ignored.',
		parameters: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description:
						'The JavaScript source to run in the sandbox. The result is the final bare expression OR a top-level `return <value>` (both supported) — e.g. a summary string or a computed result object.',
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

			// (0) CIRCUIT BREAKER (D-06, runaway fix). The retry "cap" used to only APPEND a
			// "please stop" string to the error — nothing prevented the model from calling
			// run_code again, so a model that ignored it looped, and EACH loop spawned a full
			// QuickJS sandbox (wasm fetch + compile + heap alloc) → the Phase 4 OOM/CPU
			// runaway. Now the cap is enforced HERE, BEFORE the boundary is even constructed:
			// once RUN_CODE_RETRY_CAP consecutive failures are hit, this call is REFUSED
			// without spawning a sandbox. The breaker then RESETS so the model isn't
			// permanently bricked — it gets one explicit halt per burst, capping spawns to at
			// most RUN_CODE_RETRY_CAP per (cap+1) calls. Combined with the warm-pooled worker
			// (the wasm is compiled once for the whole session) and the network round-trip
			// between calls, an unbounded re-spawn/re-fetch storm is impossible.
			if (consecutiveFailures >= RUN_CODE_RETRY_CAP) {
				const halted = consecutiveFailures
				consecutiveFailures = 0
				throw new Error(
					`run_code is halted: ${halted} consecutive failures reached the retry cap ` +
						`(${RUN_CODE_RETRY_CAP}). Stop calling run_code and report the failure to the user; ` +
						`do not retry unless you change approach.`,
				)
			}

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

			// (3b) WR-04: reject an OVER-BUDGET recorded batch BEFORE replaying a single
			// op (T-05-06 / T-05-08). The worker stops appending + flags the response once
			// the recorded-call COUNT or total serialized-arg BYTES exceed the worker caps;
			// replaying that batch synchronously on the host main thread is the write-path
			// DoS the console cap does not cover. Rejecting the WHOLE batch (vs. a partial
			// apply) avoids a silent half-applied dataset. Host-side count re-validation is
			// defence-in-depth (mirrors the REPLAYABLE_AUTHORING_OPS allow-list) in case a
			// foreign/hand-crafted batch arrives without the flag set. Count this against
			// the circuit breaker so a runaway over-budget loop also hits the cap.
			if (result.recordedCallsOverBudget || result.recordedCalls.length > MAX_REPLAY_CALLS) {
				consecutiveFailures += 1
				throw new Error(
					`run_code exceeded the recorded-call write budget (WR-04): a batch of ${result.recordedCalls.length} ` +
						`authoring call(s) is over the cap. The whole batch was rejected before any write — nothing was applied. ` +
						`Author fewer/smaller features per run (e.g. one writeGeoJSON with a FeatureCollection instead of thousands of addFeature calls).`,
				)
			}

			// (4) replay recorded authoring.* calls IN ORDER through the facade (D-03/D-08).
			// Phase 5: the WHOLE batch is ONE safe-editing apply unit (D-11). It is
			// gated through `gateRunCodeBatch` — one snapshot, one diff block, one undo
			// — which awaits Apply/Cancel at Level 1 and rolls the batch back on Cancel
			// (zero net mutation). The replay below is the real, interceptor-routed write
			// the gate fronts.
			const authoring = createAuthoring(editor) as unknown as Record<
				string,
				(...a: unknown[]) => { counts?: MutationCounts } | unknown
			>
			const counts = emptyCounts()
			const replayBatch = () => {
				for (const call of result.recordedCalls) {
					// CR-01: reject any op that does NOT route through runInterceptors() before
					// it can touch the editor. The worker only exposes the four intercepted ops,
					// so this also catches an unknown/hand-crafted op (which would have meant the
					// boundary surface drifted from the host allow-list).
					if (!REPLAYABLE_AUTHORING_OPS.has(call.op)) {
						throw new Error(
							`run_code refused to replay a non-intercepted authoring op: '${call.op}' (CR-01).`,
						)
					}
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
			}

			// Gate the batch (SAFE-03/04/D-11). Skip the gate entirely when the batch
			// wrote nothing (a pure compute/read run) so a read-only run_code is ungated.
			if (result.recordedCalls.length === 0) {
				replayBatch()
				return {
					ok: true,
					counts,
					consoleLines: result.consoleLines,
					truncated: result.truncated,
					returnValue: result.returnValue,
				}
			}

			const gateResult = await gateRunCodeBatch(
				editor,
				{
					getSafetyLevel,
					label: 'AI run_code edit',
				},
				replayBatch,
			)

			// Cancel rolled the batch back (zero net mutation) — report empty counts so
			// the model does not believe a write landed.
			if (gateResult.status === 'cancelled') {
				return {
					ok: true,
					counts: emptyCounts(),
					consoleLines: result.consoleLines,
					truncated: result.truncated,
					returnValue: result.returnValue,
				}
			}

			// AI_GEO_AWARENESS §1: auto-append advisory topology + land/water findings
			// over exactly the features this batch touched (added + modified-after),
			// so the model self-corrects in the next round without prompting.
			const written = [
				...gateResult.diff.added,
				...gateResult.diff.modified.map((change) => change.after),
			]
			return {
				ok: true,
				counts,
				consoleLines: result.consoleLines,
				truncated: result.truncated,
				returnValue: result.returnValue,
				...(written.length > 0 ? { validation: await buildPostWriteValidation(written) } : {}),
			}
		},
	})
}
