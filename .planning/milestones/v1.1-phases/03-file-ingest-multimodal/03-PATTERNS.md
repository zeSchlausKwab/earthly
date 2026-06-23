# Phase 3: File Ingest & Multimodal - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 16 (12 new, 4 modified)
**Analogs found:** 15 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/features/chat/ingest/ingest.worker.ts` (NEW) | worker | transform / file-I/O | `src/lib/geo/geoJsonParseWorker.ts` | exact (worker) |
| `src/features/chat/ingest/ingestClient.ts` (NEW) | utility | request-response (RPC) | `src/lib/geo/workerJsonParse.ts` | exact |
| `src/features/chat/ingest/ingestStore.ts` (NEW) | store | CRUD (in-memory) | `registry` Map in `tools/registry.ts`; Zustand stores | role-match |
| `src/features/chat/ingest/parseSummary.ts` (NEW) | utility | transform | `helpers.ts:compactToolMessageContentForPrompt` (~1299) | role-match |
| `src/features/chat/ingest/detectCoordinateColumns.ts` (NEW) | utility | transform | `helpers.ts` pure normalizers (e.g. `normalizeFilters`) | partial |
| `src/features/chat/ingest/types.ts` (NEW) | model | — | `geoJsonParseWorker.ts` request/response interfaces | role-match |
| `src/features/chat/ingest/fileSizeGuards.ts` (NEW) | utility | transform | `helpers.ts` clamp helpers (`clampLimit`, `clampPositiveInt`) | role-match |
| `src/features/chat/vision/detectVisionSupport.ts` (NEW) | service | request-response (network) | `store.ts:modelMaySupportVision` (484) + `routstr.ts:fetchModels` (184) | role-match |
| `src/features/chat/tools/ingest-tools.ts` (NEW) | controller (tool) | event-driven (tool dispatch) | `tools/registry.ts` `registerRemoteMcpTools`/`registerEditorWriters` | exact |
| `src/features/chat/components/FileChipStrip.tsx` (NEW) | component | event-driven (UI) | `ChatGeometryAttachment.tsx` | role-match |
| `src/features/chat/components/FileChip.tsx` (NEW) | component | event-driven (UI) | `ChatGeometryAttachment.tsx` chip/summary block | role-match |
| `src/features/chat/components/VisionGateControl.tsx` (NEW) | component | event-driven (UI) | `ChatGeometryAttachment.tsx` trigger button | partial |
| `src/features/chat/ChatPanel.tsx` (MODIFIED) | component | event-driven | self (mounts beside `ChatGeometryAttachment` ~681) | self |
| `src/features/chat/store.ts` (MODIFIED) | store | event-driven | self (`modelMaySupportVision` 484, `canUseVision` 1268, snapshot 1496) | self |
| `src/features/chat/tools/schemas.ts` (MODIFIED) | config | — | self (`geoStaticToolSchemas` array, `search_location` ~128) | self |
| `src/features/chat/tools/helpers.ts` (MODIFIED) | utility | transform | self (`compactToolMessageContentForPrompt`, `importFeaturesToEditor`) | self |

## Pattern Assignments

### `src/features/chat/ingest/ingest.worker.ts` (worker, transform)

**Analog:** `src/lib/geo/geoJsonParseWorker.ts` (35 lines — mirror exactly)

**Core worker pattern** (whole file): a `self.onmessage` handler that try/catches the parse and posts back a discriminated `{ id, success, data?, error? }` response. Extend the request to carry a `kind: 'csv'|'xlsx'|'json'|'text'` discriminator and branch the parse (PapaParse for csv, ExcelJS `wb.xlsx.load(arrayBuffer)` for xlsx, `JSON.parse` for json, `split` for text). Keep the **same** response shape so the host client mirrors `workerJsonParse.ts` verbatim. Never throw out of the handler — convert to `{ success: false, error }`.

### `src/features/chat/ingest/ingestClient.ts` (utility, request-response RPC)

**Analog:** `src/lib/geo/workerJsonParse.ts` (mirror the lazy-worker + sync-fallback + timeout machinery)

**Worker bootstrap** (lines 16-64): lazy `getWorker()` guards `typeof Worker === 'undefined'`, creates `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' })`, wires `onmessage` to resolve `pendingRequests.get(id)`, and `onerror` to (a) sync-parse-fallback all pending, (b) set `workerBroken = true`, (c) terminate. This Bun-bundles with zero config — keep the exact `new Worker(new URL(...))` form.

