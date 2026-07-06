---
phase: 04-code-interpreter-sandbox
verified: 2026-06-18T09:50:00Z
status: passed
score: 4/4 automatable must-haves verified; 5/5 human UAT items passed (04-UAT.md, 2026-06-19)
overrides_applied: 0
human_verification:
  - test: "Live fibonacci demo (CODE-05)"
    expected: "Prompt 'draw 15 circles with increasing fibonacci radii around this point'. The AI autonomously emits a run_code call (no confirm — D-04), 15 circles appear on the map, the transcript shows a COLLAPSED 'Ran code → 15 features created' block (D-09). Expand it — read-only source, console output, return value visible (D-10/D-12)."
    why_human: "Requires a configured LLM provider, live map editor, and human observation of autonomous tool dispatch + map rendering."
  - test: "Live overfly demo (CODE-06)"
    expected: "Ingest a small overfly-fees CSV dataset, then prompt the Austria→Bosnia cost-weighted flight-path request. The AI reads the data by handle, runs the computation in the sandbox, draws the chosen path, and the collapsed block's return value shows the chosen route + per-variant costs."
    why_human: "Requires live ingest, configured LLM, and observation of data-driven sandbox computation + map write."
  - test: "Live self-correction (CODE-03 D-06/D-07/D-11)"
    expected: "Prompt something that makes the AI write throwing code. The user sees a CONCISE one-line red ToolError bubble (no giant stack — D-11). The AI self-corrects within ~3 attempts (D-06). Each retry is its own separate collapsed block (D-07)."
    why_human: "Requires a configured LLM, inducing a natural error, and observing the iterative retry behavior in the live transcript."
  - test: "Live no-freeze (CODE-04)"
    expected: "The UI stays responsive throughout all runs, including any runaway that triggers the timeout. No browser hang observed."
    why_human: "Requires live app execution and human responsiveness observation across multiple runs including timeout scenarios."
  - test: "Read-only affordance (D-12)"
    expected: "In the expanded code block there is NO edit field, textarea, or 'Run'/'Rerun'/'Edit' button visible. The code is shown for transparency only."
    why_human: "Requires visual inspection of the rendered UI in the running app."
---

# Phase 4: Code Interpreter Sandbox Verification Report

