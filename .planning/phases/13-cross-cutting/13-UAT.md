---
status: partial
phase: 13-cross-cutting
source: [13-01-SUMMARY.md, 13-02-SUMMARY.md, 13-03-SUMMARY.md, 13-04-SUMMARY.md]
started: 2026-07-02T13:50:00Z
updated: 2026-07-02T14:08:00Z
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
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
- truth: "Opening a beacon comment deep-link opens the beacon and focuses that comment"
  status: failed
  reason: "User reported: here im landing on the beacon list too — same doubled-prefix deep-link routing failure as Test 2 (/#/beacons/beacon/naddr/comment/:id resolves to the 'beacons' sidebar list rather than SHARE_ROUTES.beacon focus + focusCommentId)."
  severity: major
  test: 3
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
- truth: "Beacon/Sighting view panels and rail rows expose an 'Add to map stack' button that adds a stack entry"
  status: failed
  reason: "User reported: no such button. Screenshot shows the beacon rail row ('Untitled' LIVE) with only locate + inspect icons — no add-to-map-stack affordance. Map Stack panel empty despite the live beacon rendering on the map. View-panel button couldn't be checked because the deep-link routing bug (Test 2/3) lands on the beacon list, not the inspect panel. Likely an onAddToMapStack prop declared-but-not-forwarded through the AppSidebar/GeoEditorInfoPanel chain (the affordance is gated on the optional prop), OR the rail affordance not wired — same class of wiring gap Plan 04 found for beaconFocusCommentId."
  severity: major
  test: 5
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
- truth: "MapStackPanel shows top-pinned aggregate 'Sightings'/'Live beacons' rows whose toggle adds/removes the whole layer"
  status: failed
  reason: "User reported: no such button and no way to put a sighting to the mapstack. On /sightings the sightings render on the map and the list is populated, but the Map Stack panel is empty ('0/0 visible / No map stack entries') — the aggregate Sightings/Live beacons layer rows never appear, so there is nothing to toggle. CONTRADICTION for diagnosis: sightings/beacons still render on the map while the stack is empty — either the Plan-03 selectors are not actually gating render (useMapLayers still on the old always-on path) OR the aggregate entries exist in some state but MapStackPanel isn't rendering them. Whole Plan-04 Map Stack UI surface appears absent in the running app."
  severity: major
  test: 6
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
- truth: "Cold-start Browse seeds both aggregate layers (Sightings + Live beacons), visible by default"
  status: failed
  reason: "User reported: no pass. A fresh Browse load does not seed the aggregate layer entries — Map Stack stays empty. Likely the SPEC §3.3 cold-start seeding effect (aggregateLayersSeededRef guard in GeoEditorView) never fires under the actual browse stance, or the seeded entries aren't reaching MapStackPanel. Same cluster as Test 5/6 (Plan-04 UI+lifecycle surface not active in the running app)."
  severity: major
  test: 7
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