**Request dispatch + timeout** (lines 70-108): per-request `id`, `pendingRequests` Map holding `{resolve,reject,text}`, `postMessage`, and a 30s `setTimeout` that falls back to sync parse. For xlsx, pass a **transferable** ArrayBuffer: `w.postMessage(req, [buf])` (deviation from the geo analog, which only sends strings). Keep the `workerBroken` short-circuit at the top.

### `src/features/chat/ingest/ingestStore.ts` (store, CRUD — D-11 seam)

**Analog:** the module-level `registry = new Map<string, ToolEntry>()` pattern in `tools/registry.ts:85-95` (module-level Map + `register`/`unregister`/`get` accessors)

**Pattern** (registry.ts lines 84-95):
```typescript
export const registry = new Map<string, ToolEntry>()
export function register(entry: ToolEntry): void { registry.set(entry.name, entry) }
export function unregister(name: string): boolean { return registry.delete(name) }
```
Mirror as `const ingestStore = new Map<string, ParsedDataset>()` with `putDataset`, `getDataset(handleId)`, `evictDataset`, and a `toSummary(handleId): IngestSummary` accessor. **Structural invariant (D-11/security):** the only exported accessor that the model-facing path may call returns `IngestSummary` (no `fullRows`); `fullRows` is reachable only by tools/sandbox via `getDataset`. Session-only, in-memory (D-12) — no persistence (contrast: `mapSnapshotCache` in registry.ts uses the same in-memory cache idiom with `pruneSnapshotCache`).

### `src/features/chat/ingest/parseSummary.ts` (utility, transform)

**Analog:** `helpers.ts:compactToolMessageContentForPrompt` (1299-1306) — the precedent compaction pass D-01 extends.

**Pattern:** that function parses tool-result content and re-serializes a *summarized* value (`summarizeToolResultForPromptValue`). Build the analogous `deriveIngestSummary(parsed): IngestSummary` doing head+tail+random sampling (RESEARCH.md `sampleRows`, lines 388-399) plus a column cap with "…N more columns". This is the structural "no raw rows" enforcement — the function must only ever read schema + sampled rows.

### `src/features/chat/vision/detectVisionSupport.ts` (service, network request-response)

