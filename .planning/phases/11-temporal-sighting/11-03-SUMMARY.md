---
phase: 11-temporal-sighting
plan: 03
subsystem: sighting-authoring-discovery-ui
tags: [kind-37522, map-first-create, pin-drop, observation-state-marker, nip-40-expiry, rail-destination, group-attach, sight-01, sight-02, sight-03, d-01, d-02, d-03, d-04, d-05, d-06, d-07]

# Dependency graph
requires:
  - phase: 11-temporal-sighting
    plan: 02
    provides: publishSighting/editSighting/deleteSighting, draft helpers, useSightings (dropExpired'd), classifyObservationState, content.geometry + bbox/g derivation
  - phase: 10-story-article-37520
    provides: StoryEditorPanel/StoriesPanel/useStoryEditor spine (cloned 1:1), AppSidebar story rail wiring
  - phase: 09-group-topic-37518-slimmed
    provides: GroupAttachField (off-thread warn-not-block c-attach; never disables publish)
provides:
  - "SightingEditorPanel — map-first create/edit form: observation time (D-03), NIP-40 expiry preset default After 1 month (D-04), GroupAttachField c-attach (SIGHT-02); publishes via publishSighting/editSighting, never re-inlines the factory"
  - "SightingsPanel/SightingsPanelContent — browse rail body with New Sighting accent button + observation-state cue + expiry countdown rows (D-07)"
  - "Distinct Sighting map marker layer (SIGHTING_SOURCE_ID) — obsState-keyed paint (live → --primary accent focal point), dropExpired-before-source-build, ≥44px hit layer, eye glyph (D-05/D-06)"
  - "AppSidebar 'sighting' EntityWorkspace + 'sightings' WorkViewMode + RAIL_DESTINATIONS Eye entry + SightingsPanelContent render case + sighting* prop/handler family"
  - "useSightingEditor hook + GeoEditorView map-first pin-drop create (arm draw_point, intercept 'create', open editor with placed geometry; Esc/Cancel overlay; Draw-an-area D-02)"
affects: [11-04]

# Tech tracking
tech-stack:
  added: []  # zero new deps — all primitives (calendar, radio-group, popover, lucide Eye) already installed (UI-SPEC Registry Safety)
  patterns:
    - "Map-first create: New Sighting arms editor.setMode('draw_point'); a ref-mirrored placementArmed flag gates a single editor.on('create') listener that captures geometry, opens the editor, and deletes the transient draw feature so it never pollutes the dataset draft"
    - "Sighting marker is a SEPARATE map read path from useSightings — it applies its OWN dropExpired(unixNow()) before building the source FeatureCollection (Pitfall P-1); expired markers are removed, not styled-hidden"
    - "viewSighting held as hook-local state (not store/route) — keeps the wiring a thin per-kind clone; the canonical /sighting/:naddr focus route + OG card are Plan 04 (Phase 13 owns convergence)"
    - "obsState/agingFactor written as feature properties; MapLibre data-driven 'case' paint keys on ['get','obsState'] (live=--primary #fdc700, upcoming=--secondary #00bcff, past=--muted-foreground #737373) mirroring the LayerManager point-layer paint shape but keyed on observation state instead of selection"

key-files:
  created:
    - src/components/info-panel/SightingEditorPanel.tsx
    - src/components/SightingsPanel.tsx
    - src/features/geo-editor/hooks/useSightingEditor.ts
  modified:
    - src/features/geo-editor/hooks/useMapLayers.ts
    - src/components/AppSidebar.tsx
    - src/components/GeoEditorInfoPanel.tsx
    - src/features/geo-editor/GeoEditorView.tsx
    - src/features/geo-editor/components/MobilePanel.tsx
    - src/features/geo-editor/hooks/index.ts
    - src/features/geo-editor/store/types.ts
    - src/features/geo-editor/hooks/useRouting.ts

key-decisions:
  - "viewSighting + sighting editor mode held in useSightingEditor LOCAL state, not the store/route. Story keeps viewStory in the store because it has a /story/:naddr focus route (Phase 10). Plan 04 owns the Sighting route/OG (D-08), so this plan deliberately keeps the inspect-subject hook-local and threads an onClearSightingView callback for the browse-away clear — avoids touching applyRouteState/viewModeSlice for a route that lands next plan. 'sightings' WAS added to SidebarViewMode (a navigable view) but NOT as a focusType."
  - "The Sighting map marker uses a separate source/layer pair in useMapLayers (cloned from the REMOTE_SOURCE_ID addSource/addLayer init pattern), NOT a LayerManager change. The research flagged the source-feed path as not deep-read (Q3/A3); the existing useMapLayers init+sync effect is the analog and the cleanest seam, so the marker rides the same remoteLayersReady/styleInitVersion lifecycle and a dedicated visibleSightings effect sets its data."
  - "buildSightingSource resolves a representative POINT per sighting (pointOnFeature for precise geometry incl. Line/Polygon areas; bbox centroid fallback for legacy geometry-less events) — a sighting that yields no point is skipped, never crashes the layer (T-11-03-04). agingFactor ramps opacity over the final week toward NIP-40 expiry (D-05 nice-to-have, shipped since cheap)."
  - "Editor 'create' interception is gated by a ref (sightingPlacementArmedRef) so the always-registered listener only fires during an armed Sighting placement — it does not interfere with the existing dataset-draw 'create' handlers (which check isDrawingMapArea / mirror to the store). The transient placed feature is deleteFeature'd after capture so it never enters the dataset draft."
  - "GroupAttachField mounted with featureProperties={[{}]} — a Sighting's content has no per-feature properties schema to validate against, so the empty-object probe drives the warn-not-block advisory without false rule hits; publish stays enabled regardless of verdict (GROUP-04)."

patterns-established:
  - "Map-first entity authoring (arm draw mode → intercept create → open info-panel editor with captured geometry) — the first non-dataset entity to author by placing on the map; reusable for Phase 12 Beacon"
  - "Per-read-path dropExpired discipline extended to the map-layer source build (the 3rd of the 5 SIGHT-03 read paths; subscription was Plan 02, OG server fetch is Plan 04)"

requirements-completed: []  # SIGHT-01/02/03 authoring+discovery UI shipped; requirements close when Plan 04 adds reading/route/OG and the consolidated end-of-phase UAT passes

# Metrics
duration: ~55min
completed: 2026-06-28
---

# Phase 11 Plan 03: Temporal Sighting Authoring + Discovery Surface Summary

**The kind-37522 authoring + discovery UI: a map-first pin-drop create form (time/expiry/Group-attach), a Sightings browse rail destination, and the phase's one net-new visual concern — a distinct, observation-state-aware map marker whose live-now state is the single accent focal point — all wired into AppSidebar + GeoEditorView so a user can actually create and find a Sighting (closing the Phase-9 built-but-unwired dead-end).**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-06-28
- **Tasks:** 3 auto + 1 human-verify (deferred to end-of-phase UAT)
- **Files:** 11 (3 created, 8 modified)

## Accomplishments

- **Task 1 — SightingEditorPanel + SightingsPanel (`1cfcf3f`):**
  - `SightingEditorPanel.tsx`: cloned the `StoryEditorPanel` shell/state/draft/submit spine, **dropped** the cover-image `BlossomUploaderButton` and the TipTap `GeoRichTextEditor`/Tabs body (a Sighting has no Markdown body). Added the three net-new sections: (a) observation time (D-03) — collapsed "Observed now" default with an "Adjust time" affordance revealing `start` + "Until (optional)" `end` via the `@/components/ui/calendar` popover; (b) NIP-40 expiry preset `RadioGroup` (D-04) — 1 day / 1 week / 1 month / Never / Custom, default **After 1 month**, selected preset carries the accent ring, "Custom date…" reveals a calendar; (c) Group attach (SIGHT-02) — `GroupAttachField` driving `contextReferences()`, publish never disabled by the verdict. Submit routes through `publishSighting`/`editSighting` (NOT a re-inlined factory) then `clearSightingDraft` + `castEvent(signed, TemporalSighting, eventStore)` + `onSave(cast)`. The placed `geometry` arrives as a prop. Title/description render as escaped React text nodes (T-11-03-01).
  - `SightingsPanel.tsx`: cloned `StoriesPanel`; `useSightings()` (already `dropExpired`'d), `useFilterState`/`useSortedFilteredItems`/`EntitySearchToolbar`, accent **New Sighting** button at top, `Card`-per-row with `DropdownMenu` (Open/Edit/Copy link/Delete), skeleton + UI-SPEC empty states. Swapped the cover thumbnail for an observation-state cue chip (LIVE/Upcoming/relative-date via `classifyObservationState`) + an expiry countdown ("Fades in 6 days" / "Fades soon"). Exports `SightingsPanelContent`.
- **Task 2 — distinct Sighting map marker layer (`826b615`):**
  - `useMapLayers.ts`: new `SIGHTING_SOURCE_ID` source + three layers — an invisible ≥44px `circle` **hit** layer (mobile touch), a visible `circle` marker with data-driven `'circle-color'` `'case'` keyed on `['get','obsState']` (live → `#fdc700` `--primary` accent — the ONE map focal point; upcoming → `#00bcff` `--secondary`; past → `#737373` `--muted-foreground`) + an `agingFactor`-interpolated `'circle-opacity'` (D-05), and a `symbol` **glyph** layer (◉ observation motif) so the marker reads as an ephemeral sighting, not a dataset dot.
  - `buildSightingSource(sightings)`: applies `dropExpired(events, unixNow())` BEFORE building the FeatureCollection (Pitfall P-1, SIGHT-03 — the map source is a separate read path from the subscription); resolves a representative point per sighting (precise geometry via `pointOnFeature`, bbox-centroid fallback for legacy events); writes `obsState` (via `classifyObservationState`) + `agingFactor`; skips a sighting that yields no point (never crashes the layer, T-11-03-04).
  - `GeoEditorView.tsx`: consumes `useSightings()` and feeds `visibleSightings` into `useMapLayers`.
- **Task 3 — rail + map-first pin-drop wiring (`2d3531a`):**
  - `useSightingEditor.ts`: a `useStoryEditor` twin owning `sightingEditorMode`/`editingSighting`/`viewSighting`/`placedGeometry`/`placementArmed` + handlers. `handleCreateSighting` arms the pin-drop (injected `armPlacement`); `handleGeometryPlaced` (fired on the editor `'create'`) captures geometry, disarms, and opens the editor; `cancelPlacement` + `clearSightingView` cover Esc/browse-away.
  - `AppSidebar.tsx`: `'sighting'` EntityWorkspace, `'sightings'` WorkViewMode + `WORK_VIEW_MODES`, `RAIL_DESTINATIONS` `{ mode: 'sightings', title: 'Sightings', icon: Eye }`, a `SightingsPanelContent` `renderWorkContent` case, the full `sighting*` prop/handler family + the activeEntity-resolution effect (`sightingEditorMode !== 'none' || viewSighting` → `setActiveEntity('sighting')`), `currentSurface`/`returnToCurrentSurface`, and an `onClearSightingView` browse-away clear.
  - `GeoEditorView.tsx`: `useSightingEditor` wiring; a ref-gated `editor.on('create')` interceptor that captures the placed geometry and `deleteFeature`s the transient point; an Esc handler + the **"Click the map to drop your sighting"** / **"Cancel placement"** map overlay (D-01); `handleDrawSightingArea` → `draw_polygon` (D-02); `handleDeleteSighting` via `deleteSighting`; props threaded through the desktop `AppSidebar` and the mobile `MobilePanel` mounts.
  - `GeoEditorInfoPanel.tsx`: a `SightingEditorPanel` create/edit branch (gated on `sightingEditorMode` + `onSaveSighting`/`onCloseSightingEditor`) wired with `placedGeometry`/`onDrawArea`; a reserved `SightingViewPanel` mount point (`viewSighting` threaded; component lands Plan 04).
  - `MobilePanel.tsx`: parallel sighting view/edit props forwarded to the edit-tab `GeoEditorInfoPanelContent`.
  - `store/types.ts` + `useRouting.ts`: `'sightings'` added to `SidebarViewMode` + `SIDEBAR_VIEW_MODES` (a navigable view; NOT a focusType — the `/sighting/:naddr` focus route is Plan 04).

## Task Commits

1. **Task 1: SightingEditorPanel (time/expiry/Group attach) + SightingsPanel browse** — `1cfcf3f` (feat)
2. **Task 2: distinct Sighting map marker layer — obsState paint + dropExpired source** — `826b615` (feat)
3. **Task 3: wire Sightings rail + map-first pin-drop create into AppSidebar + GeoEditorView** — `2d3531a` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Deviations from Plan

### Auto-fixed Issues

None that changed behavior. The plan executed as written. Two small, in-spec wiring choices worth recording (NOT deviations — both are explicitly within the plan's "thin per-kind clone" + "Plan 04 owns route/OG" boundaries):

1. **[Rule 3 — Blocking, in-scope] `viewSighting` held hook-local instead of in the store.** The plan's key_link only required `sightingEditorMode !== 'none' || viewSighting` in AppSidebar's activeEntity effect. Story keeps `viewStory` in the store because it has a focus route; since D-08 (route/OG) is Plan 04, adding `viewSighting` to `applyRouteState`/`viewModeSlice` now would be premature route plumbing. Held it in `useSightingEditor` and threaded an `onClearSightingView` callback so AppSidebar's browse-away still clears it. No new store/route surface; Plan 04 can promote it when it adds the focus route.
2. **[Rule 3 — Blocking, in-scope] Map marker rides `useMapLayers` (not `LayerManager`).** RESEARCH Q3/A3 flagged the source-feed path as not deep-read; the existing `useMapLayers` `REMOTE_SOURCE_ID` addSource/addLayer + sync-effect lifecycle is the analog the PATTERNS map pointed at for "browse-map entity rendering." Cloning the source/layer pair there (rather than into `LayerManager`, which manages the editor's own draft features) keeps the marker on the same `remoteLayersReady`/`styleInitVersion`/`style.load` re-init lifecycle as the other browse layers. `visibleSightings` is a new `useMapLayers` option fed from `useSightings()`.

## Authentication Gates

None — the publish path reuses the existing `accounts.signer` contract already proven by Story/dataset publishing; no new signer/login surface was touched.

## Test Results (success criteria)

- **Temporal Sighting test set** (`bun test src/lib/nostr/temporal-sighting`): **14 pass / 0 fail / 17 expect() calls** — no regression (this plan is UI-only; the data-layer contract is unchanged).
- **Full suite** (`bun test`): **717 pass / 0 fail / 3284 expect() calls / 81 files**. (The `optimizeClient.test.ts` worker-timeout warnings are that test deliberately exercising the worker-failure path; it passes.)
- **`bun run build`:** green (client + server + 5 workers).
- **`biome check`** over the 7 plan-scope files (`SightingEditorPanel`, `SightingsPanel`, `AppSidebar`, `GeoEditorView`, `useMapLayers`, `useSightingEditor`, `MobilePanel`): **clean, no fixes applied.** The 2 `noLabelWithoutControl` errors in `GeoEditorInfoPanel` are **pre-existing** (confirmed on the clean tree) and explicitly out-of-scope per the Task-3 acceptance criteria.

### key_links verification (grep)

- `useMapLayers.ts`: `dropExpired` ×6, `obsState`/`classifyObservationState` ×10 ✓ (filter expired before source build; paint keyed on obsState)
- `SightingEditorPanel.tsx`: `publishSighting`/`editSighting` ×7, `GroupAttachField` ×3 ✓
- `AppSidebar.tsx`: `SightingsPanelContent` ×2 ✓ (import + render case)

## Known Stubs

- **SightingViewPanel mount point (intentional, Plan 04).** `GeoEditorInfoPanel` reserves the inspected-Sighting view slot (`viewSighting` is threaded through and `void`-referenced) but does NOT yet render a `SightingViewPanel` — that component (read view: title/description/observation-time range/expiry countdown + comments/react mount, SIGHT-04) is Plan 04 by design (Pattern Map row). Until then, opening a Sighting from the rail navigates to the `sightings` view and marks the active entity `'sighting'`; the read surface is the next plan. This does not block the plan's goal (create + browse + map render are fully functional); it is the documented Plan-04 boundary.
- **`Copy link` copies the addressable coordinate, not a deep link.** `SightingsPanel`'s Copy-link writes `37522:pubkey:dTag` (functional pre-routing); the canonical `/sighting/:naddr` deep link is Plan 04 (D-08), mirroring how Plan-10's StoriesPanel staged the same action.

## Threat Flags

None. No security-relevant surface beyond the plan's `<threat_model>` was introduced. All mitigations are in place: escaped React text nodes (no `dangerouslySetInnerHTML`) for title/description (T-11-03-01); `dropExpired` before the map source build (T-11-03-02); `GroupAttachField`'s off-thread warn-not-block validation reused verbatim (T-11-03-03); try/catch-guarded geometry→point with skip-on-failure (T-11-03-04); zero new deps (T-11-03-SC).

## Task 4 — Human-Verify (DEFERRED to end-of-phase UAT)

**Task-4 human-verify DEFERRED to end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`** (consistent with every prior v1.2 plan: 09-04/05/06, 10-x). Automated gates are green (Temporal Sighting tests + full suite + `bun run build` + biome clean over plan scope), which is sufficient to finalize. The EXACT verification steps are preserved verbatim below to roll into the consolidated end-of-phase UAT:

> **What was built:** the map-first pin-drop create flow (D-01/D-02), the observation-state Sighting marker layer (D-05/D-06), the Sightings rail + browse panel (D-07), the time + expiry + Group-attach create form (D-03/D-04/SIGHT-02), all wired into AppSidebar + GeoEditorView. Run `bun run seed` first so seeded 37522 events (varied start/end/expiry, some c-attached) are present.
>
> **How to verify:**
> 1. `bun run seed` then `bun dev`; open the app.
> 2. Confirm a **Sightings** tab appears in the left rail; clicking it shows the browse panel with a **New Sighting** button at top and seeded sightings listed (LIVE / Upcoming / past-date cues + "Fades in N days" countdowns).
> 3. Click **New Sighting** → cursor arms with the "Click the map to drop your sighting" overlay → click the map → a pin drops and the compact create form opens in the right info panel.
> 4. In the form: title "What did you see?" + description fields; "Observed now" with an **Adjust time** affordance; an expiry preset picker defaulting to **After 1 month**; an optional **Add to a Group** picker.
> 5. On the map, confirm Sighting markers are visually distinct from dataset dots; a **live-now** sighting is accent-highlighted (the one pop), upcoming is blue-outlined, past is dimmer; confirm an expired seed sighting is NOT shown.
> 6. (D-02) Use "Draw an area instead" → draw a small polygon → confirm the geometry is captured.
> 7. (SIGHT-02) Attach to a `schema` Group with a non-conforming payload → confirm an amber advisory warning appears AND the Publish button stays enabled.
> 8. Publish → confirm the new Sighting appears on the map + in the browse list.
>
> **Resume signal:** Type "approved" or describe issues.

## Next Plan Readiness

- **Plan 04 (reading / route / OG, D-08):** add `SightingViewPanel` (mount point reserved in `GeoEditorInfoPanel`), the `/sighting/:naddr` focus route in `useRouting` (add a `'sighting'` focusType + the share-form parse + the `buildRoutePath` arm; promote `viewSighting` to the store/`applyRouteState` at that point), the server OG route in `src/index.ts`, and the `src/lib/og/` `fetchSightingOGData` (with its OWN NIP-40 expiry check — the 5th SIGHT-03 read path, Pitfall P-1). The SIGHT-04 comment/react target-union widening (`CommentsPanel`/`useGeoComments`/`useGeoReactions`) is also Plan 04.
- No blockers. The data layer (Plan 02) and the authoring+discovery+map surfaces (this plan) are complete and green; Plan 04 is purely the reading/share surface.

## Self-Check: PASSED

- All 3 created files present on disk (`SightingEditorPanel.tsx`, `SightingsPanel.tsx`, `useSightingEditor.ts`); 8 modified files updated.
- All 3 task commits present in git log: `1cfcf3f` (Task 1), `826b615` (Task 2), `2d3531a` (Task 3).

---
*Phase: 11-temporal-sighting*
*Completed: 2026-06-28*
