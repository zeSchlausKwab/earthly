# Architecture Research

**Domain:** AI chat data-ingest, sandboxed code interpreter, and safe map authoring inside an existing React/MapLibre/Nostr app (Earthly v1.1)
**Researched:** 2026-06-16
**Confidence:** HIGH (grounded in the actual `src/` tree; integration patterns verified against real files)

> Scope note: This is a **subsequent milestone on a mature app**. The architecture below is an *integration proposal* — it extends existing systems (`commands.ts` registry, GeoEditor managers, workspace binding, encrypted settings) rather than introducing parallel ones. Every "new" component is justified against what already exists, and the build order front-loads the prerequisites the rest depend on.

---

## What already exists (verified)

| Concern | Reality in the codebase | Implication for v1.1 |
|---------|-------------------------|----------------------|
| Editor command registry | `src/features/geo-editor/commands.ts` — `EditorCommandDefinition[]` with `id`, `canExecute`, `execute(state,args)`, `ai.{toolName,description,parameters}`, dispatched via `editorCommandByToolName` Map. `getEditorAiToolDefinitions()` + `executeEditorAiTool()` already generate and dispatch `editor_*` tools. | **This is the clean API pattern already.** The "toolbar/drawing API" should be an evolution of this registry, not a new abstraction. |
| Chat tool dispatch | `src/features/chat/tools/execute.ts` — a single `switch(toolCall.function.name)` (~660 lines). `default:` falls through to `executeEditorAiTool`. | The switch is the **disorganized** half. `web_search`/`fetch_url`/`wikipedia_lookup` ARE actually dispatched here (lines 740–779) — but they are hand-wired, not registered. Refactor target. |
| Tool schemas | `src/features/chat/tools/definitions.ts` — `geoTools: Tool[]` hand-authored array, splices in `editorCommandTools`. | Schemas live separately from executors → drift risk. Registry should co-locate schema + executor. |
| Editor engine | `GeoEditor.ts` + managers (`Layer/Rendering/Selection/Transform/Snap/History/Combine/Simplify/Boolean/LineOperations`). Public methods: `addFeature`, `setFeatures`, `getAllFeatures`, `getMapBounds/Center/Zoom`, `captureMapSnapshot`, `simplifySelectedFeatures`, `combineSelectedFeatures`, etc. | The drawing API wraps these. No parametric-shape primitives (circle/buffer) yet — those are net-new. |
| State slices | `editorCoreSlice`, `stanceSlice` (`browse\|focus\|author`), `mapStackSlice`, `catalogSlice`, `workspaceSlice` (has `sourceId`, `datasetKey`, `chatSessionId`, `activeDraftId`), `metadataSlice`, `publishingSlice`. | **Workspace already binds a chat session to a dataset** (`workspace.chatSessionId`, `datasetKey`). The "bound edit target" is mostly already modeled. |
| Chat ↔ workspace binding | `useDatasetManagement.ts` calls `createWorkspaceChat()` and `updateWorkspace(id,{chatSessionId})`; binds silently. | The data is there; v1.1 adds the **visible chip** + add/modify/delete intent + safety level. |
| Styling | Per-feature style props on `feature.properties` (`styleProperties.ts`: color/stroke/fill/radius/label) consumed by `RenderingManager`/`LayerManager` + `buildStyles.ts`. | No per-dataset / data-driven (attribute→style) layer exists. Net-new but slots above the existing per-feature layer. |
| Encrypted settings | `settingsStorage.ts` — `loadEncryptedChatSettings/saveEncryptedChatSettings(signer,pubkey,settings)`, nip44-preferred/nip04-fallback via `ISigner`, localStorage envelope `earthly.chat-settings.v1.<pubkey>`. | **The encrypt/decrypt-with-nsec pattern already exists.** v1.1 extends the payload (API keys, provider addresses) — not the mechanism. |
| Sandbox / worker infra | NONE for code execution. Only `src/lib/geo/workerJsonParse.ts` (blob parse) and TipTap iframes. No `xlsx`/`papaparse`/`comlink`/`quickjs` deps installed. | Code interpreter + file parsing are genuinely new infrastructure. |
| MCP transport | `EarthlyGeoServerClient` over Nostr (ContextVM). Hard payload-size constraints. | Sandbox runs **client-side**, not over MCP. File parsing also client-side to avoid the Nostr payload ceiling. |

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CHAT FEATURE (src/features/chat)                   │
│  ┌────────────┐   ┌──────────────────────────────────────────────────────┐    │
│  │ ChatPanel  │   │ store.ts  (tool-call round loop, streaming, budgeting) │    │
│  │   + file   │──▶│   executeToolCall(toolCall, ToolExecutionContext)      │    │
│  │   dropzone │   └───────────────┬──────────────────────────────────────┘    │
│  └────────────┘                   │ (NEW) dispatch via central ToolRegistry     │
│        │ upload                    ▼                                             │
│  ┌─────────────┐    ┌──────────────────────────────────────────────────────┐   │
│  │ IngestStore │◀───│ Tool Registry  (tools/registry.ts) — schema+executor   │   │
│  │ (parsed     │    │   • map/editor write tools   • OSM/Valhalla/web tools  │   │
│  │  datasets,  │    │   • editor_* (from commands) • (NEW) parametric/batch  │   │
│  │  by ref id) │    │   • (NEW) run_code / list_ingested / read_ingested     │   │
│  └─────────────┘    └───────┬───────────────────────────┬──────────────────┘   │
│        ▲                     │ run_code                   │ all editor mutations  │
│        │ parsed refs         ▼                            ▼                       │
│  ┌─────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐  │
│  │ FileParsers │   │ SandboxHost          │   │  Drawing/Authoring API        │  │
│  │ (csv/xlsx/  │   │ (Worker, postMessage │──▶│  (geo-editor/api/*)           │  │
│  │  json/geo/  │   │  RPC bridge)         │   │  "as-if-package" facade over  │  │
│  │  img/text)  │   │  generated JS runs   │   │  GeoEditor managers + commands │  │
│  └─────────────┘   └──────────────────────┘   └───────────────┬──────────────┘  │
└────────────────────────────────────────────────────────────────┼───────────────┘
                                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       GEO-EDITOR FEATURE (src/features/geo-editor)              │
│  ┌──────────────────────────┐   ┌──────────────────────────────────────────┐   │
│  │ commands.ts registry      │   │ store/ slices                            │   │
│  │ (editor commands + ai)    │   │  stance · mapStack · workspace(BINDING)  │   │
│  └────────────┬─────────────┘   │  (NEW) editTargetSlice · styleSlice       │   │
│               ▼                  └───────────────┬──────────────────────────┘   │
│  ┌──────────────────────────────────────────────┼─────────────────────────┐    │
│  │ GeoEditor.ts  +  managers                     ▼                          │    │
│  │  Layer · Rendering · Selection · Transform · Snap · History · Simplify   │    │
│  │  (NEW) StyleManager (data-driven attribute→paint)  (NEW) ParametricOps   │    │
│  └──────────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ encrypt/decrypt (signer)                        ▲ round-trip
        │                                                 │
┌───────┴────────────────┐                    ┌───────────┴───────────────────┐
│ Encrypted Settings      │                    │ Nostr (applesauce)            │
│ settingsStorage.ts      │                    │ kind 37515/37516 events,      │
│ (AccountManager signer) │                    │ style config in event tags    │
└─────────────────────────┘                    └───────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Where it lives |
|-----------|----------------|----------------|
| **Drawing/Authoring API** | Single "as-if-package" facade over editor mutations. Callable identically by UI, chat tools, and sandbox. No Zustand reach-across. | NEW: `src/features/geo-editor/api/` (e.g. `index.ts`, `authoringApi.ts`) |
| **Tool Registry** | Central `Map<toolName, {schema, execute}>`. Replaces the switch in `execute.ts`. Composes map/OSM/web/editor/sandbox tools. | NEW: `src/features/chat/tools/registry.ts` (executors move out of `execute.ts`) |
| **SandboxHost** | Owns the Worker, the postMessage RPC protocol, timeouts, error capture, and the API-call bridge. | NEW: `src/features/chat/sandbox/SandboxHost.ts` + `sandbox.worker.ts` |
| **FileParsers** | Pure functions: `File → ParsedDataset` (tabular rows, detected geometry columns, text, image meta). | NEW: `src/features/chat/ingest/parsers/*` |
| **IngestStore** | Holds parsed datasets keyed by `ref` id; exposes summaries to LLM context + full rows to tools/sandbox. | NEW: `src/features/chat/ingest/ingestStore.ts` (Zustand or chat-store slice) |
| **editTargetSlice** | The "bound edit target": dataset/context the chat may modify, add/modify/delete intent, safety level. | NEW slice in `geo-editor/store/` (built on existing `workspace.chatSessionId`/`datasetKey`) |
| **StyleManager** | Compiles attribute→style rules into MapLibre paint/layout; consumed by RenderingManager. | NEW manager in `geo-editor/core/managers/` |
| **DiffPreview** | Computes add/modify/delete diff between current dataset and a proposed feature set; renders a preview layer; gates apply. | NEW: `geo-editor/core/` helper + a ghost render layer |

---

## Recommended Project Structure

```
src/
├── features/
│   ├── geo-editor/
│   │   ├── api/                      # (NEW) the "as-if-package" authoring boundary
│   │   │   ├── index.ts              #   public exports — the ONLY entrypoint others import
│   │   │   ├── authoringApi.ts       #   createAuthoringApi(editor) → stable verbs
│   │   │   └── types.ts              #   AuthoringApi interface, ApiResult<T>, intents
│   │   ├── commands.ts               # extend: parametric/batch commands register here
│   │   ├── core/
│   │   │   └── managers/
│   │   │       ├── StyleManager.ts   # (NEW) data-driven attribute→paint
│   │   │       └── ParametricOps.ts  # (NEW) circle/buffer/grid generators (pure-ish)
│   │   └── store/
│   │       ├── editTargetSlice.ts    # (NEW) bound target + intent + safety level
│   │       └── styleSlice.ts         # (NEW) per-dataset style configs
│   └── chat/
│       ├── tools/
│       │   ├── registry.ts           # (NEW) central registry: name → {schema, execute}
│       │   ├── definitions.ts        # becomes a thin "collect schemas from registry"
│       │   ├── execute.ts            # shrinks to a registry lookup + dispatch
│       │   └── executors/            # (NEW) one file per tool family (osm, web, editor, ingest, code)
│       ├── ingest/
│       │   ├── ingestStore.ts        # (NEW) parsed datasets by ref id
│       │   ├── parsers/              # (NEW) csv.ts, xlsx.ts, json.ts, geojson.ts, image.ts, text.ts
│       │   └── geometrize.ts         # (NEW) rows+columns → GeoJSON heuristics
│       ├── sandbox/
│       │   ├── SandboxHost.ts        # (NEW) Worker lifecycle + RPC + timeout
│       │   ├── sandbox.worker.ts     # (NEW) worker entry; runs generated code
│       │   └── protocol.ts           # (NEW) message types shared host↔worker
│       └── settings/
│           └── encryptedSettings.ts  # extend settingsStorage.ts payload (keys/addresses)
```

### Structure Rationale

- **`geo-editor/api/` as a folder, not a file:** the PROJECT.md constraint ("designed as if it were a future package export") is satisfied by giving the API its own directory with a single `index.ts` barrel. Everything else (chat tools, sandbox, toolbar UI) imports only from `@/features/geo-editor/api`. This makes the future package extraction a `mv` + `package.json`, and an import-lint rule can forbid reaching past the barrel.
- **`tools/executors/` by family:** the current 660-line `execute.ts` mixes OSM tiling logic, geometry baking, and editor passthrough. Splitting by family keeps each executor testable and lets the registry compose them.
- **`chat/ingest` and `chat/sandbox` under chat, not geo-editor:** parsed files and generated code are chat concerns. They *call into* the geo-editor API but don't belong to the editor's domain.

---

## Architectural Patterns

### Pattern 1: The Authoring API as the single mutation seam

**What:** One factory `createAuthoringApi(editor: GeoEditor): AuthoringApi` returns a flat object of verbs. Three callers use the *same* object:
1. Direct UI (Toolbar buttons) — call `api.addFeatures(...)`.
2. Chat tool execution — registry executors call `api.*`.
3. Sandbox — the worker RPC bridge resolves each call to `api.*` on the host.

**When to use:** Every map mutation. The rule: **nothing mutates the editor except through this API.** `importFeaturesToEditor` in `helpers.ts` (which currently reaches into `useEditorStore.getState()`) gets reimplemented on top of it.

**Trade-offs:** One more indirection layer; but it is the explicit deliverable in PROJECT.md and the prerequisite for the sandbox. The cost is paid once.

**Example:**
```typescript
// geo-editor/api/types.ts
export interface AuthoringApi {
  // queries (read)
  getFeatures(): GeoJSON.Feature[]
  getSelection(): GeoJSON.Feature[]
  getViewport(): { bbox: BBox; center: LngLat; zoom: number }
  // mutations (write) — all return a structured ApiResult, never throw across the boundary
  addFeatures(features: GeoJSON.Feature[], opts?: { replaceExisting?: boolean }): ApiResult<{ added: number }>
  updateFeature(id: string, patch: Partial<GeoJSON.Feature>): ApiResult
  deleteFeatures(ids: string[]): ApiResult<{ deleted: number }>
  setStyleRule(rule: AttributeStyleRule): ApiResult
  // parametric primitives (NEW)
  circle(center: LngLat, radiusMeters: number, opts?: CircleOpts): GeoJSON.Feature
  buffer(feature: GeoJSON.Feature, meters: number): GeoJSON.Feature
}

// geo-editor/api/authoringApi.ts
export function createAuthoringApi(editor: GeoEditor): AuthoringApi { /* wraps editor.* */ }
```
The API takes a `GeoEditor` instance (not the store) so it has **no Zustand coupling** — satisfying the PROJECT.md "no internal map-state coupling reaching across the boundary" constraint. The store-sync (e.g. `setFeatures`) happens via editor events the store already subscribes to, or a thin `onChange` callback passed at construction.

### Pattern 2: Registry-of-definitions (extend the one in `commands.ts`)

**What:** `commands.ts` already proves the pattern: an array of definitions each carrying `{id, canExecute, execute, ai:{toolName, parameters}}`, plus `Map`-based lookup. Generalize the *same shape* to all chat tools.

**When to use:** Adding any new AI tool (parametric shapes, batch ops, ingest readers, `run_code`).

**Trade-offs:** Touching `execute.ts` is invasive (it has bespoke OSM tiling/fallback). Mitigation: registry entries can wrap existing executor functions verbatim — move code, don't rewrite it.

**Example:**
```typescript
// chat/tools/registry.ts
export interface ChatToolDefinition {
  name: string
  schema: Tool                                   // OpenAI function schema (was in definitions.ts)
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult> | ToolResult
}
const registry = new Map<string, ChatToolDefinition>()
export function registerTool(def: ChatToolDefinition) { registry.set(def.name, def) }
export function getToolSchemas(): Tool[] { return [...registry.values()].map(d => d.schema) }
export function getToolExecutor(name: string) { return registry.get(name) }
// editor commands fold in automatically:
for (const def of getEditorAiToolDefinitions())
  registerTool({ name: def.name, schema: toSchema(def), execute: (a) => wrapEditorResult(executeEditorAiTool(def.name, a)) })
```
`execute.ts::executeToolCall` collapses to: parse args → `getToolExecutor(name)` → run → serialize, keeping the existing arg-repair, `toEditor` baking, and error envelope.

### Pattern 3: Worker RPC bridge for the sandbox

**What:** Generated JS runs in a Web Worker (not the main thread, not an iframe). The worker has NO direct DOM/map access. It receives a *proxy* `geo` object whose methods serialize a call message to the host; the host executes `api.*` on the real editor and posts the result back. A correlation id matches request↔response.

**When to use:** All code-interpreter execution.

**Trade-offs:** Worker (vs iframe): simpler same-origin messaging, no CSP/iframe sandbox attribute juggling, structured-clone for GeoJSON works out of the box. Downside: a Worker shares origin, so the protocol must be the security boundary — the host only exposes the curated API surface, never `eval`-reachable globals. Geometry crosses as plain objects (structured clone), which is fine for GeoJSON.

> Iframe alternative: only needed if you must run untrusted *3rd-party* code with `sandbox` attribute isolation. For AI-authored code calling a curated API, a Worker is the lighter correct choice. (NIP-5C WASM scrolls — deferred — may later want the iframe; design the protocol so the transport is swappable.)

**Example (protocol):**
```typescript
// chat/sandbox/protocol.ts
type HostBound = { type: 'api-call'; id: string; method: keyof AuthoringApi; args: unknown[] }
                | { type: 'console'; level: 'log'|'error'; args: unknown[] }
                | { type: 'done'; result?: unknown } | { type: 'error'; message: string }
type WorkerBound = { type: 'run'; code: string; apiSurface: string[] }
                 | { type: 'api-result'; id: string; ok: boolean; value?: unknown; error?: string }
```
Worker wraps generated code: `const geo = makeProxy(apiSurface, postCall); await (async () => { <generated code> })()`. The host enforces a hard timeout (`STREAM_STALL_*` constants in `store.ts` are the precedent) and `worker.terminate()` on overrun; every `api-call` is logged so drawn geometry is auditable and the safety layer can intercept destructive calls.

### Pattern 4: Bound edit target + diff-gated apply

**What:** `editTargetSlice` records `{ targetSourceId, datasetKey, intent: 'add'|'modify'|'delete'|'mixed', safetyLevel: 1|2|3 }`. Builds on the existing `workspace.chatSessionId`/`datasetKey` link. Before any mutation that the safety level guards, the API computes a diff against the bound dataset and renders a ghost preview layer; apply requires confirm (level 1 always, level 2 destructive only, level 3 trust + rely on existing `HistoryManager` undo).

**When to use:** All chat/sandbox-originated edits to a *bound* dataset (free drawing on an empty scratch workspace can stay unguarded).

**Trade-offs:** Diff computation on large datasets costs CPU; key features by id and diff by id-set + geometry/property hash. Reuse `getFeatureDedupeKey` logic from `execute.ts`.

---

## Data Flow

### File ingest flow

```
User drops CSV/XLSX/JSON/GeoJSON/image/text in ChatPanel
   ↓
FileParsers.parse(file)  →  ParsedDataset { ref, kind, columns, rows, detectedGeometry?, textExcerpt?, imageMeta? }
   ↓
IngestStore.put(ref, parsedDataset)            (full rows held client-side, NOT sent inline)
   ↓ (two consumers, never the raw blob to the model)
   ├─▶ LLM context: a COMPACT summary message — ref id, column names, row count, 3 sample rows,
   │     detected lat/lon columns. (Mirrors the existing compactToolMessageContentForPrompt pattern.)
   └─▶ tools/sandbox: read_ingested(ref) / list_ingested() return rows on demand;
         sandbox can pull rows by ref and geometrize them via the API.
   ↓ images
Capability gate (modelMaySupportVision in store.ts already exists) → attach as image_url part,
   else disable the image affordance in ChatPanel.
```
**Where parsed data lives:** `IngestStore` (client memory, optionally persisted per chat session). Referenced by an opaque `ref` string the model passes to tools. This keeps large files out of the token budget and the Nostr transport — the same discipline the OSM tools already follow.

### Code interpreter flow

```
Model emits run_code tool call  { code: "...", note: "15 fibonacci circles" }
   ↓ registry → run_code executor
SandboxHost.run(code, apiSurface)
   ↓ postMessage {type:'run'}
Worker executes generated JS; calls geo.circle(...), geo.addFeatures(...)
   ↓ each geo.* → {type:'api-call'} → host
Host: safety check (intent/level) → createAuthoringApi(editor).<method>(...) → ghost-preview or apply
   ↓ {type:'api-result'} back to worker (e.g. created feature returned to code)
Worker {type:'done', result} or {type:'error'} (or host timeout → terminate)
   ↓
run_code executor returns ToolResult { logs, apiCallCount, featuresAdded, error? }  → model
```

### Data-driven styling flow

```
Chat: "color ports blue, airports red, waterways teal"
   ↓ set_style_rule tool → api.setStyleRule({ attribute:'type', map:{port:'#…',airport:'#…'} })
styleSlice stores per-dataset rules  →  StyleManager compiles to MapLibre data-driven paint
   ↓ RenderingManager applies (match/case expression on feature property)
On publish: rules serialized into the kind 37515 event (tag, e.g. ["style", "<json>"]) →
   on load, parsed back into styleSlice. (Round-trip; no schema break — additive tag.)
```

### Encrypted settings flow (extends existing)

```
ChatSettings (provider, apiKey, lmstudio/ollama addresses)
   ↓ on change
saveEncryptedChatSettings(signer, pubkey, settings)   ← signer from applesauce AccountManager
   ↓ nip44 (preferred) / nip04 (fallback) encrypt to self
localStorage  earthly.chat-settings.v1.<pubkey>  (envelope: {version,scheme,ciphertext,updatedAt})
   ↓ on login/reload
loadEncryptedChatSettings(signer, pubkey) → hydrateSettings()   (store.ts action exists)
```
The encrypt/decrypt sits **at the signer boundary** (AccountManager → `ISigner.nip44/nip04`), exactly as `settingsStorage.ts` already does. v1.1 only widens `ChatSettingsSnapshot` to include keys/addresses (today it holds `customApiKey` already — extend, don't rebuild).

---

## Build Order (dependency-ordered)

> The hard dependency: **the sandbox cannot exist without the Authoring API, and a clean tool surface wants the registry.** Front-load both.

| Phase | Deliverable | Depends on | Why this order |
|-------|-------------|------------|----------------|
| **P1 — Tool Registry refactor** | `tools/registry.ts`; move switch-case executors into `tools/executors/*`; `definitions.ts` collects schemas from registry; `execute.ts` → registry dispatch. Fix the orphan-vs-wired audit (all defined tools register). | Nothing (pure refactor) | Prerequisite for cleanly adding parametric/batch/`run_code`/ingest tools. De-risks everything after by establishing the seam. Behavior-preserving → easy to verify against current chat. |
| **P2 — Authoring API** | `geo-editor/api/` barrel + `createAuthoringApi(editor)`; reimplement `importFeaturesToEditor` and editor write tools on top; add parametric primitives (`circle`, `buffer`, grid) as both API methods and registered tools. | P1 (tools register against it) | The single mutation seam. Required by sandbox AND satisfies the PROJECT.md "drawing API as package export" pillar. Add parametric ops here so the sandbox has something worth calling. |
| **P3 — File Ingest** | `ingest/parsers/*`, `ingestStore.ts`, `geometrize.ts`, ChatPanel dropzone, `list_ingested`/`read_ingested` tools, compact-summary context injection, vision capability gate (reuse `modelMaySupportVision`). | P1 (tools), P2 (geometrize → `api.addFeatures`) | Independent of sandbox; can land in parallel-ish after P2. Feeds both LLM context and the sandbox. |
| **P4 — Code Interpreter** | `sandbox/SandboxHost.ts`, `sandbox.worker.ts`, `protocol.ts`, `run_code` tool, timeout/error handling, api-call audit log. | **P2 (API surface)**, P1 (registry), benefits from P3 (read ingested in code) | Hard-blocked on P2. This is the headline capability; everything it does flows through the API. |
| **P5 — Dataset-aware Safe Editing** | `editTargetSlice` (intent + safety level), visible binding chip, DiffPreview ghost layer, safety-gated apply wired into the API. | P2 (intercept at API), existing `workspace.chatSessionId`/`mapStack`/`stance` | Wraps the API's mutating verbs. Needs P2 done so there's a single place to gate. Completes the carried-over binding-chip work. |
| **P6 — Data-driven Styling** | `styleSlice`, `StyleManager`, `set_style_rule` tool, Nostr round-trip (additive event tag). | P2 (API method), RenderingManager/LayerManager | Independent feature; can follow P2. Round-trip touches publishing/loading (`usePublishing`, `useDatasetManagement`). |
| **P7 — Geometry optimization at ingest** | AI-driven simplify + merge-to-multi + microgap stitch to hit size limits. | P2 (`simplifySelectedFeatures`/`dissolveSelectedLines` already exist as commands), P3 (ingest) | Mostly composes existing managers (`SimplifyManager`, `LineOperationsManager`) via the API + a sizing check; low new-infra, so it can land late. |

**Critical path:** P1 → P2 → P4. P3, P5, P6, P7 hang off P2 and can be sequenced by demo value (P5 for the "safe editing" story, P3 for the "ugly CSV" story).

---

## Anti-Patterns

### Anti-Pattern 1: Building a second tool system instead of extending the registry
**What people do:** Add a new `aiToolsV2` array or a parallel dispatcher for "AI-oriented" tools.
**Why it's wrong:** `commands.ts` already is the registry pattern; a parallel system re-creates the exact drift (`definitions.ts` vs `execute.ts`) this milestone is meant to fix.
**Do this instead:** One registry; editor commands fold in via `getEditorAiToolDefinitions()`; new tools `registerTool(...)`.

### Anti-Pattern 2: Letting the sandbox (or chat tools) touch the Zustand store directly
**What people do:** `useEditorStore.getState().setFeatures(...)` from the worker bridge or a new tool (today's `helpers.ts::importFeaturesToEditor` does exactly this).
**Why it's wrong:** Violates the PROJECT.md "no internal map-state coupling across the boundary" constraint and makes the future package extraction impossible.
**Do this instead:** All mutation through `createAuthoringApi(editor)`. The store learns of changes through editor events it already subscribes to.

### Anti-Pattern 3: Sending parsed files or full geometry into the model context
**What people do:** Stuff CSV rows / full GeoJSON into the prompt or a tool result.
**Why it's wrong:** Blows the token budget (`store.ts` already fights this) and, for tool results crossing MCP, the Nostr payload ceiling.
**Do this instead:** IngestStore holds rows by `ref`; model gets a compact summary; tools/sandbox pull rows on demand. Reuse the `compactToolMessageContentForPrompt` discipline.

### Anti-Pattern 4: Running generated code on the main thread or via `new Function`/`eval`
**What people do:** `eval(code)` in the page for speed.
**Why it's wrong:** Blocks the UI, can crash MapLibre, gives the code the whole `window` (and the user's signer/wallet).
**Do this instead:** Worker with a curated API proxy and a hard timeout; the postMessage protocol is the security boundary.

### Anti-Pattern 5: Hardcoding one safety model
**What people do:** Always preview-and-confirm, or always trust.
**Why it's wrong:** PROJECT.md Key Decision: safety is user config (1/2/3, default 2). One model frustrates someone.
**Do this instead:** `editTargetSlice.safetyLevel` gates at the single API mutation seam.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| chat tools ↔ geo-editor | import `@/features/geo-editor/api` only | The barrel is the contract; lint-forbid deeper imports |
| sandbox worker ↔ host | postMessage RPC (`protocol.ts`), correlation ids | Structured clone for GeoJSON; host runs `api.*`, worker never touches map |
| API ↔ GeoEditor | direct method calls on the `GeoEditor` instance | No store reach-across; store syncs via editor events / onChange |
| safety layer ↔ API | API mutating verbs consult `editTargetSlice` | Single gate point; diff/preview before apply |
| styling ↔ Nostr | additive event tag on 37515 | Round-trips through `usePublishing`/`useDatasetManagement` |
| settings ↔ signer | `ISigner.nip44/nip04` via AccountManager | Reuse `settingsStorage.ts` verbatim, widen payload |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| ContextVM MCP (OSM/web/Valhalla) | `EarthlyGeoServerClient` over Nostr | Unchanged; payload-size limits mean ingest/sandbox stay client-side |
| Routstr/LM Studio/Ollama/custom | OpenAI-compatible streaming (`routstr.ts`) | Vision gate via `modelMaySupportVision`; addresses now in encrypted settings |
| Nostr relays (applesauce) | EventStore/RelayPool; kind 37515/37516 | Style round-trip is an additive tag; no kind changes |

---

## Sources

- Codebase (HIGH): `src/features/chat/tools/{execute,helpers,definitions,types,context}.ts`, `src/features/chat/{store,settingsStorage}.ts`, `src/features/chat/ARCHITECTURE.md`
- Codebase (HIGH): `src/features/geo-editor/commands.ts`, `core/GeoEditor.ts` + `core/managers/*`, `store/{stanceSlice,mapStackSlice,workspaceSlice,types}.ts`, `types/styleProperties.ts`, `components/map/buildStyles.ts`
- Codebase (HIGH): `src/features/geo-editor/hooks/useDatasetManagement.ts` (chat↔workspace binding)
- `.planning/PROJECT.md` (v1.1 definition + constraints, esp. "API discipline — Toolbar drawing" and the v1.1 Key Decisions)

---
*Architecture research for: Earthly v1.1 AI Chat integration*
*Researched: 2026-06-16*
