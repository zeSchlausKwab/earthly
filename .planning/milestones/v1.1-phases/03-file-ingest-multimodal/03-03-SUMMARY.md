---
phase: 03-file-ingest-multimodal
plan: 03
subsystem: ingest
tags: [ingest-store, privacy-seam, summary, sampling, coordinate-detection, size-guard, d-11, d-02, d-04]

# Dependency graph
requires:
  - phase: 03-file-ingest-multimodal (Plan 01)
    provides: IngestKind + parse.ts helpers (the parsed-row shape the store holds)
  - phase: 03-file-ingest-multimodal (Plan 02)
    provides: parseFileInWorker — the pre-parse size guard (T-03-01) runs BEFORE this client call
provides:
  - handle-keyed in-memory ingest store (src/features/chat/ingest/ingestStore.ts) — putDataset/getDataset/evictDataset/toModelSummary
  - the D-11 structural privacy seam — model path can ONLY reach IngestSummary; fullRows reachable solely via getDataset
  - deriveIngestSummary (src/features/chat/ingest/parseSummary.ts) — column-capped schema + head/tail/random sample + per-type stats
  - prompt-path leak guard — compactToolMessageContentForPrompt drops fullRows on ingest-handle tool results
  - name-heuristic coordinate/geometry column detector (detectCoordinateColumns.ts) — D-04
  - pre-parse file-size caps (fileSizeGuards.ts) — INGEST_SIZE_CAPS + assertFileWithinCaps (T-03-07 DoS guard)
  - ParsedDataset / IngestSummary / SchemaField / CoordinateColumns interfaces (datasetTypes.ts) — the seam Phase 4 sandbox + Phase 5 host-side rules plug into
affects:
  - "03-05 placement: reads getDataset(handleId).fullRows host-side; confirms/overrides detectedCoordinateColumns"
  - "03-06 UI: calls assertFileWithinCaps before parse, putDataset after, renders the user stat line + detectedCoordinateColumns"
  - "Phase 4 sandbox: reads fullRows via getDataset by handle"
  - "Phase 5 host-side-over-full-dataset rules: same getDataset seam"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Handle-keyed store as a STRUCTURAL privacy seam: module-level Map<handleId, ParsedDataset> (mirrors registry.ts), with two distinct projections — getDataset (full rows, tools/sandbox) vs toModelSummary (summary only, model). fullRows has no model-facing path by construction."
    - "Derive-once-cache-forever summary: IngestSummary computed at putDataset time and cached in a parallel Map, so the model path can never recompute over fullRows."
    - "Prompt-path compaction recognizes a structured ingest-handle envelope ({ ingestHandle, ingestSummary }) and strips everything else — defence-in-depth so even a tool echoing the dataset cannot leak fullRows to the model."

key-files:
  created:
    - src/features/chat/ingest/datasetTypes.ts
    - src/features/chat/ingest/ingestStore.ts
    - src/features/chat/ingest/parseSummary.ts
    - src/features/chat/ingest/detectCoordinateColumns.ts
    - src/features/chat/ingest/fileSizeGuards.ts
    - src/features/chat/ingest/ingestStore.test.ts
    - src/features/chat/ingest/parseSummary.test.ts
    - src/features/chat/ingest/detectCoordinateColumns.test.ts
  modified:
    - src/features/chat/tools/helpers.ts

key-decisions:
  - "D-11 enforced structurally: toModelSummary returns { handleId, summary } and there is NO model-facing field exposing fullRows; getDataset is the sole fullRows accessor. Invariant proven by a serialized-payload deep-scan test (no non-sampled row, no 'fullRows' substring)."
  - "Sampling (D-02 discretion): head 5 + tail 5 + random 5 (up to 15 rows), exposed as INGEST_SAMPLE; small tables (≤15 rows) return all rows with no padding."
  - "Column cap (D-02 / T-03-09): MAX_SUMMARY_COLS = 30 with a moreColumns remainder (omitted when nothing dropped)."
  - "Size caps (D-12 discretion / A4): tabular 50MB (≥ Phase 7's ~12MB West Pacific Trail GeoJSON), image 25MB; cap is on RAW file.size (xlsx decompression amplifies)."
  - "Coordinate heuristic (D-04): exact-on-normalized-name (not substring) match — lat∈{lat,latitude,y}, lon∈{lon,lng,long,longitude,x}, wkt, geometry∈{geometry,geom,the_geom}; ambiguous → {} so the AI overrides at placement."

