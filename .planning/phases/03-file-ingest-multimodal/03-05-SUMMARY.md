---
phase: 03-file-ingest-multimodal
plan: 05
subsystem: api
tags: [chat-tools, tool-registry, ingest, geocoding, authoring-api, openai-schemas, d-05, d-06, v5]

# Dependency graph
requires:
  - phase: 03-file-ingest-multimodal (Plan 03)
    provides: getDataset(handleId).fullRows + ParsedDataset/CoordinateColumns seam (the host-side full-rows accessor this plan iterates)
  - phase: 02 (Tool Registry & Authoring API)
    provides: typed registry (register/dispatch/advertise + mandatory kind), schemaFor lookup, importFeaturesToEditor → createAuthoring(editor).writeGeoJSON write seam, injected-register idiom
provides:
  - place_dataset_features (host-builtin) — applies an AI column-mapping rule over the FULL parsed dataset by handle, writing through the Authoring API
  - batch_geocode (remote-mcp) — bounded(50)+throttled(~1 req/s)+de-duped+in-call-cached geocoder over a place-name column with skip-and-report partial failure
  - buildFeaturesFromRows(fullRows, mapping) — full-dataset iteration with lat/lon | WKT | GeoJSON-geometry sources + V5 coord range validation
  - batchGeocode(names, opts) — injectable-clock/injectable-client geocode primitive (name→[lon,lat] + located/total/failed)
  - exported schemaFor() in schemas.ts (shared by registry bootstrap + injected tool modules)
  - BATCH_GEOCODE_MAX_ROWS=50, BATCH_GEOCODE_MIN_INTERVAL_MS=1000
affects:
  - "03-06 UI: surfaces placement/geocode results; the file chip can offer a place action that calls these tools by handle"
  - "Phase 4 sandbox / Phase 5 host-side rules: same getDataset(handleId).fullRows seam; placement is the host-side over-full-dataset write path"
  - "SAFE-05: placement iterating fullRows (not the model-visible sample) is the anticipatory acceptance bar"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected-register tool module (mirrors registerPrimitiveTools): registerIngestTools(register, batchOptions?) registers both tools without importing ./registry back — one-way edge, avoids the dev-bundler circular-init crash."
    - "Injectable clock + client for throttled outbound work: batchGeocode takes { delay, client, minIntervalMs } so tests assert the ~1 req/s spacing with a fake clock and a mock SearchLocation — never a real sleep, never a real network call."
    - "Host-side full-dataset iteration as the literal acceptance bar: placement reads getDataset(handleId).fullRows (D-05), builds features for ALL rows, and returns counts only (never fullRows, T-03-18)."
    - "Minimal in-repo WKT parser (POINT/LINESTRING/POLYGON + MULTI*) instead of adding a wkt dependency — file-cell geometry is parsed host-side, unrecognised WKT is skipped not crashed."

key-files:
  created:
    - src/features/chat/tools/ingest-tools.ts
    - src/features/chat/tools/ingest-tools.test.ts
  modified:
    - src/features/chat/tools/schemas.ts
    - src/features/chat/tools/registry.ts

key-decisions:
  - "BATCH_GEOCODE_MAX_ROWS = 50 (D-06 discretion): unique-name cap per call; over-cap requests are truncated to the first 50 unique names, never fired as >50 lookups (T-03-15 Nominatim ~1 req/s policy)."
  - "BATCH_GEOCODE_MIN_INTERVAL_MS = 1000 (~1 req/s): inter-lookup throttle, injectable so tests use a fake clock."
  - "schemaFor() exported from schemas.ts (dependency-free module) and shared by both the registry bootstrap and injected tool modules — registry.ts keeps its private copy to avoid churn; ingest-tools imports the exported one."
  - "WKT parsed in-repo (no new dependency): @turf does not parse WKT strings; a minimal POINT/LINESTRING/POLYGON/MULTI* parser covers realistic tabular geometry cells, returning null (skip) on anything unrecognised."
  - "Single-row geocoding inside place_dataset_features reuses the SAME bounded batch path (placeNameColumn candidates), so there is one throttle/dedupe/skip-report code path; bulk callers use batch_geocode directly."

