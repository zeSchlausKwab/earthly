---
phase: 06-ai-bulk-transform-data-driven-styling
plan: 02
subsystem: ai-bulk-transform
tags: [tdd, wave-2, green, predicate, api-layer, targeting]
requires:
  - "predicate.test.ts — RED contract from Plan 01 (matchesPredicate + selectByPredicate)"
provides:
  - "predicate.ts — the ONE shared AI-free targeting engine (matchesPredicate + selectByPredicate) consumed by Wave-3 batch-edit / style buckets / dedup-select"
  - "Predicate / PredicateOp types — the single targeting vocabulary for the model tool args (validated at the Plan 04 boundary)"
  - "A4 inclusive 'missing' semantics (absent | null | '' | whitespace-only) — defines fill-if-missing for Plan 04"
affects:
  - "Plan 04 (batch-edit + fill-if-missing), Plan 05 (style buckets), Plan 03 (dedup/select) consume selectByPredicate / matchesPredicate as their targeting primitive"
tech-stack:
  added: []
  patterns:
    - "Pure AI-free api/ module mirroring diff.ts: D-07 boundary doc-block + type-only `import type { EditorFeature }` + side-effect-free exported functions holding no editor reference"
    - "Discriminated-union operator type (PredicateOp on `op`) keyed by clause shape so each op carries exactly its required value field"
    - "Defensive comparison (never throw): non-string `contains` and non-numeric lt/lte/gt/gte return false so a hostile clause cannot crash a bulk run (T-06-02c)"
key-files:
  created:
    - src/features/geo-editor/api/predicate.ts
  modified: []
decisions:
  - "[06-02]: A4 'missing' realized in one private isMissing(value) (absent | null | trimmed-empty string) shared by exists/missing — the single place fill-if-missing semantics live for Plan 04."
  - "[06-02]: Empty `all: []` matches every feature (vacuous AND) so a style 'fallback' bucket can target everything — documented in the type doc-block."
  - "[06-02]: selectByPredicate is the ONLY full-set reader (features.filter over matchesPredicate); consumer 'rules' take NO features/featureIds array — the host supplies the list (Pitfall 2 carried from 05-04 runFixAllRule)."
  - "[06-02]: lint:fix is repo-wide and reflowed 32 unrelated pre-existing files; reverted all of them (out-of-scope, SCOPE BOUNDARY) and verified predicate.ts alone is biome-clean via `bunx biome check`."
metrics:
  duration: ~6min
  completed: 2026-06-22
---

# Phase 6 Plan 02: Shared Predicate Engine Summary

Turned the Plan 01 RED `predicate.test.ts` GREEN by implementing the one shared, host-side, AI-free predicate engine (D-06): a flat AND-list operator matcher over `feature.properties.*` only, plus the full-set `selectByPredicate` (TOOLS-03 select half). It is the single targeting primitive every Wave-3 consumer (batch-edit, style buckets, dedup/select) depends on, sequenced before them.

## What Was Built

**Task 1 — `src/features/geo-editor/api/predicate.ts` (commit `8b0f825`):**
- `matchesPredicate(feature, predicate): boolean` — evaluates a flat `all: PredicateOp[]` AND-list, reading values ONLY from `feature.properties`. Empty `all: []` matches every feature (vacuous truth — the style "fallback" target).
- `selectByPredicate(features, predicate): EditorFeature[]` — `features.filter(matchesPredicate)`, returning EVERY match in input order, never capped/sampled (proven on 250 matches vs the ≤15 model sample cap).
- `PredicateOp` discriminated union over `op`: `eq`/`neq` (value), `exists`/`missing` (no value), `contains` (string substring, case-sensitive), `in` (value-in-set), `lt`/`lte`/`gt`/`gte` (numeric). `Predicate = { all: PredicateOp[] }`.
- Private `isMissing(value)` realizing the A4 inclusive default: absent | `null` | `''` | whitespace-only string. `exists` = `!isMissing`, `missing` = `isMissing`.
- Defensive (never throws): non-string `contains` → false; non-finite/non-numeric numeric comparisons → false (T-06-02c).
- D-07 boundary doc-block + type-only `import type { EditorFeature } from '../core/types'` — nothing from chat/registry/Nostr. Minimal: NO dot-path nesting, NO regex, NO DSL, NO eval (T-06-02b).

## Verification Results

- `bun test src/features/geo-editor/api/predicate.test.ts src/features/geo-editor/api/boundary.test.ts` → **34 pass / 0 fail / 289 expect()** (predicate fully green across every operator + exists/missing + flat-AND + full-set select + purity; boundary auto-scan green with the new file).
- Exports grep: all four symbols (`matchesPredicate`, `selectByPredicate`, `Predicate`, `PredicateOp`) found.
- Boundary grep: prints `BOUNDARY-CLEAN` (no forbidden import).
- `bun run build` → green (`✅ Build completed`).
- `bunx biome check src/features/geo-editor/api/predicate.ts` → no fixes, no errors.
- Full suite `bun test` → **504 pass / 7 fail / 3 errors**. Up from Wave 0's 482/8/4: predicate's prior 1 error cleared and 22 predicate tests added; the boundary error cleared. The remaining 7 fail / 3 errors are all intended Wave 0 reds owned by Plans 03–05 — module-not-found for `./dedup`, `./geometryValidation`, `./bulk-tools`, and the 4 `classifyModifyKind` (diff) reds. No Phase 5 / predicate regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reverted repo-wide `lint:fix` collateral on 32 unrelated files**
- **Found during:** Task 1 (the plan's `<action>` says "Run `bun run lint:fix` on the file")
- **Issue:** `bun run lint:fix src/.../predicate.ts` ignores the path arg and runs Biome across the whole repo, reflowing 32 unrelated pre-existing files (GeoEditor.ts, nostr/*, social/*, etc.). Committing those would have blown the plan's single-file scope (`files_modified: [predicate.ts]`) and the SCOPE BOUNDARY rule (only touch files this task changed).
- **Fix:** `git checkout --` reverted all 32 collateral files; verified `predicate.ts` alone is biome-clean via `bunx biome check predicate.ts` (the per-file gate the plan actually intends).
- **Files modified:** none (revert only; the 32 files are back to their committed state)
- **Commit:** n/a (no net change to those files)

The pre-existing untracked `.planning/debug/sandbox-worker-file-url-dev.md` modification present at session start was left untouched (not in scope).

## Known Stubs

None. `predicate.ts` is the complete production module; its only RED consumers (`dedup`/`geometryValidation`/`bulk-tools`) are owned by Plans 03–05 as documented in 06-01-SUMMARY.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema surface. The engine only compares property values (no eval); the import boundary is enforced by `boundary.test.ts` (T-06-02a) and the never-throw comparisons cover T-06-02c.

## Self-Check: PASSED

- File: `src/features/geo-editor/api/predicate.ts` FOUND on disk.
- Commit: `8b0f825` present in `git log`.
- Verified: predicate.test.ts + boundary.test.ts both GREEN (34/0); exports + boundary greps pass; `bun run build` green.
