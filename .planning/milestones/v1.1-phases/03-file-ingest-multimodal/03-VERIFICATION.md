---
phase: 03-file-ingest-multimodal
verified: 2026-06-17T08:40:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification_resolution: "Satisfied in-session by the user's 03-06 UAT approval (all 6 live checks: button/drag attach, chips, place-all-rows, three-tier vision, D-09 snapshot gate, expandable-not-always-on grid). Accepted as the phase human-verification record. The post-UAT critical fixes (CR-01 model-facing summary, CR-02/03 validation) changed model/validation logic, not the UI behaviors tested. 4/4 automated must-haves independently verified."
human_verification:
  - test: "Attach files via button AND drag-and-drop; confirm one chip per file with parse status; confirm no UI freeze on a large file"
    expected: "FileChipStrip renders with both attach paths; chip shows rows×cols + detected coordinates; large file parses off-thread (no spinner hang)"
    why_human: "Off-thread behavior and visual chip rendering cannot be proven by grep or tests alone"
  - test: "Attach a CSV, see the compact stat line (rows × columns, detected coordinate columns) on the chip, then expand for fuller summary — confirm no always-on data grid"
    expected: "Compact stat line visible; Collapsible/Popover expands on click; no always-on table"
    why_human: "Visual UX interaction — Collapsible expand/collapse behavior requires a live browser session"
  - test: "Image attach with confirmed-vision model → send enabled; switch to confirmed-no-vision model → hard-disabled with tooltip; switch to uncertain model → amber badge + Send-anyway opt-in; confirm image is NOT sent unless opted in"
    expected: "VisionGateControl three-tier: vision=enabled, no-vision=hard-disabled+tooltip, uncertain=amber+opt-in; image_url excluded from payload unless opted in"
    why_human: "Requires switching models in the running app, verifying tooltip text, checking network payload; cannot infer from static analysis"
  - test: "Ask AI to place messy.csv rows on map; confirm place_dataset_features is called and ALL 200+ rows appear (not just the 15 sampled rows)"
    expected: "AI calls place_dataset_features tool with handleId; all fullRows placed on map; batch_geocode used for place-name-only rows"
    why_human: "Requires live AI model interaction, map rendering, and visual count verification"
  - test: "Capture map snapshot gate: confirm capture_map_snapshot obeys the same vision-support gate (D-09) — snapshot image not pushed to model unless vision=confirmed"
    expected: "Snapshot one-shot only injects image_url when detectVisionSupport returns 'vision'"
    why_human: "Requires exercising the tool loop with a real model in a live session"
---

# Phase 03: File Ingest & Multimodal Verification Report

