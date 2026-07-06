---
phase: 06-ai-bulk-transform-data-driven-styling
plan: 04
subsystem: ai-bulk-transform
tags: [wave-4, green, bulk-tools, read-only, registry, predicate, geometry-validation]
requires:
  - "bulk-tools.test.ts — RED contract from Plan 01 (the five bulk tools; this plan greens the select + validate halves)"
  - "predicate.ts — Plan 02 shared targeting engine (selectByPredicate + Predicate type)"
  - "geometryValidation.ts — Plan 03 read-only turf validation reporter"
provides:
  - "bulk-tools.ts — registerBulkTools(register) injected-register registrar; two READ-ONLY host-builtin tools select_features (TOOLS-03 select) + validate_geometry (TOOLS-04), both reading editor.getAllFeatures() full set"
  - "parsePredicate(raw): Predicate — V5 op/field/value shape validation at the tool boundary (T-06-04a), catchable for model self-correction"
  - "BULK_EDIT_MAX_FEATURES — exported DoS cap constant shared with the Plan 05 destructive tools and the test contract"
  - "select_features + validate_geometry OpenAI schemas (predicate arg; NO feature/featureIds list param, Pitfall 1)"
  - "registry.ts bootstrapRegistry() now calls registerBulkTools(register) — one-way registry → bulk-tools edge proven crash-free in dev + production builds"
affects:
  - "Plan 05 extends registerBulkTools with the gated destructive tools (batch_edit_features, dedup_features, style_by_attribute), reusing parsePredicate + BULK_EDIT_MAX_FEATURES"
tech-stack:
  added: []
  patterns:
    - "Injected-register registrar (Pitfall 4): bulk-tools imports ONLY `type { ToolEntry }` from ./registry; registry is the value-importer — one-way edge avoids the Phase-2 Bun-HMR circular-init crash"
    - "Read-only host-builtin: resolve editor via useEditorStore.getState().editor, read the FULL id-keyed set via getAllFeatures(); no gate, no snapshot, no mutation (SAFE-05 host-over-all-ids)"
    - "Boundary-shape predicate validation: parsePredicate validates op allow-list + string field at the tool edge while the engine's matchers stay never-throw on values (defense in depth)"
key-files:
  created:
    - src/features/chat/tools/bulk-tools.ts
  modified:
    - src/features/chat/tools/schemas.ts
    - src/features/chat/tools/registry.ts
decisions:
  - "[06-04]: Exported BULK_EDIT_MAX_FEATURES (=200) from bulk-tools.ts in THIS plan rather than deferring to Plan 05. The Plan 01 RED bulk-tools.test.ts imports it at module top; a missing named ESM export is a hard module-load error that takes the WHOLE test file down (0 pass), so the select + validate behavior tests could not run/green without it. It is the shared intelligence-mode DoS cap the Plan 05 destructive tools consume — landing the constant now is the minimal unblock and the single source of truth."
  - "[06-04]: select_features returns `matchedIds` (the test contract's key) alongside `matched`/`total`/`sample` — not `featureIds`. The schema still exposes NO feature-list INPUT param (Pitfall 1); matchedIds is OUTPUT only."
  - "[06-04]: validate_geometry returns the GeometryValidationReport verbatim from validateGeometryFeatures (no fixing — Phase 7 owns that); an optional predicate pre-scopes the check, absent → whole dataset."
  - "[06-04]: Per-file `bunx biome check --write` on the touched files only (repo-wide `bun run lint:fix` reflows 30+ unrelated files, blowing the files_modified scope — documented in 06-02/06-03 summaries)."
metrics:
  duration: ~12min
  completed: 2026-06-22
---

# Phase 6 Plan 04: Read-only bulk tools (select_features + validate_geometry) Summary

