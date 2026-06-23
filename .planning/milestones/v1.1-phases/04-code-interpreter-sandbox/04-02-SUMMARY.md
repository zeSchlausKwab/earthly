---
phase: 04-code-interpreter-sandbox
plan: 02
subsystem: chat-sandbox
tags: [run_code, code-interpreter, quickjs, sandbox, authoring-replay, read-snapshot, headless-editor]

# Dependency graph
requires:
  - phase: 04-code-interpreter-sandbox
    plan: 01
    provides: "runSandbox() transport-agnostic host surface + SandboxRunResult { ok, recordedCalls, consoleLines, returnValue, error, timedOut } + directEngineTransport test seam"
  - phase: 02-tool-registry-authoring-api
    provides: "createAuthoring(editor) -> runInterceptors() sole mutation facade; typed registry (register/dispatch) + ToolError(handler_error) contract; MutationCounts"
  - phase: 03-file-ingest-multimodal
    provides: "getDataset(handle).fullRows (sandbox-only accessor) + toModelSummary (model path); the D-11 privacy seam"
provides:
  - "run_code tool registered with mandatory kind:'code-interpreter', dispatchable through registry.dispatch like every other tool"
  - "buildReadSnapshot(handleIds, editor): D-01 frozen structuredClone view { datasets (rows by handle), features (plain GeoJSON) } — fail-closed on a non-clonable leak"
  - "run_code result shape Plan 03 renders: { ok, counts: MutationCounts, consoleLines, truncated, returnValue }"
  - "runSandbox reachable from the app graph (registry -> runCode -> sandboxHost -> quickjs transport) so the QuickJS .wasm bundles"
  - "Both headline scripts proven end-to-end vs a headless editor: fibonacci-15-circles (CODE-05) + Austria->Bosnia cost-weighted overfly (CODE-06)"
