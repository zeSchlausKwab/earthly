---
phase: 04-code-interpreter-sandbox
plan: 01
subsystem: infra
tags: [quickjs-emscripten, web-worker, sandbox, isolation, turf, wasm, code-interpreter]

# Dependency graph
requires:
  - phase: 02-tool-registry-authoring-api
    provides: "MAX_DISTANCE_METERS DoS cap + createAuthoring surface keys (mirrored by the recording authoring shim)"
  - phase: 03-file-ingest-multimodal
    provides: "the in-repo Worker spawn pattern (ingestClient/ingest.worker) mirrored verbatim for the sandbox worker"
provides:
  - "Transport-agnostic runSandbox() host surface (the ONLY symbol Waves 2-3 depend on) returning SandboxRunResult { ok, recordedCalls, consoleLines, returnValue, error, timedOut }"
  - "QuickJS-in-Worker transport: fresh-spawn-per-run worker + in-VM deadline interrupt + host-side terminate watchdog"
  - "Curated turf subset (frozen) + bounded console capture (256KiB / 1000 lines) importable into the worker boundary"
  - "Locked isolation transport decision: quickjs-emscripten all-in-one .wasm-asset variant (singlefile fallback NOT used)"
  - "bun-test confinement (CODE-01 a) + surface enumeration (CODE-02) + timeout-kill (CODE-04 b) + output-cap + import-boundary proofs"
affects: [04-02, 04-03, "code-interpreter", "run_code", "sandbox"]

# Tech tracking
tech-stack:
  added: ["quickjs-emscripten@^0.32.0"]
  patterns:
    - "Fresh-spawn-per-run Web Worker (no module singleton) for cross-run state isolation (D-05/Pitfall 6)"
    - "Defence-in-depth timeout: in-VM shouldInterruptAfterDeadline + host-side setTimeout->worker.terminate() watchdog (Pitfall 3)"
    - "Buffer-then-apply RPC: the worker RECORDS {op,args} authoring calls and returns serializable records; replay through createAuthoring happens in Wave 2 (keeps the worker free of any editor/signer/wallet import)"
    - "Injectable transport seam on runSandbox() so the pure worker handler is bun-test-able without spawning a browser Worker"

key-files:
  created:
    - "src/features/chat/sandbox/curatedTurf.ts"
    - "src/features/chat/sandbox/outputCapture.ts"
    - "src/features/chat/sandbox/sandboxHost.ts"
    - "src/features/chat/sandbox/transport/quickjsWorker.ts"
    - "src/features/chat/sandbox/transport/sandbox.worker.ts"
    - "src/features/chat/sandbox/transport/types.ts"
    - "src/features/chat/sandbox/curatedTurf.test.ts"
    - "src/features/chat/sandbox/outputCapture.test.ts"
    - "src/features/chat/sandbox/sandboxHost.test.ts"
  modified:
    - "package.json"

key-decisions:
  - "LOCKED transport variant: quickjs-emscripten all-in-one default (.wasm-asset path). The SUS singlefile fallback (@jitl/quickjs-singlefile-mjs-release-sync) was NOT installed; it is reserved for a separate human-action gate only if Wave 2's prod smoke 404s the .wasm."
  - "Spike criteria (a) confinement + (b) timeout-kill + CODE-02 surface proven automatically under bun test; criterion (c) prod .wasm-serving DEFERRED to Wave 2 per explicit human decision (the transport is not yet imported by any app-graph module, so no .wasm bundles today)."
  - "deadlineMs default = 3000; memory limit = 64MB (setMemoryLimit) + 512KB stack (setMaxStackSize); output caps = 1000 lines / 256KiB with a '…(output truncated)' marker."
  - "The worker only RECORDS authoring calls ({op,args}); replay through createAuthoring is Wave 2's job — this keeps the confinement boundary statically provable (no createAuthoring/signer/wallet import in worker/transport)."

patterns-established:
  - "runSandbox(code, { readSnapshot, deadlineMs, outputCap }) is the transport-agnostic contract Waves 2-3 consume; the QuickJS worker is an implementation detail behind it."
  - "SandboxRunResult.timedOut is derived (retryable) so the Wave 2 self-correction loop can distinguish a wall-clock kill from a thrown error."

requirements-completed: [CODE-02]