patterns-established:
  - "Pattern: injected-register + injectable-side-effect-deps lets a remote-mcp tool be unit-tested deterministically (mock client + fake clock) while production wires the real geo client."
  - "Pattern: skip-and-report result shape { located, total, failed, message } with UI-SPEC copy 'Located {n} of {total} rows. {failed} couldn't be geocoded.'"

requirements-completed: [INGEST-06]

# Metrics
duration: ~12min
completed: 2026-06-17
---

# Phase 3 Plan 05: Ingest Placement & Batch Geocode Tools (INGEST-06) Summary

**Two non-visual ingest tools in the Phase-2 typed registry — `place_dataset_features` (host-builtin) applies an AI column-mapping rule over the FULL parsed dataset by handle (lat/lon | WKT | GeoJSON-geometry), range-validates coordinates (V5), and writes through the Authoring API; `batch_geocode` (remote-mcp) geocodes a place-name column bounded to 50 rows, throttled to ~1 req/s, de-duped + in-call cached, with skip-and-report partial failure.**

## Performance
- **Duration:** ~12 min (sequential executor on main working tree)
- **Started:** 2026-06-17T07:51:00Z
- **Completed:** 2026-06-17T07:55:35Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- **`place_dataset_features` (D-05):** iterates `getDataset(handleId).fullRows` — NOT the model-visible sample — building a feature per row. Proven by a 200-row test asserting `importedCount === 200` and 200 features in the editor (a sample-based bug would cap at ≤15). Geometry sources: `lat`+`lon`, a `wkt` column, or a `geometry` (GeoJSON object/JSON-string) column. Returns counts only (`importedCount`/`skippedDuplicates`/`skippedInvalid`/`geocoded`/`geocodeFailed`) — never `fullRows` (T-03-18, asserted by serialized-payload scan).
- **Authoring-API write seam (INFRA-02 / Phase 2 D-07):** placement routes through `importFeaturesToEditor` → `createAuthoring(editor).writeGeoJSON` — never the Zustand store. Tests assert via `editor.getAllFeatures()` against a `createHeadlessEditor` harness.
- **V5 coordinate range validation:** `lat∈[-90,90]`, `lon∈[-180,180]` enforced before write; out-of-range rows are counted in `skippedInvalid` and never written (T-03-14, asserted: 1 placed of 4, 3 skipped).
- **`batch_geocode` (D-06):** bounded to `BATCH_GEOCODE_MAX_ROWS=50` unique names, throttled to `BATCH_GEOCODE_MIN_INTERVAL_MS=1000` (~1 req/s), de-duped (identical names looked up once), in-call cached, with skip-and-report `{ located, total, failed, message }`. Geocoding runs server-side through ContextVM `SearchLocation` (fixed MCP origin — no file-driven outbound URL, T-03-16). The throttle delay + geo client are injectable, so tests assert the ≥1000 ms spacing with a fake clock and a mock client — no real sleep, no real network.
- **`registerIngestTools(register)`** wired into `bootstrapRegistry` via the injected-register idiom (one-way registry → ingest-tools edge), alongside `place_dataset_features` + `batch_geocode` OpenAI schemas added to `geoStaticToolSchemas`.

## Task Commits
1. **Task 1 (RED):** failing place_dataset_features tests — `cac84b8` (test)
2. **Task 1 (GREEN):** place_dataset_features + registerIngestTools + schemas + bootstrap wiring — `c89dafb` (feat)
3. **Task 2 (test):** batch_geocode bound/throttle/dedupe/skip-report coverage (handler shipped in the Task-1 GREEN commit) — `035f6a5` (test)

**Plan metadata:** see final docs commit.

## Tool Contract (for Plan 06 UI + downstream)

