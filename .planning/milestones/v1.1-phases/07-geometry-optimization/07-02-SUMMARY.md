---
phase: 07-geometry-optimization
plan: 02
subsystem: ui
tags: [react, safe-editing, diff-disclosure, geometry-optimization, gate]

# Dependency graph
requires:
  - phase: 05-safe-editing
    provides: pendingDiffStore (emitDiffBlock/PendingDiffEntry), DatasetDiffDisclosure, buildDatasetDiffSummary
  - phase: 06-bulk-transform
    provides: gateBulkApply / GateBulkDeps, classifyModifyKind (~N restyled headline)
provides:
  - "EmitDiffBlockOptions.headline? + PendingDiffEntry.headline? (pendingDiffStore.ts)"
  - "GateBulkDeps.headline? threaded into all three emitDiffBlock call sites (gateBulkEdit.ts)"
  - "DatasetDiffDisclosure headline? prop with useMemo-layer precedence over buildDatasetDiffSummary"
  - "PendingDiffList threads entry.headline through to the disclosure"
affects: [07-03, 07-04, geometry-optimization, optimizer-headline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Strictly-additive optional field threaded gate → store → disclosure; every existing caller passes nothing and renders byte-identically"
    - "Headline precedence applied at the component/useMemo layer; buildDatasetDiffSummary(diff) stays the no-headline pure function for existing direct unit tests"

key-files:
  created:
    - src/features/chat/safeEditing/gateBulkEdit.test.ts
  modified:
    - src/features/chat/safeEditing/pendingDiffStore.ts
    - src/features/chat/safeEditing/gateBulkEdit.ts
    - src/features/chat/safeEditing/DatasetDiffDisclosure.tsx
    - src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx
    - src/features/chat/safeEditing/PendingDiffList.tsx
    - src/features/chat/safeEditing/pendingDiffStore.test.ts

key-decisions:
  - "headline is optional on EmitDiffBlockOptions, PendingDiffEntry, GateBulkDeps, and DatasetDiffDisclosureProps — every Phase 5/6 caller omits it and behaves identically (backward-compat is structural, not test-only)"
  - "Headline precedence lives at the useMemo layer (headline ?? buildDatasetDiffSummary(diff)) so buildDatasetDiffSummary stays a pure no-headline fn — existing direct unit tests untouched"
  - "Threaded into ALL THREE gateBulkApply emitDiffBlock sites (no-op, immediate-apply, confirm) so the headline reaches the disclosure regardless of safety level"
  - "PendingDiffList (the transcript wiring) is where entry.headline is passed to the disclosure"

patterns-established:
  - "Additive optional display field across a UI-agnostic gate → store → React seam without touching classification/snapshot/confirm logic"

requirements-completed: [GEO-02]

# Metrics
duration: 5min
completed: 2026-06-22
---

# Phase 7 Plan 2: Optimizer Diff Headline Plumbing Summary

**Threaded an optional metrics-aware `headline` through the safe-editing diff seam (gateBulkApply → emitDiffBlock → PendingDiffEntry → PendingDiffList → DatasetDiffDisclosure) so the Phase-7 optimizer can replace the generic `+N · ~N · −N` counts wall with a single before/after optimization summary, with zero change to existing Phase 5/6 callers.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-22T14:18:42Z
- **Completed:** 2026-06-22T14:23:19Z
- **Tasks:** 2
- **Files modified:** 6 (5 modified, 1 created)

## Accomplishments
- Optional `headline?: string` added to `EmitDiffBlockOptions`, `PendingDiffEntry`, `GateBulkDeps`, and `DatasetDiffDisclosureProps` — all omittable, existing callers untouched.
- `gateBulkApply` threads `deps.headline` into all three `emitDiffBlock` call sites (no-op early return, immediate-apply, confirm path) so the headline reaches the disclosure at every safety level.
- `DatasetDiffDisclosure` renders the headline verbatim when present, otherwise falls through to the existing `~N restyled` / counts headline unchanged; `buildDatasetDiffSummary(diff)` remains the pure no-headline function.
- `PendingDiffList` (the transcript wiring constructing the disclosure from a `PendingDiffEntry`) now passes `entry.headline` through.
- New `gateBulkEdit.test.ts` + extended `pendingDiffStore.test.ts` and `DatasetDiffDisclosure.test.tsx`; full safeEditing suite green (49 pass / 0 fail), including all unchanged Phase 5/6 diff tests.

## Task Commits

Each task was committed atomically (TDD: RED test + GREEN impl folded into one feat commit per task since tests + impl touch the same files):

1. **Task 1: Carry an optional headline through the pending-diff store and the gate** - `1a29853` (feat)
2. **Task 2: Render the metrics-aware headline in the diff disclosure** - `4614332` (feat)

**Plan metadata:** committed separately (docs: complete plan)

## Files Created/Modified
- `src/features/chat/safeEditing/pendingDiffStore.ts` - `headline?` on `EmitDiffBlockOptions` + `PendingDiffEntry`; `emitDiffBlock` stores `opts?.headline`
- `src/features/chat/safeEditing/gateBulkEdit.ts` - `headline?` on `GateBulkDeps`; threaded into all 3 `emitDiffBlock` call sites; also reflowed a pre-existing `isNoop` line for biome
- `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` - `headline?` prop; `summary = headline ?? buildDatasetDiffSummary(diff)` at the useMemo layer
- `src/features/chat/safeEditing/PendingDiffList.tsx` - passes `entry.headline` to the disclosure
- `src/features/chat/safeEditing/gateBulkEdit.test.ts` - NEW: headline-supplied + omitted (backward-compat) via a minimal headless editor stub at Level 3
- `src/features/chat/safeEditing/pendingDiffStore.test.ts` - headline stored / undefined / coexists-with-applied
- `src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx` - headline-verbatim render + counts/restyle backward-compat

## Decisions Made
- Kept backward-compat structural (optional everywhere) rather than via a separate code path — the headline simply defaults `undefined` and the fallback logic is the existing code.
- Applied headline precedence at the component/`useMemo` layer to preserve `buildDatasetDiffSummary(diff)` as a pure no-headline function (existing direct unit tests call it and must stay green).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reflowed a pre-existing biome formatting violation in gateBulkEdit.ts**
- **Found during:** Task 1 (biome acceptance criterion on touched files)
- **Issue:** The `isNoop` assignment in `gateBulkApply` was wrapped across two lines; biome (run on touched files per acceptance criteria) flagged it as a format error. Confirmed pre-existing (present with my changes stashed), but it sits in a file this plan modifies, so the "biome clean on touched files" criterion required addressing it.
- **Fix:** Collapsed the `isNoop` assignment to a single line per biome's formatter.
- **Files modified:** src/features/chat/safeEditing/gateBulkEdit.ts
- **Verification:** `biome check` clean on all touched files
- **Committed in:** 1a29853 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — pre-existing format nit in a touched file).
**Impact on plan:** Cosmetic; no behavior change. No scope creep.