**Phase Goal:** A user can drop a real-world file into chat and have it parsed into structured data the AI can map, with images only ever sent to models that actually support vision.
**Verified:** 2026-06-17T08:40:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can attach files by button and drag-and-drop; sees a chip per attached file; can ingest CSV, Excel, JSON, GeoJSON, plain-text, and image files without the app freezing on large files. | ✓ VERIFIED | `FileChipStrip.tsx` implements both `<input type="file" multiple>` (button) and `onDragOver`/`onDrop` (drag-drop). `ingestClient.ts` dispatches all five kinds off-thread via `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type:'module' })`. `ingest.worker.ts` handles csv/xlsx/json/geojson/text with try/catch (never throws). `fileAttachHandler.test.ts` 9 pass; `ingestClient.test.ts` 8 pass. UAT check 1+2 approved by user. |
| 2 | After ingest the user sees a parse summary (rows × columns, detected coordinate/geometry columns); the model receives only a compact summary, never the raw rows — including for GeoJSON, JSON, and text. | ✓ VERIFIED | `parseSummary.ts:deriveSampleRows` branches on kind: tabular → head/tail/random sample; geojson → ≤5 `{geometryType, properties}` rows; json → top-level key preview; text → first/last lines only. CR-01 fix (`6df7433`) confirmed in code. `parseSummary.test.ts` CR-01 invariant tests (3 tests for geojson/json/text) pass. `ingestSendPath.test.ts` GeoJSON bounded test (`serialized.length < JSON.stringify(fc).length / 10`) passes. `ingestStore.ts:toModelSummary` returns `{handleId, summary}` only — no `fullRows` field. 144/144 tests pass. |
| 3 | The AI can place ingested tabular/text rows onto the map as features, geolocating where needed. | ✓ VERIFIED | `ingest-tools.ts` registers `place_dataset_features` (host-builtin) + `batch_geocode` (remote-mcp) via `registerIngestTools`. Both schemas in `schemas.ts` (lines 802, 844). `bootstrapRegistry` calls `registerIngestTools(register)` (registry.ts:1007). `ingest-tools.test.ts` asserts `importedCount === 200` for a 200-row dataset — proves `getDataset(handleId).fullRows` is iterated, not the ≤15-row sample. `batch_geocode` tests assert bound (50), throttle (≥1000ms), de-dupe, skip-and-report. 18/18 tests pass. UAT check 4 approved. |
| 4 | When the selected model's vision support is unconfirmed, the image-send affordance is disabled or marked uncertain with explicit opt-in — an image is never silently sent to a non-vision model. | ✓ VERIFIED | `detectVisionSupport.ts` implements the four-tier ladder (Ollama /api/show → /v1/models → name heuristic → fail-safe no-vision), cached per `(type,baseUrl,modelId)`, never throws. `store.ts:1275-1281` gates `canUseVision` on `visionSupport === 'vision'` only. `VisionGateControl.tsx` three-tier: `'vision'`→enabled, `'no-vision'`→hard-disabled+Tooltip, `'uncertain'`→amber+Send-anyway button. `composeOutboundContent.ts:canSendImage` returns false for `'no-vision'`. `ingestSendPath.test.ts` asserts no `image_url` on `'no-vision'` and no-opt `'uncertain'`; asserts `image_url` present on `'vision'` and opted `'uncertain'`. 20/20 vision tests pass; 7/7 send-path tests pass. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/chat/ingest/types.ts` | IngestKind + message shapes | ✓ VERIFIED | Exists; exports `IngestKind`, `IngestParseRequest`, `IngestParseResponse` |
| `src/features/chat/ingest/ingest.worker.ts` | Off-thread CSV/xlsx/json/geojson/text parse worker | ✓ VERIFIED | Exists; `self.onmessage` with 5 branches + catch-never-throws pattern |
| `src/features/chat/ingest/parse.ts` | Pure parse helpers (extracted deviation from plan, invited) | ✓ VERIFIED | Exists; `parseCsv`, `parseXlsx`, `parseJson`, `parseText` |
| `src/features/chat/ingest/ingestClient.ts` | Host-side worker RPC client | ✓ VERIFIED | Exists; lazy worker, id-keyed pending, onerror sync-fallback, 30s timeout, xlsx transferable |
| `src/features/chat/ingest/datasetTypes.ts` | ParsedDataset + IngestSummary interfaces | ✓ VERIFIED | Exists; `ParsedDataset`, `IngestSummary`, `SchemaField`, `CoordinateColumns` |
| `src/features/chat/ingest/ingestStore.ts` | Handle-keyed D-11 store | ✓ VERIFIED | Exists; `putDataset`, `getDataset`, `evictDataset`, `toModelSummary`; no localStorage/IndexedDB |
| `src/features/chat/ingest/parseSummary.ts` | deriveIngestSummary with CR-01 fix | ✓ VERIFIED | Exists; `deriveSampleRows` branches on kind; MAX_GEOJSON_SAMPLE_FEATURES=5, MAX_JSON_PREVIEW_KEYS=30, TEXT_PREVIEW_LINES={head:3,tail:3} |
| `src/features/chat/ingest/detectCoordinateColumns.ts` | Name-heuristic coord detector | ✓ VERIFIED | Exists; case-insensitive exact-name match for lat/lon/lng/x/y/wkt/geometry |
| `src/features/chat/ingest/fileSizeGuards.ts` | CR-02 fixed size cap | ✓ VERIFIED | Exists; `Number.isFinite(raw) && raw >= 0 ? raw : +Infinity` fail-closed pattern |
| `src/features/chat/vision/detectVisionSupport.ts` | D-07 vision ladder | ✓ VERIFIED | Exists; Ollama /api/show → /v1/models → name heuristic → fail-safe; per-key cache; clearVisionCache() |
| `src/features/chat/tools/ingest-tools.ts` | place_dataset_features + batch_geocode | ✓ VERIFIED | Exists; `geometryCoordsInRange` CR-03 fix present; both tools registered; `buildFeaturesFromRows` iterates fullRows |
| `src/features/chat/components/FileChipStrip.tsx` | D-10 strip with button + drag-drop | ✓ VERIFIED | Exists; 175 lines; `<input type="file" multiple>` + `onDragOver`/`onDrop`; one `FileChip` per file |
| `src/features/chat/components/FileChip.tsx` | Per-file chip with stat line + Collapsible | ✓ VERIFIED | Exists; type icons (FileSpreadsheet/Braces/FileText/Image); compact stat line; Collapsible expand; no always-on grid |
| `src/features/chat/components/fileAttachHandler.ts` | Pure extracted attach orchestration | ✓ VERIFIED | Exists; dependency-injected; assertFileWithinCaps → parseFileInWorker → putDataset order |
| `src/features/chat/components/VisionGateControl.tsx` | D-08 three-tier gate | ✓ VERIFIED | Exists; three render branches on VisionSupport; Tooltip for hard-disabled; amber + Send-anyway for uncertain |
| `src/features/chat/composeOutboundContent.ts` | D-11 send-path composer | ✓ VERIFIED | Exists; `canSendImage` gate; datasets serialized as `{ingestHandle, ingestSummary}` — never fullRows |
| `src/features/chat/ingestSendPath.test.ts` | D-11 send-path invariant test | ✓ VERIFIED | Exists; 7 tests covering: fullRows absent from tabular payload; GeoJSON bounded; three-tier image gate all four cases + plain-string fallback |
| `src/features/chat/ChatPanel.tsx` | Mounts FileChipStrip + VisionGateControl | ✓ VERIFIED | Both components imported and mounted at line 744/749; `attachedFiles` state at line 152; `composeOutboundContent` called at line 276; `detectVisionSupport` called at line 234 |
| Fixtures: `__fixtures__/{messy.csv, sample.xlsx, sample.geojson, sample.txt}` | Parse fixtures | ✓ VERIFIED | All four present in `src/features/chat/ingest/__fixtures__/` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `ingest.worker.ts` | `exceljs`/`papaparse` | import inside worker module | ✓ WIRED | `ingest.worker.ts` imports from `./parse.ts` which imports exceljs/papaparse; confirmed in plan 01 SUMMARY |
| `ingestClient.ts` | `ingest.worker.ts` | `new Worker(new URL('./ingest.worker.ts', import.meta.url), {type:'module'})` | ✓ WIRED | Present at line 119 of `ingestClient.ts`; also visible in minified dist bundle |
| `ingestStore.ts` (model path) | `IngestSummary` | `toModelSummary` returns summary+handleId, never fullRows | ✓ WIRED | `toModelSummary` reads `summaryCache.get(handleId)` — a pre-derived IngestSummary; no `fullRows` in return type |
| `parseSummary.ts` | `deriveSampleRows` | structured-kind branch limits rows to bounded preview | ✓ WIRED | `deriveSampleRows` in `parseSummary.ts:143` branches by kind; verified CR-01 fix |
| `fileAttachHandler.ts` | `ingestStore.putDataset` | `assertFileWithinCaps → parseFileInWorker → putDataset` | ✓ WIRED | `handleAttachedFile` calls them in the documented order; `fileAttachHandler.test.ts` pins the order |
| `VisionGateControl.tsx` | `detectVisionSupport` | `support: VisionSupport` prop from parent | ✓ WIRED | ChatPanel resolves `detectVisionSupport` and passes result to VisionGateControl |
| `ChatPanel.tsx` | `FileChipStrip`/`VisionGateControl` | mounted beside ChatGeometryAttachment (~744) | ✓ WIRED | Confirmed at lines 744, 749 |
| `ChatPanel.tsx` | `toModelSummary / {handleId, summary}` | `composeOutboundContent` with `attachedFiles` | ✓ WIRED | `composeOutboundContent` at line 276; stores summary from `file.summary` (populated via `toModelSummary` in `fileAttachHandler`) |
| `store.ts` | `detectVisionSupport` | `canUseVision + snapshot gate` | ✓ WIRED | Line 1275: `await detectVisionSupport(providerConfig, selectedModelId)`; `canUseVision` at 1279-1281 requires `=== 'vision'`; `capture_map_snapshot` gate at 1507 |
| `ingest-tools.ts` | `getDataset(handleId).fullRows` | `buildFeaturesFromRows` iterates fullRows | ✓ WIRED | `buildFeaturesFromRows` receives `ds.fullRows`; tested with 200-row dataset asserting `importedCount === 200` |
| `ingest-tools.ts` | `importFeaturesToEditor` | Authoring API write seam | ✓ WIRED | Line 29: `import { importFeaturesToEditor }` from helpers; called in `place_dataset_features` handler |
| `registry.ts` `bootstrapRegistry` | `registerIngestTools` | injected-register pattern | ✓ WIRED | Line 21: import; line 1007: `registerIngestTools(register)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `FileChip.tsx` — stat line render | `file.summary` | `handleAttachedFile` → `deriveIngestSummary` → live parse result | Yes — live parse from actual file bytes | ✓ FLOWING |
| `composeOutboundContent` — dataset part | `file.summary` (IngestSummary) | `toModelSummary(handleId)` reading `summaryCache` (pre-derived at `putDataset`) | Yes — cached live summary, never fullRows | ✓ FLOWING |
| `store.ts:canUseVision` | `visionSupport` | `await detectVisionSupport(providerConfig, selectedModelId)` | Yes — live provider fetch or name heuristic | ✓ FLOWING |
| `place_dataset_features` handler | `ds.fullRows` | `getDataset(handleId)` from `ingestStore` | Yes — the actual parsed rows, not samples | ✓ FLOWING |
| `ingestSendPath.test.ts` — GeoJSON bound test | `serialized.length` | `composeOutboundContent` with 4000-feature FeatureCollection | Yes — summary payload is < 1/10 of raw payload (asserted) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 144 chat feature tests pass | `bun test src/features/chat/` | 144 pass / 0 fail | ✓ PASS |
| D-11 send-path invariant (fullRows never in payload) | `bun test src/features/chat/ingestSendPath.test.ts` | 7 pass / 0 fail | ✓ PASS |
| CR-01 GeoJSON/json/text bounded summary | `bun test src/features/chat/ingest/parseSummary.test.ts` | 15 pass / 0 fail (3 CR-01 invariants) | ✓ PASS |
| CR-02 fail-closed size guard | `bun test src/features/chat/ingest/detectCoordinateColumns.test.ts` | 16 pass / 0 fail (includes fileSizeGuards) | ✓ PASS |
| CR-03 WKT/geometry coord range validation | `bun test src/features/chat/tools/ingest-tools.test.ts` | 18 pass / 0 fail | ✓ PASS |
| Vision ladder (20 tests, all four tiers) | `bun test src/features/chat/vision/detectVisionSupport.test.ts` | 20 pass / 0 fail | ✓ PASS |
| Worker build-emission gate (Pitfall 3) | `bun test test/build-emits-ingest-worker.test.ts` | 1 pass / 0 fail | ✓ PASS |
| Production build succeeds | `bun run build` | Exit 0; ingest worker wired into main chunk (chunk-x13z7aye.js contains "Unknown ingest kind" + Worker instantiation) | ✓ PASS |
| Biome clean on phase 03 files | `bunx biome check src/features/chat/ingest/ ...` | 21 files checked, no errors | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| INGEST-01 | 03-01, 03-06 | User can attach files via button and drag-and-drop, visible chip per file | ✓ SATISFIED | `FileChipStrip.tsx` both paths; UAT 1+2 approved |
| INGEST-02 | 03-01, 03-02, 03-06 | CSV/Excel parsing off main thread; no freeze on large files | ✓ SATISFIED | `ingestClient.ts` Worker RPC + sync fallback; 8 client tests; UAT 1 no-freeze |
| INGEST-03 | 03-01, 03-02 | JSON, GeoJSON, plain-text ingest | ✓ SATISFIED | `ingest.worker.ts` json/geojson/text branches; `parse.test.ts` 5 tests |
| INGEST-04 | 03-06 | Image file ingest | ✓ SATISFIED | `fileAttachHandler.ts` image branch → `readImageDataUrl`; `fileAttachHandler.test.ts` asserts image branch |
| INGEST-05 | 03-03, 03-06 | Parse summary visible to user; model receives compact summary not raw rows | ✓ SATISFIED | `FileChip.tsx` stat line + Collapsible; `deriveIngestSummary`; `toModelSummary` model path; D-11 invariant tests |
| INGEST-06 | 03-03, 03-05 | AI places tabular/text rows on map as features, geolocating where needed | ✓ SATISFIED | `place_dataset_features` + `batch_geocode` registered; 200-row fullRows test; UAT 4 approved |
| INGEST-07 | 03-04, 03-06 | Layered vision detection; image-send disabled or uncertain when unconfirmed | ✓ SATISFIED | `detectVisionSupport` four-tier ladder; `VisionGateControl` three-tier; `ingestSendPath.test.ts` gates; UAT 5+6 approved |

All 7 INGEST requirements: ✓ SATISFIED. REQUIREMENTS.md traceability table updated to mark all INGEST-01..07 Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/chat/ingest/ingestStore.ts` | 60 | `evictDataset` exported but has zero production callers | ⚠️ Warning (WR-02) | Ingest store grows unbounded per session; datasets removed from UI chip but `fullRows` stay in memory until page reload. Tracked in 03-REVIEW.md. Not a phase-goal blocker. |
| `src/features/chat/ingest/ingestClient.ts` | 176-196 | xlsx timeout fallback re-parses a detached (transferred) ArrayBuffer | ⚠️ Warning (WR-01) | Sync fallback for timed-out xlsx will get empty/error result because buffer was transferred. Low-probability path. Tracked in 03-REVIEW.md. |
| `src/features/chat/vision/detectVisionSupport.ts` | 42-45 | Name heuristic uses substring `includes` — 'vl' over-matches | ⚠️ Warning (WR-06) | Produces misleading "uncertain" badges on non-vision models. Only drives opt-in UI, never a silent send. Tracked in 03-REVIEW.md. |
| `src/features/chat/tools/ingest-tools.ts` | 374, 438 | `batch_geocode` and `place_dataset_features` share no cross-call throttle state | ⚠️ Warning (WR-03) | Two back-to-back tool calls can exceed ~1 req/s Nominatim policy. Within-call throttle still applies. Tracked in 03-REVIEW.md. |
| `src/features/chat/components/fileAttachHandler.ts` | 106-115 | `inferSchema` samples only first non-null value per column | ℹ️ Info (WR-07) | Type may be inaccurate for mixed-type columns; `'mixed'` type never produced. AI-override at placement mitigates. Tracked in 03-REVIEW.md. |
| `src/features/chat/components/FileChipStrip.tsx` | 19-23 | `makeId` non-crypto fallback has low collision probability | ℹ️ Info (IN-03) | Monotonic counter would be safer. Low-probability risk. Tracked in 03-REVIEW.md. |

