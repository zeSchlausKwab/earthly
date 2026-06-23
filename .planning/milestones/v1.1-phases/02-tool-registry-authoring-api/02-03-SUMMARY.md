---
phase: 02-tool-registry-authoring-api
plan: 03
subsystem: authoring-api
tags: [read-mirror, one-way-sync, authoring-facade, behavior-preservation, golden-test, infra-02, d-09, d-08]

# Dependency graph
requires:
  - phase: 02
    plan: 01
    provides: createHeadlessEditor() + shared geo fixtures (singlePointCollection, dupIdCollection, emptyFeatureCollection)
  - phase: 02
    plan: 02
    provides: createAuthoring(editor) — addFeature/writeGeoJSON facade + MutationResult contract
provides:
  - "D-09 one-way store read-mirror — editor.setFeatures now emits 'features.replace'; Editor.tsx mirror catches bulk replace; reverse store→editor loop guarded by a ref flag"
  - "INFRA-02 closed for the feature-CREATE seam — authoring.* is the only caller of editor.addFeature; chat dual-write + 4 UI/hook import sites rerouted through writeGeoJSON"
  - "criterion #2 binding gate (authoring.golden.test.ts) — OLD importFeaturesToEditor vs NEW authoring.writeGeoJSON feature sets byte-identical"
  - "A3 boundary assertion (boundary.test.ts) — fs-scan fails the build on any direct editor.addFeature outside api/+core"
