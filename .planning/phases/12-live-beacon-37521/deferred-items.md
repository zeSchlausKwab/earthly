
## Plan 12-05 — pre-existing out-of-scope lint (NOT introduced)

- `src/components/GeoEditorInfoPanel.tsx:943` and `:996` — `lint/a11y/noLabelWithoutControl`
  on the contributor Group-attach `<label>` elements (the `context.coordinate` attach rows).
  These predate Plan 12-05 (present unchanged at HEAD; my beacon diff adds zero `<label>`s).
  Out of scope per the executor Scope Boundary rule (only auto-fix issues directly caused by
  the task's changes). The beacon-specific files are biome-clean.
