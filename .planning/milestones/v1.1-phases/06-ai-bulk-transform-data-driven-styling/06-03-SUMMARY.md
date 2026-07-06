---
phase: 06-ai-bulk-transform-data-driven-styling
plan: 03
subsystem: ai-bulk-transform
tags: [tdd, wave-3, green, dedup, geometry-validation, style-diff, api-layer]
requires:
  - "dedup.test.ts / geometryValidation.test.ts — RED contracts from Plan 01"
  - "diff.test.ts classifyModifyKind block — RED contract from Plan 01"
  - "predicate.ts — Plan 02 shared targeting engine (optional pre-scoping seam)"
provides:
  - "dedup.ts — findDuplicateGroups(features, { by, keys? }) → keep-first survivor + non-survivor ids; pure, AI-free, no editor reference (TOOLS-03 dedup half)"
  - "geometryValidation.ts — validateGeometryFeatures(features, predicate?) → read-only report { checked, withSelfIntersections, withZeroArea, invalidRings, issues }; turf kinks/area + ring-validity (TOOLS-04)"
  - "diff.ts classifyModifyKind(before, after): 'style' | 'properties' | 'geometry' — visual-style-only discriminator (STYLE-01 diff headline / D-02)"
  - "DatasetDiffDisclosure.buildDatasetDiffSummary → '~N restyled' for an all-style-only modify diff"
affects:
  - "Plan 04 (batch-edit / fill-if-missing) wires dedup duplicateIds + validation into read-only/gated tools"
  - "Plan 05 (style buckets) consumes the style-aware diff headline for restyle previews"
tech-stack:
  added: []
  patterns:
    - "Pure AI-free api/ module mirroring diff.ts/predicate.ts: D-07 boundary doc-block + type-only EditorFeature import + turf, holding NO editor reference"
    - "Read-only validation reporter: aggregate-count + per-feature issue list, never-throw turf wrappers, no mutation/gate path (TOOLS-04 contract)"
    - "Visual-vs-metadata style-key split: classifyModifyKind keys off CANONICAL_STYLE_KEYS minus name/description so '~N restyled' means a visual restyle, not a rename"
key-files:
  created:
    - src/features/geo-editor/api/dedup.ts
    - src/features/geo-editor/api/geometryValidation.ts
  modified:
    - src/features/geo-editor/api/diff.ts
    - src/features/chat/safeEditing/DatasetDiffDisclosure.tsx
decisions:
  - "[06-03]: classifyModifyKind keys off a VISUAL_STYLE_KEY_SET (CANONICAL_STYLE_KEYS minus name/description) rather than the full canonical set — the prior partial run used the full set, which mis-classified a name/description-only modify as 'style'. The RED contract requires a name change → 'properties', so the visual subset is the correct discriminator and keeps the '~N restyled' headline truthful (visual restyle, not metadata rename)."
  - "[06-03]: dedup geometry equality uses a private structural deepEqual on feature.geometry (the diff.ts idiom) for the identical-import common case — deterministic and cheaper than turf.booleanEqual; default by:'geometry' (A2)."
  - "[06-03]: geometryValidation per-feature only — cross-feature gap/sliver topology is DEFERRED (A3); ZERO_AREA_THRESHOLD_M2 = 1e4 m² documents the sliver cutoff."
metrics:
  duration: ~25min (continuation of a prior partial run)
  completed: 2026-06-22
---

# Phase 6 Plan 03: Pure dedup + read-only validation + style-aware diff Summary

Landed the three pure pieces the Wave-4 bulk tools compose: the keep-first dedup grouping primitive (`dedup.ts`, TOOLS-03 dedup half), the read-only turf geometry-validation reporter (`geometryValidation.ts`, TOOLS-04), and the visual-style-aware modify discriminator (`classifyModifyKind` in `diff.ts`) feeding the `~N restyled` headline in `DatasetDiffDisclosure.tsx` (STYLE-01 / D-02). All three RED specs from Plan 01 are now GREEN; the Phase 5 disclosure tests stay green.

## Continuation Context

This plan was resumed from a prior partial execution. Task 1 (`dedup.ts` + `geometryValidation.ts`) was already committed as `a7a7d11` and its tests were green. `classifyModifyKind`/`ModifyKind` had also been added to `diff.ts` in the working tree (uncommitted) but with a classification bug, and the `DatasetDiffDisclosure.tsx` headline change was missing entirely. This run fixed the discriminator bug, added the headline special-case, and committed Task 2.

## What Was Built

**Task 1 — dedup grouping + read-only geometry validation (commit `a7a7d11`, prior run):**
- `src/features/geo-editor/api/dedup.ts` — `findDuplicateGroups(features, { by, keys? }): DuplicateGroup[]` with types `DedupBy` (`'geometry' | 'attributes' | 'both'`) and `DuplicateGroup` (`{ survivorId, duplicateIds }`). Keep-first survivor (first in input order); a private structural `deepEqual` for geometry equality; default `by:'geometry'` (A2). Pure — no editor reference, no mutation; the gate-routed delete lives in the Wave-4 tool.
- `src/features/geo-editor/api/geometryValidation.ts` — `validateGeometryFeatures(features, predicate?): GeometryValidationReport` with the aggregate shape `{ checked, withSelfIntersections, withZeroArea, invalidRings, issues: [{ featureId, issues: string[] }] }`. Three never-throw turf-backed checks: `turf.kinks` (self-intersection → `'self-intersection'`), `turf.area < ZERO_AREA_THRESHOLD_M2` (1e4 m² sliver → `'zero-area'`), and structural ring-validity (too-few-points / unclosed → `'invalid-ring'`). Read-only; cross-feature topology DEFERRED (A3).

