# Phase 4: Code Interpreter Sandbox - Research

**Researched:** 2026-06-18
**Domain:** Client-side untrusted-JS isolation (QuickJS-WASM vs sandboxed iframe), message-only RPC, wall-clock/output bounding, agentic self-correction, curated turf surface
**Confidence:** HIGH (transport candidates verified against authoritative sources + npm; integration seams read directly from repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Capability surface (CODE-01 / CODE-02 / CODE-05 / CODE-06)**
- **D-01:** Read access = ingested data by handle + current map features. Sandboxed code reads full parsed rows from the Phase 3 ingest store **by handle id**, and reads the editor's **current feature set**. Both are read-only views across the message boundary; the model still never receives raw rows (Phase 3 D-11 privacy seam preserved — the *sandbox* reads by handle, not the model's context).
- **D-02:** Helper toolkit = curated `@turf/turf` subset + plain JS built-ins (`Math`, `Array`, `JSON`, …). `@turf/turf@^7.3.5` already installed. Exact exported turf surface = planner's discretion (constrained by what the transport can safely serialize/expose).
- **D-03:** Write = `authoring.*` only. Sole host mutation surface is the Authoring API facade (`createAuthoring`). No signer/wallet/store/getState reachable — the V4 access-control boundary `boundary.test.ts` already enforces. CODE-02's "and nothing else" is structurally true because the facade exposes only geometry methods.

**Execution trust model (CODE-03 / forward-couples Phase 5)**
- **D-04:** Auto-run in the agentic loop, no confirm. User sees code + output **after** (D-09). Map mutations apply without per-run approval.
- **D-05:** Fresh sandbox per run. No state carries between runs (no persistent REPL). Clean teardown — `terminate()`/iframe-teardown reliably kills a run.
- **D-08:** Phase 5's safety gate reuses the existing interceptor seam — build NO gate now. Sandbox writes already pass through `runInterceptors()`. This phase must NOT add its own confirm/placeholder gate — just ensure sandbox mutations flow through the interceptor like every other authoring write.

**Code & output display (CODE-03)**
- **D-09:** Collapsed, expandable block. Default render is a compact summary line (e.g. "Ran code → 15 features created"), collapsed; user expands for source + output. Matches existing tool-call rendering in `ChatPanel.tsx`.
- **D-10:** Output captures `console.log`/`warn`/`error` stream + structured authoring result summary (created/updated/deleted from `MutationResult`) + the script's final return/expression value, JSON-rendered. This is also what feeds the model for self-correction.
- **D-11:** User-facing errors = concise one-line message (no big stack trace). The **full** error is always fed back to the model for self-correction (CODE-03, non-negotiable).
- **D-12:** Read-only display. Code shown but not user-editable; user steers via chat. No in-place edit-and-rerun this phase.

**Self-correction bounds (CODE-03 / CODE-04)**
- **D-06:** Small fixed retry cap (2–3), then stop + report. Exact number (2 vs 3) = planner's discretion.
- **D-07:** Each retry attempt is visible as its own collapsed block.
- **D-13:** Timeouts are retryable and count against the cap. A wall-clock kill is fed back ("script exceeded Ns, terminated") and counts against the 2–3 cap.
- **D-14:** Fixed sensible timeout + output-size caps; no settings UI this phase. Planner picks hardcoded values (a few seconds wall-clock; an output byte/line cap).

### Claude's Discretion
- **Isolation transport** — resolved by the mandatory opening spike (QuickJS-WASM-in-Worker vs. cross-origin-iframe-CSP); all decisions above are transport-agnostic.
- **Write-commit granularity** — how multiple `authoring.*` writes from one run land (batched as one undo step vs. live/incremental). Recommend batching toward Phase 5's dataset-level undo, but pick what the transport's RPC makes clean.
- **Exact turf export surface** (D-02), **retry count 2 vs 3** (D-06), **timeout duration + output-cap values** (D-14), and the **`run_code` tool's registration shape** (registers through the Phase 2 typed registry with a mandatory `kind`).
- **Sandbox cold-start / instantiation cost** handling (per-run fresh sandbox, D-05) — pooling vs. fresh-spawn is an implementation detail as long as teardown stays clean.

