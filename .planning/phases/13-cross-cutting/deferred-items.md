# Phase 13 — Deferred Items (out-of-scope discoveries)

Logged by the executor per the SCOPE BOUNDARY rule. NOT fixed — pre-existing,
unrelated to the current task's changes.

## From Plan 13-02 (Task 2)

- **`src/components/GeoEditorInfoPanel.tsx:969` — `lint/a11y/noLabelWithoutControl`**
  A `<label>` (unattached-context row) is not associated with an input. Pre-existing
  since commit `25ec4ec4` (2026-03-02). My Task-2 edit only added a `beaconFocusCommentId`
  prop + BeaconViewPanel forward (hunks at lines ~155/248/707/722); it does not touch
  this label. Out of scope.
- **`src/components/GeoEditorInfoPanel.tsx:1022` — `lint/a11y/noLabelWithoutControl`**
  Same rule, recent-unattached-context row. Pre-existing since commit `3510c175`
  (2026-03-01). Out of scope.

These block a whole-file `biome check` on GeoEditorInfoPanel.tsx but not on the two
plan-specified Task-2 files (`useBeaconController.ts`, `GeoEditorView.tsx`), which are
clean. The lines I added to GeoEditorInfoPanel.tsx pass biome.

## From Plan 13-04 (Task 2)

- **`src/components/AppSidebar.tsx:337` — `lint/correctness/noUnusedFunctionParameters`
  (`onClearBeaconView`)** Pre-existing (confirmed: the warning persists on the file with
  my changes stashed). My Task-2 edits added `onAddBeaconToMapStack`/`onAddSightingToMapStack`/
  `beaconFocusCommentId` threading; they do not touch `onClearBeaconView`. Out of scope.
- The two `GeoEditorInfoPanel.tsx` `noLabelWithoutControl` errors (now at lines ~977/1030
  after this plan's prop additions shifted line numbers) remain the same pre-existing
  unattached-context labels logged above — my Task-2 edits are at the interface + the
  BeaconViewPanel/SightingViewPanel `onAddToMapStack` wiring (hunks ~175/199/259/271/725/750),
  not those labels.
