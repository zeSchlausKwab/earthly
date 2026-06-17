# Phase 3: File Ingest & Multimodal - Research

**Researched:** 2026-06-17
**Domain:** Client-side file parsing (CSV/Excel/JSON/GeoJSON/text/image), off-main-thread workers, layered LLM vision-capability detection, tabular→map placement + batch geocoding
**Confidence:** HIGH (existing-code seams, off-thread mechanism, parse libs, vision schemas all verified in-session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Model-facing summary = schema (column names/types) + **sample rows** only. Raw/full rows NEVER sent to the model. Extends the existing chat-only compaction pass in `store.ts` / `helpers.ts:compactToolMessageContentForPrompt`.
- **D-02:** Sampling = **head + tail + random** rows, plus a **column cap** for wide tables ("…N more columns"). Exact counts = planner's discretion.
- **D-03:** User-facing summary = compact **stat line, expandable** (Collapsible/Popover). **No always-on data grid.**
- **D-04:** Coordinate/geometry columns: **host auto-detect by name heuristic + AI override** at placement-tool call time.
- **D-05:** Placement applies **host-side over the FULL parsed dataset by handle** (never only sampled rows). AI supplies a **column-mapping rule**; writes go through the **Authoring API** (`authoring.writeGeoJSON` / `importFeaturesToEditor`), never the Zustand store.
- **D-06:** Geolocation: **both single + batch geocode tools, AI chooses**. Single reuses existing `search_location`. Batch is a new bounded tool. Must respect Nominatim public policy (~1 req/s). Caps + failure handling = planner's discretion.
- **D-07:** **Layered vision-detection ladder (locked):** Ollama capabilities → modalities field → name heuristic → fail-safe to no-vision. REPLACES name-only `modelMaySupportVision()` (`store.ts:484`).
- **D-08:** **Three-tier gating:** confirmed-vision → enabled; confirmed-no-vision → hard-disabled (tooltip); unconfirmed → affordance available but marked uncertain, send requires **explicit opt-in confirm** ("Send anyway").
- **D-09:** The gate **unifies both image paths** — user-attached images AND the `capture_map_snapshot` one-shot flow (`store.ts:1496–1518`). One source of truth.
- **D-10:** **Dedicated NEW file-chip strip** (button + drag-drop, one chip per file) mounted **alongside** `ChatGeometryAttachment` in `ChatPanel.tsx`. Do NOT fold them together.
- **D-11:** Parsed data lives in a **host-side ingest store keyed by handle id**. Model receives summary + handle id only; tools (and Phase 4 sandbox) read full rows by handle. This is the structural "model never sees raw rows" enforcement point.
- **D-12:** **Session-only, in-memory.** No localStorage/IndexedDB persistence. Eviction/size caps = planner's discretion.

### Claude's Discretion
- Off-thread mechanism (Worker vs main-thread chunked) — **researched, recommendation below**.
- Parse-library choices (CSV, Excel) — **researched, recommendation below**.
- Per-type summary shapes (text/GeoJSON/image) — a unified typed summary interface encouraged.
- Sample/column counts (D-02), geocode caps + failure handling (D-06), ingest-store eviction/size caps (D-12), image base64/data-URL encoding (match existing `image_url` path), registry file layout.
- Max file-size guardrails (DoS protection on huge drops).

### Deferred Ideas (OUT OF SCOPE)
- Persisted ingest cache across reloads (IndexedDB handles/eviction) — deferred for session-only (D-12).
- Unified attachment manager (folding geometry + file attachments) — deferred (D-10 keeps them separate).
- Richer always-on data-grid preview in the chip — deferred (D-03 compact stat line).
- Self-hosted / higher-throughput geocoder for very large batches — out of scope; D-06 caps batches to respect public Nominatim policy.
- **NOT this phase:** dataset binding chip / diff-preview / safety levels (Phase 5), code interpreter sandbox (Phase 4), geometry optimization/simplification (Phase 7), bulk attribute transforms & data-driven styling (Phase 6).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-01 | Attach files via button + drag-drop, one visible chip per file | UI-SPEC file-chip strip; `ChatPanel.tsx` mount; existing `ChatGeometryAttachment` chip pattern to mirror; HTML `<input type=file>` + native drag-drop events |
| INGEST-02 | Ingest CSV + Excel `.xlsx`, off the main thread (no freeze on large files) | **Existing Web Worker pattern** (`src/lib/geo/workerJsonParse.ts`) — proven, Bun-bundled; PapaParse (CSV, worker-safe) + ExcelJS (xlsx in-worker via `workbook.xlsx.load`) |
| INGEST-03 | Ingest JSON, GeoJSON, plain-text | Native `JSON.parse` (reuse `parseJsonInWorker`); `@turf/turf` (installed) for GeoJSON validation/bbox; text = decode + line/char count |
| INGEST-04 | Ingest image files | FileReader → data URL into existing `image_url` content-part (`routstr.ts:35`); gated by D-07 ladder |
| INGEST-05 | Parse summary to user; compact summary (not raw rows) to model | D-01/D-02 typed summary; extends `compactToolMessageContentForPrompt` (`helpers.ts:1299`); handle-id seam (D-11) structurally prevents raw-row leakage |
| INGEST-06 `[A][B]` | Place tabular/text rows on the map, geolocating where needed | Host-side column-mapping rule over full dataset by handle (D-05) → `authoring.writeGeoJSON`; single + batch geocode via `search_location` (D-06) |
| INGEST-07 | Layered vision detection; disable/mark-uncertain image-send when unconfirmed | D-07 ladder with verified Ollama `/api/show` + OpenAI `/v1/models` schemas; D-08 three-tier gate; unifies `modelMaySupportVision` + snapshot flow (D-09) |
</phase_requirements>

## Summary

This phase adds a client-side file-ingest pipeline to the chat. The single most important finding is that **the project already ships a working, Bun-bundled Web Worker** (`src/lib/geo/workerJsonParse.ts` + `geoJsonParseWorker.ts`) using the canonical `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })` pattern, with a robust sync-fallback + timeout + broken-worker latch. This is the proven off-thread mechanism — Phase 3 should **extend this exact pattern** (one ingest worker that parses CSV/Excel/JSON/text), not invent a new one. No bundler config changes are needed: Bun's `Bun.build` resolves `new Worker(new URL(...))` automatically, and the dev server's HTML-import HMR path already handles it.

For parse libraries: **PapaParse 5.5.3** (CSV — 11.7M weekly downloads, MIT, has a built-in worker mode but we'll drive it inside our own worker) and **ExcelJS 4.4.0** (xlsx — 9.6M weekly downloads, MIT, `workbook.xlsx.load(arrayBuffer)` works in a worker) are the recommendations. **Critically, do NOT use SheetJS `xlsx` from npm** — the npm package is frozen at 0.18.5 (2022), is no longer maintained on npm, and has a known ReDoS vulnerability through 0.20.1; SheetJS now distributes only via its own CDN, which conflicts with this project's registry-installed, lean-deps posture. JSON/GeoJSON use native `JSON.parse` (reuse `parseJsonInWorker`) + the already-installed `@turf/turf@7.3.5` for bbox/validation.

The vision ladder (D-07) branches on the existing provider matrix (`routstr.ts:127`). **Ollama is the special case**: its OpenAI-compatible `/v1/models` surface does NOT expose capabilities — you must call the native `POST /api/show` per model and read `capabilities: ["completion","vision",…]`. For routstr/lmstudio/custom, read the `/v1/models` entry's `capabilities` / `input_modalities` array when present, else fall through to the name heuristic, else fail-safe to no-vision. The gate then drives D-08's three-tier UI and unifies with the `capture_map_snapshot` path (D-09). Placement (D-05) and geocoding (D-06) are non-visual seams that register as new tools in the Phase 2 typed registry (`kind:'host-builtin'` for placement, `kind:'remote-mcp'` reusing `search_location`) and write only through the Authoring API.

**Primary recommendation:** Extend the existing worker pattern into one `ingest.worker.ts`; add PapaParse + ExcelJS (NOT SheetJS-from-npm); build a host-side handle-keyed `ingestStore` as the D-11 seam; implement the D-07 ladder as a small `detectVisionSupport(provider, modelId)` async module that caches per-model results and replaces `modelMaySupportVision`; register placement + batch-geocode tools in the typed registry routed through `authoring.writeGeoJSON`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File attach UI (button + drag-drop, chips) | Browser / Client (React, `ChatPanel.tsx`) | — | Pure DOM/file-input + drag events; mounts beside existing geometry chip |
| File parsing (CSV/Excel/JSON/text) | Web Worker (off main thread) | Main-thread sync fallback | INGEST-02 mandates no-freeze; reuse existing worker pattern |
| Image encoding (data URL) | Browser / Client | — | `FileReader.readAsDataURL`; lightweight, no worker needed |
| Ingest store (handle → full rows + summary) | Host main-thread module (in-memory) | — | D-11 seam; Phase 4 sandbox reads it host-side, must live on host not worker |
| Model-facing summary derivation | Host main-thread (extends compaction pass) | — | D-01/D-02; structural enforcement of "no raw rows" |
| Vision capability detection | Host main-thread async (network: `/api/show`, `/v1/models`) | Name heuristic → fail-safe | D-07; per-provider branch; cache results |
| Tabular→feature placement (column-mapping rule) | Host main-thread over full dataset | Authoring API (geometry write) | D-05; never only sampled rows; never the store directly |
| Geocoding (single + batch) | Remote MCP (ContextVM → Nominatim, server-side) | Host throttle/batch-cap | D-06; ~1 req/s policy enforced server-side, host still bounds batch size |
| Map geometry write | Authoring API (`geo-editor/api`) | GeoEditor | INFRA-02; single mutation seam |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `papaparse` | `^5.5.3` | CSV parsing (streaming/chunked, header detection, type inference) | The de-facto browser CSV parser; 11.7M weekly downloads; MIT; mature, no postinstall; can run inside a worker. [VERIFIED: npm registry] [CITED: github.com/mholt/PapaParse] |
| `@types/papaparse` | `^5.3.16` | TS types for PapaParse | PapaParse ships no built-in types | [VERIFIED: npm registry] |
| `exceljs` | `^4.4.0` | Excel `.xlsx` reading via `workbook.xlsx.load(arrayBuffer)` | Registry-installable, maintained, MIT, 9.6M weekly downloads, in-worker capable. Replaces SheetJS (npm-frozen + ReDoS). [VERIFIED: npm registry] [CITED: github.com/exceljs/exceljs] |
| `@turf/turf` | `^7.3.5` (installed) | GeoJSON validation, bbox, centroid for placement | Already a dependency; reuse for GeoJSON summaries + coordinate work | [VERIFIED: package.json] |
| native `JSON.parse` | — | JSON / GeoJSON parsing | Reuse existing `parseJsonInWorker` (`src/lib/geo/workerJsonParse.ts`); honors lean-deps | [VERIFIED: codebase] |
| native `Worker` + `new URL(...)` | — | Off-main-thread parsing | Existing proven pattern; Bun-bundled with zero config | [VERIFIED: codebase, build.ts] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| native `FileReader` / `Blob.arrayBuffer()` / `Blob.text()` | — | Read attached File objects to text/ArrayBuffer/data URL | Always; no dep needed. `readAsDataURL` for images (D-04), `arrayBuffer()` for xlsx, `text()` for csv/json/text |
| `comlink` | `^4.4.2` | Optional ergonomic Worker RPC | ONLY if the planner finds the hand-rolled postMessage protocol (already in `workerJsonParse.ts`) too verbose for the multi-format worker. **Not recommended** — the existing pattern is sufficient and lean-deps favors not adding it. [VERIFIED: npm registry] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `exceljs` | SheetJS `xlsx` | **Rejected.** npm version frozen at 0.18.5 (2022), unmaintained on npm, ReDoS vuln through 0.20.1, official distribution is CDN-only — conflicts with registry-installed lean-deps posture. [CITED: operations.osmfoundation.org; git.sheetjs.com #3316] |
| `exceljs` | `read-excel-file@9.2.0` | Lighter, read-only, browser-friendly. Legitimacy gate flagged `SUS:too-new` (recent version bump on a long-lived 836k-dl/wk package — false positive). Viable if exceljs bundle size proves heavy; planner's call. [VERIFIED: npm registry] |
| hand-rolled worker RPC | `comlink` | Comlink is cleaner but adds a dep; the repo already has a working hand-rolled protocol. Lean-deps favors reuse. |
| Web Worker | main-thread chunked/`requestIdleCallback` parsing | Worker is strictly better for CPU-bound parse of large files (true parallelism, never blocks paint); the repo already proves the worker path. Use Worker. |

**Installation:**
```bash
bun add papaparse exceljs
bun add -d @types/papaparse
```

**Version verification (run in-session 2026-06-17):**
- `papaparse` → 5.5.3 (modified 2025-05-19, created 2014; repo github.com/mholt/PapaParse; no postinstall) [VERIFIED: npm registry]
- `exceljs` → 4.4.0 (modified 2024-12-20; repo github.com/exceljs/exceljs; no postinstall) [VERIFIED: npm registry]
- `xlsx` (SheetJS) → 0.18.5 on npm, **stale 2022**, ReDoS — DO NOT USE [CITED: git.sheetjs.com]

## Package Legitimacy Audit

> Run in-session via `gsd-tools query package-legitimacy check --ecosystem npm`.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `papaparse` | npm | created 2014, pub 2025-05 | 11.78M/wk | github.com/mholt/PapaParse | **OK** | Approved |
| `exceljs` | npm | pub 2024-12 | 9.66M/wk | github.com/exceljs/exceljs | **OK** | Approved |
| `comlink` | npm | pub 2024-11 | 2.34M/wk | github.com/GoogleChromeLabs/comlink | **OK** | Approved (optional, not recommended) |
| `xlsx` (SheetJS) | npm | pub 2022-03 (frozen) | 11.29M/wk | github.com/SheetJS/sheetjs | OK-but-stale | **REMOVED** — npm distribution unmaintained + ReDoS through 0.20.1; use exceljs |
| `read-excel-file` | npm | pub 2026-06-11 | 836k/wk | gitlab.com/catamphetamine/read-excel-file | **SUS** (`too-new`) | Flagged — false positive (recent version on long-lived pkg). Only if chosen over exceljs; planner adds `checkpoint:human-verify` before install |
| `@types/papaparse` | npm | — | — | DefinitelyTyped | OK (types-only) | Approved |

**Packages removed due to [SLOP]/stale verdict:** `xlsx` (SheetJS — npm-unmaintained + ReDoS, replaced by exceljs).
**Packages flagged as suspicious [SUS]:** `read-excel-file` (only relevant if the planner picks it over exceljs; insert a `checkpoint:human-verify` task before install).

*Recommended path uses only `papaparse` + `exceljs` + `@types/papaparse`, all `OK`.*

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────────┐
   User drops/picks file  │            ChatPanel.tsx (Browser)          │
   ──────────────────────▶│  file-chip strip (NEW, beside Geometry chip)│
                          │   ├─ <input type=file> + drag-drop handlers │
                          │   └─ per-file chip: icon · name · stat · X  │
                          └───────────────┬─────────────────────────────┘
                                          │ File object (+ size guard)
                                          ▼
              image? ──yes──▶ FileReader.readAsDataURL ──▶ image_url part
                │                                          (gated by vision ladder, D-08)
                │ no
                ▼
        ┌───────────────────────┐   postMessage{id,kind,payload}   ┌──────────────────────┐
        │  ingestClient (host)  │ ───────────────────────────────▶ │  ingest.worker.ts    │
        │  (extends workerJson  │                                  │  CSV→PapaParse       │
        │   Parse pattern)      │ ◀─────────────────────────────── │  xlsx→ExcelJS.load   │
        └─────────┬─────────────┘   {id,success,rows,schema,err}   │  json→JSON.parse     │
                  │ full parsed rows + detected schema             │  text→split/count    │
                  ▼                                                └──────────────────────┘
        ┌──────────────────────────────────┐
        │  ingestStore (host, in-memory)   │  D-11 SEAM — Phase 4 sandbox reads full rows here
        │  handle → { id, type, schema,    │
        │    fullRows, sampleRows,         │
        │    summary, coordCols, bytes }   │
        └───────┬───────────────┬──────────┘
                │               │
   summary+handle id           │ full rows by handle (NEVER to model)
   (D-01/D-02 compaction)      │
                │               ▼
                │   ┌────────────────────────────────────────────┐
                │   │  place_dataset_features tool (NEW, registry)│  D-05
                │   │   AI supplies column-mapping rule           │
                │   │   host applies rule to ALL rows             │
                │   │   rows w/o coords → geocode (D-06)          │
                │   └──────────────┬─────────────────────────────┘
                │                  │ rows needing geolocation
                │                  ▼
                │       ┌──────────────────────────────┐
                │       │ search_location (single) OR   │  ContextVM → Nominatim
                │       │ batch_geocode (NEW, bounded,  │  (~1 req/s server-side)
                │       │  throttled, capped)           │
                │       └──────────────┬────────────────┘
                │                       │ Features (GeoJSON)
                ▼                       ▼
        ┌──────────────────────────────────────────┐
        │  Authoring API  authoring.writeGeoJSON()  │  INFRA-02 single mutation seam
        │  → GeoEditor → store read-mirror (D-09)   │
        └──────────────────────────────────────────┘

   PARALLEL: model selection ──▶ detectVisionSupport(provider, modelId)  D-07 ladder
              ├─ ollama:  POST /api/show {model} → capabilities[] includes "vision"?
              ├─ others:  GET /v1/models → entry.capabilities/input_modalities?
              ├─ else:    name heuristic (uncertain)
              └─ else:    fail-safe no-vision
              ──▶ drives D-08 three-tier gate (enabled / uncertain+optin / hard-disabled)
              ──▶ also gates capture_map_snapshot one-shot (D-09)
```

### Recommended Project Structure
```
src/features/chat/
├── ingest/                       # NEW — ingest pipeline
│   ├── ingest.worker.ts          # off-thread parser (extends workerJsonParse pattern)
│   ├── ingestClient.ts           # host-side worker RPC + sync fallback + timeout
│   ├── ingestStore.ts            # D-11 handle-keyed in-memory store (the seam)
│   ├── parseSummary.ts           # D-01/D-02 head+tail+random sampling + column cap
│   ├── detectCoordinateColumns.ts# D-04 name heuristic (lat/lon/wkt/geometry/…)
│   ├── types.ts                  # IngestHandle, ParsedDataset, IngestSummary union
│   └── fileSizeGuards.ts         # max-size caps (D-12 discretion)
├── vision/
│   └── detectVisionSupport.ts    # D-07 ladder, replaces modelMaySupportVision; cached
├── tools/
│   ├── ingest-tools.ts           # NEW — place_dataset_features, batch_geocode register()
│   └── (registry.ts / schemas.ts extended)
├── components/
│   ├── FileChipStrip.tsx         # NEW — D-10 strip (button + drag-drop + chips)
│   ├── FileChip.tsx              # NEW — one chip: icon/name/stat-line/X + Collapsible
│   └── VisionGateControl.tsx     # NEW — D-08 three-tier affordance
└── ChatPanel.tsx                 # mounts FileChipStrip + VisionGateControl (extend)
```

### Pattern 1: Extend the existing Web Worker pattern (off-thread parsing)
**What:** One ingest worker driven by a host client with the SAME structure as `workerJsonParse.ts`: lazy `getWorker()`, hand-rolled `postMessage` request/response keyed by request id, `onerror` → sync fallback + `workerBroken` latch, per-request timeout.
**When to use:** All CSV/Excel/JSON/text parsing (INGEST-02/03). Images do NOT need the worker (FileReader data URL is cheap).
**Example:**
```typescript
// Source: existing src/lib/geo/workerJsonParse.ts (verbatim pattern to mirror)
worker = new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' })
worker.onmessage = (e: MessageEvent<ParseResponse>) => { /* resolve pending by id */ }
worker.onerror = () => { workerBroken = true; /* sync-parse all pending, terminate */ }
// host call: postMessage({ id, kind: 'csv'|'xlsx'|'json'|'text', payload }), await by id, 30s timeout
```
**Key:** Bun bundles `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })` with zero config (confirmed: this exact form already builds + runs in the repo). Pass CSV as a string and xlsx as a **transferable ArrayBuffer** (`postMessage(buf, [buf])`) to avoid a copy.

### Pattern 2: Handle-keyed ingest store as the structural "no raw rows" boundary (D-11)
**What:** A host-side `Map<handleId, ParsedDataset>`. The model is handed only `{ handleId, summary }`. Tools and the Phase 4 sandbox read `fullRows` by handle.
**When to use:** Every parsed (non-image) dataset.
**Example:**
```typescript
// Recommended interface (Claude's discretion — D-11/D-12)
interface ParsedDataset {
  handleId: string                 // crypto.randomUUID()
  fileName: string
  type: 'csv' | 'xlsx' | 'json' | 'geojson' | 'text'
  schema: { name: string; type: 'string'|'number'|'boolean'|'mixed' }[]
  rowCount: number
  columnCount: number
  fullRows: Record<string, unknown>[]   // NEVER serialized to the model
  coordinateColumns: { lat?: string; lon?: string; wkt?: string; geometry?: string }
  bytes: number
  createdAt: number
}
interface IngestSummary {              // the ONLY thing the model sees (+ handleId)
  handleId: string
  fileName: string
  type: ParsedDataset['type']
  rowCount: number; columnCount: number
  schema: { name: string; type: string }[]   // capped to N cols + "…M more columns"
  sampleRows: Record<string, unknown>[]       // head + tail + random (D-02)
  detectedCoordinateColumns: string[]
}
const ingestStore = new Map<string, ParsedDataset>()  // session-only, in-memory (D-12)
```
**Key:** Derive `IngestSummary` once at ingest time. The model-facing path must structurally only ever touch `IngestSummary` — never `fullRows`. This is what makes "the model never sees raw rows" a structural guarantee, not a convention (per Specific Ideas in CONTEXT).

### Pattern 3: Vision-detection ladder (D-07) — provider-branched, cached
**What:** `async detectVisionSupport(provider, modelId): Promise<'vision' | 'no-vision' | 'uncertain'>`.
**Ladder:**
1. **Ollama** (`provider.type === 'ollama'`): `POST {baseUrl-without-/v1}/api/show` body `{ "model": modelId }` → response `capabilities: string[]`. `capabilities.includes('vision')` → `'vision'`; present-but-absent → `'no-vision'`. (Note: Ollama's `/v1/models` does NOT expose capabilities — must use native `/api/show`.)
2. **routstr / lmstudio / custom**: `GET {baseUrl}/models` → find the model entry; if it has a `capabilities` array or `input_modalities`/`architecture.input_modalities` listing `image`, return `'vision'`/`'no-vision'` accordingly.
3. **Name heuristic** (existing hints in `store.ts:484`): `vision|vl|llava|qwen2.5-vl|pixtral|gpt-4o|claude-3|gemma…` → `'uncertain'` (NOT confirmed — drives the opt-in path, D-08).
4. **Fail-safe**: anything else → `'no-vision'` (never silently send to a blind model).
**Example:**
```typescript
// Ollama native endpoint — capabilities array is authoritative
const ollamaBase = provider.baseUrl.replace(/\/v1\/?$/, '')   // http://localhost:11434
const res = await fetch(`${ollamaBase}/api/show`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: modelId }),
})
const data = await res.json() as { capabilities?: string[] }
return data.capabilities?.includes('vision') ? 'vision'
     : Array.isArray(data.capabilities) ? 'no-vision' : 'uncertain'