### Deferred Ideas (OUT OF SCOPE)
- **Editable code + manual rerun** — deferred in favor of read-only display (D-12).
- **Persistent REPL / notebook session** — deferred in favor of fresh-sandbox-per-run (D-05).
- **User-configurable timeout / output caps** in the settings store — deferred in favor of fixed defaults (D-14).
- **Live/incremental write-paint** — left to planner discretion under write-commit granularity; batching toward Phase 5 undo is the recommended default.
- **Phase 4-built safety gate** — explicitly NOT built; Phase 5 owns add/modify/delete classification + diff/preview at the interceptor seam (D-08).
- **Nostr-scrolls / WASM (NIP-5C)** — next milestone; builds on this interpreter.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CODE-01 | Sandbox provably denies DOM / `fetch` / `localStorage` / Nostr signer / wallet | Both transports deny by construction: QuickJS exposes *no* host globals by default `[CITED: github.com/justjake/quickjs-emscripten]`; an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) runs in an opaque origin with no `localStorage`, no parent reach `[CITED: MDN/HackTricks]`. Confinement proof extends `boundary.test.ts` (Confinement Proof section). |
| CODE-02 | Sandboxed code can call the curated Authoring API and nothing else | The host injects exactly one host object (`authoring.*`) + curated turf/read APIs across the message boundary. `createAuthoring(editor)` already exposes only geometry methods (verified: `authoring.test.ts` asserts the surface is `['addFeature','buffer','circle','editorCommand','writeGeoJSON']` with no signer/wallet/store). |
| CODE-03 | Code + output in collapsible block; runtime errors fed back for self-correction | Collapsible block reuses the `ChatPanel.tsx` `ToolResultDisclosure` / `MessageBubble` pattern (verified). Error feedback reuses the existing `role:'tool'` envelope + D-16 `ToolError` contract — the store loop already re-prompts the model on every tool result (verified `store.ts:1404–1629`). |
| CODE-04 | Wall-clock timeout + output-size caps terminate runaways without freezing the app | QuickJS: `runtime.setInterruptHandler(shouldInterruptAfterDeadline(...))` + `setMemoryLimit`/`setMaxStackSize` `[CITED: quickjs-emscripten docs]`. Worker/iframe: host-side `setTimeout` → `worker.terminate()` / iframe removal. Both keep the kill off the main thread (Worker) or on a microtask the main thread controls. |
| CODE-05 | Generate geometry programmatically ("15 fibonacci-radii circles") | `authoring.circle([lon,lat], radius)` in a loop; turf `circle` verified present. Headline script #1. |
| CODE-06 `[C]` | Custom cost-weighted computation over routing data (Austria→Bosnia overfly fees) | Read routing/CSV input from ingest store by handle (D-01), compute with turf `distance`/`length`/`bearing`/`along` (verified present) + JS, draw chosen path via `authoring.*`. Headline script #2. |
</phase_requirements>

## Summary

Phase 4 adds a `run_code` tool that lets the model author and execute JavaScript inside an isolation boundary whose only host-mutation surface is the existing Authoring API. The phase **opens with a mandatory time-boxed spike** to resolve the one open design decision — **(A) QuickJS-WASM-in-a-Worker** vs **(B) a sandboxed iframe with strict CSP**. Everything downstream (read views, `authoring.*` RPC, console/return capture, timeout/output caps, self-correction loop, collapsible UI) is transport-agnostic by CONTEXT design, so the plan's risk is concentrated in the transport primitive — which is exactly why the spike comes first.

The good news: the host-side seams this phase plugs into are already built and proven. `createAuthoring(editor)` is a geometry-only facade (no signer/wallet/store), enforced by `boundary.test.ts`; the ingest store exposes `getDataset(handleId)` for full-row reads (D-01); the typed tool registry takes a new entry with a mandatory `kind`; the chat store's tool loop already re-prompts the model on every `role:'tool'` result (that *is* the self-correction loop — no new agentic machinery needed); and the `ChatPanel.tsx` `ToolResultDisclosure`/`ToolError` rendering is the collapsible-block precedent. The established `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` pattern (Phase 3 ingest worker) already bundles cleanly under both the dev `Bun.serve()` HMR bundler and the html-driven production `build.ts`.

