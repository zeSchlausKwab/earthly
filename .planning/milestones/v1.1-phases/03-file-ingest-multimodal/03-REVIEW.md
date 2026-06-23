---
phase: 03-file-ingest-multimodal
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/features/chat/ChatPanel.tsx
  - src/features/chat/components/FileChip.tsx
  - src/features/chat/components/FileChipStrip.tsx
  - src/features/chat/components/VisionGateControl.tsx
  - src/features/chat/components/fileAttachHandler.ts
  - src/features/chat/composeOutboundContent.ts
  - src/features/chat/ingest/datasetTypes.ts
  - src/features/chat/ingest/detectCoordinateColumns.ts
  - src/features/chat/ingest/fileSizeGuards.ts
  - src/features/chat/ingest/ingest.worker.ts
  - src/features/chat/ingest/ingestClient.ts
  - src/features/chat/ingest/ingestStore.ts
  - src/features/chat/ingest/parse.ts
  - src/features/chat/ingest/parseSummary.ts
  - src/features/chat/ingest/types.ts
  - src/features/chat/store.ts
  - src/features/chat/tools/helpers.ts
  - src/features/chat/tools/ingest-tools.ts
  - src/features/chat/tools/registry.ts
  - src/features/chat/tools/schemas.ts
  - src/features/chat/vision/detectVisionSupport.ts
findings:
  critical: 0
  critical_resolved: 3
  warning: 0
  warning_resolved: 8
  info: 1
  info_resolved: 4
  info_deferred: 1
  total: 16
status: resolved
---