**Phase Goal:** The AI can write and run JavaScript that drives the map programmatically through the Authoring API, inside an isolation boundary that provably denies access to secrets and cannot freeze the app.
**Verified:** 2026-06-18T09:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All four success criteria have automatable facets that are fully verified. The five live UAT items (fibonacci demo, overfly demo, self-correction, no-freeze, read-only UI) were explicitly deferred to /gsd-verify-work 4 by human decision per 04-03-SUMMARY.md. Only those items remain.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Untrusted JS cannot reach fetch, DOM, localStorage, Nostr signer, or wallet | VERIFIED | sandboxHost.test.ts: 7 confinement tests pass; each forbidden global returns `'undefined'`; bare reference throws ReferenceError. Static import scan (tier A) passes across all 7 sandbox source files. `editorCommand` removed from AUTHORING_METHODS (CR-01 fix, commit 59ceac3); REPLAYABLE_AUTHORING_OPS allow-list in runCode.ts rejects forged ops. Test: CR-01 "refuses to replay non-intercepted op" passes. |
| 2 | Only authoring/turf/data/console globals are injected; no host name leaks | VERIFIED | sandboxHost.test.ts surface test: `Object.keys(globalThis)` inside the VM contains exactly `['authoring','console','data','turf']` injected names + JS built-ins, `forbiddenPresent: []`. `authoring` exposes exactly `addFeature,buffer,circle,writeGeoJSON` (CR-01 test). curatedTurf exports exactly the 13-function RESEARCH-verified set as a frozen object. |
| 3 | A runaway script is terminated without freezing the host; output flooding is capped | VERIFIED | sandboxHost.test.ts timeout test: `while(true){}` with deadlineMs=200 settles in <3s with `timedOut:true`. quickjsWorker.ts has both `shouldInterruptAfterDeadline` (in-VM) and `setTimeout(→worker.terminate(), deadlineMs+500ms)` host watchdog. Output cap: 1000 lines / 256KiB enforced by `createOutputCapture`; flooding test confirms truncation marker. WR-01 DoS distance cap enforced before turf: `assertSandboxDistanceWithinCap` called in worker's turf wrapper (commit 488cd96). |
| 4 | run_code is a registered dispatchable tool with kind:'code-interpreter' | VERIFIED | registry.ts line 66: `'code-interpreter'` in ToolKind union. Line 1013: `registerSandboxTools(register)` called in bootstrapRegistry. runCode.ts: `kind: 'code-interpreter'` in registration. bun test confirms dispatch roundtrip. |
| 5 | Recorded authoring.* calls replay through createAuthoring → runInterceptors(), never bypassing the facade | VERIFIED | runCode.ts lines 72, 194-218: `REPLAYABLE_AUTHORING_OPS = new Set(['addFeature','writeGeoJSON','circle','buffer'])`, replay via `createAuthoring(editor)`. sandbox.worker.ts `AUTHORING_METHODS` matches exactly. CR-01 test in runCode.test.ts proves forged `editorCommand` op is rejected with CR-01 error and editor untouched. |
| 6 | The fibonacci-15-circles script produces counts.created===15 and 15 real editor features | VERIFIED | runCode.test.ts "fibonacci" test: `counts.created === 15`, `editor.getAllFeatures().length === 15`, returnValue contains '15 circles'. bun test: 6 pass / 0 fail. |
| 7 | The Austria→Bosnia overfly script reads handle rows, returns chosen route + costs, draws exactly 1 feature | VERIFIED | runCode.test.ts "overfly" test: seeds fees dataset, passes handle, asserts `counts.created === 1`, `editor.getAllFeatures().length === 1`, `returnValue.chosen === 'direct'` (proves handle rows reached sandbox), `variants.viaSLO > variants.direct`. Privacy regression: `toModelSummary(handle)` has no `fullRows`. |
| 8 | Runtime error and timeout are fed to the model as ToolError(handler_error) for self-correction | VERIFIED | runCode.test.ts: throwing script → `isToolError(result)===true`, `kind==='handler_error'`, message contains 'boom'. Timeout script → ToolError, message matches `/exceed|terminat|deadline|interrupt/`. RUN_CODE_RETRY_CAP=3, attempt N/3 note attached. |
| 9 | Generated code and output render as a collapsed-by-default read-only block | VERIFIED | CodeRunDisclosure.tsx: `useState(false)` open toggle, ▸/▾ button, summary from `counts`. Expanded: read-only `<pre>/<code>` source, consoleLines, authoring counts, JSON return value. No textarea/contentEditable/Rerun/onRun. CodeRunDisclosure.test.tsx 8 tests pass: collapsed, expanded, read-only, truncated. CodeRunDisclosure wired in ChatPanel: lines 1521-1538. |
| 10 | The QuickJS .wasm asset emits under bun run build and is served with application/wasm | VERIFIED | build.ts lines 218-251: copies `emscripten-module.wasm` from `@jitl/quickjs-wasmfile-release-sync/dist/` to `dist/`. Build output confirms: "Copying QuickJS WASM asset to dist/emscripten-module.wasm". `dist/emscripten-module.wasm` exists. src/index.ts: prod `serveBuiltFile` sets `Content-Type: application/wasm` for `.wasm` paths; `.wasm` files that 404 in dist return 404 (not SPA fallback). Dev server: explicit `/emscripten-module.wasm` route serves from node_modules with `application/wasm`. Sandbox worker uses `browserWasmLocation()` to pin to `/${SERVED_WASM_FILENAME}` only in browser/Worker context. |