```ts
// place_dataset_features (host-builtin) — args
{ handleId: string,
  mapping: { lat?, lon?, wkt?, geometry?, name?, description?, placeNameColumn? } } // pick ONE geometry source
// → { importedCount, skippedDuplicates, skippedInvalid, geocoded, geocodeFailed, totalFeaturesInEditor }

// batch_geocode (remote-mcp) — args
{ handleId: string, placeNameColumn: string, mapping?: { name?, description? } }
// → { located, total, failed, uniqueNamesLookedUp, importedCount, skippedDuplicates,
//     totalFeaturesInEditor, message: "Located {n} of {total} rows. {failed} couldn't be geocoded." }

// exported primitives (ingest-tools.ts)
buildFeaturesFromRows(fullRows, mapping): { features, skippedInvalid, geocodeCandidates }
batchGeocode(names, { maxRows?, minIntervalMs?, delay?, client? }):
  { coordsByName: Map<name,[lon,lat]>, located, total, failed }
BATCH_GEOCODE_MAX_ROWS = 50; BATCH_GEOCODE_MIN_INTERVAL_MS = 1000
registerIngestTools(register, batchOptions?)  // injected-register; batchOptions for tests
```

## Decisions Made
- **`BATCH_GEOCODE_MAX_ROWS = 50` / `BATCH_GEOCODE_MIN_INTERVAL_MS = 1000`** (D-06 discretion) — the cap is on UNIQUE names after de-dupe; over-cap requests truncate to the first 50 unique names rather than firing >50 lookups.
- **WKT parsed in-repo** — `@turf` does not parse WKT strings and adding a `wkt`/`wellknown` dependency is a package install (excluded from auto-fix Rule 3). A minimal POINT/LINESTRING/POLYGON/MULTI* parser covers realistic tabular geometry cells; unrecognised WKT returns null → the row is counted in `skippedInvalid`, never a crash.
- **Single throttle/dedupe/skip-report code path** — `place_dataset_features`'s `placeNameColumn` fallback reuses the same `batchGeocode` primitive as `batch_geocode`, so there is one bounded geocode path. Telegram-style single-row geocoding uses `search_location` directly (unchanged).
- **`schemaFor()` exported from `schemas.ts`** — shared by the registry bootstrap and injected tool modules so every registered tool resolves its schema from the single dependency-free module. `registry.ts` keeps its private copy (no churn to the ~24 existing entries).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `schemaFor` was a private function in `registry.ts`, not importable by `ingest-tools.ts`**
- **Found during:** Task 1 (place_dataset_features GREEN).
- **Issue:** The plan's action says `schema: schemaFor('place_dataset_features')`, but `schemaFor` lived as a module-private function inside `registry.ts`. The injected tool module cannot import it without creating a registry → ingest-tools → registry cycle.
- **Fix:** Exported a shared `schemaFor()` from `schemas.ts` (the dependency-free schema module). `ingest-tools.ts` imports it from there; `registry.ts` keeps its identical private copy to avoid editing the ~24 existing entries.
- **Files modified:** `src/features/chat/tools/schemas.ts` (added `export function schemaFor`).
- **Verification:** `bun test src/features/chat/tools/ingest-tools.test.ts` green; both tools resolve their schemas; no import cycle (`bun run build` clean).
- **Committed in:** `c89dafb` (Task 1 GREEN).

**2. [Rule 3 - Ordering] `batch_geocode` handler shipped in the Task-1 GREEN commit, not Task 2**
- **Found during:** Task 2 (batch_geocode RED).
- **Issue:** `registerIngestTools` registers BOTH tools in one call (it is wired into `bootstrapRegistry` once). Registering only `place_dataset_features` in Task 1 and adding `batch_geocode` in Task 2 would have required a throwaway intermediate registration shape. The plan's own `<artifacts_this_phase_produces>` lists both tools + `batchGeocode` as the file's exports.
- **Fix:** Both handlers + `batchGeocode` landed in the Task-1 GREEN commit (`c89dafb`); Task 2's commit (`035f6a5`) adds the canonical D-06 test coverage (de-dupe/cap/throttle/skip-report) that drives and proves the batch behavior. The batch tests fail against a registry without `batch_geocode`, preserving the RED→GREEN intent at the suite level.
- **Files modified:** none beyond the planned set.
- **Verification:** `bun test src/features/chat/tools/ingest-tools.test.ts` 16/16 green; the batch tests assert bound/throttle/dedupe/skip-report against the injected fake clock + mock client.
- **Committed in:** `035f6a5` (Task 2).

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking/ordering).
**Impact on plan:** none on contract or scope — the same files, exports, tool names, schemas, and constants the plan lists. Only the module that exports `schemaFor` and the commit in which `batch_geocode`'s handler first appears shifted by necessity (`registerIngestTools` is a single both-tools registration).

