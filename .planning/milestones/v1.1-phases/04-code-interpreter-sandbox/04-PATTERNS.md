# Phase 4: Code Interpreter Sandbox - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 9 new + 1 extended
**Analogs found:** 8 / 9 (one greenfield: the QuickJS worker transport)

## File Classification

Proposed structure from RESEARCH.md §"Recommended Project Structure" (transport-agnostic surface + transport impl). Roles/data-flow per file:

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/features/chat/sandbox/runCode.ts` | tool handler | request-response (RPC) | `src/features/chat/tools/primitives-tools.ts` | exact |
| `src/features/chat/sandbox/sandboxHost.ts` | service (transport-agnostic) | event-driven (message RPC) | `src/features/chat/ingest/ingestClient.ts` | role-match |
| `src/features/chat/sandbox/transport/quickjsWorker.ts` | service (worker client) | event-driven (postMessage) | `src/features/chat/ingest/ingestClient.ts:132-169` | role-match |
| `src/features/chat/sandbox/transport/sandbox.worker.ts` | worker | streaming/transform | `src/features/chat/ingest/ingest.worker.ts` (+ `lib/geo/geoJsonParseWorker.ts`) | role-match (greenfield engine) |
| `src/features/chat/sandbox/readSnapshot.ts` | utility | transform (serialize) | `ingestStore.getDataset` + `GeoEditor.getAllFeatures` | role-match |
| `src/features/chat/sandbox/curatedTurf.ts` | utility/config | transform (pure compute) | `src/features/geo-editor/api/primitives.ts` | exact |
| `src/features/chat/sandbox/outputCapture.ts` | utility | streaming (capture+cap) | none direct (truncation idioms in `execute.ts`/`store.ts` MAX_* caps) | partial |
| `src/features/chat/sandbox/runCode.test.ts` | test | — | `src/features/geo-editor/api/boundary.test.ts` | exact (confinement) |
| Tool registration (in `runCode.ts` via injected `register`) | config | — | `primitives-tools.ts:117` / `ingest-tools` injected-register | exact |
| `boundary.test.ts` (EXTEND, or sibling sandbox boundary test) | test | — | `src/features/geo-editor/api/boundary.test.ts:35-57` | exact |

## Pattern Assignments

### `src/features/chat/sandbox/runCode.ts` (tool handler, request-response)

**Analog:** `src/features/chat/tools/primitives-tools.ts` (registers `draw_circle`/`buffer_feature` via the injected `register`; resolves the editor; dispatches into `createAuthoring`; wraps failures so `registry.dispatch` produces a `ToolError`).

**Injected-register registration pattern** (`primitives-tools.ts:106-152`) — COPY verbatim, including the circular-import doc comment rationale. `run_code` registers with mandatory `kind` (add a new `ToolKind` literal in `registry.ts:59`, e.g. `'code-interpreter'`):
```typescript
export function registerSandboxTools(register: (entry: ToolEntry) => void): void {
  register({
    name: 'run_code',
    kind: 'code-interpreter',   // NEW ToolKind literal added to registry.ts:59
    schema: runCodeSchema,
    handler: async (args) => { /* snapshot → execute → collect → throw on fail */ },
  })
}
```
Wire it into `registry.ts:bootstrapRegistry` (`registry.ts:995-1008`) next to `registerPrimitiveTools(register)` / `registerIngestTools(register)` — **inject `register`, never import `./registry` back** (the dev-bundler circular-init crash documented at `primitives-tools.ts:106-116` and `registry.ts:1000-1007`).

**Editor + Authoring resolution** (`primitives-tools.ts:26-32`) — COPY verbatim. The sandbox host applies recorded `authoring.*` calls through exactly this facade:
```typescript
function resolveAuthoring() {
  const { editor } = useEditorStore.getState()
  if (!editor) throw new Error('Map editor is not ready. Open the map editor first, then try again.')
  return createAuthoring(editor)
}
```

**Error contract (D-11/D-16)** — DIFFERS from primitives in one way: a runtime/timeout error inside the sandbox must throw with the **full** error string so `registry.dispatch` (`registry.ts:117-127`) wraps it into `ToolError(handler_error)` fed to the model. The user-facing one-liner is handled by the existing `ChatPanel` ToolError render (see below) — do NOT build a second error channel. Reuse `registry.dispatch`'s try/catch verbatim; it already serializes into `role:'tool'` (`execute.ts:32-50`).

---

### `src/features/chat/sandbox/transport/quickjsWorker.ts` + `sandbox.worker.ts` (worker client + worker)

**Analog:** `src/features/chat/ingest/ingestClient.ts:132-169` — the lazy `getWorker()` singleton, onmessage pending-request resolution, onerror sync-fallback + `terminate()`.

**Worker-spawn form (Pitfall 2 — MUST be verbatim, this exact form is what `build.ts` emits a chunk for)** (`ingestClient.ts:141-142`, identical at `lib/geo/workerJsonParse.ts:26`):
```typescript
worker = new Worker(new URL('./sandbox.worker.ts', import.meta.url), { type: 'module' })
```
The repo has THREE proven precedents of this exact form: `ingestClient.ts:142`, `workerJsonParse.ts:26`, and `ingest/parse.ts:6` doc. Mirror it; any other spawn form (Blob URL, string) 404s after `bun run build`.

**Teardown (D-05 / CODE-04)** — DIFFERS from ingest's persistent worker: the sandbox is **fresh-per-run** with `terminate()` in a `finally` (RESEARCH Pitfall 6). Pattern the onerror/terminate latch off `ingestClient.ts:152-162` but spawn-per-run instead of a module singleton. Add the host-side wall-clock watchdog (RESEARCH Pitfall 3):
```typescript
const t = setTimeout(() => worker.terminate(), deadlineMs + slack)  // fires regardless of in-VM interrupt
// clear t on normal completion
```

**Greenfield:** the QuickJS engine instantiation inside `sandbox.worker.ts` (`getQuickJS()`, `newRuntime()`, `setInterruptHandler(shouldInterruptAfterDeadline(...))`, `setMemoryLimit`, host-function injection of `authoring.*`/`data`/`turf`/`console`) has NO repo analog — it is the spike deliverable. Build it from RESEARCH §Pattern 1/2 (`quickjs-emscripten@0.32.0`). Mirror the message-shape discipline of `ingest.worker.ts` (typed request/response messages keyed by id).

---

### `src/features/chat/sandbox/readSnapshot.ts` (utility, transform — D-01)

**Analog (read seam 1, ingest by handle):** `ingestStore.getDataset(handleId)` (`ingestStore.ts:74-82`) — the ONLY accessor returning `fullRows`. The sandbox reads by handle here; the model never gets rows (preserves the Phase 3 D-11 seam — `ingestStore.ts:1-18`).

**Analog (read seam 2, current features):** `GeoEditor.getAllFeatures()` (`GeoEditor.ts:1155`) returns `EditorFeature[]`; `getFeature(id)` at `GeoEditor.ts:1151`.

**Pattern (RESEARCH §Pattern 3)** — build a **frozen plain-data** snapshot; never pass the live editor or the ingest `Map`. `structuredClone` fail-closed (Pitfall 5):
```typescript
function buildReadSnapshot(handleIds: string[], editor: GeoEditor) {
  const datasets = Object.fromEntries(
    handleIds.map((h) => [h, getDataset(h)?.fullRows ?? null]),  // ingestStore.ts:74
  )
  const features = editor.getAllFeatures().map(toPlainGeoJSON)    // GeoEditor.ts:1155, plain copy
  return structuredClone({ datasets, features })                 // throws on a non-clonable leak
}
```

---

### `src/features/chat/sandbox/curatedTurf.ts` (utility/config, pure transform — D-02)

**Analog:** `src/features/geo-editor/api/primitives.ts` — the turf-in-host pattern (`makeCircle`/`makeBuffer` import `{ buffer, circle } from '@turf/turf'`, `primitives.ts:24`).

**Pattern:** named-export a curated turf subset bundled INTO the boundary (don't RPC per call). RESEARCH verified-present set:
```typescript
export const curatedTurf = {
  circle, distance, buffer, area, length, bearing, destination,
  point, lineString, along, nearestPointOnLine, booleanPointInPolygon, centroid,
}
```
**Reuse the V5 distance cap from `primitives.ts`:** `MAX_DISTANCE_METERS = 40_075_000` (`primitives.ts:41`) and `validateDistance` (`primitives.ts:64-80`) bound turf inputs so a sandbox loop can't generate freezing geometry (DoS mitigation, RESEARCH Security Domain). `authoring.circle`/`buffer` already enforce this on the WRITE path (`primitives.ts:97-111`).

---

### `src/features/chat/sandbox/outputCapture.ts` (utility, streaming — D-10/D-14)

**Analog (closest):** the `MAX_*_CHARS` truncation idiom in `store.ts:45-49` (`MAX_TOOL_MESSAGE_CHARS = 12000`) and the arguments-preview truncation in `execute.ts:29-30`. No direct console-capture analog exists — partial match.

**Pattern:** capture `console.log/warn/error` lines emitted from the boundary into a bounded buffer; on overflow truncate with a `…(output truncated)` marker (RESEARCH Pitfall 4). The capped output is what BOTH the UI (D-10) and the model see. Output summary feeds the same `role:'tool'` content envelope (`execute.ts:65-69`).

---

### `src/features/chat/sandbox/runCode.test.ts` + boundary extension (test)

**Analog:** `src/features/geo-editor/api/boundary.test.ts` — the EXACT import-forbidding pattern the CODE-01 confinement proof extends.

**Import-boundary scan to MIRROR** (`boundary.test.ts:17-57`) — the forbidden-import regex list + per-file scan. Extend its scope (or add a sibling test) to the new `chat/sandbox/` module; the sandbox host must not import signer/wallet/Nostr beyond the Authoring API:
```typescript
const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
  /@\/features\/chat/, /chat\/tools/, /@\/lib\/ndk/, /@\/lib\/nostr/,
  /['"]nostr/, /applesauce/, /@modelcontextprotocol/, /@contextvm/,
]
```
Note: `chat/sandbox/` legitimately lives under `@/features/chat`, so the sandbox boundary test needs a tuned variant (forbid signer/wallet/Nostr/NDK, ALLOW the Authoring API + registry types) rather than the verbatim list.

**Surface-enumeration assertion to MIRROR** (`boundary.test.ts:125-140`) — the `Object.keys(authoring)` geometry-only assertion. CODE-02 adds a sibling: enumerate the boundary's injected globals and assert exactly `authoring`/`turf`/`data`/`console` are present and `fetch`/`localStorage`/`document`/`signer`/`wallet` are absent.

**Headless editor for CODE-05/06 integration** — `createHeadlessEditor()` (`test-harness.ts:120`, already used by `boundary.test.ts:5,127`). Drive the fibonacci-15-circles script → assert `MutationCounts.created === 15` (`results.ts:21-26`).

---

## Shared Patterns

### Authoring facade = sole host mutation surface (D-03)
**Source:** `src/features/geo-editor/api/authoring.ts` — `createAuthoring(editor)` returns `{ addFeature, writeGeoJSON, editorCommand, circle, buffer }` (geometry-only; the surface assertion lives at `boundary.test.ts:133`).
**Apply to:** `runCode.ts`, `sandboxHost.ts`. The sandbox records `authoring.*` calls; the host replays them through this facade (RESEARCH §Pattern 2 buffer-then-apply). NO signer/wallet/store reachable — structurally true.

### Interceptor seam — route ALL writes through it, build NO gate (D-08)
**Source:** `src/features/geo-editor/api/interceptor.ts` — `runInterceptors(ctx, chain)` (default empty pass-through, `interceptor.ts:47-59`). Already called inside every `authoring` write (`authoring.ts:114, 136, 164`).
**Apply to:** sandbox writes get this for free by going through `createAuthoring`. Do NOT add a confirm/preview gate (Phase 5 owns it). A write path that bypasses `createAuthoring` is a boundary hole — the `addFeature`-bypass test (`boundary.test.ts:90-110`) should be extended to cover the sandbox.

### MutationResult contract (D-10)
**Source:** `src/features/geo-editor/api/results.ts` — `MutationResult { ok, intent, featureIds, counts }`, `MutationCounts { created, updated, deleted, skippedDuplicates }`.
**Apply to:** the output block's "authoring result summary" (created/updated/deleted counts) and the collapsed summary line ("Ran code → 15 features created"). `authoring.circle` already returns this (`authoring.ts:180-190`).

### Tool error → model loop AND chat UI (D-16)
**Source:** `src/features/chat/tools/errors.ts` (`ToolError`, `isToolError`) + `registry.ts:117-127` (dispatch try/catch) + `execute.ts:40-50` (serialize into `role:'tool'`).
**Apply to:** runtime errors (D-11) and timeouts (D-13). Throw the full error from the `run_code` handler; the registry wraps it; the store loop re-prompts. No new error channel.

### Self-correction loop — add only a counter, don't fork (D-04/D-06)
**Source:** `src/features/chat/store.ts:1404` (`while (true)` tool loop), `:1534-1628` (executes each tool call, appends `role:'tool'`, `continue`s to re-prompt). The loop ALREADY feeds every tool result back — that IS self-correction. `totalToolCalls` tracked at `:1358, 1538`.
**Apply to:** D-06 is a per-`run_code` retry **counter** scoped to the handler/sandbox, NOT a change to the store loop (RESEARCH Open Question 3 / A3). After 2–3 failed retries, return a final `ToolError` and stop.

### Collapsible code/output block (D-07/D-09/D-10)
**Source:** `src/features/chat/ChatPanel.tsx` — `ToolResultDisclosure` (`:1747-1836`, collapsed-by-default `▸/▾`, preview lines + expand) and the `ToolError` render path (`:1455-1482`, distinct red bubble). `MessageBubble` dispatches by `role === 'tool'` (`:1430, 1455-1493`).
**Apply to:** the code+output block reuses the `ToolResultDisclosure` collapse idiom verbatim; each self-correction attempt renders as its own collapsed `role:'tool'` message (D-07) since each retry is already a separate tool message in the transcript. The concise user-facing error reuses the existing red ToolError bubble (`:1459-1480`).

### Worker-chunk emission under build.ts (Pitfall 2)
**Source:** `ingestClient.ts:142`, `workerJsonParse.ts:26` — the verbatim `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` form proven to emit a chunk under `build.ts` + dev `Bun.serve()` HMR.
**Apply to:** `quickjsWorker.ts`. The NEW risk is the QuickJS `.wasm` ASSET (not the worker chunk) — RESEARCH Pitfall 1 / Open Question 1; the spike must run `bun run build:production && bun start`. Fallback: inlined `@jitl/quickjs-singlefile-mjs-release-sync` variant.

## No Analog Found

| File / Symbol | Role | Data Flow | Reason |
|------|------|-----------|--------|
| QuickJS engine instantiation inside `sandbox.worker.ts` (`getQuickJS`/`newRuntime`/`setInterruptHandler`/host-function injection) | worker engine | transform | No prior untrusted-JS isolation in the repo; this is the spike deliverable. Build from RESEARCH §Pattern 1/2 against `quickjs-emscripten@0.32.0`. Worker *plumbing* mirrors `ingest.worker.ts`; the engine itself is greenfield. |
| `outputCapture.ts` console-stream capture | utility | streaming | No console-capture analog; only the `MAX_*_CHARS` truncation idiom (`store.ts:45`) partially applies. |

## Metadata

**Analog search scope:** `src/features/geo-editor/api/`, `src/features/chat/tools/`, `src/features/chat/ingest/`, `src/features/chat/store.ts`, `src/features/chat/ChatPanel.tsx`, `src/lib/geo/` (worker), `src/features/geo-editor/core/`.
**Files scanned:** ~16 (8 read in full, 8 grepped).
**Pattern extraction date:** 2026-06-18
