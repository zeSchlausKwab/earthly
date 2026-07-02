---
phase: 13-cross-cutting
plan: 04
subsystem: map-stack
tags: [map-stack, ui, aggregate-layer, cold-start, expiry, beacon, sighting]

# Dependency graph
requires:
  - phase: 13-cross-cutting
    plan: 03
    provides: "MapStackEntryType (sighting|beacon|sighting-layer|beacon-layer); deriveVisibleEntitiesFromStack render gate; addSightingToMapStack/addBeaconToMapStack handlers; visibleSightingsFromStack/visibleBeaconsFromStack selectors; 66a155e extraMapBeacons hack already deleted"
provides:
  - "Add-to-map-stack affordance on BeaconViewPanel/SightingViewPanel + Beacons/Sightings rail rows (SPEC §3.4)"
  - "Aggregate Sightings/Live beacons layer entries render top-pinned + toggle in MapStackPanel (D-05)"
  - "Cold-start Browse seeds both aggregate layer entries (browse-default, entityKey:'all', idempotent, Clear-aware) (SPEC §3.3)"
  - "Pinned individual sighting/beacon entries auto-remove on NIP-40 expiry / subscription drop (D-02, no tombstone rows)"
  - "Pure bucketMapStackEntries/orderedMapStackEntries + entityTypeLabel/entryTypeMetaLabel helpers (unit-tested top-pin order)"