## Issues Encountered
- **De-dupe vs. failed names in the dispatch test:** an initial assertion expected only the two *successful* names in the call log, but a unique-but-failing name (`Nowhereville`) is correctly still looked up once (and reported failed). Corrected the assertion to expect all 3 unique names looked up, plus a `filter(n === 'Berlin').length === 1` check proving the two Berlin rows collapsed to one call.
- **`getGeoClient()` instantiates a relay-connected client on module load:** Task 1's tests print a Nostr connect log even though no geocoding fires (the singleton is constructed in `helpers.ts`). Harmless — Task 1 placement never calls it, and Task 2 injects a mock client so the production client is never used in tests.
- **Pre-existing repo-wide biome diagnostics remain (~228, Plan 03 noted the same posture):** one formatting diagnostic surfaces at `registry.ts:814` (the pre-existing `import_osm_to_editor` handler), unchanged by this plan — out of scope. This plan's 4 touched files are biome-clean after a format pass. Logged, not fixed.

## Known Stubs
None — every export is fully implemented and exercised by a GREEN test.

## Threat Mitigations Applied
- **T-03-14 (untrusted coords placed without bounds, Tampering):** `isValidLngLat` range-validates `lat∈[-90,90]`/`lon∈[-180,180]` before `writeGeoJSON`; out-of-range rows counted in `skippedInvalid`, never written (asserted).
- **T-03-15 (batch geocoding floods Nominatim, DoS/rate-policy):** `BATCH_GEOCODE_MAX_ROWS=50` cap + ~1 req/s throttle + de-dupe + in-call cache; bound/throttle/dedupe asserted with an injected fake clock.
- **T-03-16 (file content driving unbounded outbound requests, SSRF):** geocoding runs server-side via ContextVM `SearchLocation` (fixed MCP origin); the host only bounds/throttles call volume — no arbitrary URL is taken from file content.
- **T-03-17 (CSV cell prompt-injection, Tampering/Spoofing):** placement returns counts only and keys no privileged action off cell text; the model never receives placed/full rows back (closes Plan 03's deferred framing mitigation).
- **T-03-18 (placement echoing full rows to the model, Information Disclosure):** result is counts only (`importedCount`/`geocoded`/`skipped*`); asserted by a serialized-payload scan that `fullRows` and a non-sampled row marker (`note-4`) are absent.

## Next Phase Readiness
- **Plan 06 (UI):** ready — the file chip can offer a "place on map" action that dispatches `place_dataset_features` by handle (mapping from `detectedCoordinateColumns` defaults the AI/user overrides), and a bulk geocode action that dispatches `batch_geocode`; surface the skip-and-report `message`.
- **Phase 4 (sandbox) / Phase 5 (host-side rules):** the `getDataset(handleId).fullRows` seam + host-side full-dataset placement path are the templates for the sandboxed/host-rule writers.
- Gates: `bun test src/features/chat/tools/ src/features/chat/ingest/` (78 pass / 0 fail), `bun run build` (✅), biome (clean on this plan's 4 touched files).

## Self-Check: PASSED

- FOUND: src/features/chat/tools/ingest-tools.ts
- FOUND: src/features/chat/tools/ingest-tools.test.ts
- FOUND (modified): src/features/chat/tools/schemas.ts
- FOUND (modified): src/features/chat/tools/registry.ts
- FOUND commit: cac84b8 (test, Task 1 RED)
- FOUND commit: c89dafb (feat, Task 1 GREEN)
- FOUND commit: 035f6a5 (test, Task 2)
- Gates: bun test (78 pass / 0 fail across tools + ingest), bun run build (✅), biome (clean on touched files)

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17*
