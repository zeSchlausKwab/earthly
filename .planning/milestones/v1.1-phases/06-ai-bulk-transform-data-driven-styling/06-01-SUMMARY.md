---
phase: 06-ai-bulk-transform-data-driven-styling
plan: 01
subsystem: ai-bulk-transform
tags: [tdd, wave-0, red-tests, predicate, dedup, validation, styling, diff]
requires: []
provides:
  - "predicate.test.ts — RED contract for matchesPredicate + selectByPredicate (TOOLS-02 D-06 / TOOLS-03 select)"
  - "dedup.test.ts — RED contract for findDuplicateGroups (TOOLS-03 dedup)"
  - "geometryValidation.test.ts — RED contract for validateGeometryFeatures (TOOLS-04)"
  - "bulk-tools.test.ts — RED contract for the five bulk tools + gate + caps + STYLE-02 round-trip"
  - "diff.test.ts — EXTENDED RED contract for classifyModifyKind (STYLE-01 diff headline)"
affects:
  - "Plan 02 (predicate engine), Plan 03 (dedup + validation), Plans 04/05 (bulk tools + style diff) turn these reds green"
tech-stack:
  added: []
  patterns:
    - "RED-first Wave 0: tests import absent production symbols so import resolution fails (intended W0 state)"
    - "Namespace import for additive RED in a shared module: `import * as diffModule` keeps diff.test.ts loading so the existing classifyMutation tests stay green while the new classifyModifyKind block is red"
key-files:
  created:
    - src/features/geo-editor/api/predicate.test.ts
    - src/features/geo-editor/api/dedup.test.ts
    - src/features/geo-editor/api/geometryValidation.test.ts
    - src/features/chat/tools/bulk-tools.test.ts
  modified:
    - src/features/geo-editor/api/diff.test.ts
decisions:
  - "diff.test.ts reaches classifyModifyKind via a namespace import (not a named import) — a missing named ESM import is a hard module-load error that takes the whole file down (including the 7 green classifyMutation tests); the namespace keeps the module loading so only the new block is red."
  - "bulk-tools.test.ts drives all five tools through registry `dispatch` (the ingest-tools idiom) and sets the gate level via `setSafetyLevelProvider`, exercising Cancel through `requestConfirm`/`resolvePendingDiff` — no new test plumbing invented."
metrics:
  duration: ~16min
  completed: 2026-06-22
---

# Phase 6 Plan 01: Wave 0 RED Test Scaffolds Summary

Locked the Phase 6 requirement→behavior contract as executable RED specs: four new `*.test.ts` files (predicate, dedup, geometryValidation, bulk-tools) plus an additive `classifyModifyKind` extension to `diff.test.ts`, all red-on-landing because the production symbols they import land in Plans 02–05.

## What Was Built

**Task 1 — three pure `api/` module test scaffolds (commit `8be3cc3`):**
- `predicate.test.ts` (42 `expect`s): every operator — `eq`, `neq`, `exists`, `missing`, `contains`, `in`, `lt`, `lte`, `gt`, `gte` — plus A4 inclusive "missing" semantics (absent / null / `''` / whitespace-only all count as missing), the flat `all: PredicateOp[]` AND-list, and `selectByPredicate` returning the FULL matching set (250 matches, not capped) + purity. (TOOLS-02 D-06 / TOOLS-03 select)
- `dedup.test.ts` (15 `expect`s): `findDuplicateGroups` by `geometry` / `attributes` / `both`, keep-first survivor, non-survivor delete ids, no-duplicates case, and purity (no editor reference, no mutation). (TOOLS-03 dedup)
- `geometryValidation.test.ts` (14 `expect`s): `validateGeometryFeatures` flags self-intersection (kinks) / near-zero-area sliver / invalid ring, asserts the aggregate shape `{ checked, withSelfIntersections, withZeroArea, invalidRings, issues }`, and read-only (no mutation). Cross-feature gap/sliver detection marked out-of-scope (A3). (TOOLS-04)

