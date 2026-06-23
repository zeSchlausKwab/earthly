---
phase: 06-ai-bulk-transform-data-driven-styling
fixed_at: 2026-06-22T09:05:00Z
review_path: .planning/phases/06-ai-bulk-transform-data-driven-styling/06-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-06-22
**Source review:** .planning/phases/06-ai-bulk-transform-data-driven-styling/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (3 critical + 6 warning; Info IN-01..03 out of scope under `critical_warning`)
- Fixed: 9
- Skipped: 0

**Gates:** `bun test` 548 pass / 0 fail (was 538; +10 new tests), `bun run build` OK, biome clean on all touched files.

**Security:** CR-01 closes T-06-05e (HIGH blocker); CR-02 closes T-06-02b / T-06-04a (MEDIUM).

## Fixed Issues

### CR-01: `gateBulkApply` had no exception safety — a throwing `apply()` left partial mutation + a dangling snapshot

**Files modified:** `src/features/chat/safeEditing/gateBulkEdit.ts`, `src/features/chat/tools/bulk-tools.ts`, `src/features/chat/tools/bulk-tools.test.ts`
**Commits:** `07fd513` (gate), `51baba5` (style pre-validation + test)
**Applied fix:** Wrapped the real `apply()` in try/catch in `gateBulkApply`; on throw it calls `editor.undoLastDatasetSnapshot()` to restore the pre-apply snapshot (zero net mutation, mirroring the Cancel path) then re-throws so `dispatch()` yields a `handler_error` ToolError. Additionally implemented the RECOMMENDED defense: `parseStyleBuckets` and the `style_by_attribute` fallback now run `normalizeStyleOptions` UP FRONT, so an unknown style key is rejected before any feature is touched (fail-fast, no partial restyle). Added a ≥2-matching-feature style-throw test asserting zero net mutation and no phantom undo step.
**Verification:** requires human verification — logic/state-handling change to the rollback path. Tier-1 re-read + Tier-2 (`bun test`, `bun run build`) pass; the new test exercises the partial-apply/rollback path that the prior single-feature test could not observe.

### CR-02: `parsePredicate` never validated clause `value`; `in` with a non-array value threw `undefined is not an object`

**Files modified:** `src/features/chat/tools/bulk-tools.ts`, `src/features/geo-editor/api/predicate.ts`, `src/features/chat/tools/bulk-tools.test.ts`, `src/features/geo-editor/api/predicate.test.ts`
**Commits:** `08439e5` (predicate engine + test), `51baba5` (parsePredicate + test)
**Applied fix:** `parsePredicate` now validates `value` per operator — `in` requires an array; `lt/lte/gt/gte` require a number; `eq/neq/contains` require a defined value; `exists/missing` take none — throwing the same catchable `Error` class it already uses for unknown ops (self-correctable, not a raw TypeError). As a defensive second layer, `matchesClause`'s `in` branch now guards `Array.isArray(clause.value)` before `.includes`, so the engine never throws on bad input. Added unit tests for the per-op validation, a `select_features` end-to-end self-correctable-ToolError test, and a defensive-matcher never-throw test.
**Verification:** requires human verification — validation-logic change. Tier-1 + Tier-2 pass; new tests cover the previously-uncovered `op:'in'` non-array crash path.

### CR-03: `gateBulkApply` returned `'applied'` with a phantom snapshot for a no-op batch

**Files modified:** `src/features/chat/safeEditing/gateBulkEdit.ts`, `src/features/chat/tools/bulk-tools.test.ts`
**Commits:** `07fd513` (gate), `51baba5` (test)
**Applied fix:** After classifying, the gate detects a genuinely empty diff (`added/modified/deleted` all empty), drops the snapshot it pushed via `undoLastDatasetSnapshot()`, and returns an empty applied diff — so a no-op batch leaves no phantom "undo AI edit" step on the bounded snapshot stack. Added a zero-match declarative test asserting `edited: 0`, dataset unchanged, and no restorable snapshot.
**Note:** During verification I confirmed the editor's `modifyFeature` injects `importSource`/`customProperties` metadata, so a declarative `set` to an already-present *value* is still a genuine modify at the storage layer (not a diff no-op). The no-op guard therefore fires for truly empty diffs (zero-match predicate, untouched features) rather than for value-identical writes; the test was written accordingly.
**Verification:** requires human verification — state-handling change.

### WR-01: declarative `copy`/`template` read the *mutated* accumulator, making ops order-dependent

**Files modified:** `src/features/chat/tools/bulk-tools.ts`, `src/features/chat/tools/bulk-tools.test.ts`
**Commit:** `51baba5`
**Applied fix:** `applyDeclarativeOps` now reads `copy` sources and `template` interpolation from a frozen snapshot of the *original* props, so `set name=X` then `copy oldName from name` copies the ORIGINAL name. Added a copy/template order-independence test.

### WR-02: `dedup_features` reported `survivors`/`groups` on cancel

**Files modified:** `src/features/chat/tools/bulk-tools.ts`
**Commit:** `51baba5`
**Applied fix:** On cancel, `survivors` and `groups` are now zeroed (mirroring `deleted`) and an explicit `applied: boolean` field makes the no-change contract unambiguous to the model.

### WR-03: `dedup_features` silently dropped non-string `keys` entries

**Files modified:** `src/features/chat/tools/bulk-tools.ts`, `src/features/chat/tools/bulk-tools.test.ts`
**Commit:** `51baba5`
**Applied fix:** A non-array `keys` or any non-string entry now throws a self-correctable error instead of being filtered out. Added a rejection test.

### WR-04: `dedup_features` did not require `keys` for `by:'attributes'`/`by:'both'`

**Files modified:** `src/features/chat/tools/bulk-tools.ts`, `src/features/chat/tools/bulk-tools.test.ts`
**Commit:** `51baba5`
**Applied fix:** The handler throws when `by !== 'geometry'` and `keys` is absent/empty, preventing the catastrophic "every feature is a duplicate → delete all but the first" mass delete from an under-specified call. Added a rejection test asserting the dataset is untouched.

### WR-05: `validate_geometry` zero-area is per-feature, not per-MultiPolygon-part

**Files modified:** `src/features/geo-editor/api/geometryValidation.ts`
**Commit:** `c6c7c3b`
**Applied fix:** Documented (at the zero-area check) that `safeArea` sums a MultiPolygon's parts, so `withZeroArea` counts features whose TOTAL area is near-zero rather than per-part slivers. Per-part detection is intentionally out of scope (it would change the counter's meaning and the report shape) — the review offered documentation as the acceptable first option.

### WR-06: `batch_edit_features` intelligence-mode cap was non-deterministic across reruns

**Files modified:** `src/features/chat/tools/bulk-tools.ts`
**Commit:** `51baba5`
**Applied fix:** The intelligence-mode result now returns `appliedIds` and `remainingIds` (empty/full respectively on cancel) so the model can deterministically continue a capped batch on rerun without double-application or skips.

## Out of Scope (not attempted)

- **IN-01, IN-02, IN-03** — Info-tier readability/duplication nits, excluded under `fix_scope: critical_warning`.

---

_Fixed: 2026-06-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