affects: [02-04, 02-05, "Phase 5 (gate hooks attach at the single store-write chokepoint + interceptor seam)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed bulk-replace event ('features.replace') so the existing create/update/delete read-mirror catches editor.setFeatures (closes the stale-sidebar gap)"
    - "Ref-flag reverse-sync guard (suppressReverseSyncRef) — editor-originated mirror writes skip the reverse store→editor push; external dataset loads still sync"
    - "Golden behavior-preservation oracle: reproduce the OLD function body verbatim against one headless editor, run NEW facade against a second, deep-equal the feature sets"
    - "fs-scan boundary assertion recursing src/ for direct editor.addFeature( bypass sites"

key-files:
  created:
    - src/features/geo-editor/api/mirror.test.ts
    - src/features/geo-editor/api/authoring.golden.test.ts
  modified:
    - src/features/geo-editor/core/GeoEditor.ts
    - src/features/geo-editor/core/types/index.ts
    - src/features/geo-editor/components/Editor.tsx
    - src/features/chat/tools/helpers.ts
    - src/features/geo-editor/GeoEditorView.tsx
    - src/features/geo-editor/hooks/useOsmQuery.ts
    - src/features/geo-editor/api/boundary.test.ts

key-decisions:
  - "[02-03]: Bulk-replace emit strategy = a NEW typed 'features.replace' event (not 'update' reuse). Distinct typing makes the read-mirror subscription explicit in Editor.tsx and keeps EditorEventType honest about replace vs incremental update; editorCoreSlice.setFeatures (the sink) is event-agnostic so either would work."
  - "[02-03]: Reverse-loop guard = suppressReverseSyncRef flag set true inside the mirror handler (updateFeatures) and consumed-and-reset at the top of the reverse store→editor effect. Editor-originated updates skip the reverse push; genuine external store writes (dataset loads) still sync. Open Question 2 resolved: KEEP the reverse push, narrow it via the flag — do not remove."
  - "[02-03]: Golden OLD-path reference = the pre-refactor importFeaturesToEditor body reproduced verbatim (toEditorFeature(f,'chat_tool') + dedup-by-id loop) against a fresh headless editor; NEW path runs createAuthoring(editor).writeGeoJSON against a second editor; assert deep-equal feature sets + identical skippedDuplicates/importedCount."
  - "[02-03]: A3 boundary assertion scoped to editor.addFeature (the geometry-CREATE seam this plan owns) + a chat-dual-write-removed check. updateFeature/deleteFeatures are NOT yet rerouted (authoring exposes no modify/delete surface) — deferred, see Deferred Issues."

requirements-completed: [INFRA-02, INFRA-03]

# Metrics
duration: 9min
completed: 2026-06-16
---

# Phase 2 Plan 03: One-Way Store Read-Mirror + Authoring-API Reroute Summary

**Made the Zustand store a strict one-way downstream read-mirror (D-09) by adding a typed `features.replace` emit to `GeoEditor.setFeatures` (closing the stale-sidebar bulk-replace gap), wired it into the existing `create/update/delete` mirror in `Editor.tsx`, guarded the reverse store→editor loop with a ref flag, then rerouted EVERY remaining feature-create write — the chat dual-write in `helpers.ts` plus four UI/hook import sites — through `createAuthoring(editor).writeGeoJSON`, deleting the store dual-write, so `authoring.*` is now the only caller of `editor.addFeature` (INFRA-02) and the binding OLD-vs-NEW golden gate (criterion #2) is green.**

## What Shipped

### Task 1 — One-way read-mirror (D-09) — commit `2055e4c`
- **`GeoEditor.setFeatures` (core/GeoEditor.ts)** now emits `features.replace` with the full replaced feature set after render. Previously it emitted nothing — the exact reason the old code dual-wrote the store.
- **`EditorEventType` (core/types/index.ts)** gained `'features.replace'`.
- **`Editor.tsx`** mirror subscribes `editor.on('features.replace', updateFeatures)` alongside `create/update/delete`. `updateFeatures` sets `suppressReverseSyncRef.current = true` before writing the store; the reverse store→editor effect consumes-and-resets that flag and skips its push for editor-originated updates (Pitfall 2 round-trip guard). External dataset loads (store-originated) still sync because the flag is only set by the editor-event path.
- **`editorCoreSlice.setFeatures`** kept as the event-driven sink — draft persistence (`writePersistedGeoCollectionDraftState`), `isDirty:true`, and `updateStats()` side-effects all preserved (not reduced to `set({features})`).
- **`mirror.test.ts`** (new): store `features` === `editor.getAllFeatures()` after `authoring.addFeature`, after `writeGeoJSON(replace)`, after `writeGeoJSON(append+dedup)`, and across a mixed sequence; asserts exactly one mirror emission per op (no duplicate `create`, incl. bulk replace).

### Task 2 — Reroute writes + binding golden gate (INFRA-02/INFRA-03, D-08, criterion #2) — commit `79989f6`
- **`importFeaturesToEditor` (helpers.ts)** refactored to `createAuthoring(editor).writeGeoJSON(usable, { replace })`; the store-side `setFeatures` dual-write **DELETED** (D-09 mirror catches it). Return shape (`importedCount/skippedDuplicates/totalFeaturesInEditor`) preserved by mapping from `MutationResult.counts`. The `MAX_GEOJSON_TEXT_CHARS` cap + `parseToolCallArguments` remain at the call boundary (V5, T-02-08 — not regressed). The early "no valid features" throw preserved.
- **`GeoEditorView.tsx`** sites **1249** (paste), **1413** (file import), **2120** (OSM dialog import) rerouted to `createAuthoring(editor).writeGeoJSON(..., { replace:false })` (D-08).
- **`useOsmQuery.ts:96`** (`handleOsmImport`) — a 4th, plan-unlisted direct `editor.addFeature` import site (the actual handler `OsmResultsPanel` calls) also rerouted (Rule 2, see Deviations).
- **`authoring.golden.test.ts`** (new): the BINDING gate. Reproduces the OLD `importFeaturesToEditor` body verbatim as the oracle, runs the NEW facade path, deep-equals feature sets (ids, geometry, importSource, customProperties) + `skippedDuplicates`/`importedCount` across replace/append/dup/empty fixtures; asserts `importSource:'chat_tool'` is preserved (proves `toEditorFeature` reuse).
- **`boundary.test.ts`** (extended): A3 fs-scan recurses `src/` and fails on any `editor.addFeature(` outside `api/` + `core/GeoEditor.ts`; plus a check that `helpers.ts` references `createAuthoring` and no longer destructures `{ editor, setFeatures }` for a dual-write.

## Emit strategy / guard / oracle (recorded for the registry plan + verifier)
- **Bulk-replace emit:** NEW `features.replace` event type (chosen over reusing `update`).
- **Reverse-loop guard:** `suppressReverseSyncRef` flag, set in the mirror handler, consumed at the top of the reverse-sync effect.
- **Golden OLD-path reference:** pre-refactor `importFeaturesToEditor` body reproduced verbatim against a fresh `createHeadlessEditor()`; NEW path = `createAuthoring(editor).writeGeoJSON`; deep-equal `getAllFeatures()` + counts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical reroute] `useOsmQuery.ts:96` direct `editor.addFeature` rerouted**
- **Found during:** Task 2 (A3 boundary grep)
- **Issue:** PATTERNS.md asserted "the 3 GeoEditorView sites are the only direct UI addFeature calls," but `useOsmQuery.ts:96` (`handleOsmImport`, the handler `OsmResultsPanel onImport` actually invokes) is a 4th direct `editor.addFeature` import site. Leaving it would have left an INFRA-02 hole and failed the A3 boundary assertion.
- **Fix:** Rerouted `handleOsmImport` through `createAuthoring(editor).writeGeoJSON(features, { replace:false })`; removed the now-unused `toEditorFeature` import.
- **Files modified:** `src/features/geo-editor/hooks/useOsmQuery.ts`
- **Commit:** `79989f6`

**2. [Scope clarification] A3 assertion scoped to `addFeature` (create seam), not all four verbs**
- **Found during:** Task 2 (initial broad grep)
- **Issue:** The plan's behavior bullet listed `editor.(addFeature|setFeatures|updateFeature|deleteFeatures)` as the zero-bypass target. A repo-wide grep shows `updateFeature` (property edits in info-panel/comments/GeometriesTable), `deleteFeatures` (commands.ts, GeoEditorView clear, Editor.tsx map-area), and non-import `setFeatures` (useDatasetManagement dataset load/clear, chat/comment annotation reset) are pervasive and NOT in this plan's `files_modified`. The Authoring facade exposes only `addFeature`/`writeGeoJSON` today — it has **no** `updateFeature`/`deleteFeatures` surface, so those cannot be rerouted without expanding the facade (architectural, out of this plan's 2-task scope).
- **Decision:** Scoped the A3 boundary assertion to the geometry-CREATE seam this plan actually closes (`editor.addFeature`, now zero outside api/+core) plus the chat-dual-write-removed check. The modify/delete verbs are tracked as Deferred Issues for a follow-up facade-expansion plan that adds `modifyFeature`/`deleteFeatures` to `Authoring` and tightens this assertion. This keeps the build green and INFRA-02 honestly satisfied for the seam in scope.
- **Files modified:** `src/features/geo-editor/api/boundary.test.ts` (assertion scope + documenting comment)

## Deferred Issues

| Item | Reason | Resolves in |
|------|--------|-------------|
| Reroute `editor.updateFeature` sites (info-panel `StylePropertiesSection`/`FeaturePropertiesSection`, `GeometriesTable`, chat/comment annotation edit) | Authoring facade has no `modifyFeature` method yet — net-new surface (architectural) | A follow-up facade-expansion plan (extends `Authoring` + tightens A3 to all 4 verbs) |
| Reroute `editor.deleteFeatures` sites (`commands.ts`, `GeoEditorView.handleClear`, `Editor.tsx` map-area cleanup) | Authoring facade has no `deleteFeatures` method yet | Same follow-up |
| Reroute non-import `editor.setFeatures` (dataset load/clear in `useDatasetManagement`, annotation reset in chat/comments) | These are dataset-load / reset paths, not the chat/UI geometry-import write paths this plan targets; some are the legitimate "external store→editor" path the reverse-sync guard intentionally keeps | Evaluate during the facade-expansion plan |

## Threat Model Compliance
- **T-02-06 (Tampering — behavior drift breaks criterion #2):** mitigated. `authoring.golden.test.ts` deep-equals OLD-vs-NEW feature sets (ids/geometry/importSource/customProperties) + dedup counts; `toEditorFeature` + dedup-by-id reused verbatim. Green.
- **T-02-07 (EoP — missed direct write bypasses the seam):** mitigated for the create seam. `boundary.test.ts` A3 fs-scan asserts zero `editor.addFeature` outside api/+core (caught and fixed `useOsmQuery.ts`). `updateFeature`/`deleteFeatures` scoped out — see Deferred Issues.
- **T-02-08 (DoS — oversized GeoJSON via chat path):** mitigated. `MAX_GEOJSON_TEXT_CHARS` cap + `parseToolCallArguments` preserved at the dispatch boundary; not regressed.
- **T-02-09 (DoS — reverse-sync feedback loop):** mitigated. `suppressReverseSyncRef` guard; `mirror.test.ts` asserts exactly one mirror emission per op (no duplicate `create`/render churn).
- **T-02-SC (package installs):** none this plan.

## Gates
- `bun test src/features/geo-editor/api` — 29 pass / 0 fail (mirror + golden + boundary/A3 + Plan 02 authoring/interceptor).
- `bun test` (full repo) — 61 pass / 0 fail.
- `bun run build` — succeeds (923ms).
- `bunx biome lint` on all changed files — no NEW diagnostics (pre-existing baseline counts unchanged: helpers.ts 0, GeoEditorView.tsx 0, useOsmQuery.ts 6 pre-existing, Editor.tsx/GeoEditor.ts pre-existing; new test files clean).

## Known Stubs
None introduced. (The `editorCommand` passthrough scaffold from Plan 02 remains as documented there — untouched here.)

## Next Phase Readiness
- The single store-write chokepoint (`Editor.tsx` mirror → `editorCoreSlice.setFeatures`) and the interceptor seam are in place for Phase 5's SAFE-01..06 gate hooks.
- Plan 04 (unified registry) and Plan 05 (primitives) build on the same `createAuthoring` surface, now the sole geometry-CREATE caller.
- A facade-expansion follow-up should add `modifyFeature`/`deleteFeatures` to `Authoring` and tighten the A3 assertion to all four mutation verbs (see Deferred Issues).

## Self-Check: PASSED
- Files verified present: `api/mirror.test.ts`, `api/authoring.golden.test.ts` (created); `core/GeoEditor.ts`, `core/types/index.ts`, `components/Editor.tsx`, `chat/tools/helpers.ts`, `GeoEditorView.tsx`, `hooks/useOsmQuery.ts`, `api/boundary.test.ts` (modified).
- Commits verified in git log: `2055e4c` (Task 1), `79989f6` (Task 2).

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