## Issues Encountered
- **`bun run build` fails at the `optimize` worker bundling step** (`ModuleNotFound resolving "src/features/chat/geometry/optimize.worker.ts"`). This is a PRE-EXISTING, cross-plan break: plan 07-01 (`chore(07-01): register optimize worker asset`, f4001af) registered the `optimize` entry in `workerAssets.ts`, but the worker source file is authored by a LATER plan in this phase (07-03/07-04). The build was already broken on HEAD before 07-02 began and is outside this plan's scope (07-02 touches only `src/features/chat/safeEditing/`). The main app/HTML bundle (which includes this plan's modules) builds and emits `dist/index.html` successfully — only the separate worker entrypoint fails. Logged to `.planning/phases/07-geometry-optimization/deferred-items.md`; will close automatically when the worker source lands.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The optional `headline` plumbing is ready for the Phase-7 optimizer (07-04) to pass a metrics summary string into `gateBulkApply`'s `deps.headline`; it will surface verbatim in the inline diff block.
- Carry-forward (not a blocker for this plan): `bun run build` only goes green once `optimize.worker.ts` exists (a sibling plan's artifact).

## Self-Check: PASSED

- All 6 key files verified present on disk (`[ -f ]`).
- Both task commits verified in git log (`1a29853`, `4614332`).
- Plan verification: `bun test src/features/chat/safeEditing/` → 49 pass / 0 fail; biome clean on all touched files; `headline` confirmed OPTIONAL in all four declarations via grep.
- Build caveat documented (pre-existing cross-plan worker break; app bundle builds).

---
*Phase: 07-geometry-optimization*
*Completed: 2026-06-22*
