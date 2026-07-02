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