**Primary recommendation:** Spike **transport (A): `quickjs-emscripten` running inside a dedicated Web Worker**, using the **all-variants `quickjs-emscripten` package with the default RELEASE_SYNC variant** (or `quickjs-emscripten-core` + the `@jitl/quickjs-wasmfile-release-sync` variant, both `[VERIFIED: npm registry]` OK). Rationale: QuickJS denies all host globals *by construction* (no CSP/origin engineering needed), runs synchronously so `authoring.*` can be exposed as ordinary sync host functions inside the worker (avoiding async-RPC-per-call marshalling), gives a deterministic `bun test`-able confinement + timeout proof via `setInterruptHandler` + `setMemoryLimit`, and sidesteps Earthly's single-origin `Bun.serve()` constraint that makes a *true* cross-origin iframe awkward to serve. Keep transport (B) as the documented fallback if WASM bundling under the worker turns out to be a problem in the spike — `sandbox="allow-scripts"` (no `allow-same-origin`) gives an opaque-origin frame with no `localStorage` and no parent reach without standing up a second origin.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Untrusted JS execution | Isolation boundary (QuickJS-in-Worker **or** sandboxed iframe) | — | Must be off the main thread / in an opaque origin so a runaway cannot freeze the app and cannot reach host secrets (CODE-01/04). |
| Geometry mutation (`authoring.*`) | API / Host (main thread) | Editor core | Mutating MapLibre layers requires the live `GeoEditor`; the sandbox sends *messages*, the host applies them through `createAuthoring` (D-03). No live editor object crosses the boundary. |
| Curated math/geometry compute (turf, `Math`) | Isolation boundary | — | Pure computation with no host side-effects; bundle turf *into* the boundary (worker/iframe) so calls don't round-trip RPC per turf op (D-02). |
| Read views (ingest rows, current features) | API / Host (snapshot) | Isolation boundary (frozen copy) | Host serializes a **plain-data snapshot** by handle and passes it in; the boundary only ever sees frozen JSON, never the live `Map`/editor (D-01, preserves Phase 3 privacy seam). |
| Timeout / output caps enforcement | API / Host (watchdog) + boundary (interrupt) | — | Defence in depth: in-boundary interrupt handler (QuickJS) AND a host-side wall-clock watchdog that terminates the boundary (CODE-04, D-13/D-14). |
| Self-correction loop + retry cap | API / Host (chat store) | Tool registry (error contract) | The existing `store.ts` tool loop re-prompts on `role:'tool'` results; the new bound is a per-`run_code` retry counter (D-06). |
| Code/output rendering | Frontend (React, `ChatPanel.tsx`) | — | Collapsible block reuses existing disclosure components (D-09/D-10/D-07). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `quickjs-emscripten` | `0.32.0` | QuickJS compiled to WASM; runs untrusted JS with **no host globals by default**, `setInterruptHandler` deadline, `setMemoryLimit`. The recommended transport-(A) engine. `[VERIFIED: npm registry]` | ~1M weekly downloads, 2.5 yrs old, by `justjake`, no postinstall. The de-facto "safely execute untrusted JS in your JS" library. `[CITED: github.com/justjake/quickjs-emscripten]` |
| `@turf/turf` | `^7.3.5` (installed) | Curated geometry/math subset exposed inside the sandbox (D-02). Already used by `primitives.ts`. `[VERIFIED: package.json + node require]` | Already the project's geometry toolkit; `circle`/`distance`/`buffer`/`length`/`bearing`/`along` all verified present. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `quickjs-emscripten-core` | `0.32.0` | JS-only core (~795 KB unpacked) — pair with **one** variant package to control bundle size. `[VERIFIED: npm registry]` | Use instead of the all-in-one package if the spike shows the 2.4 MB all-variants install bloats the bundle; pair with `@jitl/quickjs-wasmfile-release-sync`. |
| `@jitl/quickjs-wasmfile-release-sync` | `0.32.0` | RELEASE_SYNC variant as a **separate `.wasm` asset** (loaded via `new URL('…','import.meta.url')`). `[VERIFIED: npm registry]` (OK, ~1M downloads) | Default variant pairing for `-core`. Emits a `.wasm` chunk the build serves like any other asset. |
| `@jitl/quickjs-singlefile-mjs-release-sync` | `0.32.0` | Same variant but with the WASM **inlined** (no separate `.wasm` to serve). `[ASSUMED — see audit]` (SUS: 576 downloads/wk) | Only if `.wasm` asset serving under `Bun.serve()` prod proves troublesome. First-party sibling in the same monorepo, but low-download → planner must gate behind `checkpoint:human-verify`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| QuickJS-in-Worker (A) | Sandboxed iframe + strict CSP (B) | (B) needs origin/CSP engineering and `postMessage(*)` (you cannot target a specific origin to an opaque-origin frame); every `authoring.*` call is an async round-trip. Wins only if WASM-in-worker bundling fails. Keep as fallback. |
| QuickJS-in-Worker | QuickJS on the **main thread** (no worker) | QuickJS's `setInterruptHandler` *can* stop an infinite loop on the main thread, but a tight synchronous host-callback or huge turf op could still jank a frame. A worker keeps the main thread responsive (CODE-04 "without freezing the app"). Recommend worker. |
| QuickJS | `ses`/SES `Compartment`, `vm2`, raw `new Function` | SES/Compartment shares the host realm — far harder to *prove* `fetch`/`localStorage` are denied; `vm2` is Node-only and historically CVE-prone; `new Function` has no isolation at all. QuickJS's empty-globals model is the cleanest CODE-01 proof. `[ASSUMED]` |
| `quickjs-emscripten` | `@sebastianwessel/quickjs` (v3.1.0) higher-level wrapper | Adds a filesystem/module-runner abstraction this phase doesn't need; more surface to audit for the CODE-01 confinement proof. Prefer the lower-level primitive. `[ASSUMED]` |

**Installation (recommended path):**
```bash
bun add quickjs-emscripten
# OR, to control bundle size:
# bun add quickjs-emscripten-core @jitl/quickjs-wasmfile-release-sync
```

**Version verification (run during the spike before locking):**
```bash
npm view quickjs-emscripten version           # 0.32.0 (confirmed 2026-06-18)
npm view @jitl/quickjs-wasmfile-release-sync version   # 0.32.0
```

## Package Legitimacy Audit

> Verified via the legitimacy seam (`gsd-tools query package-legitimacy check --ecosystem npm …`) on 2026-06-18.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `quickjs-emscripten` | npm | ~2.5 yrs (created 2023-12-25) | ~997K/wk | github.com/justjake/quickjs-emscripten | **OK** | Approved (recommended) |
| `quickjs-emscripten-core` | npm | ~2.5 yrs | ~1.05M/wk | github.com/justjake/quickjs-emscripten | **OK** | Approved (size-control alt) |
| `@jitl/quickjs-wasmfile-release-sync` | npm | ~2.5 yrs | ~1.02M/wk | github.com/justjake/quickjs-emscripten | **OK** | Approved (variant for -core) |
| `@jitl/quickjs-singlefile-mjs-release-sync` | npm | ~2.5 yrs | ~576/wk | github.com/justjake/quickjs-emscripten | **SUS** (low-downloads) | Flagged — planner adds `checkpoint:human-verify` if used |

