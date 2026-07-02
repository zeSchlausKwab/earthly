---
status: diagnosed
phase: 13-cross-cutting
source: [13-01-SUMMARY.md, 13-02-SUMMARY.md, 13-03-SUMMARY.md, 13-04-SUMMARY.md]
started: 2026-07-02T13:50:00Z
updated: 2026-07-02T14:20:00Z
---

## Current Test

[testing paused — 1 item blocked, 5 issues to diagnose]

## Tests

### 1. Beacon Comments (parity)
expected: Open a live beacon's view panel. A full comments section appears below the details (identical to Story/Sighting), with the old Phase-12 "comments deferred" note gone. Posting a comment adds it to the thread.
result: pass

### 2. Beacon Share Link
expected: On a live beacon, click "Copy share link" / Share. Opening that link (new tab) opens the beacon — no "No share route available for this item" error. URL is a /beacon/... path.
result: issue
reported: "http://localhost:3000/#/beacons/beacon/naddr1qvzqqqyjjypzqjsfzm5z0fzlluvj3mfn7hyxr435wsmwstgapl0q7pv4qpypvmflqq25u5zsfdp9vmnj2e35ger9fcex572cv3m4yl2laun -- One problem is when i land there fresh i get the intro/tour dialogs. Also im still not focusing on the beacon in inspect - instead im seeing the beacon list"
severity: major

### 3. Beacon Comment Deep-Link
expected: Share a specific comment on a beacon, then open that link. The beacon opens AND that specific comment is focused/scrolled-to/highlighted (not just the top of the thread).
result: issue
reported: "here im landing on the beacon list too"
severity: major

### 4. All-Kinds Share Regression
expected: Share links for Story, Group, Sighting, a dataset (geoevent), and a map context still resolve correctly — each opens the right entity, unchanged from before this phase (URL shapes preserved).
result: pass
note: "User confirmed other kinds work — isolates the deep-link bug to the beacon Copy-share-link builder only."

### 5. Add Beacon / Sighting to Map Stack
expected: Beacon and Sighting view panels (and their rail rows) show an "Add to map stack" button. Clicking it adds that entity as a Map Stack entry (a toast confirms), and it stays visible on the map via the stack.
result: issue
reported: "no such button (screenshot: beacon rail row 'Untitled' LIVE shows only locate + inspect icons; no Add-to-map-stack button. Map Stack panel empty '0/0 visible / No map stack entries' though the live beacon renders on the map. Beacon inspect view panel unreachable due to the Test-2/3 doubled-prefix routing bug — URL localhost:3000/beacons/beacon/naddr...)"
severity: major

### 6. Aggregate Layer Toggle
expected: MapStackPanel shows "Sightings" and "Live beacons" rows pinned at the TOP (above datasets/contexts). Toggling a row's visibility off removes that whole layer from the map; toggling back on restores it.
result: issue
reported: "no such button and no way to put a sighting to the mapstack (screenshot on /sightings: sightings render on the map + list is populated, but Map Stack panel shows '0/0 visible / No map stack entries' — no aggregate Sightings/Live beacons rows exist to toggle; sighting rows have heart/bolt/share/comment/locate/inspect icons but no add-to-map-stack)"
severity: major

### 7. Cold-Start Browse Defaults
expected: Load a fresh Browse view (no shared/deep link). The Map Stack already contains both aggregate layers ("Sightings" + "Live beacons"), visible/on by default — so sightings and live beacons show without any manual step. They are removable/toggleable.
result: issue
reported: "no pass"
severity: major

### 8. Deep-Link Isolate-Solo
expected: Open a beacon (or sighting) via a share/deep link. Only THAT entity renders on the map — the aggregate layers and other pins are suppressed while it's isolated, so the shared view shows exactly what was shared.
result: pass

### 9. Expiry Auto-Remove
expected: A pinned individual sighting/beacon entry disappears from the Map Stack once its entity expires (or drops from the live subscription) — no leftover "ended"/tombstone row remains.
result: blocked
blocked_by: other
reason: "Cannot create a pinned individual stack entry to age out — the add-to-map-stack button (Test 5) is missing. Re-test after the Test 5/6/7 Map Stack UI fixes land."

## Summary

total: 9
passed: 3
issues: 5
pending: 0
skipped: 0
blocked: 1

## Gaps