**Analogs:** `store.ts:modelMaySupportVision` (484-499, the name-heuristic to keep as the ladder's tier 3) + `routstr.ts:fetchModels` (184-194, the `fetch(\`${provider.baseUrl}/models\`)` discovery to reuse for tier 2).

**Name-heuristic tier** (store.ts 484-499, becomes ladder step 3 → `'uncertain'`):
```typescript
const visionHints = ['vision','vl','llava','qwen2.5-vl','gemma-vision','pixtral','gpt-4o','claude-3']
const providerSupportsVisionTransport =
  provider.type === 'lmstudio' || provider.type === 'routstr' || provider.type === 'custom'
```
**Provider matrix branch** (routstr.ts 127-164): `ProviderType = 'routstr'|'lmstudio'|'ollama'|'custom'`; `ProviderConfig.baseUrl`. Ollama baseUrl is `http://localhost:11434/v1` — strip `/v1` and `POST /api/show {model}` for `capabilities[]` (RESEARCH.md Pattern 3, lines 270-281). Others: reuse the `fetch(\`${provider.baseUrl}/models\`, {headers})` shape from `fetchModels` (190) and read a `capabilities`/`input_modalities` field. Cache per `(type, baseUrl, modelId)`; on fetch failure degrade to heuristic → `'uncertain'`, never throw. Auth header idiom: `if (provider.apiKey) headers.Authorization = \`Bearer ${provider.apiKey}\`` (routstr.ts 186-188).

### `src/features/chat/tools/ingest-tools.ts` (tool controller, event-driven)

**Analog:** `tools/registry.ts` `register({...})` entries — `registerEditorWriters` (331-371) for `place_dataset_features`, `registerRemoteMcpTools` (373-964, the `search_location` entry at 374-386) for `batch_geocode`.

**Placement tool** — copy the `write_geojson_to_editor` entry shape (registry.ts 332-348):
```typescript
register({
  name: 'place_dataset_features',
  kind: 'host-builtin',                       // ToolKind union, registry.ts:58
  schema: schemaFor('place_dataset_features'),
  handler: async (args) => {
    const ds = ingestStore.get(String(args.handleId))
    if (!ds) throw new Error(`Unknown ingest handle: ${args.handleId}`)  // → ToolError (dispatch wraps, 116-126)
    const features = await buildFeaturesFromRows(ds.fullRows, args.mapping) // ALL rows, not samples (D-05)
    const result = importFeaturesToEditor(features, false)               // Authoring API seam
    return { importedCount: result.importedCount, skippedDuplicates: result.skippedDuplicates }
  },
})
```
**Geocode tool** — copy the `search_location` remote-mcp entry (registry.ts 374-386): `kind: 'remote-mcp'`, `origin: REMOTE_MCP_ORIGIN`, handler calls `getGeoClient().SearchLocation(query, limit)` and `extractMcpToolResult(...)`. For `batch_geocode`, loop a capped place-name column, throttle ~1 req/s, de-dupe, skip-and-report (RESEARCH.md Pitfall 5). Register via the injected-`register` pattern (registry.ts 999-1002) or add a `registerIngestTools()` call in `bootstrapRegistry` (994-1003). Add matching schemas to `geoStaticToolSchemas` (schemas.ts) so `schemaFor()` resolves (registry.ts 260-266).

**Map write path:** route through `importFeaturesToEditor` (helpers.ts 735-760) which calls `createAuthoring(editor).writeGeoJSON(...)` — **never** write the Zustand store directly (D-05/D-09). Do NOT import from `geo-editor/api` internals beyond the `index.ts` barrel (api/index.ts boundary note, lines 6-10).

### `src/features/chat/components/FileChipStrip.tsx` + `FileChip.tsx` (component, event-driven UI)

**Analog:** `ChatGeometryAttachment.tsx` (the entire chip-strip visual language; D-10 mounts the new strip *alongside*, not folded in).

**Props/onChange contract** (lines 17-22): `{ value, onChange }` controlled pattern — mirror as `{ files, onChange }` lifted to `ChatPanel`. **Trigger button** (275-288): `<Button variant={active ? 'default' : 'outline'} size="sm" className="h-8 gap-1.5 text-xs">` with a lucide icon `h-3.5 w-3.5` — reuse for the `Attach file` (`Paperclip`) button. **Summary/stat row** (396-409): `flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground` with `rounded border bg-background px-2 py-0.5` chips — reuse for the per-file stat line (use `text-[11px]` per UI-SPEC). **Clear control** (165-167, 365-376): `onChange(null)` ghost `X` button. Add native drag-drop (`onDragOver`/`onDrop`) + hidden `<input type=file>` (not present in the analog — new, INGEST-01). Type icons per UI-SPEC: `FileSpreadsheet`/`Braces`/`FileText`/`Image`.

### `src/features/chat/ChatPanel.tsx` (MODIFIED)

**Current shape:** imports `ChatGeometryAttachment` (line 42); local `attachedGeometry` state (146); mounts the attachment at ~681 inside the input row; injects geometry into the request via `geometryAttachment` (229-240). Mount `<FileChipStrip>` and `<VisionGateControl>` adjacent to the `<ChatGeometryAttachment>` block (~681) using the same `flex-wrap` row. Add an `attachedFiles`/`ingestHandles` state mirroring the `attachedGeometry` `useState` (146).

### `src/features/chat/store.ts` (MODIFIED)

**Current shape to replace:** `modelMaySupportVision` (484-499) → replace with async `detectVisionSupport` result; `canUseVision` computed at 1268-1270 → drive off the ladder + D-08 gate; `capture_map_snapshot` one-shot image push (1496-1518) → now gated by the *same* unified capability source (D-09). Keep the `image_url` content-part shape verbatim (1511-1515) — it matches `ChatImageUrlContentPart` (routstr.ts 35-41).

## Shared Patterns

### Worker RPC (off-thread, no-freeze)
**Source:** `src/lib/geo/workerJsonParse.ts` (1-119) + `geoJsonParseWorker.ts` (1-35)
**Apply to:** `ingest.worker.ts`, `ingestClient.ts`
Lazy `getWorker()`, `new Worker(new URL('./x.ts', import.meta.url), {type:'module'})`, id-keyed `pendingRequests`, `onerror` → sync-fallback + `workerBroken` latch, 30s timeout. Bun bundles zero-config.

### Typed registry + structured errors (D-16)
**Source:** `src/features/chat/tools/registry.ts` (57-126)
**Apply to:** `ingest-tools.ts`
Every entry carries a mandatory `kind: ToolKind`. `dispatch` (103-126) wraps unknown-name → `{kind:'unknown_tool'}` and handler throw → `{kind:'handler_error', origin?}`. New tools just `throw new Error(...)` for the model-facing error; the chokepoint serializes it.

### Authoring API as sole geometry write seam (INFRA-02 / D-05)
**Source:** `helpers.ts:importFeaturesToEditor` (735-760) → `createAuthoring(editor).writeGeoJSON` (api/index.ts barrel 16)
**Apply to:** `place_dataset_features` and `batch_geocode` placement
Never write the Zustand store directly — it is a one-way read-mirror (helpers.ts 736-739). Import only from `geo-editor/api` (barrel), never the editor internals.

### Geocoding via ContextVM/Nominatim
**Source:** `EarthlyGeoServerClient.SearchLocation` (855-857) + the `search_location` registry entry (registry.ts 374-386); `getGeoClient()` (helpers.ts 39)
**Apply to:** single (reuse `search_location`) + new `batch_geocode`. Bound + throttle ~1 req/s host-side; the network call runs server-side via `client.call('search_location', ...)`.

### Model-handoff compaction ("no raw rows", D-01)
**Source:** `helpers.ts:compactToolMessageContentForPrompt` (1299-1306)
**Apply to:** `parseSummary.ts` `deriveIngestSummary`. Model sees `IngestSummary` + handle id only; `fullRows` never serialized into a message.

### Image content-part shape
**Source:** `routstr.ts:ChatImageUrlContentPart` (35-41); existing push at `store.ts:1511-1515`
**Apply to:** user-attached image path (FileReader `readAsDataURL` → `{type:'image_url', image_url:{url}}`), gated by `detectVisionSupport` (D-09).

### Clamp/guard helpers
**Source:** `helpers.ts` `clampLimit` (103), `clampPositiveInt` (109)
**Apply to:** `fileSizeGuards.ts`, batch-geocode caps, sample/column caps (V5 input validation; coord range checks lat∈[-90,90], lon∈[-180,180] before placement).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/features/chat/components/VisionGateControl.tsx` | component | event-driven | No existing three-tier capability-gated control. Borrow only the `ChatGeometryAttachment` trigger-button idiom (275-288) + the amber-uncertain idiom already in `ChatPanel.tsx:549,620` (per UI-SPEC). Build the three-state logic (enabled / uncertain+opt-in / hard-disabled tooltip) fresh from D-08. |

## Metadata

**Analog search scope:** `src/lib/geo/`, `src/features/chat/`, `src/features/chat/tools/`, `src/features/geo-editor/api/`, `src/ctxcn/`
**Files scanned:** workerJsonParse.ts, geoJsonParseWorker.ts, tools/registry.ts, tools/helpers.ts, tools/schemas.ts, ChatGeometryAttachment.tsx, ChatPanel.tsx, store.ts, routstr.ts, geo-editor/api/index.ts, EarthlyGeoServerClient.ts
**Pattern extraction date:** 2026-06-17