# Metrics
duration: ~10min
completed: 2026-06-18
---

# Phase 4 Plan 01: Isolation Spike Summary

**QuickJS-WASM-in-a-Worker isolation boundary locked: a transport-agnostic `runSandbox()` proving confinement, surface enumeration, and timeout-kill under `bun test` — with the prod `.wasm`-serving smoke (criterion c) deferred to Wave 2 per human decision.**

## Performance

- **Duration:** ~10 min (initial execution) + close-out continuation
- **Started:** 2026-06-18T10:00:11Z
- **Completed:** 2026-06-18 (close-out)
- **Tasks:** 4 of 5 complete; Task 5 (criterion c) deferred to Wave 2
- **Files modified:** 10 (9 created under `src/features/chat/sandbox/`, `package.json` modified)

## Accomplishments

- Resolved the roadmap-mandated open design decision: **QuickJS-WASM-inside-a-Worker** is the chosen isolation transport (vs. cross-origin-iframe+CSP), built and proven before any tool is wired.
- Locked the `runSandbox()` transport-agnostic host surface — the only thing Waves 2-3 depend on — returning `SandboxRunResult { ok, recordedCalls, consoleLines, returnValue, error, timedOut }`.
- Proved automatically (28/28 tests green): confinement (CODE-01 a — `fetch`/`localStorage`/`document`/`window`/`XMLHttpRequest`/`signer`/`wallet` all `undefined`), injected surface = exactly `authoring`/`turf`/`data`/`console` plus JS built-ins (CODE-02), timeout-kill of `while(true){}` → `timedOut:true` without freezing (CODE-04 b), 1000-line/256KiB output cap, and a static import-boundary scan finding no signer/wallet/Nostr/NDK/applesauce/createAuthoring import.
- Installed `quickjs-emscripten@^0.32.0` (legitimacy-gated, no postinstall) and locked the all-in-one `.wasm`-asset variant; the SUS singlefile fallback was NOT installed.

## Task Commits

1. **Task 1: Package legitimacy gate + install quickjs-emscripten** - `d99d289` (chore)
2. **Task 2: Curated turf subset + bounded output capture (D-02/D-14)** - `23f1a96` (test) → `8410826` (feat)
3. **Task 3: QuickJS worker + transport-agnostic host surface** - `fb6bb09` (feat)
4. **Task 4: Confinement/surface/timeout/output-cap/import-boundary proofs** - `e1226dc` (feat — injectable transport seam) → `18fd5bc` (test — the proofs)
5. **Task 5: Prod `.wasm`-serving smoke (criterion c)** - **DEFERRED to Wave 2 (04-02) per human decision** — no commit (no code change).

**Plan metadata:** (this docs commit)

_Note: TDD tasks 2 and 4 carry test→feat / seam→proofs commit pairs._

## Files Created/Modified

- `src/features/chat/sandbox/curatedTurf.ts` - Frozen curated `@turf/turf` subset (D-02); re-exports `MAX_DISTANCE_METERS` from the geo-editor API rather than redefining it.
- `src/features/chat/sandbox/outputCapture.ts` - `createOutputCapture()` + `OUTPUT_LINE_CAP=1000` / `OUTPUT_BYTE_CAP=256*1024` byte+line cap with `…(output truncated)` marker (D-14/Pitfall 4).
- `src/features/chat/sandbox/sandboxHost.ts` - Transport-agnostic `runSandbox()`; normalizes the worker response into `SandboxRunResult`; carries an injectable transport seam for headless tests. Imports nothing from editor/signer/wallet.
- `src/features/chat/sandbox/transport/sandbox.worker.ts` - Greenfield QuickJS engine: empty-global context, `setInterruptHandler(shouldInterruptAfterDeadline)`, `setMemoryLimit(64MB)`, `setMaxStackSize(512KB)`, injects exactly `authoring`(recording)/`turf`/`data`/`console`, disposes handles in `finally`.
- `src/features/chat/sandbox/transport/quickjsWorker.ts` - `runInQuickjsWorker()`: fresh-spawn-per-run via `new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })`, host-side `setTimeout → worker.terminate()` watchdog, `terminate()` in `finally`.
- `src/features/chat/sandbox/transport/types.ts` - `RecordedCall`, `SandboxWorkerResponse` shared types.
- `src/features/chat/sandbox/{curatedTurf,outputCapture,sandboxHost}.test.ts` - The bun-test proof suites (28 tests).
- `package.json` - Added `quickjs-emscripten@^0.32.0`.