affects: [04-03, "code-interpreter", "run_code", "sandbox", "ChatPanel-render"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Host-side replay seam: the worker RECORDS {op,args}; runCode.ts replays them on the MAIN thread through createAuthoring(editor) -> runInterceptors() (D-03/D-08, no Phase-4 gate)"
    - "Two-tier sandbox import scan: tier A (secret reach) covers ALL sandbox files; tier B (createAuthoring + geo-editor/store) covers worker/transport ONLY — the host replay seam is exempt"
    - "Module-level test transport seam (setSandboxTransportForTests) so the handler runs the pure QuickJS engine under bun test (Worker-spawn segfault workaround from Plan 01)"
    - "Bounded self-correction via a module-level consecutiveFailures counter capped at RUN_CODE_RETRY_CAP=3; timeouts count against it (D-06/D-13); the cap note is attached to the thrown error so the bound is observable to the model"

key-files:
  created:
    - "src/features/chat/sandbox/readSnapshot.ts"
    - "src/features/chat/sandbox/readSnapshot.test.ts"
    - "src/features/chat/sandbox/runCode.ts"
    - "src/features/chat/sandbox/runCode.test.ts"
  modified:
    - "src/features/chat/tools/registry.ts"
    - "src/features/chat/sandbox/sandboxHost.test.ts"

key-decisions:
  - "RUN_CODE_RETRY_CAP = 3 (D-06 discretion). Implemented as a module-level consecutiveFailures counter reset on success; the cap is a counter LOCAL to run_code self-correction, NOT a store-loop change (RESEARCH A3/Open Question 3). Timeouts increment it (D-13)."
  - "run_code result shape (D-10) Plan 03 renders: { ok:true, counts: MutationCounts, consoleLines: string[], truncated: boolean, returnValue: unknown }. On failure the handler THROWS the full error -> registry.dispatch wraps ToolError(handler_error)."
  - "Editor injection for the headless headline tests: useEditorStore.setState({ editor: createHeadlessEditor() }) (the handler resolves the editor via useEditorStore.getState(), same idiom as primitives-tools), plus setSandboxTransportForTests(directEngineTransport) so the pure QuickJS engine runs in-process under bun test."
  - "Plan 01's single-tier import-boundary scan was refined into two tiers because Wave 2's host replay legitimately imports createAuthoring + the editor store; over-scoping would have made the scan break the moment run_code landed."

patterns-established:
  - "run_code handler: resolve editor -> buildReadSnapshot(handles, editor) -> runSandbox -> (error/timeout) throw full error / (success) replay recordedCalls through createAuthoring, accumulate MutationCounts, return the D-10 shape."

requirements-completed: [CODE-01, CODE-02, CODE-03, CODE-05, CODE-06]

# Metrics
duration: ~8min
completed: 2026-06-18
---

# Phase 4 Plan 02: run_code Tool — Wiring the Isolation Boundary Summary

**Plan 01's `runSandbox()` is now a real `run_code` tool: it builds a D-01 frozen read snapshot (ingest rows by handle + current features), runs untrusted JS in the QuickJS boundary, replays recorded `authoring.*` calls on the host through `createAuthoring` -> `runInterceptors()` (no Phase-4 gate), feeds runtime/timeout errors back to the model as `ToolError`, and proves both headline scripts (fibonacci-15-circles CODE-05, Austria->Bosnia cost-weighted overfly CODE-06) end-to-end against a headless editor.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-18T08:19:43Z
- **Tasks:** 3 of 3 complete (all TDD)
- **Files:** 4 created (readSnapshot.ts/.test, runCode.ts/.test), 2 modified (registry.ts, sandboxHost.test.ts)

## Accomplishments

- **`run_code` is a registered, dispatchable tool** with mandatory `kind:'code-interpreter'` (added to the `ToolKind` union) and a schema of `code: string` (required) + `handles: string[]` (optional). It dispatches through `registry.dispatch` like every other tool.
- **D-01 read snapshot** (`buildReadSnapshot`): full ingest rows by handle via `getDataset` (NOT the model-summary path — the Phase 3 D-11 privacy seam is preserved, T-04-10) + current editor features stripped to plain GeoJSON, all run through `structuredClone` so the boundary copy is independent (T-04-08) and a non-clonable leak fails closed (Pitfall 5).
- **Host-side replay through the facade**: on success the handler replays the worker's recorded `{op,args}` calls in order through `createAuthoring(editor)`, so every write flows through `runInterceptors()` for free (D-03/D-08). No Phase-4 confirm/preview/diff gate was built — Phase 5 owns it at the interceptor seam.
- **Error feedback + bounded self-correction**: runtime errors and wall-clock timeouts both make the handler throw the full error -> `registry.dispatch` wraps `ToolError(handler_error)` fed to the model (CODE-03/D-11/D-13). `RUN_CODE_RETRY_CAP = 3`; a module-level `consecutiveFailures` counter (reset on success, incremented on timeout too) attaches an `attempt N/3` note to the thrown message so the cap is observable.
- **Both headline scripts pass** deterministic `bun test` proofs against `createHeadlessEditor()`: fibonacci-15-circles -> `counts.created === 15` and 15 real features (CODE-05); Austria->Bosnia -> reads the seeded overfly-fee rows by handle, returns the chosen route + per-variant costs, draws exactly one feature (CODE-06).
- **`runSandbox` is reachable from the app graph** (registry -> runCode -> sandboxHost -> quickjs transport -> `quickjs-emscripten`), so the QuickJS `.wasm` is now pulled into the build. `bun run build` succeeds.

## Task Commits

1. **Task 1: D-01 read snapshot** — `5160454` (test) -> `7ad6b9f` (feat)
2. **Task 2: run_code handler + replay + registry wire-in** — `f3bd113` (test, also carries Task 3 proofs) -> `7bdb292` (feat)
3. **Task 3: headline-script proofs** — proofs live in the same `runCode.test.ts` (committed RED at `f3bd113`, made green by `7bdb292`); the import-boundary scan refinement that Task 3 surfaced is `5cf28c8` (test).

## Files Created/Modified

- `src/features/chat/sandbox/readSnapshot.ts` — `buildReadSnapshot(handleIds, editor): ReadSnapshot` (`{ datasets, features }`); `getDataset(h)?.fullRows ?? null` per handle + `getAllFeatures().map(toPlainGeoJSON)`; `structuredClone` fail-closed.
- `src/features/chat/sandbox/runCode.ts` — `registerSandboxTools(register)`, `RUN_CODE_RETRY_CAP`, `setSandboxTransportForTests` (test seam). The `run_code` handler + inline OpenAI schema.
- `src/features/chat/sandbox/{readSnapshot,runCode}.test.ts` — the D-01 unit proofs + the error-feedback / fibonacci / overfly / privacy-regression integration proofs.
- `src/features/chat/tools/registry.ts` — `'code-interpreter'` added to `ToolKind`; `registerSandboxTools(register)` wired into `bootstrapRegistry` (the import that pulls the QuickJS transport into the app graph).
- `src/features/chat/sandbox/sandboxHost.test.ts` — import-boundary scan split into tier A (secret reach, all files) + tier B (createAuthoring/store, worker/transport only).

## Decisions Made

- **run_code result shape (D-10) for Plan 03:** `{ ok:true, counts: MutationCounts, consoleLines: string[], truncated: boolean, returnValue: unknown }`. Failures/timeouts are NOT a result object — the handler throws and `registry.dispatch` produces a `ToolError(handler_error)` (the concise user one-liner is the existing ChatPanel ToolError render, Plan 03; no second error channel built).
- **Retry cap = 3 (D-06)**, a module-level `consecutiveFailures` counter local to `run_code` (NOT a `store.ts` loop change, per RESEARCH A3). Timeouts increment it (D-13); the `attempt N/3` note rides on the thrown error.
- **Editor injection for headless tests:** `useEditorStore.setState({ editor: createHeadlessEditor() })` (mirrors how the handler resolves the editor) + `setSandboxTransportForTests(directEngineTransport)` to drive the pure QuickJS engine in-process (Plan 01 documented that QuickJS-WASM-in-a-spawned-Worker segfaults under `bun test`; production uses the real fresh-spawn Worker).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan 01's single-tier sandbox import scan broke when Wave 2 landed**
- **Found during:** Task 3 (running the full `src/features/chat/sandbox/` suite).
- **Issue:** Plan 01's `sandboxHost.test.ts` import-boundary scan forbade `createAuthoring` and `geo-editor/store` across ALL sandbox source files. Wave 2's `runCode.ts` legitimately imports both (the host-side replay on the main thread — the entire point of D-03/D-08), so the scan failed the moment `runCode.ts` was added.
- **Fix:** Split the scan into two tiers — tier A (secret reach: signer/wallet/Nostr/NDK/applesauce/MCP) still covers EVERY sandbox file including the new ones (T-04-12 intact); tier B (`createAuthoring` + `geo-editor/store`) covers the worker/transport/pure-engine files ONLY, exempting the `runCode.ts`/`readSnapshot.ts` host replay seam. T-04-09 (worker cannot apply writes itself) stays statically provable.
- **Files modified:** `src/features/chat/sandbox/sandboxHost.test.ts`
- **Commit:** `5cf28c8`

## Issues Encountered

- The full-suite `bun test` intermittently reported a single failure in `src/features/chat/tools/mcp-sync.test.ts` (`listTools timed out` — a network-dependent test). Re-running twice gave 290 pass / 0 fail consistently; the flake is pre-existing and unrelated to this plan.

## Deferred / Out-of-scope

- **Prod `.wasm` browser smoke (Wave-1 deferred criterion c):** This plan's job was to make `runSandbox` reachable from the app graph (done — the registry import chain pulls `quickjs-emscripten` in) and confirm `bun run build` succeeds (done). Per the plan and the Wave-1 carry-forward, the orchestrator runs the production browser smoke (`bun run build:production` + confirm the `*.wasm` returns 200 and `runSandbox("typeof fetch") === 'undefined'`). If that 404s, the documented fallback is the human-gated `@jitl/quickjs-singlefile-mjs-release-sync` inlined variant.
- **Repo-wide `bun run lint`** reports ~114 pre-existing Biome errors (e.g. `registry.ts` OSM-handler formatting that predates this plan, confirmed by linting the HEAD version). All FOUR files this plan created/edited are Biome-clean. The pre-existing backlog is out of scope (logged to `deferred-items.md`).

## Requirements

- **CODE-01** — confinement + the prod-serving facet: the read snapshot is a frozen fail-closed view; the worker stays secret-free (tier A scan). Prod `.wasm` serving is the orchestrator smoke (carry-forward from Wave 1).
- **CODE-02** — the sandbox surface stays exactly `authoring`/`turf`/`data`/`console` (Plan 01 proof still green); `run_code` replays only `authoring.*` through the facade.
- **CODE-03** — code runs; runtime errors AND timeouts feed the model the full error via `ToolError(handler_error)`; self-correction bounded at 3 (D-06/D-13). (Collapsible block render is Plan 03.)
- **CODE-05** — fibonacci-15-circles: `counts.created === 15`, 15 real features in the headless editor.
- **CODE-06 `[C]`** — Austria->Bosnia: reads handle rows, returns chosen route + costs, draws one feature; privacy seam intact.

## Threat Flags

None — no new security surface beyond the threat model. The handler adds no network/auth/file-access path; the read snapshot is the only new data path and it is `structuredClone`-frozen + summary-seam-preserving.

## Self-Check: PASSED

- `src/features/chat/sandbox/readSnapshot.ts` — FOUND
- `src/features/chat/sandbox/readSnapshot.test.ts` — FOUND
- `src/features/chat/sandbox/runCode.ts` — FOUND
- `src/features/chat/sandbox/runCode.test.ts` — FOUND
- Commits `5160454`, `7ad6b9f`, `f3bd113`, `7bdb292`, `5cf28c8` — all in git history.
- `bun test src/features/chat/sandbox/` -> 46 pass / 0 fail; `bun test` (full) -> 290 pass / 0 fail; `bun run build` -> success.

---
*Phase: 04-code-interpreter-sandbox*
*Completed: 2026-06-18*