requirements-completed: [INGEST-05, INGEST-06]

# Metrics
duration: ~5min
completed: 2026-06-17
---

# Phase 3 Plan 03: Ingest Store & Summary Seam (D-11) Summary

**A handle-keyed, session-only ingest store that makes "the model never sees raw rows" a STRUCTURAL guarantee — `toModelSummary` returns summary+handle only while `fullRows` is reachable solely via `getDataset`; plus the two summaries (column-capped schema + head/tail/random sample), the D-04 coordinate-column heuristic, and the T-03-07 pre-parse size caps, all proven by a serialized-payload no-leak invariant test.**

## Performance
- **Duration:** ~5 min (sequential executor on main working tree)
- **Completed:** 2026-06-17T07:45:03Z
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files created:** 8 (1 modified: helpers.ts)

## Accomplishments
- **D-11 structural seam delivered:** `ingestStore.ts` holds full datasets in a module-level `Map`; the only model-facing accessor `toModelSummary(handleId)` returns `{ handleId, summary }`, and `fullRows` has no model-reachable field. The store derives + caches the `IngestSummary` once at `putDataset` time so the model path can never recompute over raw rows.
- **No-raw-rows invariant PROVEN:** the store test puts a 200-row dataset and deep-scans the serialized `toModelSummary` output — every non-sampled row name is absent and the string `fullRows` never appears (T-03-06 mitigated).
- **Two summaries (D-01/D-02/D-03):** `deriveIngestSummary` caps the schema to `MAX_SUMMARY_COLS=30` (with `moreColumns` remainder, T-03-09), samples head 5 + tail 5 + random 5 (`INGEST_SAMPLE`), and adds per-type stats (GeoJSON feature count + geometry types + bbox via `@turf/turf`; text line/char counts). `detectedCoordinateColumns` feeds the user stat line.
- **Prompt-path defence-in-depth:** `compactToolMessageContentForPrompt` now recognizes a structured `{ ingestHandle, ingestSummary }` tool result and compacts to summary-only, so even a tool echoing the dataset cannot leak `fullRows` to the model.
- **D-04 coordinate heuristic:** `detectCoordinateColumns` matches lat/lon/lng/long/x/y/wkt/geometry case-insensitively (exact-on-normalized-name, not substring — `relation_id` does not falsely match), returning `{}` for ambiguous input so the AI overrides at placement.
- **T-03-07 DoS guard:** `assertFileWithinCaps` rejects over-cap files BEFORE parse/hold (tabular 50MB ≥ A4's 12MB, image 25MB), normalizing a possibly non-finite size via the `clampPositiveInt` idiom.

## Task Commits
1. **Task 1 (RED):** failing store + no-raw-rows invariant test — `8399315` (test)
2. **Task 1 (GREEN):** handle-keyed store + deriveIngestSummary — `bfc34ab` (feat)
3. **Task 2 (RED):** sampling/cap/invariant + compaction tests — `fd2de3e` (test)
4. **Task 2 (GREEN):** ingest-handle compaction in helpers.ts — `c6633d3` (feat)
5. **Task 3 (RED):** coordinate heuristic + size-guard tests — `34aefa1` (test)
6. **Task 3 (GREEN):** detectCoordinateColumns + fileSizeGuards — `77f9d8a` (feat)
7. **Formatting:** biome format pass — `079aa6a` (style)

**Plan metadata:** see final docs commit.

## Seam Contract (for Plan 05 placement, Plan 06 UI, Phase 4 sandbox)

```ts
// datasetTypes.ts
type DatasetType = 'csv' | 'xlsx' | 'json' | 'geojson' | 'text'
interface SchemaField { name: string; type: 'string'|'number'|'boolean'|'mixed' }
interface CoordinateColumns { lat?: string; lon?: string; wkt?: string; geometry?: string }
interface ParsedDataset {
  handleId: string; fileName: string; type: DatasetType
  schema: SchemaField[]; rowCount: number; columnCount: number
  fullRows: Record<string, unknown>[]   // NEVER handed to the model
  coordinateColumns: CoordinateColumns; bytes: number; createdAt: number
  typeStats?: DatasetTypeStats
}
interface IngestSummary {                // the ONLY thing the model sees
  handleId: string; fileName: string; type: DatasetType
  rowCount: number; columnCount: number
  schema: SchemaField[]; moreColumns?: number
  sampleRows: Record<string, unknown>[]
  detectedCoordinateColumns: string[]; typeStats?: DatasetTypeStats
}

// ingestStore.ts
putDataset(parsed: Omit<ParsedDataset,'handleId'|'createdAt'>): string   // → handleId
getDataset(handleId: string): ParsedDataset | undefined                  // tools/sandbox: fullRows
evictDataset(handleId: string): void
toModelSummary(handleId: string): { handleId: string; summary: IngestSummary } | undefined  // model path ONLY

// parseSummary.ts
deriveIngestSummary(parsed: ParsedDataset): IngestSummary
sampleRows<T>(rows: T[], opts?: { head?; tail?; random? }): T[]
INGEST_SAMPLE = { head: 5, tail: 5, random: 5 }; MAX_SUMMARY_COLS = 30

// detectCoordinateColumns.ts
detectCoordinateColumns(schemaFields: string[]): CoordinateColumns

// fileSizeGuards.ts
INGEST_SIZE_CAPS = { tabularBytes: 50*1024*1024, imageBytes: 25*1024*1024 }
assertFileWithinCaps(file: { size: number; isImage: boolean }): { ok: true } | { ok: false; reason: string }
```

**Plan 06 wiring order:** `assertFileWithinCaps(file)` → reject if `!ok` → `parseFileInWorker` (Plan 02) → build `ParsedDataset` (`detectCoordinateColumns(schemaFields)` for `coordinateColumns`) → `putDataset` → render the user stat line from the summary. The model receives `toModelSummary(handleId)` only.

## Decisions Made
- **GeoJSON/text `fullRows` shape for typeStats:** `deriveTypeStats` reads the parsed FeatureCollection from `fullRows[0].__geojson` (or `fullRows[0]` directly) for GeoJSON, and `fullRows[0].{lineCount,charCount}` for text, but always prefers a pre-computed `parsed.typeStats` when the ingest pipeline already supplied one. This keeps Plan 06 free to either pre-compute stats or let the summary derive them.
- **Compaction envelope is structured, not heuristic:** the prompt-path guard keys off explicit `ingestHandle` + `ingestSummary` fields (not a fuzzy row-shape sniff), so it never mis-compacts an unrelated tool result.
- **Size normalization via `clampPositiveInt`:** a `NaN`/`Infinity` reported size can't slip past the cap — it is clamped to a bounded positive int before the comparison.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `parseSummary.ts` created in Task 1, not Task 2**
- **Found during:** Task 1 (store GREEN).
- **Issue:** The plan has `putDataset` "derive the IngestSummary once via `deriveIngestSummary`" (Task 1), but `deriveIngestSummary` is the Task 2 artifact. Task 1's store cannot compile/run without it.
- **Fix:** Created a working `parseSummary.ts` (sampling + column cap + per-type stats) in Task 1's GREEN commit; Task 2 then added its dedicated tests and the `helpers.ts` compaction extension (the genuinely-new Task 2 behavior). The plan's own Task 1 `<action>` mandates this ordering ("derives the IngestSummary once via deriveIngestSummary and caches it").
- **Files modified:** `src/features/chat/ingest/parseSummary.ts` (created in `bfc34ab`).
- **Verification:** Task 2's `parseSummary.test.ts` covers sampling/cap/invariant/per-type GREEN; the compaction test was RED without the `helpers.ts` change (confirmed via stash) and GREEN with it.

---

**Total deviations:** 1 auto-fixed (1 blocking/ordering). **Impact:** none on contract or scope — the same files and exports the plan lists; only the commit in which `parseSummary.ts` first appears shifted earlier by necessity.

## Threat Mitigations Applied
- **T-03-06 (raw rows → model, Information Disclosure):** STRUCTURAL — `toModelSummary` summary-only + no `fullRows` field on the model path + prompt-path compaction; invariant test scans the serialized payload.
- **T-03-07 (huge file held in memory, DoS):** `assertFileWithinCaps` rejects over-cap files before parse/hold; session-only in-memory store bounds lifetime.
- **T-03-09 (wide-table token blow-up, Information Disclosure):** column cap `MAX_SUMMARY_COLS=30` + `moreColumns`.
- **T-03-08 (CSV cell prompt-injection):** ACCEPTED per plan — sampled rows are shown to the model by design (column mapping needs them); framing-as-data mitigation is carried into Plan 05's tool-result message. No new surface introduced here.

## Issues Encountered
- **Doc-comment tripped the source-grep invariant:** the D-12 "no localStorage/IndexedDB/persist" assertion greps the store source; the original doc comment literally named those APIs. Reworded the comment to describe the absence without the banned tokens — the grep is now clean and the comment still documents the session-only choice.
- **Substring collision in the invariant test:** zero-padded + delimited row markers (`m-0000-end`) so `m-3` is not a substring of `m-30`, otherwise a sampled row could falsely "contain" an unsampled marker.
- **`bun run lint` reports ~228 pre-existing repo-wide diagnostics** (out of scope — Plan 01/02 noted the same gate posture). Lint of THIS plan's 9 touched files is clean after a biome format pass.

## Known Stubs
None — every export is fully implemented and exercised by a GREEN test. `__geojson`/pre-computed-`typeStats` are optional pipeline inputs (documented above), not stubs.

## Next Phase Readiness
- **Plan 05 (placement):** ready — read `getDataset(handleId).fullRows` host-side; confirm/override `detectedCoordinateColumns`; carry T-03-08 sample-framing into the tool-result message.
- **Plan 06 (UI):** ready — wire `assertFileWithinCaps` → `parseFileInWorker` → `detectCoordinateColumns` → `putDataset`; render the user stat line + detected coords from the summary.
- **Phase 4 (sandbox) / Phase 5 (host-side rules):** the `getDataset` seam is the single full-rows entry point.
- Gates: `bun test src/features/chat/ingest/` (38 pass / 0 fail), `bun run build` (exit 0), biome (clean on the 9 touched files).

## Self-Check: PASSED

- FOUND: src/features/chat/ingest/datasetTypes.ts
- FOUND: src/features/chat/ingest/ingestStore.ts
- FOUND: src/features/chat/ingest/parseSummary.ts
- FOUND: src/features/chat/ingest/detectCoordinateColumns.ts
- FOUND: src/features/chat/ingest/fileSizeGuards.ts
- FOUND: src/features/chat/ingest/ingestStore.test.ts
- FOUND: src/features/chat/ingest/parseSummary.test.ts
- FOUND: src/features/chat/ingest/detectCoordinateColumns.test.ts
- FOUND commit: 8399315 (test, Task 1 RED)
- FOUND commit: bfc34ab (feat, Task 1 GREEN)
- FOUND commit: fd2de3e (test, Task 2 RED)
- FOUND commit: c6633d3 (feat, Task 2 GREEN)
- FOUND commit: 34aefa1 (test, Task 3 RED)
- FOUND commit: 77f9d8a (feat, Task 3 GREEN)
- Gates: bun test (38 pass / 0 fail), bun run build (exit 0), biome (clean on touched files)

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17*