<!-- YAML format for plan-phase --gaps consumption -->
- truth: "Opening a beacon share link opens/focuses that specific beacon in inspect (no tour dialogs on a fresh deep-link land)"
  status: failed
  reason: "User reported: share URL http://localhost:3000/#/beacons/beacon/naddr1qvzqqqyjjypzqjsfzm5z0fzlluvj3mfn7hyxr435wsmwstgapl0q7pv4qpypvmflqq25u5zsfdp9vmnj2e35ger9fcex572cv3m4yl2laun landed on the beacon LIST (sidebar view 'beacons'), not the beacon inspect panel; also got the intro/tour dialogs on fresh land. URL is doubled: /#/beacons/beacon/naddr — 'beacons' (sidebar view) prefixed before the 'beacon/naddr' share path, so the parser matches the isSidebarViewMode tail instead of SHARE_ROUTES.beacon."
  severity: major
  test: 2
  root_cause: "BeaconViewPanel.handleCopyShareLink (src/components/info-panel/BeaconViewPanel.tsx:191) is a SECOND, legacy beacon-share emitter that hand-builds the URL as `${origin}/#/beacons/beacon/${naddr}` — baking in a doubled prefix (the plural sidebar-view segment `beacons/` prepended before the singular share segment `beacon/`) plus the legacy `#/` hash form (WR-01). On open, upgradeLegacyHashRoute rewrites it to `/beacons/beacon/naddr`; parsePathSegments sees `first='beacons'`, which is a valid isSidebarViewMode but NOT a SHARE_ROUTES key, so it takes the sidebar-tail branch (useRouting.ts:205-215) and FORCES sidebarView:'beacons' (the LIST) instead of matching SHARE_ROUTES.beacon (the tested `/beacon/:naddr` share form). Beacon-only because every other kind's Share button routes through the canonical GeoSocialActions.buildSharePath→getEntitySharePath→handleShare pipeline (emits clean single-prefix `/<kind>/:naddr`); BeaconViewPanel is the only panel with a bespoke share string that bypasses it. Phase-13 CR-02 (b6492c3) fixed getEntitySharePath so the CANONICAL beacon Share button is correct — but this separate legacy builder (flagged WR-01, deferred, never fixed) is the button the UAT user clicked."
  artifacts: [src/components/info-panel/BeaconViewPanel.tsx:177-197]
  missing: ["BeaconViewPanel.handleCopyShareLink must route through the canonical buildSharePath/getEntitySharePath pipeline (or emit the clean single-prefix `/beacon/${naddr}` path directly) instead of the hand-built `/#/beacons/beacon/${naddr}` string", "SEPARATE independent cause behind the same 'tour dialogs on fresh land' sub-symptom: TourManager auto-start (src/features/tour/TourManager.tsx:13-18, mounted unconditionally in src/App.tsx:15) fires 800ms after mount gated ONLY on !hasSeenTour (localStorage 'earthly-tour-seen'); it is route-blind and never checks for a deep-link/shared route. Add a deep-link suppression guard so startTour() is skipped when the initial URL is a shared/deep-linked route (e.g. parseLocation().focusType !== 'none', a contextNaddr, or a ?ms= param). Independent of the URL bug — fixing the share URL does NOT stop the tour."]
  debug_session: ".planning/debug/beacon-share-url-doubled-prefix.md (URL) + .planning/debug/tour-on-fresh-deeplink.md (tour)"
- truth: "Opening a beacon comment deep-link opens the beacon and focuses that comment"
  status: failed
  reason: "User reported: here im landing on the beacon list too — same doubled-prefix deep-link routing failure as Test 2 (/#/beacons/beacon/naddr/comment/:id resolves to the 'beacons' sidebar list rather than SHARE_ROUTES.beacon focus + focusCommentId)."
  severity: major
  test: 3
  root_cause: "Same root cause as Test 2. BeaconViewPanel.tsx:191 hand-builds the doubled-prefix legacy URL `${origin}/#/beacons/beacon/${naddr}`. For a comment deep-link the full shape becomes `/beacons/beacon/naddr/comment/:id` → segments ['beacons','beacon','naddr','comment','id']. Because leading `beacons` is an isSidebarViewMode (not a SHARE_ROUTES key), parsePathSegments takes the sidebar-tail branch and pins sidebarView:'beacons' (the LIST). The naddr/commentId are shifted one segment right of the canonical `/beacon/:naddr/comment/:id` share form, so the intended SHARE_ROUTES.beacon dispatch (which drives handleInspectBeacon(beacon, route.commentId) → BeaconViewPanel.focusCommentId) never runs as a share-form deep link — the user lands on the beacon list, not the focused comment."
  artifacts: [src/components/info-panel/BeaconViewPanel.tsx:177-197]
  missing: ["Same fix as Test 2 — routing the beacon Copy-share-link through the canonical buildSharePath pipeline yields `/beacon/${naddr}/comment/${id}` for the comment case automatically (buildSharePath already emits the /comment/:id suffix for GEO_COMMENT_KIND targets)"]
  debug_session: ".planning/debug/beacon-share-url-doubled-prefix.md"