- No package has a `postinstall` script (verified `npm view … scripts.postinstall` → null).
- All four are first-party packages in the **same** `justjake/quickjs-emscripten` monorepo; the SUS verdict on the singlefile variant is purely a download-count artifact (it's a niche bundling option), not a slopsquat signal — but per protocol it stays flagged and gated.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@jitl/quickjs-singlefile-mjs-release-sync` — only if the spike chooses the inlined-WASM path; planner inserts a `checkpoint:human-verify` before install.

## Architecture Patterns

### System Architecture Diagram

```
                          CHAT STORE TOOL LOOP (store.ts, main thread)
                          ─ existing agentic loop; re-prompts on every role:'tool' result ─
   model emits run_code(code) ──► executeToolCall ──► registry.dispatch('run_code', {code})
                                                              │
                                                              ▼
                                              ┌──────────────────────────────┐
                                              │  run_code HANDLER (host)      │
                                              │  - build read snapshot (D-01) │
                                              │  - start wall-clock watchdog  │
                                              │  - per-run retry counter(D-06)│
                                              └──────────────┬───────────────┘
            read snapshot (frozen JSON) + code               │  serialized messages only
   ┌──────────────────────────────────────────────┐         ▼
   │  ingestStore.getDataset(handle).fullRows       │   ╔══════════════════════════════════╗
   │  editor.getAllFeatures() → plain GeoJSON copy  │   ║  ISOLATION BOUNDARY               ║
   └──────────────────────────────────────────────┘   ║  (QuickJS context in a Worker)    ║
                                                       ║                                   ║
                                              code ──► ║  globals: authoring.*, turf.*,    ║
                                                       ║  data.*, console.* (captured)     ║
                                                       ║  NO fetch / DOM / localStorage /  ║
                                                       ║  signer / wallet  (CODE-01)       ║
                                                       ║                                   ║
                                   authoring.circle()  ║  setInterruptHandler(deadline)    ║
                                   authoring.buffer()  ║  setMemoryLimit / output cap      ║
                                              │        ╚════════════╤══════════════════════╝
                  RPC message: {op:'addFeature', args}             │ console lines + return value
                                              ▼                     ▼
                          ┌────────────────────────────────────────────────┐
                          │  HOST applies via createAuthoring(editor)        │
                          │  → runInterceptors() (D-08 Phase-5 gate slot)    │
                          │  → editor.addFeature / setFeatures               │
                          │  → MutationResult (created/updated/deleted)      │
                          └───────────────────────┬──────────────────────────┘
                                                  │  collected MutationCounts + console + return + error/timeout
                                                  ▼
                       role:'tool' message  ──►  store loop re-prompts model (self-correct, D-06 cap)
                                                  │
                                                  ▼
                       ChatPanel collapsible block (D-09/D-10/D-07): summary line → expand → code+output
```

The reader can trace headline script #1 (CODE-05): model → `run_code(loop calling authoring.circle with fibonacci radii)` → boundary executes loop, each `authoring.circle` RPCs to host → host draws 15 circles through the interceptor → `MutationCounts {created:15}` → collapsed "Ran code → 15 features created" block.

### Recommended Project Structure (new files — transport-agnostic surface + transport impl)
```
src/features/chat/sandbox/
├── runCode.ts             # run_code tool handler: snapshot → execute → collect → ToolError on fail
├── sandboxHost.ts         # transport-agnostic host interface: run(code, {readSnapshot, authoring, deadlineMs, outputCap})
├── transport/
│   ├── quickjsWorker.ts   # transport (A): spawns the worker, marshals authoring.* RPC, enforces caps
│   └── sandbox.worker.ts  # the worker: instantiates QuickJS, injects globals, runs code (Bun new URL(...) form)
│   # (iframeSandbox.ts)   # transport (B) fallback — only if spike rejects A
├── readSnapshot.ts        # D-01: frozen plain-data views of ingest rows (by handle) + current features
├── curatedTurf.ts         # D-02: the explicit turf subset exposed in the boundary
├── outputCapture.ts       # D-10: console.log/warn/error capture + byte/line cap (D-14)
└── runCode.test.ts        # CODE-01 confinement + CODE-04 timeout + headline-script proofs (bun test)
```

### Pattern 1: QuickJS host-function injection (transport A)
**What:** Inside the worker, instantiate a QuickJS context with an empty global, then attach exactly the curated surface.
**When to use:** Transport (A) — the recommended path.
**Example:**
```typescript
// Source: github.com/justjake/quickjs-emscripten (README)  [CITED]
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'

const QuickJS = await getQuickJS()
const runtime = QuickJS.newRuntime()
runtime.setMemoryLimit(64 * 1024 * 1024)        // D-14 memory cap
runtime.setMaxStackSize(1024 * 512)
runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 3000)) // D-14 wall-clock

const vm = runtime.newContext()
// Inject ONE host object: authoring.* — every call posts an RPC message to the host.
const authoringObj = vm.newObject()
const circleFn = vm.newFunction('circle', (centerH, radiusH) => {
  const center = vm.dump(centerH); const radius = vm.dump(radiusH)
  const seq = nextSeq()
  postToHost({ op: 'circle', args: [center, radius], seq })   // host applies via createAuthoring
  return vm.newString(`pending:${seq}`)  // or block on a sync rendezvous — see Pattern 2
})
vm.setProp(authoringObj, 'circle', circleFn)
vm.setProp(vm.global, 'authoring', authoringObj)
circleFn.dispose(); authoringObj.dispose()
// NO fetch / XMLHttpRequest / localStorage / document are ever created → CODE-01 holds by omission.
const result = vm.evalCode(userCode)
```

### Pattern 2: Sync-looking `authoring.*` over an async boundary (the central RPC question)
**What:** User code calls `authoring.circle(...)` and expects it to "just work" synchronously; the host applies it on the main thread.
**Two viable shapes — pick during the spike:**
- **(A-sync) Buffer-then-apply (recommended default):** `authoring.*` host functions inside QuickJS **record** the call (push `{op,args}` into an in-boundary array) and return immediately. When the script finishes, the worker posts the *ordered batch* of recorded calls to the host, which replays them through `createAuthoring(editor)` in order. Clean, synchronous from the script's view, batches naturally into one undo step (the recommended write-commit granularity, CONTEXT discretion), and avoids any cross-boundary blocking. The script cannot read a `MutationResult` mid-run, but the headline scripts don't need to (they draw, they don't branch on per-call results).
- **(A-blocking) Synchronous rendezvous:** use `quickjs-emscripten`'s **asyncify** variant (`newAsyncContext` / `RELEASE_ASYNC`) so a host function can `await` the host's reply and return the real `MutationResult` into the script. More faithful but adds asyncify overhead and a bigger WASM. Only adopt if a script genuinely needs a return value from an `authoring.*` call.
**Recommendation:** Default to **(A-sync) buffer-then-apply** — it satisfies both headline scripts, gives batched-undo for free, and keeps the worker on the smaller RELEASE_SYNC variant.

### Pattern 3: Read snapshot without leaking live host objects (D-01)
**What:** Pass ingest rows + current features into the boundary as frozen plain data.
**Example:**
```typescript
// host side, in runCode.ts — runs BEFORE the boundary starts
function buildReadSnapshot(handleIds: string[], editor: GeoEditor) {
  const datasets = Object.fromEntries(
    handleIds.map((h) => [h, getDataset(h)?.fullRows ?? null]),   // D-01: full rows by handle
  )
  const features = editor.getAllFeatures().map(toPlainGeoJSON)     // structured-clonable copy, not live
  return structuredClone({ datasets, features })                  // throws on any non-clonable handle → fail-closed
}
// Inside the boundary this is exposed as a frozen `data` global. The MODEL never sees it
// (preserves Phase 3 D-11): only the sandbox reads rows by handle.
```

### Anti-Patterns to Avoid
- **Passing the live `GeoEditor` or the ingest `Map` across the boundary.** Defeats CODE-01/D-01. Always serialize a plain snapshot; `structuredClone` fails closed on a non-clonable leak.
- **Re-implementing a confirm/preview gate here.** D-08 forbids it — Phase 5 owns the gate at the interceptor. Just route writes through `createAuthoring` → `runInterceptors`.
- **Relying solely on the in-boundary interrupt handler for timeout.** A pathological host-callback or a wedged worker still needs the host-side wall-clock `setTimeout` → `terminate()` watchdog (defence in depth, CODE-04).
- **Building bespoke agentic retry machinery.** The `store.ts` loop already re-prompts on `role:'tool'` results — add only a per-`run_code` retry *counter* (D-06), don't fork the loop.
- **`sandbox="allow-scripts allow-same-origin"` (transport B).** Granting both lets the frame remove its own sandbox and reach `top.document` — a non-boundary `[CITED: MDN/HackTricks]`. If B is chosen, `allow-scripts` only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JS isolation / denying host globals | A custom `new Function` shim or property-stripping wrapper | `quickjs-emscripten` empty-global context (A) **or** opaque-origin sandboxed iframe (B) | Stripping globals off a shared realm is unprovable and routinely bypassed (prototype reach, `constructor.constructor`). A separate VM/origin is the only sound CODE-01 proof. |
| Wall-clock interrupt of a tight loop | A cooperative "check a flag every N statements" transpile pass | QuickJS `setInterruptHandler` + `shouldInterruptAfterDeadline` | The engine calls the interrupt during execution including inside tight loops; no source rewriting. `[CITED: quickjs-emscripten docs]` |
| Geometry/distance math | Hand-rolled haversine / point-in-polygon / buffering | curated `@turf/turf` subset (D-02) | Already installed, battle-tested, and the same functions `primitives.ts` uses. |
| Self-correction agent loop | A new retry/agent orchestrator | existing `store.ts` tool loop + D-16 `ToolError` envelope | The loop already feeds tool results back to the model every round; you only add a bounded counter. |
| Tool error → model + UI plumbing | A new error channel | `tools/errors.ts` `ToolError` (`handler_error`) | Already serialized into `role:'tool'` and rendered distinctly in `ChatPanel.tsx`. |

**Key insight:** Nearly every hard part of this phase is *already solved upstream* — the only genuinely new, genuinely risky element is the transport primitive, which is precisely what the spike de-risks first.

## Runtime State Inventory

> Not a rename/refactor/migration phase — greenfield additive feature. Section included for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — sandbox is fresh-per-run (D-05), no persistence. | None |
| Live service config | None — no external service touched; sandbox has no network (CODE-01). | None |
| OS-registered state | None. | None |
| Secrets/env vars | None — the entire point is that the sandbox cannot reach the signer/wallet/keys. | None |
| Build artifacts | New worker/WASM chunk emitted by `build.ts` (the `new Worker(new URL(...))` form already emits a chunk for the ingest worker — verify the QuickJS `.wasm` asset also emits, or use the inlined singlefile variant). | Spike verifies prod-bundle emission |

**Nothing found in categories 1–4:** verified — this is an isolated, stateless, additive capability.

## Common Pitfalls

### Pitfall 1: QuickJS `.wasm` asset not served by `Bun.serve()` in production
**What goes wrong:** Dev HMR bundles the `.wasm`, but the html-driven `build.ts` + the prod `Bun.serve()` static handler (`src/index.ts`) may not emit/serve the `.wasm` chunk, so the sandbox fails to load in prod only.
**Why it happens:** `build.ts` globs `**.html` entrypoints and relies on Bun's bundler to trace assets; a `.wasm` referenced only through the variant loader's `new URL('…','import.meta.url')` must be traced and copied, and the prod server only serves from `dist/` + `public/`.
**How to avoid:** The spike's success criterion (c) — *serves correctly in `Bun.serve()` dev AND prod* — must explicitly run a production `bun run build` + `bun start` and load the sandbox. If the `.wasm` doesn't emit/serve cleanly, fall back to the **inlined singlefile variant** (no separate asset) — that is exactly why it's listed in the stack.
**Warning signs:** 404 on a `*.wasm` URL in prod; "failed to instantiate WebAssembly" only after `build:production`.

### Pitfall 2: Worker module bundling under the prod build
**What goes wrong:** The worker file doesn't get its own chunk in `dist/`, so `new Worker(new URL('./sandbox.worker.ts', import.meta.url))` 404s in prod.
**Why it happens:** Historically this exact issue bit Phase 3 (the ingest worker chunk "was missing" — see `ingestClient.ts` doc comment) and was solved by using the precise `new Worker(new URL(...), { type: 'module' })` form.
**How to avoid:** Reuse the **verbatim** Phase 3 worker-spawn form. The ingest worker proves it emits under `build.ts`; mirror it.
**Warning signs:** Worker works in `bun dev` but 404s after `bun run build`.

### Pitfall 3: Treating the in-boundary interrupt as the only timeout
**What goes wrong:** A script that wedges *inside a host callback* (or a worker that stops pumping messages) never returns even though the deadline passed.
**Why it happens:** `setInterruptHandler` only fires while QuickJS is executing *its* bytecode; time spent in a host function or a stalled worker isn't covered.
**How to avoid:** Host-side wall-clock watchdog: `const t = setTimeout(() => worker.terminate(), deadlineMs + slack)`; clear it on normal completion. This is the CODE-04 "without freezing the app" guarantee and the D-13 retryable-timeout source.
**Warning signs:** Timeout test passes for `while(true){}` but hangs for a script that calls `authoring.*` in a tight loop.

### Pitfall 4: Output not capped → giant `console.log` floods the transcript and the model
**What goes wrong:** `console.log` in a loop produces megabytes; it bloats the chat, the model context, and may freeze rendering.
**Why it happens:** No byte/line cap on captured output (D-14).
**How to avoid:** Cap captured output at a fixed byte+line budget (D-14, planner-chosen); on overflow truncate with a "…(output truncated)" marker. The capped output is what both the UI (D-10) and the model see.
**Warning signs:** Transcript jank or context-overflow errors right after a `run_code` with logging.

### Pitfall 5: `structuredClone` / serialization of the read snapshot silently dropping data
**What goes wrong:** A feature with a non-clonable property (function, DOM node, class instance) throws or is dropped, so the sandbox sees partial data and the model "self-corrects" against a phantom bug.
**Why it happens:** Editor features or ingest rows may carry non-plain values.
**How to avoid:** Normalize to plain GeoJSON / plain rows before cloning; let `structuredClone` throw (fail-closed) rather than passing a live handle. Add a test with a feature carrying an exotic property.
**Warning signs:** Sandbox reports "undefined is not iterable" on data the host clearly has.

### Pitfall 6: React 19 / HMR double-spawning workers in dev
**What goes wrong:** Fast-refresh re-runs the module and leaks workers / QuickJS runtimes.
**Why it happens:** Module-level worker singletons + HMR.
**How to avoid:** Fresh-spawn-per-run + explicit `terminate()`/`dispose()` (D-05 already mandates this) — never a module-level long-lived runtime. Dispose every QuickJS handle (`.dispose()`) and `terminate()` the worker in a `finally`.
**Warning signs:** Climbing memory across runs in dev; "runtime still has N undisposed handles" warnings from QuickJS DEBUG variant.

## Code Examples

### Headline script #1 — fibonacci circles (CODE-05), as the model would emit it
```typescript
// runs INSIDE the boundary; `authoring` is the only host-mutation global
let a = 1, b = 1
const center = [14.5, 47.5]  // [lon, lat]
for (let i = 0; i < 15; i++) {
  authoring.circle(center, a * 100, { units: 'meters' }) // a*100 m radius
  ;[a, b] = [b, a + b]
}
return `drew 15 circles, max radius ${a * 100}m`
```

### Headline script #2 — cost-weighted path (CODE-06), shape
```typescript
// `data.datasets[handle]` = full ingested rows (overfly fees per country); turf curated subset available
const fees = data.datasets[feeHandle]          // [{country, eurPerKm}, ...]
const direct = turf.lineString([[16.37,48.21],[17.91,44.79]])  // Vienna→Sarajevo
const viaSLO  = turf.lineString([[16.37,48.21],[14.5,46.05],[17.91,44.79]])
function cost(line) { /* segment length × per-country fee via turf.length + lookup */ }
const chosen = cost(viaSLO) < cost(direct) ? viaSLO : direct
authoring.addFeature(chosen)
return { chosenCostEUR: cost(chosen), variants: { direct: cost(direct), viaSLO: cost(viaSLO) } }
```

### Curated turf surface (D-02) — verified present in `@turf/turf@7.3.5`
```typescript
// Source: node require('@turf/turf') — all verified typeof 'function' on 2026-06-18  [VERIFIED]
export const curatedTurf = {
  circle, distance, buffer, area, length, bearing, destination,
  point, lineString, along, nearestPointOnLine, booleanPointInPolygon, centroid,
} // planner trims/extends as needed; bundle INTO the boundary, don't RPC per call
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vm2` for untrusted JS in JS | QuickJS-WASM (separate VM, no shared realm) | `vm2` deprecated 2023 after sandbox-escape CVEs | Don't reach for `vm2`; QuickJS-WASM is the maintained, escape-resistant standard. `[ASSUMED]` |
| Worker spawned from a string/Blob URL | `new Worker(new URL('./x.worker.ts', import.meta.url), {type:'module'})` (bundler-traced) | Modern bundlers (Bun included) | Phase 3 proves this form emits a chunk under `build.ts`; reuse it. `[VERIFIED: repo ingest worker]` |

**Deprecated/outdated:**
- `vm2` — abandoned due to unfixable escapes; not a candidate.
- All-variants `quickjs-emscripten` (2.4 MB) when bundle size matters → prefer `-core` + a single variant.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The inlined `@jitl/quickjs-singlefile-mjs-release-sync` variant is a safe first-party fallback despite low downloads | Stack / Audit | If avoided, the `.wasm`-asset path must work under prod `Bun.serve()` (Pitfall 1); spike resolves either way. Gated behind `checkpoint:human-verify`. |
| A2 | Buffer-then-apply (A-sync) RPC is sufficient — no script needs a mid-run `MutationResult` | Pattern 2 | If a real script must branch on a per-call result, switch to the asyncify (A-blocking) variant — larger WASM, more complexity. Spike should test both headline scripts against A-sync. |
| A3 | The existing `store.ts` tool loop suffices for self-correction with only an added retry counter | Don't Hand-Roll / Self-correction | If the loop's existing max-iterations behavior conflicts with the per-`run_code` cap, a small loop change is needed — verify against `store.ts` max-iteration logic during planning. |
| A4 | `vm2`/SES are inferior to QuickJS for the CODE-01 proof | Alternatives | Low — QuickJS's empty-realm model is the cleanest provable boundary; this only affects the rationale, not the recommendation. |
| A5 | QuickJS WASM instantiation cost is acceptable per-run (fresh sandbox, D-05) | Discretion (cold-start) | If per-run instantiation is too slow for the demo, pool/reuse runtimes with a hard reset between runs — still clean teardown. Measure in spike. |

## Open Questions

1. **Does the QuickJS `.wasm` asset emit + serve under prod `Bun.serve()`?**
   - What we know: dev HMR handles it; the Phase 3 *worker* chunk emits under `build.ts`; the prod server serves only `dist/` + `public/`.
   - What's unclear: whether a variant-loaded `.wasm` is traced/copied into `dist/`.
   - Recommendation: spike criterion (c) must run `bun run build:production` + `bun start`; if it fails, use the inlined singlefile variant.

2. **A-sync (buffer-then-apply) vs A-blocking (asyncify) RPC.**
   - What we know: both headline scripts only *draw* and *return a value*; neither branches on a per-call `MutationResult`.
   - What's unclear: whether the model will naturally write code expecting a return from `authoring.*`.
   - Recommendation: default A-sync; document the asyncify upgrade path; let the spike try both headline scripts.

3. **Per-`run_code` retry cap vs the store loop's global max-iterations.**
   - What we know: `store.ts` runs an unbounded `while(true)` round loop driven by tool calls; `totalToolCalls` is tracked.
   - What's unclear: exact interaction between a new per-run retry counter and existing iteration bounds.
   - Recommendation: read the max-iteration logic in `store.ts` during planning; scope the D-06 cap as a counter local to `run_code` self-correction.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | runtime / build / tests | ✓ | 1.3.11 | — |
| `@turf/turf` | curated math (D-02) | ✓ | 7.3.5 (installed) | — |
| Web Worker support | transport (A) | ✓ (browser; proven by Phase 3 ingest worker) | — | sync/main-thread QuickJS (jank risk) |
| WebAssembly | QuickJS engine | ✓ (browsers + Bun) | — | none (hard requirement for A) — choose transport B |
| `quickjs-emscripten` | transport (A) | ✗ (not yet installed) | 0.32.0 on registry | transport B (sandboxed iframe) |

**Missing dependencies with no fallback:** none (transport B is a viable fallback for the whole approach).
**Missing dependencies with fallback:** `quickjs-emscripten` not yet installed — installed during the spike; if WASM-in-worker fails, fall back to transport B.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun's built-in runner, v1.3.11) |
| Config file | none — Bun convention (`*.test.ts`) |
| Quick run command | `bun test src/features/chat/sandbox/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CODE-01 | Sandbox denies `fetch`/DOM/`localStorage`/signer/wallet | confinement (unit) | `bun test src/features/chat/sandbox/runCode.test.ts -t confinement` | ❌ Wave 0 |
| CODE-01 | Static boundary: sandbox host imports nothing from signer/wallet beyond Authoring API | static-import scan (extends `boundary.test.ts`) | `bun test -t "import boundary"` | ◐ extend existing |
| CODE-02 | Only `authoring.*` + curated turf/read globals exposed; no other host object reachable | unit (enumerate boundary globals) | `bun test src/features/chat/sandbox/runCode.test.ts -t "surface"` | ❌ Wave 0 |
| CODE-03 | Runtime error → `ToolError(handler_error)` serialized into `role:'tool'` for the model | unit | `bun test -t "error feedback"` | ❌ Wave 0 |
| CODE-04 | `while(true){}` is terminated by wall-clock; promise settles; main thread responsive | unit (deterministic, injectable deadline) | `bun test src/features/chat/sandbox/runCode.test.ts -t timeout` | ❌ Wave 0 |
| CODE-04 | Output over byte/line cap is truncated, not unbounded | unit | `bun test -t "output cap"` | ❌ Wave 0 |
| CODE-05 | 15-fibonacci-circles script yields `MutationCounts.created === 15` via headless editor | integration (headless `createHeadlessEditor`) | `bun test -t "fibonacci"` | ❌ Wave 0 |
| CODE-06 | Cost-weighted path script reads handle rows + returns chosen route + draws 1 feature | integration | `bun test -t "overfly"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test src/features/chat/sandbox/` + `bun run lint`
- **Per wave merge:** `bun test` (full suite) + `bun run build` (proves worker/WASM chunk emits)
- **Phase gate:** Full suite green + a manual `bun run build:production` && `bun start` sandbox smoke (Pitfall 1) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/features/chat/sandbox/runCode.test.ts` — confinement (CODE-01), surface (CODE-02), timeout + output cap (CODE-04), error feedback (CODE-03), both headline scripts (CODE-05/06)
- [ ] Extend `src/features/geo-editor/api/boundary.test.ts` (or a sibling sandbox boundary test) to scan the new sandbox host module
- [ ] Test fixture: an "overfly fees" CSV/JSON dataset put into the ingest store by handle (CODE-06 input)
- [ ] Spike harness proving QuickJS instantiates + interrupts under `bun test` (deterministic deadline) AND emits/serves under `bun run build`
- [ ] Framework install: `bun add quickjs-emscripten` (during the spike)

## Security Domain

> `security_enforcement: true`, ASVS level 1. This phase **is** a security boundary (CODE-01), so this section is load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Isolation boundary (separate VM/origin) is the security architecture; documented + tested (Confinement Proof). |
| V4 Access Control | yes | The sandbox can reach **only** `createAuthoring`'s geometry surface — no signer/wallet/store. Enforced structurally (facade) + by import-boundary test. |
| V5 Input Validation | yes | `authoring.*` already validates radius/distance (V5 caps in `primitives.ts`); read snapshot normalized + `structuredClone` fail-closed; output capped. |
| V6 Cryptography | no (negative requirement) | The *goal* is that the sandbox **cannot** reach the Nostr signing key or the Cashu wallet — verified by the confinement proof, never exposed. |
| V12 Files/Resources | yes | No filesystem/network from the sandbox (CODE-01); turf + data are in-memory only. |
| V14 Config | yes | Fixed hardcoded timeout/memory/output caps (D-14); no user-tunable knobs this phase. |

### Known Threat Patterns for {QuickJS-in-Worker / sandboxed-iframe + chat-driven codegen}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sandbox escape to read `nsec`/Cashu wallet | Information Disclosure / Elevation | Separate VM (QuickJS empty realm) or opaque-origin frame; no host globals; confinement test (CODE-01). |
| Data exfiltration via `fetch`/network | Information Disclosure | No network primitive exists in the boundary; `authoring.*` is geometry-only; out-of-scope per REQUIREMENTS "Out of Scope". |
| DoS via infinite loop / huge geometry | Denial of Service | Wall-clock interrupt + host watchdog `terminate()` (CODE-04); `setMemoryLimit`; existing `MAX_DISTANCE_METERS` cap in `primitives.ts`. |
| Output flooding (context/UI) | Denial of Service | Byte/line output cap (D-14). |
| Live-object leak via read snapshot | Information Disclosure / Tampering | Pass only `structuredClone`d plain data; never the live editor/`Map` (D-01, Pitfall 5). |
| Bypassing the (future) Phase-5 safety gate | Tampering | Route ALL sandbox writes through `createAuthoring` → `runInterceptors()` (D-08); a write path that skips the facade is a boundary hole — extend the A3 `addFeature`-bypass test to cover the sandbox. |
| Sandboxed-iframe re-enabling same-origin (transport B only) | Elevation | `allow-scripts` **without** `allow-same-origin`; never grant both (Anti-Patterns). |

## Sources

### Primary (HIGH confidence)
- Repo source read directly: `src/features/geo-editor/api/{authoring,interceptor,results,primitives}.ts`, `boundary.test.ts`, `src/features/chat/ingest/{ingestStore,ingest.worker,ingestClient}.ts`, `src/features/chat/tools/{registry,errors,execute}.ts`, `src/features/chat/store.ts` (tool loop), `src/features/chat/ChatPanel.tsx` (tool render), `build.ts`, `src/index.ts` (serving).
- npm registry (`npm view` + downloads API + legitimacy seam): `quickjs-emscripten`, `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`, `@jitl/quickjs-singlefile-mjs-release-sync` — versions, age, downloads, no-postinstall (2026-06-18).
- `node require('@turf/turf')` — verified the curated function set exists in 7.3.5.

### Secondary (MEDIUM confidence)
- `github.com/justjake/quickjs-emscripten` README/docs (via WebFetch) — `getQuickJS`, `newFunction`, `setInterruptHandler`, `shouldInterruptAfterDeadline`, `setMemoryLimit`/`setMaxStackSize`, variants, no-host-globals-by-default, WASM loading.

### Tertiary (LOW confidence)
- WebSearch — iframe `sandbox`/CSP isolation semantics (MDN/HackTricks), QuickJS interrupt/async host-function patterns. Used to characterize transport (B) and corroborate (A); cross-checked against the QuickJS docs above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — packages verified on registry + legitimacy seam (OK), turf functions verified by `require`, no postinstall.
- Architecture / integration seams: HIGH — read directly from current repo source; the loop, registry, facade, interceptor, ingest store, and render path all exist as described.
- Transport recommendation: MEDIUM-HIGH — QuickJS API confirmed via official docs; the single residual unknown (prod `.wasm` serving) is the explicit subject of the mandated spike, with a concrete fallback.
- Pitfalls: HIGH — Pitfalls 1–2 are grounded in the documented Phase 3 worker-chunk experience; 3–6 follow from the verified APIs.

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (stable; QuickJS at 0.32.0, turf installed) — re-verify `quickjs-emscripten` version at spike time.