No TBD/FIXME/XXX debt markers found in any phase 03 file. All 8 Warning and 5 Info findings from the code review are tracked in 03-REVIEW.md. None of the open warnings undermine the four success criteria.

### Human Verification Required

UAT Task 3 in Plan 06 was approved by the user (recorded in 03-06-SUMMARY.md "UAT Outcome — APPROVED" covering all 6 checks). However, the following items cannot be statically verified — they require a human to confirm the running UI before a formal pass verdict:

### 1. File attach UI interaction

**Test:** Run `bun dev`, attach `messy.csv` via button and drag-and-drop `sample.geojson`; attach a file over 50 MB.
**Expected:** One chip per file with correct stat line; Collapsible expand; no freeze; "too large" copy on over-cap.
**Why human:** Visual rendering and off-thread no-freeze cannot be asserted statically.

### 2. Three-tier vision gate in-browser

**Test:** Attach an image; switch between a confirmed-vision model, a confirmed-no-vision model, and an uncertain-name model (e.g. `vl-chat`). Check affordance state. Confirm image NOT sent without opt-in.
**Expected:** VisionGateControl renders correct state per tier; tooltip text matches UI-SPEC; image absent from network payload on 'no-vision'.
**Why human:** Model switching, tooltip text, and network payload inspection require a live session.