- truth: "Beacon/Sighting view panels and rail rows expose an 'Add to map stack' button that adds a stack entry"
  status: failed
  reason: "User reported: no such button. Screenshot shows the beacon rail row ('Untitled' LIVE) with only locate + inspect icons — no add-to-map-stack affordance. Map Stack panel empty despite the live beacon rendering on the map. View-panel button couldn't be checked because the deep-link routing bug (Test 2/3) lands on the beacon list, not the inspect panel. Likely an onAddToMapStack prop declared-but-not-forwarded through the AppSidebar/GeoEditorInfoPanel chain (the affordance is gated on the optional prop), OR the rail affordance not wired — same class of wiring gap Plan 04 found for beaconFocusCommentId."
  severity: major
  test: 5
  root_cause: "NOT A CODE DEFECT — stale HMR runtime. The `bun --hot src/index.ts` dev server (PID 95035) started 13:00:39, ~2.5h BEFORE the Plan-03/04 commits (45936be/a219548/c8d6df4/77071df landed 15:31–15:59). Bun --hot could not apply a change of this structural magnitude — a new module-scope export (deriveVisibleEntitiesFromStack), a DELETED extraMapBeacons useState (changes GeoEditorView's hook count/order → React fast-refresh bails), added useRef/useEffect/useMemo, props threaded through 4 files, switched useMapLayers call — so the live bundle kept the PRE-Phase-13 GeoEditorView (old always-on subscription render, no add-to-stack props). Source is correctly wired end-to-end (add-to-stack chain intact GeoEditorView L2464-2465 → AppSidebar → GeoEditorInfoPanel → view panels + rails; verified by read + 13/13 stackLayers/layerEntries tests pass). The build in dist/ (16:20) already has the correct code."
  artifacts: ["runtime-only: no source change — dev server PID 95035 predates the Plan-03/04 commits"]
  missing: ["Restart the dev server (kill the stale `bun --hot`/`bun dev` process, then `bun dev`) + hard browser reload, then RE-RUN UAT 5/6/7. Only a genuine code bug if a symptom persists after a clean restart."]
  debug_session: ".planning/debug/mapstack-ui-surface-absent.md"
- truth: "MapStackPanel shows top-pinned aggregate 'Sightings'/'Live beacons' rows whose toggle adds/removes the whole layer"
  status: failed
  reason: "User reported: no such button and no way to put a sighting to the mapstack. On /sightings the sightings render on the map and the list is populated, but the Map Stack panel is empty ('0/0 visible / No map stack entries') — the aggregate Sightings/Live beacons layer rows never appear, so there is nothing to toggle. CONTRADICTION for diagnosis: sightings/beacons still render on the map while the stack is empty — either the Plan-03 selectors are not actually gating render (useMapLayers still on the old always-on path) OR the aggregate entries exist in some state but MapStackPanel isn't rendering them. Whole Plan-04 Map Stack UI surface appears absent in the running app."
  severity: major
  test: 6
  root_cause: "Same stale-HMR-runtime cause as Test 5. Resolves the render-contradiction: the stale pre-Phase-13 bundle renders sightings/beacons via the OLD always-on subscription (so they show on the map), while MapStackPanel reads mapStackEntries directly from the store (empty, because the stale GeoEditorView never seeds aggregate entries) — hence '0/0 visible / No map stack entries'. Against committed source, deriveVisibleEntitiesFromStack returns [] for an empty stack, so an empty stack would render NOTHING — the observed render-with-empty-stack is impossible against committed code and only occurs with a divergent runtime."
  artifacts: ["runtime-only: no source change"]
  missing: ["Restart dev server + hard reload, re-run UAT 6."]
  debug_session: ".planning/debug/mapstack-ui-surface-absent.md"
- truth: "Cold-start Browse seeds both aggregate layers (Sightings + Live beacons), visible by default"
  status: failed
  reason: "User reported: no pass. A fresh Browse load does not seed the aggregate layer entries — Map Stack stays empty. Likely the SPEC §3.3 cold-start seeding effect (aggregateLayersSeededRef guard in GeoEditorView) never fires under the actual browse stance, or the seeded entries aren't reaching MapStackPanel. Same cluster as Test 5/6 (Plan-04 UI+lifecycle surface not active in the running app)."
  severity: major
  test: 7
  root_cause: "Same stale-HMR-runtime cause as Test 5/6. The cold-start seed effect (GeoEditorView L850-888) IS correctly gated (stance==='browse' [store default] + stackUrlHydrated when no ?ms=) and evaluates true on a plain Browse load in committed source — it just isn't in the running bundle. No guard-never-fires bug in source."
  artifacts: ["runtime-only: no source change"]
  missing: ["Restart dev server + hard reload, re-run UAT 7."]
  debug_session: ".planning/debug/mapstack-ui-surface-absent.md"