Stood up the `registerBulkTools(register)` registrar with the two lowest-risk bulk tools — `select_features` (TOOLS-03 select half) and `validate_geometry` (TOOLS-04) — both strictly READ-ONLY (no gate, no snapshot, no mutation), each reading `editor.getAllFeatures()` over the FULL bound dataset (SAFE-05). Added their OpenAI schemas (predicate arg, NO feature-list param — Pitfall 1) and wired the registrar into `bootstrapRegistry()` via the injected-register one-way edge, proving the Phase-2 circular-init regression class stays clear in both dev and production builds. This greens the select + validate portions of the Plan 01 RED `bulk-tools.test.ts`; Plan 05 extends the same registrar with the gated destructive tools.

## What Was Built

**Task 1 — `bulk-tools.ts` registrar + 2 read-only handlers + schemas (commit `bee00d6`):**
- `src/features/chat/tools/bulk-tools.ts` — `registerBulkTools(register: (entry: ToolEntry) => void): void`. TYPE-ONLY import of `ToolEntry` from `./registry` (never the value `register` — Pitfall 4). Registers:
  - `select_features` (`kind: 'host-builtin'`) — resolves the editor (`requireEditor`), `parsePredicate(args.predicate)`, runs `selectByPredicate(editor.getAllFeatures(), predicate)` over the FULL set, returns `{ matched, total, matchedIds, sample }` (sample = first 15 names/ids). No mutation.
  - `validate_geometry` (`kind: 'host-builtin'`) — resolves the editor, optionally parses a scoping predicate, returns `validateGeometryFeatures(editor.getAllFeatures(), predicate)` verbatim. No fixing (Phase 7).
  - private `parsePredicate(raw): Predicate` — V5 validation: rejects non-object predicate, non-array `all`, non-string `field`, and any `op` outside the allow-list (eq/neq/exists/missing/contains/in/lt/lte/gt/gte) with a catchable error so the model self-corrects (T-06-04a). Absent/empty → vacuous-AND "all features".
  - exported `BULK_EDIT_MAX_FEATURES = 200` — the shared intelligence-mode DoS cap (Plan 05 + test contract).
- `src/features/chat/tools/schemas.ts` — appended `select_features` + `validate_geometry` OpenAI function schemas. Predicate parameter is `{ all: [{ field, op (enum), value? }] }`; neither schema exposes a `features`/`featureIds` array param (Pitfall 1). Descriptions tell the model both tools read the entire bound dataset and make no map change.

**Task 2 — wire into bootstrapRegistry (commit `3811477`):**
- `src/features/chat/tools/registry.ts` — added `import { registerBulkTools } from './bulk-tools'` and `registerBulkTools(register)` inside `bootstrapRegistry()` after `registerSandboxTools(register)`. The registry is the value-importer; bulk-tools imports only a type back — the one-way edge that avoids the Bun-HMR null-`register` crash.

## Verification Results