affects: [XCUT-01, XCUT-02, verify-phase-13, 13-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Aggregate-layer entries as first-class MapStack rows pinned above dataset/context via a pure bucket-and-order helper (D-05); their `visible` flag gates the whole subscription-driven layer through the Plan-03 selector"
    - "Cold-start browse-default aggregate seeding guarded by a per-session ref + a `?ms=` deep-link check so it never re-seeds after Clear/remove and never overwrites a shared view"
    - "Expiry auto-remove sweep: individual sighting/beacon stack entries resolved against the (dropExpired'd) subscription; gone-or-expired ⇒ removeMapStackEntry(id) — dropExpired parity, no tombstone rows (D-02)"

key-files:
  created:
    - src/components/MapStackPanel.layerEntries.test.ts
  modified:
    - src/components/MapStackPanel.tsx
    - src/components/info-panel/BeaconViewPanel.tsx
    - src/components/info-panel/SightingViewPanel.tsx
    - src/components/BeaconsPanel.tsx
    - src/components/SightingsPanel.tsx
    - src/components/AppSidebar.tsx
    - src/components/GeoEditorInfoPanel.tsx
    - src/features/geo-editor/GeoEditorView.tsx

key-decisions:
  - "D-05 — aggregate sighting-layer/beacon-layer entries pin to the TOP of MapStackPanel via a pure bucketMapStackEntries/orderedMapStackEntries helper (unit-tested), above individual dataset/context/draft entries"
  - "SPEC §3.3 — cold-start Browse seeds ONE sighting-layer + ONE beacon-layer entry (source:'browse-default', entityKey:'all', visible), preserving today's always-on behavior while making both removable/toggleable; idempotent + Clear-aware via a per-session ref guard + a `?ms=` deep-link skip"
  - "D-02 — pinned individual sighting/beacon entries auto-remove once their resolved entity is expired OR no longer in the dropExpired'd subscription; aggregate layers are NOT swept (they self-drop expired inside buildSighting/BeaconSource); no ended tombstone rows"
  - "T-13-04-GPSREGRESS — cold-start seeds ONLY the aggregate beacon-layer (entityKey:'all', discovery #t:['live']); link-only beacons are absent from discovery and never fed to the rail/aggregate (Phase-12 P-6 preserved)"
  - "Threading — used descriptive AppSidebar/GeoEditorInfoPanel prop names (onAddBeaconToMapStack/onAddSightingToMapStack) rather than a colliding shared onAddToMapStack; both leaf panels receive onAddToMapStack; both AppSidebar mounts wired to the Plan-03 handlers"

patterns-established:
  - "New MapStack entity types add: (1) a bucket in bucketMapStackEntries, (2) a label case in entityTypeLabel/entryTypeMetaLabel, (3) an icon case in the row switch — no unknown fallthrough"

requirements-completed: [XCUT-01, XCUT-02]

# Metrics
duration: ~30min
completed: 2026-07-02
---

# Phase 13 Plan 04: Map Stack ↔ Entity-Layer Unification (UI + Lifecycle) Summary

**The UI + lifecycle surface of the Map Stack unification landed: sightings/beacons now expose the SAME visibility controls datasets/contexts have — an "Add to map stack" button on both view panels and both rail rows (SPEC §3.4), aggregate "Sightings"/"Live beacons" layer rows pinned to the top of MapStackPanel and toggling the whole subscription-driven layer (D-05), cold-start Browse that auto-seeds both aggregate layers so today's always-on behavior is preserved but now removable/toggleable/Clear-aware (SPEC §3.3), and an expiry sweep that auto-removes a pinned individual entry once its entity expires or drops from the dropExpired'd subscription (D-02, no tombstone rows) — all driven through the stack, with no reintroduction of the deleted `extraMapBeacons` side-channel.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2
- **Files modified:** 8 (7 modified, 1 created)

## Accomplishments

- **Task 1 (D-05 top-pin + row rendering):** Extracted the previously-inline MapStackPanel bucketing into pure, exported, unit-tested helpers — `bucketMapStackEntries` (splits `sighting-layer`/`beacon-layer` into their own buckets; individual `sighting`/`beacon` pins ride `otherEntries`) and `orderedMapStackEntries` (aggregate layers FIRST). Added the aggregate-layer group render blocks ABOVE the draft/contexts/datasets groups so they pin to the top (D-05). Added `entityTypeLabel` (row TITLE: "Sightings"/"Live beacons"/entity title) and `entryTypeMetaLabel` (the "kind" chip: "sightings layer" etc.) with an explicit case per new type — no `unknown`/blank fallthrough. Added icon cases (`MapPin` for sightings, `Radio` for beacons) to the row icon switch. Per-entry toggle/isolate/remove reuse the existing `toggleMapStackEntryVisible`/`setMapStackEntryIsolated`/`removeMapStackEntry` wiring unchanged (the new types are not special-cased out). Wrote `MapStackPanel.layerEntries.test.ts` (4 tests): top-pin ordering (aggregate before dataset AND context), individual-entry bucketing (not dropped, total-count conservation), aggregate separation, and label non-empty/no-fallthrough for all four types.

- **Task 2 (affordances + cold-start + expiry):**
  - **View panels:** added `onAddToMapStack?` to `BeaconViewPanelProps`/`SightingViewPanelProps` + an "Add to map stack" `<Button variant="outline">` (MapPlus icon), gated on the prop. On Beacon it sits beside "Copy share link"; on Sighting it sits below the observation-range block.
  - **Rails:** added `onAddToMapStack?` to `BeaconsPanelProps`/`SightingsPanelProps` + a compact add affordance in each row's action cluster, mirroring the dataset rail's add pattern.
  - **Threading:** added `onAddBeaconToMapStack`/`onAddSightingToMapStack` props through `AppSidebar` (into `beaconsPanelProps`/`sightingsPanelProps` for the rails and `editorPanelProps` for the view panels) and through `GeoEditorInfoPanel` to the `BeaconViewPanel`/`SightingViewPanel` mounts; wired both AppSidebar mounts (desktop + mobile) to `addBeaconToMapStack`/`addSightingToMapStack` (Plan-03 handlers, `source:'manual'` default ⇒ toast + non-isolated visible entry). Also forwarded the latent `beaconFocusCommentId` (declared on AppSidebar's incoming props by GeoEditorView but never destructured/forwarded — Rule 2 wiring gap closed).
  - **Cold-start (SPEC §3.3):** added an effect that, on the first Browse cold-start (`stance==='browse'`, hydrated, no `?ms=`), seeds ONE `sighting-layer` + ONE `beacon-layer` entry (`source:'browse-default'`, `entityKey:'all'`, `visible:true`). Guarded by `aggregateLayersSeededRef` so it runs once per session (never re-seeds after Clear/remove) and by the `?ms=` check so a shared deep link shows exactly what was shared. Idempotent belt-and-suspenders: checks for an existing entry of each aggregate type before adding, and `addMapStackEntry` keys by `entityType:entityKey` so a repeat is a no-op merge.
  - **Expiry auto-remove (D-02):** added a sweep effect keyed on the sighting/beacon subscription sets that resolves each individual `sighting`/`beacon` stack entry against `sightings` / `beaconLookupSuperset` (discovery ∪ routed) and calls `removeMapStackEntry(id)` when the entity is `isExpired` OR no longer resolvable (dropped from the already-`dropExpired`'d subscription). Aggregate `*-layer` entries are NOT swept.

## Task Commits

1. **Task 1: aggregate + individual entries in MapStackPanel (top-pinned) + RED test** — `c8d6df4` (feat)
2. **Task 2: add-to-stack affordances (view panels + rails) + cold-start defaults + expiry auto-remove** — `77071df` (feat)

## Cold-start seed site + guard (per plan output spec)

- **Seed site:** `src/features/geo-editor/GeoEditorView.tsx`, in a `useEffect` immediately after `showBrowseLandingPrompt` (mirrors the browse-default seeding neighborhood the plan pointed at). It calls `addMapStackEntry({ entityType: 'sighting-layer' | 'beacon-layer', entityKey: 'all', source: 'browse-default', visible: true, pinned: false })`.
- **Guard:** `aggregateLayersSeededRef` (once-per-session) + an early `?ms=` deep-link skip (a shared stack is not seeded) + a pre-add existence check per aggregate type (idempotent). Clear-awareness comes for free: `browse-default` entries are non-pinned, so `clearMapStack` removes them, and the ref prevents re-seeding after a Clear.

## Expiry-sweep effect location (per plan output spec)

`src/features/geo-editor/GeoEditorView.tsx`, in a `useEffect` immediately after the `visibleBeaconsFromStack` memo (so `beaconLookupSuperset` is in scope). Deps: `[sightings, beaconLookupSuperset, mapStackEntries, mapStackOrder, removeMapStackEntry]`. It builds a key→entity map per kind (using the SAME `encodeSightingNaddrPure`/`encodeBeaconNaddrPure` key the entries were pinned under), then removes any individual `sighting`/`beacon` entry that is unresolvable or `isExpired`.

## 4-kind matrix + new stack behaviors ready for UAT (D-11)

The full 4-kind matrix (Story / Group / Beacon / Sighting × comment × deep-link/route × share) plus the net-new stack behaviors are now surfaced for end-of-phase UAT:
- **Add-to-stack:** button on both view panels + both rails → non-isolated visible entry (`source:'manual'`, toast).
- **Deep-link isolate-solo:** unchanged from Plan 03 (`source:'route'` ⇒ `isolated:true`).
- **Aggregate layer toggle:** the top-pinned Sightings/Live beacons rows toggle `visible` → the Plan-03 `deriveVisibleEntitiesFromStack` gate adds/removes the whole layer from the map.
- **Cold-start default:** a fresh Browse load shows both aggregate layers (removable/toggleable/Clear-aware).
- **Expiry auto-remove:** a pinned individual sighting/beacon vanishes from the stack once expired — no tombstone row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical wiring] `beaconFocusCommentId` was declared-but-not-forwarded through AppSidebar**
- **Found during:** Task 2 (threading the view-panel add-to-stack prop through the same chain)
- **Issue:** `GeoEditorView` passes `beaconFocusCommentId={beaconFocusCommentId}` to both `<AppSidebar>` mounts, and `GeoEditorInfoPanel`/`BeaconViewPanel` consume it — but `AppSidebar` never declared it in its props interface nor destructured/forwarded it into `editorPanelProps`. The beacon comment deep-link focus (D-10, meant to reach the panel) was silently dropped at the AppSidebar boundary.
- **Fix:** added `beaconFocusCommentId?: string` to the AppSidebar props interface, destructured it, and forwarded it into `editorPanelProps` (which `GeoEditorInfoPanel` already threads to `BeaconViewPanel`).
- **Files modified:** `src/components/AppSidebar.tsx`
- **Commit:** `77071df`

### Acceptance-grep note (semantic equivalence, not a defect)

- The plan's Task-2 acceptance grep expects `onAddToMapStack={addBeaconToMapStack}` / `onAddToMapStack={addSightingToMapStack}` **literally in GeoEditorView**. Because `AppSidebar` mounts TWO distinct panels needing TWO distinct handlers, a single shared prop name would collide, so the AppSidebar/GeoEditorInfoPanel props are named `onAddBeaconToMapStack`/`onAddSightingToMapStack` (the leaf `BeaconViewPanel`/`SightingViewPanel`/`Beacons`/`Sightings` panels DO use `onAddToMapStack`). Both handlers are wired at BOTH GeoEditorView mounts — `grep -c "onAddBeaconToMapStack={addBeaconToMapStack}"` = 2 and `grep -c "onAddSightingToMapStack={addSightingToMapStack}"` = 2 — so the semantic requirement ("both panels wired to the Plan-03 handlers") is fully met; only the exact grep string differs.

### Out-of-scope discoveries (logged, NOT fixed — see deferred-items.md)

- **`src/components/AppSidebar.tsx:337` `onClearBeaconView` unused-param warning** — pre-existing (persists with my changes stashed). Out of scope.
- **`src/components/GeoEditorInfoPanel.tsx` ~977/1030 `noLabelWithoutControl` errors** — pre-existing unattached-context labels (logged since Plan 13-02). My edits don't touch those lines. They block a whole-file biome check on GeoEditorInfoPanel but the lines I changed are clean.
- **`storyProposal.test.ts` full-suite ordering flake** — pre-existing (6/0 in isolation; documented in 13-03 SUMMARY). Not a regression from this plan.

## Threat Model Outcomes

- **T-13-04-EXPIRELEAK (mitigate):** satisfied. The D-02 sweep calls `removeMapStackEntry` for any individual entry whose entity is expired or gone from the dropExpired'd subscription, so a stale beacon/sighting is never shown as current; aggregate layers self-drop expired via `buildSource`. No tombstone rows persist.
- **T-13-04-GPSREGRESS (mitigate):** satisfied. Cold-start seeds ONLY the aggregate `beacon-layer` (`entityKey:'all'`), which renders the `#t:['live']` DISCOVERY set — link-only beacons are absent from discovery (Phase-12 P-6) and are never fed to the rail or the aggregate layer. A link-only beacon still renders only via an explicit deep-link/add-to-stack action (Plan 03's `individualLookupSet` superset).
- **T-13-04-COLDSTART (mitigate):** satisfied. The seed is guarded by a per-session ref, a `?ms=` deep-link skip, AND a per-type existence check before adding; browse-default entries clear normally on Clear. A repeated cold-start cannot pile up duplicate layers or resurrect cleared ones.
- **T-13-04-XSS (mitigate):** satisfied. `grep -c dangerouslySetInnerHTML src/components/MapStackPanel.tsx` = 0. All new entity labels render as escaped React text nodes in the existing row component.

## Known Stubs

None. Every new affordance is wired end-to-end: the view-panel/rail buttons call `addBeaconToMapStack`/`addSightingToMapStack`; the aggregate rows toggle through the existing slice actions into the Plan-03 render gate; the cold-start seed and expiry sweep both mutate the real stack. No hardcoded empty/placeholder values flow to render.

## Verification Evidence

- `bun test src/components/MapStackPanel.layerEntries.test.ts` → **4 pass / 0 fail** (top-pin ordering + individual bucketing + label no-fallthrough).
- `bun test` (full suite) → **775 pass / 2 fail + 1 error**; the 3 non-passes are EXCLUSIVELY the pre-existing `storyProposal.test.ts` full-suite ordering flake (6/0 in isolation, documented in 13-03). Baseline was 771/2+1 before this plan; the +4 are the new MapStackPanel tests. No new failures.
- `bun run build` → succeeds (client + server + 5 workers), run after each task.
- `bunx biome check` on the six plan-listed source files → clean except two pre-existing GeoEditorInfoPanel `noLabelWithoutControl` errors + one pre-existing AppSidebar unused-param warning, none on my changed lines (logged to deferred-items).
- Acceptance greps — Task 1: `sighting-layer|beacon-layer` in MapStackPanel = 11 (≥4); `sightingLayerEntries|beaconLayerEntries` = 24 (≥2); `dangerouslySetInnerHTML` = 0. Task 2: `onAddToMapStack` in each of the 4 panel files ≥1 (4/4/7/7); `'sighting-layer'|'beacon-layer'` in GeoEditorView = 6 (≥2, cold-start seeds both); `removeMapStackEntry` in GeoEditorView = 6 (≥1, sweep calls it); `onAddBeaconToMapStack={addBeaconToMapStack}` = 2 and `onAddSightingToMapStack={addSightingToMapStack}` = 2 (both panels wired at both mounts). `extraMapBeacons` = 0, `beaconsForMap` = 0 (no side-channel reintroduced).

## Issues Encountered

Only the pre-existing `storyProposal.test.ts` full-suite ordering flake (documented in 13-03) and the pre-existing GeoEditorInfoPanel/AppSidebar biome findings (logged to deferred-items). No plan-related issues.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 04 completes the Phase-13 body: the Map Stack unification is now fully surfaced (add-to-stack, top-pinned aggregate toggles, cold-start defaults, expiry auto-remove). "On the stack = visible" holds for every entity type, and the `66a155e` side-channel remains deleted.
- Ready for the consolidated end-of-phase UAT (D-11): the full 4-kind matrix + the net-new stack behaviors are all reachable. Then `/gsd-verify-phase 13` + `/gsd-secure-phase 13`.

## Self-Check: PASSED

- FOUND: src/components/MapStackPanel.layerEntries.test.ts
- FOUND: src/components/MapStackPanel.tsx (modified)
- FOUND: src/components/info-panel/BeaconViewPanel.tsx (modified)
- FOUND: src/components/info-panel/SightingViewPanel.tsx (modified)
- FOUND: src/components/BeaconsPanel.tsx (modified)
- FOUND: src/components/SightingsPanel.tsx (modified)
- FOUND: src/components/AppSidebar.tsx (modified)
- FOUND: src/components/GeoEditorInfoPanel.tsx (modified)
- FOUND: src/features/geo-editor/GeoEditorView.tsx (modified)
- FOUND: commit c8d6df4 (Task 1)
- FOUND: commit 77071df (Task 2)

---
*Phase: 13-cross-cutting*
*Completed: 2026-07-02*