## Decisions Made

- **Transport LOCKED = quickjs-emscripten all-in-one (`.wasm`-asset) default.** The `@jitl/quickjs-singlefile-mjs-release-sync` inlined fallback (SUS, 576 dl/wk) was NOT installed. It remains reserved for a separate human-action approval gate, to be invoked ONLY if Wave 2's prod smoke 404s the QuickJS `.wasm`.
- **`deadlineMs` default 3000 / memory 64MB / stack 512KB / output 1000 lines / 256KiB** — concrete planner-discretion values.
- **Worker RECORDS authoring calls, does not apply them.** Replay through `createAuthoring`→interceptors is Wave 2 (`runCode.ts`), keeping the worker free of any editor/signer/wallet import so confinement stays statically provable.

## Deviations from Plan

None - plan executed as written through Task 4. Task 5 is an **accepted deferral** (see below), not a deviation or a skipped blocker.

## Issues Encountered

None during planned work. Task 5 (the prod `.wasm`-serving smoke, spike criterion c) reached a `checkpoint:human-verify` and the human elected to defer it — see Deferred Criterion below.

## Deferred Criterion — (c) Prod `.wasm` Serving (Wave-2-verified)

**Status: DEFERRED to Wave 2 (04-02) — per explicit human decision. OUTSTANDING-BUT-TRACKED, NOT passed.**

Spike criterion (c) — the QuickJS `.wasm` asset emitting under `bun run build:production` AND serving (HTTP 200, not 404) under the production `Bun.serve()` static handler (RESEARCH Pitfall 1 / Open Question 1) — **cannot be exercised yet**: the sandbox transport is not imported by any app-graph module today, so a prod build bundles no `.wasm`. The human explicitly chose to fold this smoke into Wave 2's build/post-merge gate, once `run_code` → `runSandbox` is wired.

**Wave 2 MUST run `bun run build:production` + a browser smoke confirming the QuickJS `*.wasm` returns 200 and `runSandbox("typeof fetch")` returns `'undefined'`.** If that smoke 404s the `.wasm`, take the documented fallback: get explicit human approval to install the SUS `@jitl/quickjs-singlefile-mjs-release-sync` (inlined, no separate asset), re-point the worker's QuickJS variant import, and re-confirm `bun test src/features/chat/sandbox/` green with the inlined variant.

This deferral is visible to both the Wave 2 executor (04-02-PLAN.md owns the prod smoke) and the phase verifier (treat criterion c as Wave-2-verified, not satisfied here).

## Requirements

- **CODE-02** — fully proven this plan (sandboxed code reaches exactly the curated `authoring`/`turf`/`data`/`console` surface and nothing else on the host).
- **CODE-01** — confinement facet (no `fetch`/DOM/`localStorage`/signer/wallet reachable) proven automatically; its **prod-serving facet is Wave-2-verified** (criterion c deferred). Left Pending in traceability until Wave 2 closes the prod smoke + the `run_code` wiring lands.
- **CODE-04** — timeout-kill + output-cap engine proven automatically; left Pending until Wave 2 wires it into the `run_code` tool loop.

## Next Phase Readiness

- `runSandbox()` contract + result shape are stable and ready for Wave 2 (`run_code` handler replaying `recordedCalls` through `createAuthoring`).
- **Carry-forward gate for Wave 2:** the prod `.wasm`-serving smoke (criterion c) + singlefile-fallback contingency.
- Boundary stays provable only as long as Wave 2 keeps the replay (`createAuthoring`) in the HOST, never importing it into the worker/transport files.

## Self-Check: PASSED

All 5 created source files verified present on disk; all 6 task commits (`d99d289`, `23f1a96`, `8410826`, `fb6bb09`, `e1226dc`, `18fd5bc`) verified in git history. `bun test src/features/chat/sandbox/` → 28 pass / 0 fail.

---
*Phase: 04-code-interpreter-sandbox*
*Completed: 2026-06-18 (Task 5 / criterion c deferred to Wave 2)*