> **Resolution (2026-06-17):** All 3 CRITICAL findings were verified and fixed during execute-phase:
> - **CR-01** — `fix(03): CR-01 bound non-tabular ingest summaries (D-11 seam)` (`6df7433`). `deriveSampleRows` now emits a bounded preview for geojson/json/text (≤5 features' `{geometryType, properties}`, top-level keys, first/last lines) instead of the verbatim full payload; full data stays host-side in `fullRows` for placement. Invariant tests added.
> - **CR-02** — `fix(03): CR-02 fail-closed file-size DoS guard on non-finite size` (`fb85d7f`). `assertFileWithinCaps` now normalizes non-finite/negative size to `+Infinity` (fail-closed → rejected). Test added.
> - **CR-03** — `fix(03): CR-03 range-validate WKT + geometry-cell placement (V5)` (`0994acc`). Recursive `geometryCoordsInRange` gates both the WKT and geometry-cell branches; out-of-range skipped. Tests added.
>
> Gates green post-fix: `bun test src/features/chat/` 145 pass / 0 fail, `bun run build` exits 0 (ingest worker chunk still emits), biome clean.
> The **8 Warning** and **5 Info** findings below remain OPEN and tracked for a follow-up `/gsd-code-review 03 --fix` or gap-closure pass (notably WR-02 `evictDataset` never called → unbounded store growth, WR-01 detached-ArrayBuffer sync-fallback, WR-08 handle-JSON truncation, and CR-03 secondary hardening: polygon ring-closure + invalid geometry-type rejection in `parseGeometryCell`).

> **Follow-up resolution (2026-06-17):** the four highest-value open findings were fixed (atomic commits):
> - **WR-02** — eviction wired to file-chip removal (`FileChipStrip.handleRemove`) and chat switch/clear (`ChatPanel`), plus a defense-in-depth LRU size cap (`MAX_INGEST_DATASETS=32`) in `ingestStore`. Tests added.
> - **WR-01** — transferred (detached) xlsx buffers are flagged; the timeout/`onerror` fallbacks now settle with a clear failure response instead of re-parsing zero-length bytes. Test added.
> - **WR-03** — geocode throttle hoisted to a module-level clock shared by `place_dataset_features` + `batch_geocode` (injectable clock + `resetGeocodeThrottle()` seam). Cross-call throttle test added.
> - **CR-03 secondary** — `parseGeometryCell` validates the `type` against RFC 7946 geometry types + requires an array payload; `parseWktGeometry` enforces polygon ring closure (≥3 positions, auto-close, reject degenerate). Tests added.
>
> Still OPEN: WR-04..WR-08 and IN-01..IN-05. Gates green post-fix: `bun test src/features/chat/` 150 pass / 0 fail, `bun run build` exits 0, biome clean on changed files.

> **Final resolution (2026-06-17) — all remaining debt closed:**
> - **WR-08** (`4963bf8`) — `compactIngestHandlePartForPrompt` in `store.ts` shrinks the `{ingestHandle, ingestSummary}` part field-wise (drop `sampleRows` → trim schema tail → handle-only floor) when it exceeds `MAX_USER_MESSAGE_CHARS`, so the JSON stays parseable and `ingestHandle` is never lost. Tests added.
> - **WR-04/05/06/07** (`f3981fd`) — WR-04: `place_dataset_features` reports `geocodeNotAttempted` + re-run hint separately from `skippedInvalid`. WR-05: vision capability probe omits the API-key bearer for `custom` providers (user-controlled baseUrl → key-leak avoidance). WR-06: vision name-heuristic matches on token boundaries (`-vl`/`vl-`), no more `marvel`/`mistral-small` false-match. WR-07: `inferSchema` scans a 100-row per-column sample and emits `'mixed'` on >1 primitive type. Tests added.
> - **IN-01/02/03/04** (`167d69f`) — phantom trailing-row filter in `parseCsv`; `firstCoordinate` envelope fallback + shape-drift warning; monotonic `makeId` counter; `sampleRows` middle draw without replacement.
> - **IN-05 — DEFERRED (intentional):** marking single-letter `x`/`y` coordinate matches as "weak" would change the `CoordinateColumns` return shape and break the `detectCoordinateColumns(['x','y'])` exact-equality contract test, for marginal benefit (the AI confirms coordinates at placement time). Not worth the contract churn.
>
> **All 3 criticals + 8 warnings + CR-03 secondary + 4/5 info resolved; 1 info deferred with rationale.** Gates green: full `bun test` 244 pass / 0 fail, `bun run build` exits 0 (ingest worker chunk emits), biome clean.

# Phase 3: Code Review Report

**Reviewed:** 2026-06-17
**Depth:** standard
**Files Reviewed:** 22 (21 distinct source files; ChatPanel reviewed for ingest/vision surfaces, lines 1-810 + relevant helpers)
**Status:** issues_found

## Summary

This phase implements file ingest (CSV/XLSX/JSON/GeoJSON/text), an in-memory handle-keyed
dataset store (the "D-11 privacy seam"), the vision-detection fail-safe ladder, file-size DoS
guards, a `place_dataset_features` host tool, and a `batch_geocode` remote-mcp tool. The
architecture is generally sound and the documented seams (single model-facing accessor, single
vision gate, injected `register`) are real. However, adversarial review surfaced several
defects that undermine the very invariants the phase claims to enforce structurally:

- **The D-11 "model never sees the full table" guarantee is violated for GeoJSON and text
  files** — the entire file payload is embedded in `summary.sampleRows` and sent to the model
  (CR-01). This is the central security claim of the phase and it does not hold for two of the
  five file kinds.
- **The file-size DoS guard passes `Infinity`-sized files** because of a clamp-fallback
  inversion (CR-02).
- **Coordinate range validation accepts the antimeridian/pole-swapped or transposed
  lat/lon** only superficially; more importantly the WKT/geometry paths bypass range
  validation entirely (CR-03), so a WKT `POINT(999 999)` is placed on the map.

Plus eight warnings (worker timeout double-settle risk, no dataset eviction / unbounded store
growth, geocode throttle not applied across the two tools, schema type inference sampling only
the first non-null value, etc.).

## Critical Issues

### CR-01: Full GeoJSON / text file content is embedded in the model-facing summary (D-11 seam breach)

**File:** `src/features/chat/ingest/parseSummary.ts:134` and `src/features/chat/components/fileAttachHandler.ts:131-137`
**Issue:** The phase's headline invariant (datasetTypes.ts:9-12, "`IngestSummary` ... NEVER
`fullRows`") is enforced for tabular kinds but structurally broken for `geojson` and `text`.

For GeoJSON, `buildParsedDataset` stores the entire parsed FeatureCollection as a single row:
`fullRows = [{ __geojson: res.data }]` (fileAttachHandler.ts:132). For text it stores
`fullRows = [{ lineCount, charCount, lines: [...every line...] }]` (parse.ts:85-91 →
fileAttachHandler.ts:135).

`deriveIngestSummary` then does `sampleRows: sampleRows(parsed.fullRows)`
(parseSummary.ts:134). Because these `fullRows` arrays have length 1 (≤ head+tail+random=15),
`sampleRows` returns `[...rows]` verbatim (parseSummary.ts:42) — i.e. the **entire** GeoJSON
object or the **entire** text file's line array is copied into `summary.sampleRows`.

That `IngestSummary` is exactly what `composeOutboundContent` serializes into the outbound user
message (`composeOutboundContent.ts:59-65`) and what `compactIngestHandleResult` passes through
to the prompt path (helpers.ts:1287-1294). So a 12 MB GeoJSON (the A4 reference file) or a large
`.txt` is sent to the model in full — defeating both the privacy seam AND the token-bounding
purpose of the sample, and able to blow the prompt window.

**Fix:** Never place raw file payloads in `fullRows[0]` and sample them. For structured kinds,
exclude the payload row from the sample and surface only `typeStats`:
```ts
// parseSummary.ts deriveIngestSummary
const isStructured = parsed.type === 'geojson' || parsed.type === 'text'
return {
  ...,
  // structured kinds carry their payload in fullRows[0] for tools only — never sample it
  sampleRows: isStructured ? [] : sampleRows(parsed.fullRows),
  ...
}
```
For GeoJSON, optionally surface a small bounded sample of feature *properties* (not geometry);
for text, surface only `lineCount`/`charCount` (already in `typeStats`). Keep the full payload
reachable solely via `getDataset(handleId)`.

### CR-02: File-size DoS guard passes a non-finite (Infinity / NaN) size

**File:** `src/features/chat/ingest/fileSizeGuards.ts:47-49` (with `src/features/chat/tools/helpers.ts:109-113`)
**Issue:** The guard's stated purpose is "a NaN/Infinity size can't slip past the cap"
(fileSizeGuards.ts:44-46). It calls `clampPositiveInt(file.size, 0, Number.MAX_SAFE_INTEGER)`.
But in `clampPositiveInt`, a non-finite input makes `toFiniteNumber` return `undefined`, which
returns the **fallback verbatim without clamping**: `if (numeric === undefined) return fallback`
(helpers.ts:111). The fallback here is `0`. So `assertFileWithinCaps` computes `size = 0` for an
`Infinity` or `NaN` file size, and `0 > cap` is false → the file is **accepted**. The clamp
idiom does the opposite of what the comment claims for exactly the inputs it was meant to catch.

(`File.size` is normally a finite non-negative integer, so this is a defense-in-depth guard
rather than a routine path — but the guard as written is inert, and a synthesized/mocked
`{ size, isImage }` object, e.g. from a future drag-drop or paste path, can carry `Infinity`.)

**Fix:** Make the non-finite case fail the cap rather than pass it:
```ts
const raw = file.size
const size = Number.isFinite(raw) && raw >= 0 ? raw : Number.POSITIVE_INFINITY
if (size > cap) { return { ok: false, reason: ... } }
```
Do not route through `clampPositiveInt` for a size comparison — its `undefined → fallback`
branch and `Math.max(1, ...)` floor are wrong for this use.

### CR-03: WKT and GeoJSON-geometry placement paths skip coordinate range validation (V5)

**File:** `src/features/chat/tools/ingest-tools.ts:227-248` (and `parseWktGeometry` 93-146, `parseGeometryCell` 148-167)
**Issue:** The tool description and the seam doc promise "Coordinates are range-validated (lat
-90..90, lon -180..180); out-of-range rows are skipped" (schemas.ts:804, ingest-tools.ts:8).
`isValidLngLat` is only applied on the explicit lat/lon branch (ingest-tools.ts:213). The WKT
branch (228-237) and the GeoJSON-geometry branch (240-248) build features directly from
`parseWktGeometry` / `parseGeometryCell` with **no range check at all**. A row with
`wkt = "POINT(9999 9999)"` or a geometry cell `{"type":"Point","coordinates":[5000,5000]}` is
accepted and written to the editor. This is an unvalidated-input → map-corruption path that the
phase explicitly claims to close (V5 / SAFE-05).