```
**Key:** Cache results per `(provider.type, baseUrl, modelId)` — `/api/show` is a network call; don't repeat it every send. On fetch failure (Ollama down, CORS), degrade to name heuristic → `'uncertain'`, never throw.

### Pattern 4: Host-side column-mapping placement over the FULL dataset (D-05)
**What:** A `place_dataset_features` tool. The model passes `{ handleId, mapping: { lat, lon | wkt | geometry, name?, description?, placeNameColumn? } }`. The **host** reads `ingestStore.get(handleId).fullRows`, builds GeoJSON features for **all** rows, geocodes any without coordinates (D-06), then calls `authoring.writeGeoJSON(features, { replace: false })` via `importFeaturesToEditor`.
**When to use:** INGEST-06; the ugly-CSV→all-points and Telegram→single-feature stories.
**Key:** Iterate `fullRows`, NOT `sampleRows`. This is the literal acceptance bar and it anticipates SAFE-05.

### Anti-Patterns to Avoid
- **Sending full rows to the model "just this once."** Breaks the D-11 guarantee and blows token budget. The model gets summary + handle id, full stop.
- **Using SheetJS `xlsx` from npm.** Stale + ReDoS; use exceljs.
- **Trusting `/v1/models` for Ollama vision.** Ollama's OpenAI surface omits capabilities; use `/api/show`.
- **Reimplementing a new worker bootstrap.** Mirror `workerJsonParse.ts` exactly (sync fallback + timeout + broken latch are already correct).
- **Writing the Zustand store directly for placed features.** Route through Authoring API (INFRA-02 / D-05); the store is a read-mirror (D-09).
- **Folding the file-chip strip into `ChatGeometryAttachment`.** D-10 keeps them separate.
- **Unbounded batch geocoding.** Cap batch size + throttle to respect Nominatim (~1 req/s).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | A regex/split CSV parser | `papaparse` | Quoted fields, embedded newlines, delimiters, BOM, type inference — all edge cases PapaParse handles |
| Excel `.xlsx` reading | A ZIP+XML SpreadsheetML reader | `exceljs` | xlsx is a zipped OOXML bundle; shared strings, number formats, multiple sheets are non-trivial |
| Off-thread plumbing | A fresh Worker harness | Existing `workerJsonParse.ts` pattern | Sync fallback, timeout, broken-worker latch already solved + battle-tested in repo |
| GeoJSON bbox/centroid/validation | Manual coordinate math | `@turf/turf` (installed) | Already a dependency; correct edge handling |
| Geometry mutation | Direct `editor.addFeature` / store writes | Authoring API | INFRA-02 single seam; Phase 5 gate hooks here |
| Vision capability guessing | A bigger name regex | `/api/show` + `/v1/models` capabilities, heuristic only as last resort | Authoritative provider data beats string matching; D-07 |

**Key insight:** Almost every "hard" part of this phase (CSV edge cases, xlsx unzip, worker fallback, vision capability) has an authoritative source — a maintained library, an existing in-repo pattern, or a provider API field. The phase's real engineering is the **seams** (ingest store, summary derivation, column-mapping placement, the gate), not the parsing.

## Common Pitfalls

### Pitfall 1: Ollama vision detection silently fails on the `/v1` surface
**What goes wrong:** Calling `GET {ollama}/v1/models` returns models with NO capabilities field, so vision is never confirmed and either everything is "uncertain" or images get blocked.
**Why it happens:** Ollama's OpenAI-compatible layer doesn't surface capabilities; only the native `/api/show` does.
**How to avoid:** For `provider.type === 'ollama'`, strip the `/v1` suffix and `POST /api/show {model}`; read `capabilities[]`. [CITED: github.com/ollama/ollama PR #10066, docs api.md]
**Warning signs:** Local llava/qwen2.5-vl models showing as "uncertain" despite being multimodal.

### Pitfall 2: ExcelJS streaming `WorkbookReader` doesn't work in the browser/worker
**What goes wrong:** Using `new ExcelJS.stream.xlsx.WorkbookReader(path)` throws — it's Node-stream + filepath based.
**Why it happens:** The streaming reader targets Node fs streams; the browser path is `workbook.xlsx.load(arrayBuffer)`.
**How to avoid:** In the worker, `const wb = new ExcelJS.Workbook(); await wb.xlsx.load(arrayBuffer)`, then iterate `wb.worksheets[0].eachRow(...)`. Pass the ArrayBuffer as a transferable.
**Warning signs:** `fs`/stream errors in the worker bundle; "Cannot read properties of undefined (stream)".

### Pitfall 3: Worker bundling differs between Bun dev (HMR) and prod build
**What goes wrong:** A worker that resolves in `bun dev` 404s or fails to load in the `dist/` production build.
**Why it happens:** `build.ts` only enumerates `**.html` entrypoints; worker chunks are emitted as dependencies of `new Worker(new URL(...))`. The existing GeoJSON worker proves this works, but a NEW worker path must be reachable from a bundled module graph.
**How to avoid:** Use the identical `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type:'module' })` form, imported from a module that's reachable from an HTML entrypoint. **Add a Wave-0 smoke test that builds (`bun run build`) and asserts the worker chunk is emitted to `dist/`.** Don't assume — the repo's CI gates are `bun test + bun run build + biome` (no tsc gate; ~305 pre-existing tsc errors per project memory).
**Warning signs:** Worker loads in dev, silently falls to sync parse (or errors) in prod.

### Pitfall 4: Huge file drop freezes/OOMs even with a worker
**What goes wrong:** A 500MB CSV gets `Blob.text()`'d into one giant string and OOMs the tab, or the worker copies it main↔worker and doubles memory.
**Why it happens:** No size guard; non-transferable postMessage copies.
**How to avoid:** Enforce a max-file-size cap up front (D-12 discretion — e.g. 50MB tabular / 25MB image; planner sets) with the UI-SPEC "file too large" error copy; for xlsx pass a transferable ArrayBuffer; for CSV consider PapaParse `step`/`chunk` streaming inside the worker for very large files.
**Warning signs:** Tab memory spikes; `RangeError: Invalid string length` on `Blob.text()` for >512MB.

### Pitfall 5: Batch geocoding trips Nominatim usage limits
**What goes wrong:** Geocoding a 2000-row place-name column fires 2000 requests and gets the user (or the shared ContextVM server) rate-limited / blocked.
**Why it happens:** Nominatim public policy is an **absolute max 1 req/s**, stricter (4 req/min) for sustained bulk; results must be cached. [CITED: operations.osmfoundation.org/policies/nominatim]
**How to avoid:** Cap `batch_geocode` to a bounded N (planner's discretion — e.g. ≤50 rows/call), throttle to ~1 req/s, de-dupe identical place names before geocoding, cache within the session, and use **skip-and-report** partial-failure semantics (UI-SPEC copy: "Located {n} of {total} rows. {failed} couldn't be geocoded."). Geocoding physically runs server-side through ContextVM (`EarthlyGeoServerClient.SearchLocation` → `search_location` MCP → Nominatim), so the host-side concern is bounding/throttling/caching the call volume.
**Warning signs:** `"Usage limit reached"` / 429 / 509 from the geo server.

### Pitfall 6: Image attachment path doesn't exist yet in ChatPanel
**What goes wrong:** Assuming there's an existing user-image-attach flow to extend — there isn't. Today only `capture_map_snapshot` produces an `image_url` part (`store.ts:1496`); `ChatPanel.tsx` has no file/image input.
**Why it happens:** The `image_url` type + send plumbing exist (`routstr.ts:35`, `store.ts:267,386`) but no UI attach path.
**How to avoid:** Build the user-attached-image path fresh (FileReader → data URL → `image_url` content part), and unify its gate with the snapshot path per D-09. The `messageContentToText`/sanitize/budget code already tolerates `image_url` parts.
**Warning signs:** Looking for an `attachedImages` state that isn't there.

## Code Examples

### Reading a File by type (host side)
```typescript
// Image (D-04): data URL into existing image_url content-part (routstr.ts:35)
const dataUrl: string = await new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej
  r.readAsDataURL(file)
})
// CSV: text string into worker
const csvText = await file.text()
// XLSX: transferable ArrayBuffer into worker
const buf = await file.arrayBuffer()  // postMessage(buf, [buf])
```

### CSV parse inside the worker (PapaParse)
```typescript
// Source: github.com/mholt/PapaParse — header mode + dynamic typing
import Papa from 'papaparse'
const result = Papa.parse(csvText, { header: true, dynamicTyping: true, skipEmptyLines: true })
// result.data: Record<string, unknown>[]; result.meta.fields: string[] (the schema names)
```

### XLSX parse inside the worker (ExcelJS, browser/worker API)
```typescript
// Source: github.com/exceljs/exceljs — browser load path (NOT the Node stream reader)
import ExcelJS from 'exceljs'
const wb = new ExcelJS.Workbook()
await wb.xlsx.load(arrayBuffer)            // works off a transferred ArrayBuffer
const ws = wb.worksheets[0]
const header = (ws.getRow(1).values as unknown[]).slice(1).map(String)
const rows: Record<string, unknown>[] = []
ws.eachRow({ includeEmpty: false }, (row, n) => {
  if (n === 1) return
  const vals = (row.values as unknown[]).slice(1)
  rows.push(Object.fromEntries(header.map((h, i) => [h, vals[i]])))
})
```

### Head + tail + random sampling for the model (D-02)
```typescript
function sampleRows<T>(rows: T[], head = 5, tail = 5, random = 5): T[] {
  if (rows.length <= head + tail + random) return rows
  const out = [...rows.slice(0, head), ...rows.slice(-tail)]
  const mid = rows.slice(head, rows.length - tail)
  for (let i = 0; i < random && mid.length; i++) {
    out.push(mid[Math.floor(Math.random() * mid.length)])
  }
  return out
}
// + column cap: schema.slice(0, MAX_COLS) with a "…N more columns" marker (D-02)
```

### Registering the placement tool (mirror existing registry entries)
```typescript
// Source: existing src/features/chat/tools/registry.ts register({...}) pattern
register({
  name: 'place_dataset_features',
  kind: 'host-builtin',
  schema: schemaFor('place_dataset_features'),
  handler: async (args) => {
    const ds = ingestStore.get(String(args.handleId))
    if (!ds) throw new Error(`Unknown ingest handle: ${args.handleId}`) // → ToolError (D-16)
    const features = await buildFeaturesFromRows(ds.fullRows, args.mapping) // geocode where needed
    const result = importFeaturesToEditor(features, false) // → authoring.writeGeoJSON (INFRA-02)
    return { importedCount: result.importedCount, geocoded: /* report */, skippedDuplicates: result.skippedDuplicates }
  },
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SheetJS `xlsx` from npm | exceljs from npm / SheetJS via CDN only | npm dist frozen 2022 (0.18.5) | Don't `bun add xlsx`; use exceljs |
| Name-only vision heuristic | Provider capability APIs (`/api/show`, `/v1/models` capabilities) | Ollama added capabilities to `/api/show` 2025 (PR #10066) | D-07 ladder replaces `modelMaySupportVision` |
| Main-thread JSON.parse | Worker-offloaded parse w/ sync fallback | Already adopted in repo (`workerJsonParse.ts`) | Extend, don't reinvent |

**Deprecated/outdated:**
- SheetJS `xlsx` on npm: unmaintained on npm + ReDoS through 0.20.1. Replaced by exceljs (or read-excel-file).
- `modelMaySupportVision()` (`store.ts:484`): name-only; replaced by D-07 ladder.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ExcelJS `workbook.xlsx.load(arrayBuffer)` runs cleanly inside a Bun-bundled Web Worker without a Node `fs`/`stream` shim | Standard Stack / Pitfall 2 | If ExcelJS pulls Node-only deps into the worker bundle, planner must add a Wave-0 spike to confirm or fall back to `read-excel-file` (lighter, browser-first). **Recommend a Wave-0 "parse a real .xlsx in the worker + build to dist" smoke test.** |
| A2 | routstr/lmstudio/custom `/v1/models` entries expose a `capabilities` or `input_modalities` field for vision when the model supports it | Pattern 3 | LM Studio's modalities field is recent/evolving (lmstudio-js issue #325); for many custom OpenAI-compatible servers this field is absent → those correctly fall to name-heuristic `'uncertain'`. The fail-safe design already handles absence, so low risk. [ASSUMED] |
| A3 | Ollama runs on the same origin/CORS-permissive enough for the browser to `POST /api/show` | Pattern 3 | If CORS blocks the native endpoint from the browser, detection degrades to `'uncertain'` (name heuristic) — acceptable per D-08, but confirm Ollama CORS config (`OLLAMA_ORIGINS`). [ASSUMED] |
| A4 | Max file-size caps (e.g. 50MB tabular) are acceptable UX | Pitfall 4 | Caps are D-12 discretion; if too low for the "12MB West Pacific Trail" Phase 7 input, raise. Phase 7 ingests large GeoJSON — keep the cap ≥ that. |
| A5 | Batch geocode bound of ≤50 rows/call with ~1 req/s throttle satisfies the stories without tripping Nominatim | Pitfall 5 | Exact cap is D-06 discretion; the Telegram story is single-row (uses `search_location`), the ugly-CSV story may have coords already (no geocode). Bulk place-name geocoding is the edge case. |

## Open Questions

1. **Does ExcelJS bundle cleanly into the worker, or pull Node polyfills?**
   - What we know: `workbook.xlsx.load(ArrayBuffer)` is the documented browser API; ExcelJS is widely used in browsers.
   - What's unclear: whether Bun's browser-target build tree-shakes the Node stream paths cleanly, and the resulting chunk size.
   - Recommendation: **Wave-0 spike** — add `ingest.worker.ts` with an ExcelJS load of a fixture .xlsx, run `bun run build`, assert the worker chunk emits and the parse round-trips. If heavy/broken, switch to `read-excel-file` (gate its install behind `checkpoint:human-verify` per SUS flag).

2. **What are the exact sample/column caps (D-02) and file-size caps (D-12)?**
   - What we know: head+tail+random shape is locked; counts are discretion.
   - Recommendation: planner picks (suggest head 5 / tail 5 / random 5 = 15 sample rows; column cap ~30 with "…N more columns"; file cap ~50MB tabular / ~25MB image). Keep tabular cap ≥ Phase 7's largest expected GeoJSON.

3. **Partial-geocode-failure policy: skip-and-report vs place-with-flag?**
   - What we know: UI-SPEC copy implies skip-and-report ("Located {n} of {total}…").
   - Recommendation: **skip-and-report** (don't place rows that fail to geocode; report the count). Cleaner than placing flagged null-island points. Planner confirms.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | build/test/dev | ✓ | (repo standard) | — |
| `@turf/turf` | GeoJSON placement/validation | ✓ | 7.3.5 | — |
| Web Worker support | off-thread parse | ✓ (browser) | — | sync main-thread parse (existing latch) |
| `papaparse` | CSV | ✗ (to install) | 5.5.3 | none — required for CSV |
| `exceljs` | xlsx | ✗ (to install) | 4.4.0 | `read-excel-file` (SUS-flagged, gate install) |
| ContextVM / `EarthlyGeoServerClient` | geocoding (D-06) | ✓ (in repo) | — | single `search_location` only if batch unavailable |
| Ollama `/api/show` reachable | vision ladder step 1 | ⚠ runtime-dependent (only if user runs Ollama) | — | name heuristic → uncertain (D-08) |

**Missing dependencies with no fallback:** `papaparse` (CSV core), `exceljs`/`read-excel-file` (xlsx core) — both must be installed.
**Missing dependencies with fallback:** Worker (→ sync parse), Ollama `/api/show` (→ name heuristic / uncertain).

## Validation Architecture

> nyquist_validation is enabled (config). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun's built-in runner) |
| Config file | none dedicated; `bunfig.toml` exists (serve plugins only); tests are `*.test.ts` colocated |
| Quick run command | `bun test src/features/chat/ingest` |
| Full suite command | `bun test` |
| Build gate | `bun run build` (worker-emission gate — see Wave 0); `bun run lint` (Biome) |

*Note (project memory): there is NO tsc gate (~305 pre-existing tsc errors); the binding gates are `bun test` + `bun run build` + Biome. Do not introduce a tsc-pass requirement.*

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INGEST-02 | CSV parses to rows + schema | unit | `bun test src/features/chat/ingest/parse.test.ts` | ❌ Wave 0 |
| INGEST-02 | xlsx parses to rows in worker; build emits worker chunk | unit + build | `bun test ...parse.test.ts` + `bun run build` | ❌ Wave 0 |
| INGEST-02 | large input does not block (worker used; sync fallback path) | unit | `bun test ...ingestClient.test.ts` | ❌ Wave 0 |
| INGEST-03 | JSON/GeoJSON parse + bbox; text line/char count | unit | `bun test ...parse.test.ts` | ❌ Wave 0 |
| INGEST-05 | summary = schema + head/tail/random samples; column cap; **fullRows never in summary** | unit | `bun test ...parseSummary.test.ts` | ❌ Wave 0 |
| INGEST-05 | model-facing payload contains handle id + summary only (no fullRows) | unit | `bun test ...ingestStore.test.ts` | ❌ Wave 0 |
| INGEST-06 | column-mapping rule builds features over ALL rows (not samples) | unit | `bun test ...placement.test.ts` | ❌ Wave 0 |
| INGEST-06 | placement writes via Authoring API (no direct store write) | unit | `bun test ...placement.test.ts` (mock editor) | ❌ Wave 0 |
| INGEST-06 | coordinate-column auto-detect (lat/lon/wkt/geometry heuristic) | unit | `bun test ...detectCoordinateColumns.test.ts` | ❌ Wave 0 |
| INGEST-06 | batch geocode bounded + throttled + skip-and-report partial failure | unit | `bun test ...placement.test.ts` (mock geo client) | ❌ Wave 0 |
| INGEST-07 | Ollama `/api/show` capabilities → vision/no-vision | unit | `bun test ...detectVisionSupport.test.ts` (mock fetch) | ❌ Wave 0 |
| INGEST-07 | `/v1/models` capabilities branch; name heuristic → uncertain; fail-safe → no-vision | unit | `bun test ...detectVisionSupport.test.ts` | ❌ Wave 0 |
| INGEST-07 | gate unifies snapshot path (D-09) | unit/integration | `bun test src/features/chat/store.test.ts` (extend) | ⚠ extend existing |
| INGEST-01/04 | chip-per-file, drag-drop, image data-URL encode | manual UAT + light component test | UAT checklist | manual |

### Sampling Rate
- **Per task commit:** `bun test src/features/chat/ingest` (+ `bun test src/features/chat/vision` for INGEST-07 tasks)
- **Per wave merge:** `bun test` (full suite) + `bun run build` (worker-emission + bundle gate) + `bun run lint`
- **Phase gate:** full suite green + build green + UAT (attach + drop + parse + place + vision three-tier) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/features/chat/ingest/parse.test.ts` — CSV/xlsx/json/geojson/text parse correctness (INGEST-02/03)
- [ ] `src/features/chat/ingest/ingestClient.test.ts` — worker RPC + sync fallback + timeout (INGEST-02)
- [ ] `src/features/chat/ingest/parseSummary.test.ts` — head/tail/random + column cap; no-fullRows invariant (INGEST-05)
- [ ] `src/features/chat/ingest/ingestStore.test.ts` — handle lifecycle; model-facing payload excludes fullRows (INGEST-05/D-11)
- [ ] `src/features/chat/ingest/detectCoordinateColumns.test.ts` — name heuristic (INGEST-06/D-04)
- [ ] `src/features/chat/ingest/placement.test.ts` — full-dataset mapping, Authoring-API write, batch geocode bound/throttle/skip-report (INGEST-06)
- [ ] `src/features/chat/vision/detectVisionSupport.test.ts` — full D-07 ladder with mocked fetch (INGEST-07)
- [ ] **Build smoke gate:** assert `bun run build` emits the ingest-worker chunk to `dist/` (Pitfall 3)
- [ ] Fixtures: a small real `.xlsx`, a messy CSV (quoted fields, embedded newlines, a coords column + a place-name column), a GeoJSON, a plain-text file
- [ ] Framework install: none (`bun test` present); add `bun add papaparse exceljs` + `bun add -d @types/papaparse`

## Security Domain

> security_enforcement enabled, ASVS L1. Section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface this phase |
| V3 Session Management | no | Ingest data is session-only in-memory (D-12), not a session-auth concern |
| V4 Access Control | yes | The handle-id seam (D-11) + Authoring API boundary are the access-control surface Phase 4's sandbox confines to. Don't expose `fullRows` to the model; don't bypass Authoring API. |
| V5 Input Validation | **yes (primary)** | All ingest input is **untrusted user files**. Validate/clamp: file size caps, row/column caps, GeoJSON shape (via turf guards), coordinate ranges (lat∈[-90,90], lon∈[-180,180]) before placement. ToolError on bad handle/mapping (D-16). |
| V6 Cryptography | no | No new crypto; image data URLs are local, not persisted |
| V12 Files & Resources | **yes** | File-upload handling: MIME/extension sniffing, size limits (DoS guard, Pitfall 4), no execution of file content, parse in a worker (isolation), reject unknown types gracefully |
| V13 API / SSRF | yes (indirect) | Geocoding goes through the existing ContextVM/`search_location` server path — no new direct outbound fetch from arbitrary file content. Vision detection fetches only the configured provider baseUrl (`/api/show`, `/v1/models`), never a URL derived from file content. |

### Known Threat Patterns for {file-ingest / multimodal chat}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Huge-file memory exhaustion (multi-GB drop) | Denial of Service | Max-size caps + transferable ArrayBuffers + worker isolation (Pitfall 4) |
| Malformed CSV/xlsx crashing the tab | DoS | Parse in worker with try/catch → `ParseResponse{success:false}`; sync-fallback latch; never crash the host |
| ReDoS via the parse library | DoS | Use exceljs (not vulnerable SheetJS ≤0.20.1); keep PapaParse current |
| Raw rows leaking to the model (privacy) | Information Disclosure | Structural: model only ever receives `IngestSummary` + handle id (D-11); covered by an explicit invariant test |
| Image silently sent to a non-vision model (trust/leak) | Information Disclosure / Spoofing | D-07 fail-safe to no-vision + D-08 hard-disable / explicit opt-in; never silent send (acceptance criterion #4) |
| Untrusted coordinate/place data placed without bounds | Tampering | Validate coordinate ranges + cap row counts before `authoring.writeGeoJSON`; geocode rate-bound (Pitfall 5) |
| Prompt injection via file CONTENT (e.g. CSV cell with "ignore previous instructions") | Tampering / Spoofing | Out-of-band: the model sees only summary+samples; treat ingested text as data, not instructions. Note for planner: sample rows ARE shown to the model — keep them clearly framed as data in the summary message. |

## Sources

### Primary (HIGH confidence)
- Existing repo code (read in-session): `src/lib/geo/workerJsonParse.ts`, `geoJsonParseWorker.ts` (worker pattern); `src/features/chat/store.ts` (`modelMaySupportVision`, image_url handling, snapshot vision flow); `src/features/chat/routstr.ts` (provider matrix, image_url type, `/models` discovery); `src/features/chat/tools/registry.ts` / `helpers.ts` (registry `register()`, `importFeaturesToEditor`); `src/features/geo-editor/api/*` (Authoring API facade); `build.ts` (Bun build, worker bundling); `src/ctxcn/EarthlyGeoServerClient.ts` (SearchLocation/Nominatim path).
- `gsd-tools query package-legitimacy check` (npm) — papaparse/exceljs/comlink OK; read-excel-file SUS(too-new); xlsx OK-but-stale.
- `npm view` (in-session) — papaparse 5.5.3, exceljs 4.4.0, xlsx 0.18.5 (stale), comlink 4.4.2.

### Secondary (MEDIUM confidence)
- Ollama API: `/api/show` returns `capabilities: ["completion","vision"]`; vision detected via `vision.block_count` KV. [github.com/ollama/ollama PR #10066; docs api.md; deepwiki ollama 7.3]
- Nominatim Usage Policy: absolute max 1 req/s, bulk restricted further, cache required. [operations.osmfoundation.org/policies/nominatim]
- SheetJS npm status: frozen at 0.18.5, ReDoS through 0.20.1, CDN-only distribution. [git.sheetjs.com #3316/#3111/#3183; docs.sheetjs.com]
- LM Studio `/v1/models` capabilities array + evolving input_modalities. [lmstudio.ai/docs; lmstudio-js issue #325]
- ExcelJS browser `workbook.xlsx.load()` vs Node-only `stream.xlsx.WorkbookReader`. [github.com/exceljs/exceljs; discussion #2517]

### Tertiary (LOW confidence)
- ExcelJS in-worker bundle cleanliness under Bun (A1) — needs Wave-0 spike confirmation.
- Ollama browser CORS to `/api/show` (A3) — runtime-dependent.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions + legitimacy verified in-session; SheetJS exclusion well-sourced.
- Off-thread mechanism: HIGH — exact pattern exists in repo and is Bun-bundled today.
- Vision ladder: HIGH for Ollama `/api/show` shape and the fail-safe design; MEDIUM for `/v1/models` capabilities across custom providers (handled by fail-safe).
- Placement/geocoding seams: HIGH — Authoring API + registry + `search_location` all read in-session.
- ExcelJS-in-worker: MEDIUM — recommend a Wave-0 spike (A1/Open Q1).

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (stable libs); re-check Ollama/LM Studio capability fields and SheetJS/exceljs advisories sooner if the vision ladder or xlsx path misbehaves.
