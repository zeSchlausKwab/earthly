---
phase: 03-file-ingest-multimodal
plan: 01
subsystem: ingest
tags: [papaparse, exceljs, web-worker, bun-build, csv, xlsx, geojson, parse]

# Dependency graph
requires:
  - phase: 02-tool-registry-authoring-api
    provides: chat tool infrastructure (src/features/chat/tools) — sibling pattern for colocated bun:test
provides:
  - off-thread ingest parse worker (src/features/chat/ingest/ingest.worker.ts) for csv/xlsx/json/geojson/text
  - pure parse helpers (parse.ts) directly unit-testable under bun:test
  - IngestParseRequest/IngestParseResponse discriminated message contract (types.ts)
  - four parse fixtures (messy.csv, sample.xlsx, sample.geojson, sample.txt)
  - parse-correctness test scaffold (parse.test.ts, 5 tests GREEN)
  - build-emission gate proving ExcelJS+PapaParse bundle cleanly for the browser worker target
affects: [03-02 parse client/worker round-trip, 03-03 size guard, 03-05 coord-detect + geocode]

# Tech tracking
tech-stack:
  added: [papaparse ^5.5.3, exceljs ^4.4.0, "@types/papaparse ^5.5.2"]
  patterns:
    - "Worker-thin / helper-pure split: ingest.worker.ts wraps pure parse.ts helpers so parse logic is bun:test-able without a real Worker"
    - "Standalone Bun.build worker-emission gate (test/build-emits-ingest-worker.test.ts) — proves a worker entrypoint bundles for target:'browser' before any UI wires it"

key-files:
  created:
    - src/features/chat/ingest/types.ts
    - src/features/chat/ingest/parse.ts
    - src/features/chat/ingest/ingest.worker.ts
    - src/features/chat/ingest/parse.test.ts
    - src/features/chat/ingest/__fixtures__/messy.csv
    - src/features/chat/ingest/__fixtures__/sample.xlsx
    - src/features/chat/ingest/__fixtures__/sample.geojson
    - src/features/chat/ingest/__fixtures__/sample.txt
    - test/build-emits-ingest-worker.test.ts
  modified:
    - package.json

key-decisions:
  - "ExcelJS-in-worker spike PASSED — exceljs ^4.4.0 bundles cleanly for target:'browser' under Bun; read-excel-file fallback (Task 3) NOT needed"
  - "Extracted pure parse helpers into parse.ts (deviation, not in plan files_modified) so parse correctness is testable without driving a real Worker — the plan's Task 4 explicitly invited this"
  - "xlsx parsed via the in-memory ExcelJS browser API wb.xlsx.load(buffer), NOT the Node stream WorkbookReader (RESEARCH Pitfall 2)"
  - "SheetJS xlsx remains forbidden (npm-frozen 2022 + ReDoS); read-excel-file not installed"

patterns-established:
  - "Worker-thin / helper-pure: a worker module is a try/catch self.onmessage shell around exported pure functions"
  - "Build-emission gate as a unit test: assert worker entrypoint Bun.build success + library markers in the emitted bundle"

requirements-completed: [INGEST-02, INGEST-03]

# Metrics
duration: ~12min (continuation)
completed: 2026-06-17
---

# Phase 3 Plan 01: Ingest Wave-0 De-risk & Scaffold Summary

**ExcelJS-in-worker spike resolved GREEN — papaparse + exceljs parse a real .xlsx/CSV inside a Bun-bundled browser worker, with a build-emission gate, message-shape contract, pure parse helpers, and a 5-test parse-correctness scaffold + four fixtures for Wave-1 to build against.**

## Performance

- **Duration:** ~12 min (continuation executor; resumed after a transient API socket error mid-plan)
- **Completed:** 2026-06-17T07:24:20Z
- **Tasks:** 4 (Task 1 already committed pre-handoff; Task 3 skipped — spike passed; Tasks 2 & 4 completed here)
- **Files created:** 9 (1 modified: package.json)

## Accomplishments
- **Spike GREEN:** ExcelJS ^4.4.0 bundles cleanly for `target:'browser'` under Bun — the single highest-risk phase unknown (Open Q1 / Assumption A1) is resolved. No Node `fs`/`stream` shim failure. The `read-excel-file` fallback (Task 3, blocking-human) was correctly NOT taken.
- **Worker + contract:** `ingest.worker.ts` `self.onmessage` branches all five kinds (csv/xlsx/json/geojson/text), converting every error to `{ success:false, error }` and never throwing out of the handler (mirrors `geoJsonParseWorker.ts` exactly). `types.ts` defines `IngestKind` + `IngestParseRequest`/`IngestParseResponse`.
- **Build-emission gate:** `test/build-emits-ingest-worker.test.ts` standalone-builds the worker entrypoint and asserts papaparse + exceljs + the worker's own `Unknown ingest kind` marker survive bundling (Pitfall 3).
- **RED scaffold + fixtures:** `parse.test.ts` (5 tests) exercises all five parse kinds against real fixtures, including a real ExcelJS-written `sample.xlsx` round-trip and `messy.csv`'s quoted/embedded-newline + lat/lon + place columns.

## Task Commits