- `bun test src/features/chat/tools/bulk-tools.test.ts -t "read-only"` → **2 pass / 0 fail** (the `select_features … read-only full-set` + `validate_geometry … read-only report` blocks, dispatched through the live registry). select_features returns matched=2/matchedIds=[a,b] with byte-identical editor state; validate_geometry flags the bowtie polygon (checked=1, withSelfIntersections=1) read-only.
- Task 1 acceptance greps: `from './registry'` → only the `import type` line (Pitfall 4 honored); `select_features` schema → `NO-LIST-PARAM` (Pitfall 1); `getAllFeatures()` count = 3 (≥2); mutation-symbol grep → `READONLY-SO-FAR`.
- Task 2: `grep -c "registerBulkTools(register)"` in registry.ts = 1 (wired exactly once).
- `bun run build` → `✅ Build completed` (dev; no circular-init crash). `bun run build:production` → `✅ Frontend build complete!` (no bootstrap crash — Phase-2 regression class clear).
- `bunx biome check` on all three touched files → clean (after per-file `--write` reflow; no logic change).
- Full suite `bun test` → **526 pass / 12 fail**. Up from Plan 03's 523/1(+1 error): the entire `bulk-tools.test.ts` previously failed to load (module-not-found, counted as 1 fail + 1 error); it now LOADS and runs, exposing its individual tests — 2 read-only GREEN, 12 RED. Every one of the 12 fails is a Plan-05-owned tool (`batch_edit_features` ×5, `dedup_features` ×2, `style_by_attribute` ×4) plus the "all five tools registered" test (needs all five). No non-bulk-tools regression; the rest of the suite is fully green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported BULK_EDIT_MAX_FEATURES in Plan 04 to let bulk-tools.test.ts load**
- **Found during:** Task 1 (running the `<verify>` `bun test … -t "select"`)
- **Issue:** The Plan 01 RED `bulk-tools.test.ts` imports `{ BULK_EDIT_MAX_FEATURES, registerBulkTools }` at module top. `BULK_EDIT_MAX_FEATURES` is nominally a Plan 05 symbol, but a missing named ESM export is a hard module-load error in Bun — it took the WHOLE test file down (`SyntaxError: Export named 'BULK_EDIT_MAX_FEATURES' not found`, 0 pass), so the select + validate behavior tests could not run at all, making the plan's acceptance criterion unachievable.
- **Fix:** Exported `BULK_EDIT_MAX_FEATURES = 200` from `bulk-tools.ts` now (the shared intelligence-mode DoS cap the Plan 05 destructive tools will consume — single source of truth). This is the minimal change that lets the module load; the cap is not yet USED by a handler (Plan 05's batch_edit_features enforces it).
- **Files modified:** src/features/chat/tools/bulk-tools.ts
- **Commit:** bee00d6

**2. [Rule 3 - Blocking] Per-file biome instead of repo-wide `bun run lint:fix`**
- **Found during:** Tasks 1 + 2 (the plan's `<action>` says "Run `bun run lint:fix`")
- **Issue:** As documented in 06-02/06-03 summaries, `bun run lint:fix` ignores path args and reflows the whole repo (30+ unrelated files), which would blow the plan's `files_modified` scope and the SCOPE BOUNDARY rule.
- **Fix:** Ran `bunx biome check --write` scoped to the three touched files only (reflowed long lines in the two new schema blocks + the bulk-tools op array; no logic change).
- **Files modified:** none beyond the three in scope
- **Commit:** bee00d6 / 3811477

## Known Stubs

None. `bulk-tools.ts` is a complete, dispatching production module for its two READ-ONLY tools. The remaining RED in `bulk-tools.test.ts` (batch_edit_features / dedup_features / style_by_attribute + the all-five registration test) is owned by Plan 05, which extends `registerBulkTools` — as documented in this plan's `<objective>` and the prior-wave context. `BULK_EDIT_MAX_FEATURES` is exported and correct but not yet enforced by a handler (Plan 05 wires it into intelligence-mode batch_edit).

## Threat Flags

None. No new network endpoint, auth path, file access, or schema surface beyond the two read-only tool schemas.
- T-06-04a (Tampering / predicate injection): `parsePredicate` rejects unknown ops + malformed clauses with a catchable error (V5); the engine only COMPARES values, never executes a clause.
- T-06-04b (Tampering / SAFE-05): handlers read `editor.getAllFeatures()` (full id-keyed set); schemas expose NO feature-list INPUT param (`NO-LIST-PARAM` grep).
- T-06-04d (Elevation / registry cycle): bulk-tools imports only `type { ToolEntry }` from ./registry; the one-way edge is proven crash-free by `bun run build:production`.
- T-06-04e (Tampering / validate mutating): the read-only handlers contain no mutation symbols (`READONLY-SO-FAR` grep); validate_geometry calls only the read-only `validateGeometryFeatures`.

## Self-Check: PASSED

- File: `src/features/chat/tools/bulk-tools.ts` FOUND on disk.
- Commits: `bee00d6` (Task 1) and `3811477` (Task 2) both present in `git log`.
- Verified: read-only select + validate tests GREEN via registry dispatch; all four Task 1 acceptance greps pass; `registerBulkTools(register)` wired exactly once; dev + production builds green; no non-bulk-tools suite regression.