Additionally `parseWktGeometry` never validates POLYGON ring closure or minimum vertex counts
(a 1-point "ring" yields an invalid Polygon), and `parseGeometryCell` accepts any object with a
string `type` + `coordinates` key without checking the type is a real GeoJSON geometry type or
that coordinates are numeric — so `{type:"Banana",coordinates:"oops"}` passes
(ingest-tools.ts:158-165).

**Fix:** Range-validate every coordinate produced by WKT/geometry parsing before pushing the
feature. Add a recursive coordinate walker:
```ts
function geometryCoordsInRange(geom: GeoJSON.Geometry): boolean {
  const walk = (c: unknown): boolean =>
    typeof c === 'number'
      ? true
      : Array.isArray(c)
        ? (c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number'
            ? isValidLngLat(c[0], c[1])
            : c.every(walk))
        : false
  return 'coordinates' in geom ? walk((geom as any).coordinates) : true
}
```
Skip (and count in `skippedInvalid`) any WKT/geometry row whose coordinates fall out of range,
and validate the geometry `type` against the known GeoJSON types in `parseGeometryCell`.

## Warnings

### WR-01: Worker timeout fallback can double-settle / cross-talk with a late worker reply

**File:** `src/features/chat/ingest/ingestClient.ts:176-196`
**Issue:** The per-request `setTimeout` deletes the pending entry and calls `parseSync(...)`,
resolving the promise (189-195). But the worker's `onmessage` only acts if it still finds the
id in `pendingRequests` (122-127) — that part is safe. The real hazard: for `xlsx` the
ArrayBuffer was **transferred** to the worker (183), so the timeout's `parseSync(id, kind,
payload)` re-parses with a now-**detached/zero-length** `payload.buffer`. The sync fallback for
a timed-out xlsx will therefore throw "Could not parse" or return empty rows rather than the
correct data — the fallback silently corrupts the result for the exact large-file case it
exists to rescue. The `onerror` fallback (settleViaSync, 104-107) has the same transferred-buffer
problem.
**Fix:** Do not transfer the xlsx buffer if a sync fallback may need it (copy instead), or clone
the buffer before transfer and have the fallback use the clone, or mark xlsx requests as
non-fallbackable and reject on timeout with a clear message.

### WR-02: Ingest store grows unbounded — `evictDataset` is never called

**File:** `src/features/chat/ingest/ingestStore.ts:60-63` (dead export) and `src/features/chat/ChatPanel.tsx:297-300`
**Issue:** `putDataset` adds to two module-level Maps and nothing ever removes entries.
`evictDataset` is exported but has **zero callers** (confirmed by grep across `src/features/chat`).
Removing a file chip (FileChip `onRemove` → FileChipStrip `handleRemove`, FileChipStrip.tsx:100-107)
filters the UI list but never evicts the dataset; switching/clearing chats
(ChatPanel.tsx:216-222) drops `attachedFiles` but leaves the parsed `fullRows` resident. The
doc claims the store is "session-only ... bounds the lifetime of an untrusted in-memory file
(T-03-07)" (ingestStore.ts:11-16), but in practice every attached-and-removed file's full table
lives until page reload. For a workflow that attaches several 50 MB files this is a real memory
problem and weakens the untrusted-data lifetime bound.
**Fix:** Call `evictDataset(handleId)` from `handleRemove` when a parsed chip is removed, and on
chat switch/clear evict the handles of any not-yet-sent attached datasets. Consider an LRU/size
cap on the store as defense-in-depth.

### WR-03: `batch_geocode` (50-row) and `place_dataset_features` geocode-fallback share no throttle state

**File:** `src/features/chat/tools/ingest-tools.ts:374-378, 438-441`
**Issue:** Each tool call constructs an independent `batchGeocode` run with its own throttle
clock. The throttle (`minInterval` spacing, ingest-tools.ts:328) only spaces requests *within a
single call*. The model can issue `place_dataset_features` and `batch_geocode` back-to-back (or
two `batch_geocode` calls), and there is no cross-call rate limiter — bursting well past the
"~1 req/s Nominatim policy" the doc promises (ingest-tools.ts:15-18, 36-37). The bound is also
only 50 *unique* names per call, not per session.
**Fix:** Hoist the throttle to a module-level token-bucket / last-request timestamp shared by
both tools (and ideally by `search_location`), so the ~1 req/s policy holds across all geocoder
traffic, not just within one call.

### WR-04: `place_dataset_features` geocode-failure accounting is wrong when no place column is mapped

**File:** `src/features/chat/tools/ingest-tools.ts:392-394`
**Issue:** When there are geocode candidates but `mapping.placeNameColumn` is falsy, the code
sets `geocodeFailed = built.geocodeCandidates.length` in the `else` branch. But candidates are
only ever produced when `mapping.placeNameColumn` is set and a row has a non-empty value
(buildFeaturesFromRows:251-254). So with no `placeNameColumn`, `geocodeCandidates` is always
empty and this branch reports `geocodeFailed = 0` — fine — but the asymmetry means rows that had
a place name yet no `placeNameColumn` mapping were already silently counted as `skippedInvalid`
(257), so the returned counts can't distinguish "skipped because no geometry" from "could have
been geocoded but wasn't asked to". The reported `skippedInvalid` overstates true invalid rows.
**Fix:** Track a distinct `geocodeNotAttempted` (or surface a hint) so the model can tell that
re-running with a `placeNameColumn` would place more rows, rather than treating them as invalid.

### WR-05: `detectOpenAiCompatible` sends the API key but does not constrain the request target

**File:** `src/features/chat/vision/detectVisionSupport.ts:107-124`
**Issue:** The doc asserts "the fetch target is ALWAYS `provider.baseUrl` + a fixed path ...
never a value derived from file content or model output" (detectVisionSupport.ts:19-24). That
holds — but `provider.baseUrl` for a `custom` provider is fully user-controlled and the function
attaches `Authorization: Bearer <apiKey>` (112-114) to a `GET {baseUrl}/models` request. If the
custom baseUrl points at an attacker-influenced origin (e.g. via a shared/imported settings
blob), the provider API key leaks to that origin. This is an existing-surface risk rather than
new to this phase, but the vision detector newly fans the key out to a second endpoint per model.
**Fix:** This mirrors the trust model of the existing chat completion path, so it may be
acceptable — but document the assumption, and consider omitting the bearer for the capability
probe when the provider is `custom` (the `/models` list is typically public), or validate
`baseUrl` is https and same-origin-family before attaching credentials.

### WR-06: Vision name-heuristic uses substring matching and over-matches

**File:** `src/features/chat/vision/detectVisionSupport.ts:42-45`
**Issue:** `nameHeuristic` returns `'uncertain'` if the model id `includes` any hint. Hints like
`'vl'` (line 32) match as a substring inside unrelated model names (e.g. `mistral-small` contains
no `vl`, but `...-vllm`, `marvel`, `ncouvelle`, any id containing the letters "vl" consecutively
match). `'claude-3'` will not match `claude-3.5`/`claude-3-5` reliably depending on punctuation.
Because `'uncertain'` only unlocks the opt-in path (not a silent send) the blast radius is
limited, but it produces misleading "vision?" badges and Send-anyway prompts on non-vision
models.
**Fix:** Match on word boundaries / token segments rather than raw `includes`, and drop overly
short hints (`'vl'`) in favor of `'-vl'`/`'vl-'` token forms.

### WR-07: Schema type inference samples only the first non-null value per column

**File:** `src/features/chat/components/fileAttachHandler.ts:106-115`
**Issue:** `inferSchema` picks the first row where the column is non-null and types the column by
that single value (`typeof sample`). A numeric column whose first value happens to be a string
(e.g. a header echoed into data, `"N/A"`, or PapaParse leaving an un-coerced token) is typed
`string`; a `mixed` column (the schema supports `'mixed'`, datasetTypes.ts:24) is never produced
because the function only ever emits string/number/boolean. The model then sees an inaccurate
schema and may pick the wrong column mapping.
**Fix:** Scan a bounded sample (e.g. first 100 rows) per column; if more than one primitive type
appears, emit `'mixed'`. Reuse the same sample for `detectCoordinateColumns` confidence.

### WR-08: `MAX_USER_MESSAGE_CHARS` truncation can corrupt the dataset handle JSON

**File:** `src/features/chat/store.ts:45, 328-347` (sanitizeMessageForPrompt) and `composeOutboundContent.ts:59-66`
**Issue:** A composed user message places the dataset as a JSON text part
`{"ingestHandle":...,"ingestSummary":{...}}`. On the prompt path, `sanitizeMessageForPrompt`
truncates each text part to `MAX_USER_MESSAGE_CHARS` (6000) with
`truncateTextForPrompt` (store.ts:285-288, 336). Combined with CR-01 (full GeoJSON/text in
`sampleRows`), a large summary JSON is cut mid-string, producing **invalid JSON** in the user
message — the model can no longer parse out `ingestHandle`, so it cannot call
`place_dataset_features` with the right handle. Even for tabular files a wide
schema + 15 sample rows can exceed 6000 chars and be truncated mid-token.
**Fix:** Resolve CR-01 first (shrinks the payload massively). Then ensure the
`{ingestHandle, ingestSummary}` part is either exempt from char-truncation or truncated
field-wise (drop sampleRows before cutting the handle/schema), so the handle is never lost.

## Info

### IN-01: `parseCsv` uses `dynamicTyping` but `skipEmptyLines` may still yield a trailing all-undefined row

**File:** `src/features/chat/ingest/parse.ts:33-43`
**Issue:** PapaParse with `header: true` + `dynamicTyping` can still emit a row of all-`null`/
`undefined` for malformed trailing lines depending on input. Downstream `rowCount` then includes
phantom rows. Consider filtering rows where every value is null/undefined.
**Fix:** `rows: result.data.filter(r => Object.values(r).some(v => v != null))`.

### IN-02: `firstCoordinate` reads `result.results` but `search_location` envelopes vary

**File:** `src/features/chat/tools/ingest-tools.ts:287-297`
**Issue:** `firstCoordinate` assumes `response.result.results[0].coordinates.{lat,lon}`. Other
call sites (`registry.ts:384-385`) pass the response through `extractMcpToolResult` which unwraps
`.result` differently. If the MCP envelope shape drifts, geocoding silently returns 0 located
rows with no diagnostic. Add a fallback to `response.results` and log a one-time shape warning.

### IN-03: `makeId` fallback duplicate-collision window

**File:** `src/features/chat/components/FileChipStrip.tsx:19-23`
**Issue:** The non-crypto fallback `file-${Date.now()}-${Math.random()...}` can collide if two
files are seeded in the same tick with the same random slice (low probability). Since chip ids
key React lists and the update-by-id map (91), a collision mis-routes a parse result. Prefer a
monotonic counter suffix.

### IN-04: `sampleRows` random draw can duplicate the same middle row

**File:** `src/features/chat/ingest/parseSummary.ts:46-48`
**Issue:** The random sample draws `random` times with replacement from `mid`, so the same middle
row can appear multiple times while others never appear. For representativeness, draw without
replacement (shuffle-and-slice) when `mid.length >= random`.

### IN-05: `detectCoordinateColumns` maps `x`/`y` as lon/lat unconditionally

**File:** `src/features/chat/ingest/detectCoordinateColumns.ts:15-16`
**Issue:** `x` → lon and `y` → lat by name (D-04 heuristic). Many tabular datasets use `x`/`y`
for non-geographic axes (charts, pixel coords). Because the AI confirms at placement time this is
low-risk, but the auto-detected coords surfaced in the summary may mislead. Consider lowering
confidence for single-letter matches or noting them as "weak" in the summary.

---

_Reviewed: 2026-06-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