1. **Task 1: Package legitimacy gate + install** - `3e7b7b3` (chore) — committed pre-handoff; legitimacy checkpoint already human-approved.
2. **Task 2: ExcelJS-in-worker spike — types + worker + build-emission gate** - `76a982c` (feat)
3. **Task 3: Spike-failure fallback gate** - SKIPPED (spike passed GREEN; `read-excel-file` not installed).
4. **Task 4: Parse-correctness scaffold + fixtures** - `5a5fd5a` (test)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/features/chat/ingest/types.ts` - `IngestKind` + discriminated request/response message shapes.
- `src/features/chat/ingest/parse.ts` - pure `parseCsv`/`parseXlsx`/`parseJson`/`parseText` helpers (extracted for direct bun:test).
- `src/features/chat/ingest/ingest.worker.ts` - thin `self.onmessage` worker over the pure helpers; never throws out.
- `src/features/chat/ingest/parse.test.ts` - 5 GREEN parse-correctness tests (csv/xlsx/json/geojson/text).
- `src/features/chat/ingest/__fixtures__/{messy.csv,sample.xlsx,sample.geojson,sample.txt}` - parse fixtures.
- `test/build-emits-ingest-worker.test.ts` - Pitfall-3 build-emission gate.
- `package.json` - papaparse, exceljs, @types/papaparse (committed in Task 1).

## Decisions Made
- **Spike outcome: exceljs PASSED, fallback not needed.** The conditional Task 3 `read-excel-file` human-verify gate was not triggered — `bun run build` exits 0 and the standalone worker build is green.
- **dist worker chunk name:** The production html-driven build (`build.ts` enumerates `**.html` entrypoints) does NOT yet emit an ingest chunk, because no UI instantiates `new Worker(new URL('./ingest.worker.ts', import.meta.url))` yet — that wiring is Plan 02. The plan's emission gate therefore correctly uses a standalone `Bun.build` of the worker entrypoint, which emits an entry-point named `ingest.worker-<hash>.js` (observed `ingest.worker-zpyyr9ra.js`; hash is content-derived per build). Plan 02 should add the worker-wiring so the chunk also appears under the html-driven dist build.
- **File-size cap handoff to Plan 03:** The worker has NO size guard — T-03-01 (xlsx zip-bomb / oversized parse DoS) is mitigated only by the try/catch converting parse errors to `{success:false}` (host never crashes). A real input-size cap MUST be added in Plan 03 *before* this worker is called from the UI. Recommended starting cap: reject inputs over ~10 MB pre-parse (xlsx decompression amplification means the cap should apply to the raw ArrayBuffer/text byte length, not the decompressed row count).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted pure parse helpers into `parse.ts` (not in plan `files_modified`)**
- **Found during:** Task 2 / Task 4 (left in-progress by the interrupted executor; reconciled here).
- **Issue:** The plan's `files_modified` lists `ingest.worker.ts` but not a separate `parse.ts`. A real `new Worker(new URL(...))` cannot be driven under `bun:test`, so testing parse correctness (Task 4 acceptance) directly against the worker is impossible without an extracted, importable parse module.
- **Fix:** Parse logic lives in pure helpers (`parse.ts`); the worker is a thin try/catch `self.onmessage` shell over them. The plan's Task 4 explicitly invited this ("invoke the worker's parse logic directly or via a small synchronous parse helper extracted from the worker").
- **Files modified:** `src/features/chat/ingest/parse.ts` (new), `ingest.worker.ts` (imports helpers).
- **Verification:** `parse.test.ts` (5 pass) imports the helpers directly; the worker still imports them so behaviour is identical at runtime.
- **Committed in:** `76a982c` (Task 2).

---

**Total deviations:** 1 auto-fixed (1 blocking/structural). **Impact:** Makes Task 4's "assert real behavior, not MISSING" achievable; no scope creep — the worker contract and bundled libraries are unchanged.

## Issues Encountered
- **Continuation handoff:** Resumed as a fresh agent after a transient API socket error. Verified all prior state via `git log`/`git status` and direct file inspection before acting — Task 1 (`3e7b7b3`) recognized, no duplicate install commit. The interrupted agent's four untracked files were inspected, found correct/complete, finished (added `parse.test.ts` + fixtures), and committed atomically.

## Note on parse.test.ts status (RED vs GREEN)
The plan frames `parse.test.ts` as the "Wave-0 RED scaffold the Wave-1 client makes GREEN." Because the parse logic was extracted into directly-importable helpers, these 5 tests assert REAL parse behaviour and are **GREEN today** — they are the executable contract Plan 02 wires the worker round-trip against, not `MISSING`-stub placeholders (the plan's acceptance criterion explicitly allows either, "document which" — documented: GREEN).

## Next Phase Readiness
- Parse libs installed + legitimacy-gated; SheetJS NOT used; spike GREEN.
- Worker + message contract + fixtures + parse tests ready for **Plan 02** (parse client / worker round-trip) to consume.
- **Plan 03 must add the pre-parse input-size cap** (T-03-01 mitigation) before the worker is invoked from UI.
- **Plan 02 should wire `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type:'module' })`** so the ingest chunk also emits under the html-driven production build.

## Self-Check: PASSED

- FOUND: src/features/chat/ingest/types.ts
- FOUND: src/features/chat/ingest/parse.ts
- FOUND: src/features/chat/ingest/ingest.worker.ts
- FOUND: src/features/chat/ingest/parse.test.ts
- FOUND: src/features/chat/ingest/__fixtures__/{messy.csv, sample.xlsx, sample.geojson, sample.txt}
- FOUND: test/build-emits-ingest-worker.test.ts
- FOUND commit: 76a982c (feat, Task 2)
- FOUND commit: 5a5fd5a (test, Task 4)
- Gates: bun test (6 pass / 0 fail), bun run build (exit 0), biome (clean on ingest dir + gate test)

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17*
