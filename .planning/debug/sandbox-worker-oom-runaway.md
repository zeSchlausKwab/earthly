---
status: awaiting_human_verify
trigger: "QuickJS sandbox worker runaway: re-fetches/re-instantiates ~500KB wasm thousands of times (2,831 req / 1.38 GB), allocating toward OOM, pegging a CPU core (~121%), overheating. Found in Phase 4 UAT, worse after code-interpreter changes (537cac2)."
created: 2026-06-19T00:00:00Z
updated: 2026-06-19T02:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Each run_code spawns a fresh sandbox worker that, on EVERY run, calls loadQuickJS() → newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC,{wasmLocation})) — which is NOT memoized (unlike getQuickJS()'s singletonPromise). So each run re-fetches+re-compiles the 503KB wasm and allocates a fresh wasm heap (never reused). The wasm route + worker route send NO Cache-Control, so the browser cannot even HTTP-cache the bytes → every spawn = a fresh 503KB network fetch. The 'thousands of fetches' magnitude requires a SECONDARY repeated-spawn/repeated-instantiate trigger on top of per-run cost; candidate triggers being tested: (a) emscripten loader retry loop inside ONE worker (the self.onmessage↔postMessage + repeated HEAP-realloc stack), (b) the agent loop re-calling run_code past the soft cap on a persistently-failing worker."
  confirming_evidence:
    - "quickjs-emscripten 0.32.0 internals (node_modules/.../index.global.js): newQuickJSWASMModuleFromVariant calls wasmModuleLoader() each invocation with NO memoization; only getQuickJS() memoizes via singletonPromise. The library even exports memoizePromiseFactory for exactly this."
    - "sandbox.worker.ts loadQuickJS(): browser path uses the UN-memoized newQuickJSWASMModuleFromVariant per runSandboxCode call; Node/test path uses the memoized getQuickJS()."
    - "quickjsWorker.ts spawns new Worker PER RUN and terminates in settle — no module-level reuse; each spawn re-imports the 0.58MB bundle AND re-fetches the 503KB wasm."
    - "src/index.ts serveQuickjsWasm + serveBuiltFile set NO Cache-Control → no browser HTTP cache → every spawn re-fetches 503KB. Matches ~500KB × ~2,700 ≈ 1.38 GB."
    - "Agent loop (store.ts while(true)) awaits a network LLM request each iteration, so it is network-rate-limited — it cannot ALONE produce thousands of fetches per second; the rapid magnitude must come from within instantiation OR an emscripten retry loop."
  falsification_test: "Build the worker bundle, run it as a real Worker against a local HTTP server that COUNTS wasm fetches, post ONE request. If one run triggers >1 wasm fetch (a loop), the in-worker retry hypothesis (a) is confirmed. If exactly 1 fetch per run, the runaway is purely N spawns × 1 fetch and the trigger is host-side spawn count (b)."
  fix_rationale: "Regardless of which trigger dominates: (1) memoize the compiled QuickJS module across spawns (or pool one warm worker) so wasm is fetched+compiled at most once; (2) add Cache-Control to the wasm so even un-memoized fetches hit browser cache; (3) guarantee termination (already present) + a hard host-side spawn/concurrency guard so a persistent failure cannot become a re-fetch storm. These cap the blast radius even if the exact trigger is model-driven."
  blind_spots: "Bun-test cannot spawn QuickJS-in-Worker (segfault per Plan 01 note) so the live browser loop can't be reproduced under bun test directly; will reproduce via a standalone Bun Worker harness with the built bundle + instrumented HTTP server. Also: outputCapture.ts uses Buffer.byteLength (Node global) inside the worker — may throw in a real browser Worker; need to check if that contributes to a load/run failure feeding the retry loop."
  next_action: "Build the worker bundle; stand up an instrumented HTTP server serving the wasm; run the bundle as a Bun Worker and post one request; count wasm fetches per run and watch RSS."

## Symptoms

expected: A single run_code call fetches+compiles the QuickJS wasm at most once, the worker terminates, memory stays bounded, idle CPU at baseline.
actual: "Worker re-fetches+re-instantiates the ~503KB wasm thousands of times (DevTools: 2,831 requests / 1.38 GB in a short window), allocates toward OOM (Chrome 'Paused before potential out-of-memory crash' inside emscripten HEAP-allocation: HEAP8=new Int8Array(buffer)…BigUint64Array), pegs a CPU core (~121%), overheats the machine. Call stack: deeply nested self.onmessage↔postMessage in the built /workers/sandbox.worker.js."
errors: "Chrome OOM-guard auto-pause inside emscripten HEAP view (re)allocation; no thrown error string captured. WebSocket relay Messages pane EMPTY (relays not the cause)."
reproduction: Phase 4 UAT — invoke run_code in chat (dev and prod); got worse after the code-interpreter worker-serving changes (537cac2). Reported app-wide incl. a fresh tab (machine pegged).
started: Phase 4 (new feature); worse after 537cac2 (fresh-Worker-per-run + http worker serving + wasmLocation pin).

## Eliminated

- hypothesis: "geoJsonParse worker or ingest worker is the wasm refetch source."
  evidence: "Neither loads any wasm (grep: 0 wasm/emscripten refs in ingest.worker.ts; geoJsonParseWorker.ts is a plain JSON.parse worker). Only sandbox.worker.ts loads the QuickJS emscripten wasm."
  timestamp: 2026-06-19T00:00:00Z

- hypothesis: "The agent while(true) loop spawns thousands of workers per second by itself."
  evidence: "Each loop iteration awaits makeRequest (a network LLM streaming call) before executing tools (store.ts:1603,1706). Network-rate-limited; cannot produce thousands of fetches per second alone. The rapid magnitude must originate within instantiation or an emscripten retry loop."
  timestamp: 2026-06-19T00:00:00Z

- hypothesis: "The worker re-posts to itself (self-recursive onmessage)."
  evidence: "Built bundle has exactly ONE self.onmessage and two self.postMessage, both in our shell; the handler runs once per host postMessage and never re-posts a request to itself."
  timestamp: 2026-06-19T00:00:00Z

## Evidence

- timestamp: 2026-06-19T00:00:00Z
  checked: quickjs-emscripten 0.32.0 newQuickJSWASMModuleFromVariant / newVariant / getQuickJS internals
  found: getQuickJS() memoizes the compiled module via singletonPromise; newQuickJSWASMModuleFromVariant(newVariant(...,{wasmLocation})) does NOT — it re-runs wasmModuleLoader() (fetch+compile+instantiate) every call. Library exports memoizePromiseFactory for this exact need.
  implication: The browser path re-fetches+re-compiles the 503KB wasm on EVERY runSandboxCode, and each fresh-per-run worker compounds it. Caching the compiled module across spawns is the high-impact fix.

- timestamp: 2026-06-19T00:00:00Z
  checked: src/index.ts serveQuickjsWasm + serveBuiltFile (dev + prod wasm serving)
  found: Neither sets Cache-Control / ETag / immutable. WASM served fresh each request.
  implication: No browser HTTP cache → each worker spawn re-downloads 503KB even though the bytes never change. Adding long-lived immutable Cache-Control caps network even before memoization lands.

- timestamp: 2026-06-19T01:00:00Z
  checked: REPRODUCTION harness (/tmp/repro/harness2.ts) — built sandbox.worker.js run as a FRESH Bun Worker per run against a counting HTTP wasm server, http location injected so the browser wasm path is taken.
  found: EXACTLY 1 wasm fetch per fresh-per-run worker (4 runs → server saw 4 fetches). RSS grew monotonically +75MB→+95MB across the 4 terminated workers. No in-worker retry loop.
  implication: The runaway is N host-side spawns × 1 full instantiation each — NOT an emscripten retry loop inside one worker (hypothesis (a) ELIMINATED). 2,831 fetches ⇒ ~2,800 spawns. Each spawn fully re-fetches+re-compiles the 503KB wasm and allocates a fresh QuickJS heap that is not promptly reclaimed → monotonic memory climb toward OOM + CPU peg per (re)compile.

- timestamp: 2026-06-19T01:00:00Z
  checked: emscripten browser glue (node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.browser.mjs)
  found: ea() does instantiateStreaming, on failure falls back to da()/ArrayBuffer (≤2 fetches per instantiate, not a loop). The DevTools OOM pause site is `k:` = emscripten_resize_heap: `r.grow(e); K()` where K() rebuilds HEAP views (HEAP8=new Int8Array(buffer)…BigUint64Array) — normal per-instance memory-growth, multiplied across thousands of instantiations.
  implication: Confirms per-spawn full instantiation is the allocation source. Caching the compiled module (or pooling one warm worker) eliminates the repeated grow/realloc.

- timestamp: 2026-06-19T01:00:00Z
  checked: runCode.ts consecutiveFailures / RUN_CODE_RETRY_CAP enforcement + store.ts while(true) agent loop
  found: The docstring claims consecutiveFailures 'is what makes the cap a HARD stop' but the code only APPENDS a string ('retry cap reached, stop and report') to the model-facing error — it never programmatically stops. run_code spawns a worker on EVERY call regardless of the counter. The agent while(true) loop has NO round cap, NO total-tool-call cap, NO break tied to repeated run_code failures. Each loop iteration awaits a network LLM call, so spawns are throttled to model latency — but a fast LOCAL model (LM Studio, referenced in store.ts) that ignores the soft 'stop' instruction loops indefinitely, spawning a fresh full-instantiation worker every few hundred ms → hundreds-to-thousands of spawns.
  implication: SPAWN COUNT is unbounded. The 'cap' is advisory only. Need a HARD programmatic stop: run_code must throw/refuse without spawning once consecutiveFailures >= RUN_CODE_RETRY_CAP, and the spawn path must cap concurrent/total in-flight workers as defence-in-depth.

## Resolution

root_cause: |
  TWO compounding defects in the Phase-4 code-interpreter sandbox path, both new with the
  fresh-Worker-per-run design (537cac2):

  (1) UNBOUNDED PER-RUN COST. Every run_code spawns a fresh Worker that calls loadQuickJS() →
      newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC,{wasmLocation})). That factory is
      NOT memoized (unlike the library's getQuickJS() singletonPromise used on the Node/test
      path), so each run RE-FETCHES + RE-COMPILES the 503KB QuickJS wasm and allocates a fresh
      wasm heap that is not promptly reclaimed. The wasm route (serveQuickjsWasm / serveBuiltFile)
      sends NO Cache-Control, so the browser cannot even HTTP-cache the bytes. Reproduced: exactly
      1 full 503KB fetch + full instantiate per spawn, with monotonic RSS growth.

  (2) UNBOUNDED SPAWN COUNT. The RUN_CODE_RETRY_CAP "hard stop" is a lie — it only appends a
      string asking the model to stop; run_code still spawns a worker on every call, and the
      agent while(true) loop has no round/tool-call cap. A model that keeps calling run_code
      (fast local models especially) loops, and each loop iteration is a full wasm
      fetch+compile+heap-alloc.

  Together: thousands of spawns × full per-spawn re-instantiation = 2,831 wasm fetches / 1.38 GB,
  monotonic allocation toward OOM (Chrome's pause inside emscripten_resize_heap), and a pegged
  CPU core from repeated wasm compilation. WebSocket relays are unrelated (confirmed empty).
fix: |
  Three layered changes; the runaway needs the first two, the third is defence-in-depth.

  (A) COMPILE-THE-WASM-ONCE (sandbox.worker.ts). loadQuickJS() now memoizes the compiled
      QuickJSWASMModule in a module-scoped promise (cleared on a failed compile so a one-off
      failure can retry). The compiled module is stateless; reuse is safe because runSandboxCode
      already builds a FRESH runtime+context per run and disposes them. Within a worker's
      lifetime the 503KB wasm is fetched+compiled exactly once.

  (B) WARM-POOLED SINGLE WORKER (quickjsWorker.ts). Replaced fresh-Worker-per-run with ONE
      long-lived worker reused across runs (runs keyed by id through a pending-map). Because the
      worker is long-lived AND the module is memoized inside it, the wasm is fetched+compiled
      ONCE for the whole session — not per run. The host watchdog still TERMINATES the worker on
      a wall-clock timeout (a wedged thread is unrecoverable otherwise) and the next run lazily
      recreates it; worker.onerror tears the worker down and fails in-flight runs ONCE (a
      wasm/worker-load failure can NOT become a re-spawn/re-fetch storm). Isolation preserved
      (proven: a global set in run 1 is undefined in run 2; forbidden globals stay undefined).

  (C) CIRCUIT BREAKER on run_code (runCode.ts). RUN_CODE_RETRY_CAP was a lie — it only appended
      a "please stop" string; nothing stopped the model from re-calling run_code, and each call
      spawned a sandbox. Now once consecutiveFailures >= cap, run_code is REFUSED before any
      boundary invocation, then the counter RESETS (one explicit halt per burst, so the model is
      not permanently bricked). Caps invocations to ≤cap per (cap+1) calls; combined with (A)/(B)
      and the per-call network round-trip, an unbounded storm is impossible.

  (D) WASM HTTP CACHE (src/index.ts). serveQuickjsWasm (dev) + serveBuiltFile (prod) now send
      `Cache-Control: public, max-age=31536000, immutable` so even an un-memoized fetch hits the
      browser cache. Defence-in-depth on top of (A)/(B).

  Confinement (CODE-01), timeout/output caps (CODE-04), and the typeof Worker===undefined
  bun-test fallback are all untouched.
verification: |
  REPRODUCTION (out-of-band, real built browser bundle + counting wasm HTTP server, http
  location injected so the browser wasm path runs):
    - BEFORE: fresh-Worker-per-run → exactly 1 wasm fetch PER spawn (4 runs = 4 fetches) and
      monotonic RSS +75→+95MB across 4 terminated workers. Extrapolates to the 2,831 observed.
    - AFTER: ONE warm worker, 6 sequential runs → SERVER saw the wasm fetched exactly 1 time
      (runs 2–6 = 0 fetches); RSS plateaued at ~104MB instead of climbing; state bleed check
      (global set in run 1) = "undefined" in run 2; forbidden `fetch` = "undefined". Matches
      success criteria: ≤1 wasm compile across N runs, memory bounded, no OOM climb.
  AUTOMATED:
    - bun test src/features/chat/sandbox/: 69 pass / 0 fail (incl. new wasmReuse.test.ts module-
      reuse isolation proofs + run_code circuit-breaker proof: ≤cap invocations per (cap+1)
      calls, halt message, reset-after-success).
    - bun test (full): 384 pass / 0 fail (was 379 baseline; +5 new). No regressions.
    - bun run build: green; dist/workers/{sandbox,ingest,geoJsonParse}.worker.js + dist/
      emscripten-module.wasm emitted. bun run build:production: green; prod sandbox worker keeps
      a SINGLE newVariant call (memoization survives minification) + the worker shell.
    - biome: the 5 changed sandbox files are 0 errors / 0 warnings (exit 0). src/index.ts has 1
      biome error WITH AND WITHOUT my change (proven by stashing the edit) — pre-existing
      OG-route formatting, not introduced here. Repo-wide biome has ~111 pre-existing errors
      unrelated to this change (noted in the prior debug session).
  OPEN (human-verify): live browser Phase-4 run_code UAT — confirm a normal run_code call
    fetches the wasm at most once (Network tab), the warm worker survives runs, memory does not
    climb toward OOM, and idle CPU returns to baseline.
files_changed:
  - src/features/chat/sandbox/transport/sandbox.worker.ts (memoize compiled QuickJS module)
  - src/features/chat/sandbox/transport/quickjsWorker.ts (warm-pooled single worker + guards)
  - src/features/chat/sandbox/runCode.ts (RUN_CODE_RETRY_CAP circuit breaker + test reset seam)
  - src/index.ts (immutable Cache-Control on the QuickJS wasm, dev + prod)
  - src/features/chat/sandbox/transport/wasmReuse.test.ts (new: module-reuse isolation regression)
  - src/features/chat/sandbox/runCode.test.ts (new: circuit-breaker regression + per-test reset)
