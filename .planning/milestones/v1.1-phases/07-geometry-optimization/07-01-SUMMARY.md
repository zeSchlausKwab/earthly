---
phase: 07-geometry-optimization
plan: 01
subsystem: testing
tags: [geojson, turf, web-worker, tdd, fixture, byte-budget]

# Dependency graph
requires:
  - phase: 04-code-interpreter-sandbox
    provides: WORKER_ASSETS registry + /workers/:name dev route + dist/workers prod emission
  - phase: 06-ai-bulk-transform-data-driven-styling
    provides: Wave-0 RED-scaffold idiom (namespace imports), gateBulkApply/registry dispatch test patterns
provides:
  - Deterministic >1MB "West Pacific Trail" surrogate fixture generator (makeOversizedTrailFixture + fixtureBytes)
  - RED test scaffolds encoding the GEO-01/02/03 behavioral contract (optimize, RPC client, acceptance, tool)
  - optimize entry in WORKER_ASSETS so the off-thread worker can be served (dev) and emitted (prod)
affects: [07-02, 07-03, 07-04, geometry-optimization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deterministic seeded-PRNG fixture generator (checked-in code, not a multi-MB blob) for byte-budget acceptance tests"
    - "Namespace-import RED scaffolds: a missing named export fails at call time, not module-load (06-01 idiom)"
    - "Pre-register a worker in WORKER_ASSETS before its source exists, so the dev route + prod build pick it up"

key-files:
  created:
    - src/features/chat/geometry/fixture.ts
    - src/features/chat/geometry/optimize.test.ts
    - src/features/chat/geometry/optimizeClient.test.ts
    - src/features/chat/geometry/optimize.acceptance.test.ts
    - src/features/chat/tools/geometry-tools.test.ts
  modified:
    - src/lib/workers/workerAssets.ts

key-decisions:
  - "Fixture sized at 145 points/line × 300 lines to clear 1MB (research's 12MB blob replaced by a ~1.1MB deterministic surrogate — repo-light and reproducible)"
  - "RED tests reference optimizeMod.countSelfIntersections as the Wave-2 topology helper name (namespace import keeps the suite from crashing on its absence)"
  - "geometry-tools.test gates at safety Level 2 so a single pending diff is emitted and assertable as intent:'modify'"

patterns-established:
  - "Pattern 1: seeded mulberry32 PRNG + fixed-precision rounding → byte-identical fixture across runs"
  - "Pattern 2: fixtureBytes() uses the EXACT publish-gate serialization so the budget compares apples-to-apples"

requirements-completed: [GEO-01, GEO-02, GEO-03]

# Metrics
duration: 9 min
completed: 2026-06-22
---

# Phase 7 Plan 1: Wave-0 Geometry-Optimization Foundation Summary

**Deterministic >1MB West Pacific Trail surrogate fixture + four RED test scaffolds encoding the GEO-01/02/03 optimize contract + the one-line `optimize` WORKER_ASSETS registration that lets the off-thread worker be served and emitted.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-22
- **Completed:** 2026-06-22
- **Tasks:** 3
- **Files modified:** 6 (5 created, 1 edited)

## Accomplishments
- `makeOversizedTrailFixture()` deterministically produces a 1,108,694-byte messy LineString FeatureCollection (300 features) with superfluous near-collinear vertices (simplify target), microgaps within the `0.00001` dissolve tolerance (stitch target), and a 50-feature identical-props group (lossless merge target).
- Four RED test files encode the full Wave-2/3 contract: `optimize.test.ts` (report/topology/merge/unreachable), `optimizeClient.test.ts` (no-hang sync fallback), `optimize.acceptance.test.ts` (GEO-03 under-budget bar), `geometry-tools.test.ts` (tool registered, `targetBytes`-only schema, gates `modify`).
- `optimize` registered in `WORKER_ASSETS` → `workerUrl('optimize') === '/workers/optimize.worker.js'`; the dev `/workers/:name` route and the `build.ts` emission loop now both cover it.

## Task Commits

Each task was committed atomically:

1. **Task 1: Deterministic West Pacific Trail surrogate fixture generator** - `86be330` (feat)
2. **Task 2: RED test scaffolds for optimize(), RPC client, acceptance, tool** - `fa760e6` (test)
3. **Task 3: Register the optimize worker asset** - `f4001af` (chore)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/features/chat/geometry/fixture.ts` - `makeOversizedTrailFixture(opts?)` deterministic generator + `fixtureBytes()`; pure (no turf/editor/worker imports).
- `src/features/chat/geometry/optimize.test.ts` - RED: report/topology/merge/unreachable blocks (GEO-01/02).
- `src/features/chat/geometry/optimizeClient.test.ts` - RED: RPC client settles via sync fallback, never hangs (GEO-01).
- `src/features/chat/geometry/optimize.acceptance.test.ts` - RED: oversized fixture → under `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (GEO-03).
- `src/features/chat/tools/geometry-tools.test.ts` - RED: `optimize_geometry` registered, target-only schema, gates `modify`.
- `src/lib/workers/workerAssets.ts` - added `optimize` entry to `WORKER_ASSETS`.

## Decisions Made
- Fixture default tuned from research's 90 → 145 points/line so the serialized collection clears 1MB (998KB at 130, 1.11MB at 145) without an unbounded blob.
- The topology assertion calls `optimizeMod.countSelfIntersections(...)` — pinned here as the Wave-2 helper name the worker module must export alongside `optimize`.
- No new packages installed (research §"Installation: None"); slopcheck N/A.

## Deviations from Plan

None - plan executed exactly as written.

The only tuning was the fixture's `pointsPerLine` default (a host-internal sizing constant, explicitly the plan's "Size the densification so the serialized FeatureCollection exceeds `BLOSSOM_UPLOAD_THRESHOLD_BYTES`" instruction), not a behavioral deviation.

## Issues Encountered
- First fixture pass measured 707KB (90 pts/line), then 998KB (130). Bumped to 145 pts/line → 1.11MB, clearing the 1MB target with margin. Resolved within the task before commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The objective contract is now `bun test`-enforced and RED: `bun test src/features/chat/geometry/` fails against absent `./optimize`, `./optimizeClient`, and `./geometry-tools` symbols.
- Wave 2 must export from `src/features/chat/geometry/optimize.ts`: `optimize(fc, budget) → { result, report }` (with the `OptimizeReport` fields the tests read) and `countSelfIntersections(features)`.
- Wave 2 must export `runOptimize(fc, budget)` from `optimizeClient.ts`; Wave 3 must create `optimize.worker.ts` (already pre-registered) and `registerGeometryTools` in `geometry-tools.ts`.
- No `bun run build` gate was run here by design — the worker source lands in 07-03.

## Self-Check: PASSED

- All 5 created files verified present on disk; `workerAssets.ts` edit verified via import assertion (`workerUrl('optimize') === '/workers/optimize.worker.js'`).
- Commits `86be330`, `fa760e6`, `f4001af` verified in `git log`.
- Plan verification re-run: `bun test src/features/chat/geometry/` fails RED (0 pass / 3 fail) as expected; `fixture.ts` + `workerAssets.ts` import-load cleanly; `biome check` clean on all touched files.

---
*Phase: 07-geometry-optimization*
*Completed: 2026-06-22*