**Task 2 — classifyModifyKind + style-aware '~N restyled' headline (commit `da29b94`, this run):**
- `src/features/geo-editor/api/diff.ts` — additive `export type ModifyKind = 'style' | 'properties' | 'geometry'` and `export function classifyModifyKind(before, after): ModifyKind`. Geometry wins (deepEqual false → `'geometry'`); otherwise `'style'` iff every changed property key is in `VISUAL_STYLE_KEY_SET` (canonical style keys minus the non-rendered `name`/`description` metadata), else `'properties'`. A private `changedPropertyKeys` helper computes the changed-key union. `classifyMutation`/`isModified` untouched (Open Q3 backward-compat); `deepEqual` not exported.
- `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` — `buildDatasetDiffSummary` now returns `~${n} restyled` when `added===0 && deleted===0 && modified.length>0 && every modified pair classifyModifyKind === 'style'`, falling through to the verbatim `+N added · ~N changed · −N deleted` string for every other shape. Component render and `DiffSection` untouched.

## Verification Results

- `bun test src/features/geo-editor/api/dedup.test.ts src/features/geo-editor/api/geometryValidation.test.ts src/features/geo-editor/api/diff.test.ts src/features/geo-editor/api/boundary.test.ts` → **39 pass / 0 fail** (dedup all three `by` modes + keep-first + no-dup + purity; validation kinks/zero-area/ring + clean + read-only; diff classifyModifyKind all 4 cases + every pre-existing classifyMutation test; boundary auto-scan green with the two new api/ files).
- `bun test src/features/chat/safeEditing/` → green, no Phase 5 disclosure regression (Open Question 3 verified).
- Boundary grep on dedup.ts + geometryValidation.ts → `BOUNDARY-CLEAN`; purity grep → `PURE` (no `editor.`/`deleteFeatures`/`updateFeature`/`GeoEditor`).
- Exports grep → both `export type ModifyKind` and `export function classifyModifyKind` present; `restyled` present in disclosure; default `added · ~` counts string preserved.
- `bun run build` → `✅ Build completed`.
- `bunx biome check` on both Task-2 files → no fixes, no errors.
- Full suite `bun test` → **523 pass / 1 fail / 1 error**. The sole fail+error is `bulk-tools.test.ts` (module-not-found for `./bulk-tools`) — the intended Wave 0 RED owned by Plans 04/05, explicitly out of scope. No Phase 5 / this-plan regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] classifyModifyKind mis-classified metadata-only modifies as 'style'**
- **Found during:** Task 2 (resuming the prior partial run)
- **Issue:** The uncommitted `classifyModifyKind` from the prior run keyed off the FULL `CANONICAL_STYLE_KEYS` set. That set includes the non-rendered metadata keys `name` and `description` (styleOptions.ts STRING_KEYS), so a `name`-only or `description`-only modify classified as `'style'` — failing the RED contract (`a non-style property change → 'properties'`, `a mix of a style key AND a non-style property change → 'properties'`).
- **Fix:** Introduced `VISUAL_STYLE_KEY_SET` = `CANONICAL_STYLE_KEYS` minus `{name, description}` and keyed the discriminator off it, so only genuine visual style changes (color/opacity/width/radius/label) classify as `'style'`. This also keeps the `~N restyled` headline truthful — it means a visual restyle, not a metadata rename.
- **Files modified:** src/features/geo-editor/api/diff.ts
- **Commit:** da29b94

**2. [Rule 3 - Blocking] Used per-file `bunx biome check --write` instead of repo-wide `bun run lint:fix`**
- **Found during:** Task 2
- **Issue:** As documented in 06-02-SUMMARY, `bun run lint:fix` ignores path args and reflows the whole repo (32+ unrelated files), which would blow the plan's `files_modified` scope and the SCOPE BOUNDARY rule.
- **Fix:** Ran `bunx biome check --write` scoped to the two touched files (no fixes needed; already clean).
- **Files modified:** none (no net change)
- **Commit:** n/a

## Known Stubs

None. `dedup.ts` and `geometryValidation.ts` are complete production modules; `classifyModifyKind` and the `~N restyled` headline are complete. The only remaining RED consumer (`bulk-tools.test.ts`) is owned by Plans 04/05 as documented in 06-01-SUMMARY.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema surface.
- T-06-03a (EoP / import boundary): dedup.ts + geometryValidation.ts import only `type EditorFeature` + turf (+ optional `predicate.ts`); `boundary.test.ts` auto-enforces — `BOUNDARY-CLEAN`.
- T-06-03b (Tampering / validation mutating): geometryValidation holds no editor reference and returns a report only — `PURE` grep confirms no `editor.`/`deleteFeatures`/`updateFeature`; read-only test asserts the input is byte-identical after the call.
- T-06-03c (data-integrity / wrong survivor): keep-first grouping unit-tested across all three `by` modes; the actual delete is the Wave-4 tool's gated `intent:'delete'`, not this module.
- T-06-SC (package installs): zero packages installed (turf 7.3.5 already present).

## Self-Check: PASSED

- Files: dedup.ts, geometryValidation.ts, diff.ts, DatasetDiffDisclosure.tsx all FOUND on disk.
- Commits: `a7a7d11` (Task 1) and `da29b94` (Task 2) both present in `git log`.
- Verified: all four api test files GREEN (39/0); boundary + purity greps pass; `bun run build` green; only out-of-scope Wave 0 bulk-tools RED remains.