**Score:** 10/10 automatable truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/chat/sandbox/transport/sandbox.worker.ts` | QuickJS engine: empty-global context, deadline, memory limit, AUTHORING_METHODS | VERIFIED | 303 lines. Injects exactly authoring/turf/data/console. setInterruptHandler, setMemoryLimit(64MB), setMaxStackSize(512KB). editorCommand absent from AUTHORING_METHODS (CR-01). assertSandboxDistanceWithinCap called in turf wrapper (WR-01). |
| `src/features/chat/sandbox/transport/quickjsWorker.ts` | Fresh-spawn-per-run, Worker spawn, host watchdog, terminate in finally | VERIFIED | 101 lines. `new Worker(new URL('./sandbox.worker.ts', import.meta.url), {type:'module'})`. `setTimeout(→terminate, deadlineMs+500)` watchdog. `worker.terminate()` in settle/finally. |
| `src/features/chat/sandbox/sandboxHost.ts` | Transport-agnostic runSandbox(); exports SandboxRunResult, SandboxRunOptions | VERIFIED | 121 lines. Exports `runSandbox`, `SandboxRunResult`, `SandboxRunOptions`, `directEngineTransport`. No editor/signer/wallet import. |
| `src/features/chat/sandbox/curatedTurf.ts` | Frozen curated turf subset, MAX_DISTANCE_METERS reused, assertSandboxDistanceWithinCap | VERIFIED | 158 lines. Object.freeze({13 functions}). Imports MAX_DISTANCE_METERS from '@/features/geo-editor/api' (no literal). assertSandboxDistanceWithinCap exported and called from worker (WR-01 fix). |
| `src/features/chat/sandbox/outputCapture.ts` | Bounded capture: OUTPUT_LINE_CAP=1000, OUTPUT_BYTE_CAP=256KiB, truncation marker | VERIFIED | 71 lines. OUTPUT_LINE_CAP=1000, OUTPUT_BYTE_CAP=256*1024. TRUNCATION_MARKER='…(output truncated)'. push/drain interface. |
| `src/features/chat/sandbox/readSnapshot.ts` | D-01 frozen view: getDataset by handle + getAllFeatures, structuredClone | VERIFIED | 63 lines. Imports getDataset (not toModelSummary). structuredClone fail-closed. No signer/wallet import. |
| `src/features/chat/sandbox/runCode.ts` | run_code handler: snapshot → runSandbox → replay through createAuthoring; registerSandboxTools; RUN_CODE_RETRY_CAP | VERIFIED | 230 lines. REPLAYABLE_AUTHORING_OPS allow-list (CR-01). consecutiveFailures counter (D-06). registerSandboxTools exported. RUN_CODE_RETRY_CAP=3. |
| `src/features/chat/sandbox/sandboxHost.test.ts` | Confinement + surface + timeout + output cap + import boundary proofs | VERIFIED | 255 lines. 34 tests pass. Covers: 7 forbidden global confinement tests, surface enumeration, CR-01 editorCommand absent, timeout-kill, output cap, WR-01 distance cap, recording roundtrip, import boundary (tier A + tier B). |
| `src/features/chat/sandbox/runCode.test.ts` | Error feedback + fibonacci + overfly + CR-01 interception proofs | VERIFIED | 199 lines. 6 tests pass: error feedback (throws → ToolError), timeout (→ ToolError retryable), CR-01 forged-batch rejection, fibonacci (15 circles), overfly (1 feature + route costs), privacy regression. |
| `src/features/chat/CodeRunDisclosure.tsx` | Collapsed-by-default block, read-only source, console+counts+returnValue, truncation | VERIFIED | 169 lines. useState(false) open toggle. 4 sections on expand. No textarea/contentEditable/Rerun/onRun. JSON.stringify for returnValue. truncated marker in both console and return value sections. |
| `src/features/chat/CodeRunDisclosure.test.tsx` | Render proof: collapsed, expanded, read-only, truncated — 5 behaviors per plan | PARTIAL | 94 lines, 8 tests pass. Covers collapsed, expand, read-only, truncated. MISSING: "error concise" (D-11) behavior test — the test was specified in 04-03-PLAN behavior list but absent from the file. The error path IS correctly implemented in ChatPanel (parseToolErrorContent → red ToolError bubble, D-11), but no unit test covers the concise-message assertion. |
| `src/features/chat/ChatPanel.tsx` | CodeRunDisclosure wired; run_code tool calls routed to new block | VERIFIED | Lines 50 (import), 421-430 (pairing tool_call_id→source), 963-964 (runCodeSourceByCallId), 1515-1538 (CodeRunDisclosure render), 1555-1558 (suppress run_code from generic chip). |
| `src/features/chat/tools/registry.ts` | 'code-interpreter' in ToolKind; registerSandboxTools called in bootstrapRegistry | VERIFIED | Line 66: 'code-interpreter' in ToolKind union. Line 21: import registerSandboxTools. Line 1013: registerSandboxTools(register) in bootstrapRegistry. |
| `build.ts` | QuickJS .wasm copy to dist/ with fail-loud behavior | VERIFIED | Lines 218-251: resolves wasm via import.meta.resolve or node_modules fallback; fails loudly if missing; copies to dist/emscripten-module.wasm. Build confirmed emitting the asset. |
| `src/index.ts` | Dev server serves wasm; prod server serves with application/wasm MIME; SPA guard for .wasm | VERIFIED | Dev: line 347 explicit `/emscripten-module.wasm` route with application/wasm. Prod: serveBuiltFile (line 59-61) sets Content-Type for .wasm; line 304-306 .wasm never falls through to SPA index.html. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| quickjsWorker.ts | sandbox.worker.ts | new Worker(new URL('./sandbox.worker.ts', import.meta.url), {type:'module'}) | VERIFIED | Line 65 in quickjsWorker.ts. Verbatim spawn form confirmed. |
| sandbox.worker.ts | quickjs-emscripten | shouldInterruptAfterDeadline + setMemoryLimit | VERIFIED | Line 124 in sandbox.worker.ts. setInterruptHandler called with shouldInterruptAfterDeadline. |
| quickjsWorker.ts | worker.terminate() | setTimeout watchdog | VERIFIED | Lines 78-84: setTimeout(()=>settle({...error...}), deadlineMs+WATCHDOG_SLACK_MS). |
| runCode.ts | sandboxHost.ts | runSandbox(code, {readSnapshot, deadlineMs, outputCap}) | VERIFIED | Line 168 in runCode.ts. |
| runCode.ts | createAuthoring | replay recorded calls through facade (D-03) | VERIFIED | Line 194: createAuthoring(editor); lines 199-218: replay through REPLAYABLE_AUTHORING_OPS allow-list. |
| readSnapshot.ts | ingestStore getDataset | read full rows by handle (D-01) | VERIFIED | Line 27 import, line 57 usage. NOT toModelSummary. |
| registry.ts | runCode.ts registerSandboxTools | bootstrapRegistry injects register | VERIFIED | Line 1013 in registry.ts. |
| ChatPanel.tsx | CodeRunDisclosure | MessageBubble routes run_code to new block | VERIFIED | Lines 1521-1538. |
| build.ts | dist/emscripten-module.wasm | copy from @jitl/quickjs-wasmfile-release-sync/dist | VERIFIED | Build output confirmed. File exists in dist/. |
| src/index.ts | emscripten-module.wasm | application/wasm MIME, no SPA fallback | VERIFIED | serveBuiltFile + wasm guard on both dev and prod paths. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| runCode.ts (handler) | readSnapshot | buildReadSnapshot(handles, editor) → getDataset + getAllFeatures | Yes — getDataset returns fullRows from ingest store; getAllFeatures returns real editor features | FLOWING |
| runCode.ts (replay) | result.recordedCalls | runSandbox → sandbox worker records {op,args} | Yes — worker records real authoring calls from VM execution | FLOWING |
| CodeRunDisclosure.tsx | result (counts, consoleLines, returnValue) | parseRunCodeResult(contentText) from role:'tool' message | Yes — parsed from actual run_code tool result JSON | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Sandbox test suite (56 tests) | `bun test src/features/chat/sandbox/` | 56 pass / 0 fail, 365 expects | PASS |
| Chat test suite (243 tests including CodeRunDisclosure) | `bun test src/features/chat/` | 243 pass / 0 fail, 1726 expects | PASS |
| Full suite gate | `bun test` | 308 pass / 0 fail, 2064 expects | PASS |
| Build emits wasm | `bun run build` (checked dist/) | emscripten-module.wasm present in dist/, Worker chunk in dist/chunk-c02zymd9.js | PASS |
| Fibonacci: counts.created===15 | `bun test src/features/chat/sandbox/runCode.test.ts` (fibonacci describe) | 6 pass / 0 fail | PASS |
| Overfly: 1 feature + route+costs returned | `bun test src/features/chat/sandbox/runCode.test.ts` (overfly describe) | 6 pass / 0 fail | PASS |
| Confinement: forbidden globals undefined | `bun test src/features/chat/sandbox/sandboxHost.test.ts` (confinement describe) | 34 pass / 0 fail | PASS |
| Timeout-kill: while(true){} settles with timedOut:true | `bun test src/features/chat/sandbox/sandboxHost.test.ts` (timeout describe) | 34 pass / 0 fail | PASS |
| CR-01 fix: forged editorCommand rejected | `bun test src/features/chat/sandbox/runCode.test.ts` (interceptor-seam invariant) | 6 pass / 0 fail | PASS |
| WR-01 fix: over-cap turf.circle → __turf_error__ | `bun test src/features/chat/sandbox/sandboxHost.test.ts` (DoS distance cap describe) | 34 pass / 0 fail | PASS |

### Probe Execution

No conventional probe scripts found. Phase 4 uses bun test as the verification mechanism per PLAN design.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| CODE-01 | 04-01, 04-02 | Sandbox provably cannot access DOM/fetch/localStorage/signer/wallet | PARTIAL — automatable facets verified; live browser wasm execution pending | Confinement: 7 forbidden globals undefined (bun test). Static import boundary scan clean. Prod wasm: dist/emscripten-module.wasm emitted, HTTP 200 + application/wasm served from prod. Remaining: live in-browser wasm execution round-trip (Wave 3 UAT). |
| CODE-02 | 04-01, 04-02 | Sandboxed code can call curated Authoring API and nothing else | VERIFIED | Surface test: exactly authoring/turf/data/console injected. CR-01: editorCommand absent from AUTHORING_METHODS. Worker tier-B import scan: no createAuthoring/signer/wallet in worker/transport. run_code replays only REPLAYABLE_AUTHORING_OPS. |
| CODE-03 | 04-02, 04-03 | Code and output shown in collapsible block; errors fed back for self-correction | IMPLEMENTED — automatable facets proven; live UX pending | Error-feedback tests pass. CodeRunDisclosure renders collapsed/expanded/read-only/truncated. Wired in ChatPanel. Live autonomous-loop + UX confirmation pending /gsd-verify-work 4. |
| CODE-04 | 04-01, 04-02 | Sandbox bounded by wall-clock timeout + output-size caps; no freeze | IMPLEMENTED — engine proven; live no-freeze pending | Timeout-kill test: timedOut:true within 3s. Output cap: 1000 lines/256KiB, truncation marker. Timeout flows through run_code as retryable ToolError (D-13). Live no-freeze observation pending. |
| CODE-05 | 04-02 | AI can generate geometry programmatically (fibonacci-15-circles) | IMPLEMENTED — bun test proven; live autonomous emit pending | fibonacci test: counts.created===15, editor.getAllFeatures().length===15. Live autonomous demo pending. |
| CODE-06 | 04-02 | AI can run cost-weighted computations over routing data | IMPLEMENTED — bun test proven; live autonomous run pending | overfly test: reads handle rows, returns chosen route+costs, draws 1 feature, privacy seam intact. Live demo pending. |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| runCode.ts:92 | `let consecutiveFailures = 0` (module-global, shared across all chats) | WARNING (WR-03, open) | The retry cap is per-module not per-session; a failure in one chat bumps the counter seen by another. The cap message is advisory text only — dispatch is not actually hard-stopped. Not a correctness blocker for this phase's goals but misleads about isolation. Tracked in 04-REVIEW.md. |
| sandboxHost.ts:84-88 | `isTimeout()` uses fragile regex `/exceeded .*wall-clock\|interrupted\|deadline/i` | WARNING (WR-05, open) | User script throwing an error whose message contains "interrupted" or "deadline" would be misclassified as a timeout. Also brittle to QuickJS version changes. Tracked in 04-REVIEW.md. |
| quickjsWorker.ts:58-62 | Direct-path (`typeof Worker === 'undefined'`) has no wall-clock watchdog | WARNING (WR-02, open) | In a non-browser embedding without Worker support, a wedged synchronous turf call hangs the caller indefinitely. WR-01 cap reduces but doesn't eliminate the risk. Tracked in 04-REVIEW.md. |
| runCode.ts:57-58 | `outputCap: OUTPUT_CAP` plumbed but `SandboxRunOptions.outputCap` is advisory only | INFO (IN-01, open) | Dead plumbing — the real cap lives in outputCapture.ts and is not overridable per-run. Misleading to maintainers. Tracked in 04-REVIEW.md. |
| CodeRunDisclosure.test.tsx | Missing "error concise" (D-11) behavior test | WARNING | Plan specified 5 test behaviors; 4 implemented. D-11 (concise error, no stack trace) is correctly implemented in ChatPanel red ToolError bubble but the unit assertion is absent from CodeRunDisclosure.test.tsx. |
| runCode.ts, sandbox.worker.ts | WR-04: recorded args unbounded (calls, arg size, nesting depth) | WARNING (WR-04, open) | Console output is capped but the recorded-call channel that mutates the editor is not. Asymmetric DoS gap. Tracked in 04-REVIEW.md. |

No TBD/FIXME/XXX markers found in the phase files.

### Human Verification Required

All five items below require a configured LLM provider, a running application (bun dev), and human observation. They were explicitly deferred from the blocking-human Task 3 (04-03-PLAN.md) to /gsd-verify-work 4 by an accepted human decision.

#### 1. Live fibonacci demo (CODE-05 + SC#4 partial)

**Test:** Run `bun dev`, open the chat with a configured model and the map editor open. Prompt: "draw 15 circles with increasing fibonacci radii around this point" (give a point coordinate).
**Expected:** The AI autonomously emits a `run_code` call (no confirm dialog — D-04). 15 circles appear on the map. The transcript shows a COLLAPSED block summarizing "Ran code → 15 features created" (D-09). Click to expand — see the read-only source, console output, and return value (D-10/D-12). No confirmation prompt should appear before or during execution.
**Why human:** Requires live LLM provider, real map editor state, and direct observation of the autonomous tool dispatch and map rendering.

#### 2. Live overfly demo (CODE-06 + SC#4 partial)

**Test:** Attach/ingest a small overfly-fees CSV dataset (columns: country, eurPerKm). Then prompt the Austria→Bosnia cost-weighted flight-path request.
**Expected:** The AI reads the data by handle, runs the cost computation in the sandbox, draws the chosen path on the map, and the collapsed block's expanded return value shows the chosen route name + per-variant costs (e.g. `{ chosen: "direct", variants: { direct: X, viaSLO: Y } }`). The via-Slovenia detour should be more expensive (SI fee = 5 EUR/km in the seeded data), causing the direct route to be chosen.
**Why human:** Requires live ingest pipeline, configured LLM, and observation of handle-keyed data passing from ingest store through the sandbox boundary to the computation.

#### 3. Live self-correction (CODE-03 + SC#2 + D-06/D-07/D-11)

**Test:** Prompt the AI to write code that throws (e.g. "compute the distance between undefined points" or similar intentionally broken request). Or observe a natural error if one occurs.
**Expected:** The user sees a CONCISE one-line red error bubble (no giant stack trace — D-11). The AI self-corrects and eventually either succeeds or stops after ~3 attempts (D-06). Each retry is a separate collapsed block in the transcript (D-07), not a single growing block.
**Why human:** Requires inducing a real runtime error in live LLM output, observing the iterative retry behavior in the running chat loop, and confirming the stack is not dumped to the user.

#### 4. Live no-freeze under timeout (CODE-04 + SC#3)

**Test:** Across all the live demo runs above (fibonacci, overfly, self-correction), confirm the browser UI remains responsive at all times. If a timeout fires, the run should complete (via the watchdog) without causing a hang.
**Expected:** The app never becomes unresponsive. The tab stays interactive throughout. A runaway (if triggered) terminates within ~3.5s (3000ms deadline + 500ms watchdog slack) and the UI reports the ToolError.
**Why human:** Requires live browser execution and human observation of UI responsiveness. The timeout-kill mechanism is bun-test-proven but the browser/Worker real-execution path (as opposed to the directEngineTransport test path) needs live validation.

#### 5. Read-only affordance in the UI (D-12)

**Test:** In the live running app, expand a successful `run_code` collapsed block.
**Expected:** There is NO text input, textarea, contentEditable region, or "Run"/"Rerun"/"Edit" button in the expanded block. The code and output are visible but non-interactive.
**Why human:** Although CodeRunDisclosure.test.tsx already renders the component and asserts no textarea/contentEditable/Rerun, the live browser render must confirm this holds in the full ChatPanel integration.

---

## Gaps Summary

No automatable must-haves failed. All 10 observable truths are VERIFIED. The phase implementation is code-complete across all three plans (04-01 isolation spike, 04-02 run_code tool wiring, 04-03 display UI).

**Open warnings (non-blocking, tracked in 04-REVIEW.md):**
- WR-02: Direct transport path (bun test / SSR) has no wall-clock watchdog — a wedged synchronous turf call can hang the caller indefinitely in non-browser embeddings.
- WR-03: `consecutiveFailures` retry counter is module-global, not per-session — misleads about self-correction isolation in concurrent scenarios.
- WR-04: Recorded authoring call batch is unbounded in size — asymmetric DoS gap vs. the capped console output.
- WR-05: `isTimeout()` regex is fragile to user error messages containing "interrupted"/"deadline".
- WR-06: Worker `onmessage` does not validate inbound request shape; `runId` resets on HMR.
- IN-01: `outputCap` option is plumbed but advisory only — misleading to maintainers.
- IN-02: Snapshot described as "frozen" but is `structuredClone`d only — inaccurate wording.
- IN-03: Double JSON round-trip for turf return values — latent silent-undefined foot-gun.
- IN-04: WASM path resolver duplicated between build.ts and src/index.ts dev server — maintenance trap.
- Missing "error concise" (D-11) unit test in CodeRunDisclosure.test.tsx — behavior is implemented correctly in ChatPanel; the unit test assertion is absent.

None of these warnings block the phase goal. The five deferred live-UAT items are the only items standing between the current state and full phase closure.

---

_Verified: 2026-06-18T09:50:00Z_
_Verifier: Claude (gsd-verifier)_