### 3. AI places all rows (not just sample) on map

**Test:** Attach a 200-row CSV with lat/lon columns; ask the AI to place all rows on the map.
**Expected:** AI calls `place_dataset_features`; 200 points appear, not ≤15 (the sampled set); batch_geocode used for place-name rows.
**Why human:** Requires live AI model + map rendering; count verification is visual.

### 4. capture_map_snapshot obeys the same gate (D-09)

**Test:** With a non-vision model, trigger a conversation that causes a `capture_map_snapshot` tool call. Confirm no `image_url` content part reaches the model.
**Expected:** Snapshot tool result does not include `image_url` unless `visionSupport === 'vision'`.
**Why human:** Requires live tool loop execution and prompt inspection.

### 5. Parse summary — no always-on data grid

**Test:** Attach a CSV; confirm the expanded summary shows structured info (feature count, bbox, column names) but no scrollable data table visible before expansion.
**Expected:** Compact stat line only until Collapsible is opened; no always-on data grid.
**Why human:** Visual layout verification.

### Gaps Summary

No gaps. All four success criteria are satisfied in code and tests:

1. **SC-1** (attach + chip + no-freeze): `FileChipStrip` + `FileChip` + off-thread `ingestClient` all exist and are wired. UAT approved.
2. **SC-2** (parse summary + model gets compact summary, never raw rows): CR-01 fix confirmed in `parseSummary.ts:deriveSampleRows`; invariant tests (CR-01 in `parseSummary.test.ts` + GeoJSON bound in `ingestSendPath.test.ts`) pass. The full payload remains host-side in `fullRows[0]` for tools only.
3. **SC-3** (AI places rows on map): `place_dataset_features` iterates `fullRows` (200-row test proves this); `batch_geocode` with throttle/de-dupe/skip-report. UAT approved.
4. **SC-4** (never silently send image to non-vision model): `detectVisionSupport` fail-safe ladder; `composeOutboundContent` hard-blocks on `'no-vision'`; store.ts blocks autonomous snapshot on non-`'vision'`; `ingestSendPath.test.ts` asserts this. UAT approved.

The 8 Warning and 5 Info findings from the code review (WR-01..08, IN-01..05) are known open debt. The most notable is WR-02 (`evictDataset` never called from production code — store grows unbounded per session) and WR-01 (detached ArrayBuffer in xlsx timeout fallback). Neither blocks the phase goal.

---

_Verified: 2026-06-17T08:40:00Z_
_Verifier: Claude (gsd-verifier)_