**Task 2 — bulk-tools behavior scaffold + diff extension (commit `13acd10`):**
- `bulk-tools.test.ts` (49 `expect`s): the five tools driven via `dispatch` against `createHeadlessEditor`. Pins declarative host-over-all-ids (120 features, out-of-sample `f-119` modified; schema has no `features`/`featureIds` param), `set`/`copy`/`template`/`fillIfMissing` ops, intelligence-mode `BULK_EDIT_MAX_FEATURES` cap + skip-and-report (`N of M` + "rerun"), unknown-id skip, gate cancel-to-zero, read-only `select_features`/`validate_geometry`, dedup delete via `intent:'delete'` (Level-2 confirms, Pitfall 6), style materialization + fallback-only-when-supplied (D-03), `InvalidStyleOptionError` propagation (Pitfall 3), and the STYLE-02 `JSON.stringify`→re-parse round-trip.
- `diff.test.ts`: additive `classifyModifyKind` describe block (geometry / style / properties + a mixed-key case). The original `classifyMutation` block is untouched.

## Verification Results

- `bun test src/features/geo-editor/api/predicate.test.ts src/features/geo-editor/api/dedup.test.ts src/features/geo-editor/api/geometryValidation.test.ts` → RED (module-not-found for `./predicate`, `./dedup`, `./geometryValidation`) — intended W0 state.
- `bun test src/features/chat/tools/bulk-tools.test.ts` → RED (module-not-found for `./bulk-tools`).
- `bun test src/features/geo-editor/api/diff.test.ts` → **7 pass / 4 fail**: the original classifyMutation tests stay GREEN, only the new classifyModifyKind block is RED (exactly the acceptance criterion).
- Full suite `bun test` → **482 pass / 8 fail / 4 errors**: every failure/error is an intended Wave 0 RED (the 4 absent-module errors + the named classifyModifyKind reds). No Phase 5 regression.
- Biome clean on all five touched files (`bunx biome check …` → no errors, no warnings).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] diff.test.ts RED via namespace import instead of named import**
- **Found during:** Task 2
- **Issue:** A named import of the not-yet-existent `classifyModifyKind` (`import { classifyModifyKind } from './diff'`) is a hard ESM module-load error in Bun — it took the WHOLE diff.test.ts file down (0 pass / 1 error), so the existing classifyMutation tests could not run. This violated the acceptance criterion that the original tests stay green.
- **Fix:** Reach the symbol through a namespace import (`import * as diffModule from './diff'`) wrapped in a thin local accessor; the module loads, `diffModule.classifyModifyKind` is `undefined`, and only the new block fails at call time (7 pass / 4 fail).
- **Files modified:** src/features/geo-editor/api/diff.test.ts
- **Commit:** 13acd10

**2. [Rule 1 - Style/lint] Removed non-null assertions flagged by Biome**
- **Found during:** Task 2 (biome gate)
- **Issue:** `diffs[0]!.id` triggered Biome `noNonNullAssertion` warnings on the touched file (plan requires biome-clean on the five files).
- **Fix:** Added an `onlyPendingDiff()` helper that asserts exactly one pending diff and returns it without a `!` assertion; both gate-flow tests use it.
- **Files modified:** src/features/chat/tools/bulk-tools.test.ts
- **Commit:** 13acd10

Biome's default formatter also reflowed long `expect(...)` lines in the new files (applied via `biome check --write`); no logic change.

## Known Stubs

None. These are RED test scaffolds by design — the absent production modules are owned by Plans 02–05, as documented in the plan's `<objective>` and `<artifacts_produced>`.

## Self-Check: PASSED

- Files: all five FOUND on disk.
- Commits: `8be3cc3` and `13acd10` present in `git log`.
- RED state verified per the plan's `<verify>` grep contracts.
