# Deferred Items — Phase 09 (Group/Topic 37518 slimmed)

## From Plan 03 execution

- `src/lib/group/noModMinimum.test.ts` (GROUP-08 RED baseline from Plan 01) remains RED
  after Plan 03. It pins `@/lib/group/noModMinimum` (kind→sig→mute gate, 50-cap, flipToClosed)
  which is NOT in Plan 03's `files_modified` scope. A later plan (06) implements it. Out of
  scope for Plan 03 — no action taken.

## Plan 04 — map-context consumer migration (for Plans 05/06)

The Group authoring surface (GroupEditorPanel + groups-columns) is Group-native, but
the following consumer sites STILL import from `@/features/contexts/*` / `@/lib/nostr/map-context`
and build `MapContext`-typed data. They migrate to `Group` / `useGroups` in Plan 06:

- `src/components/GeoDatasetsPanel.tsx` — imports `createContextColumns` / `ContextRowData` /
  `ContextColumnsContext` from `../features/contexts/contexts-columns`; builds `contextTableData`.
- `src/components/UserProfilePanel.tsx` — same `contexts-columns` import + `contextTableData`.
- `src/components/GeoEditorInfoPanel.tsx` — the context VIEW branch still renders
  `MapContextViewPanel` and the attach-to-context picker (lines ~684/739). The EDIT branch was
  repointed to `GroupEditorPanel` this plan; `onSaveContext`/`editingContext`/`mapContextEvents`
  remain `MapContext`-typed (the panel accepts/returns `MapContext` at its props boundary so the
  lifecycle is unchanged until Plan 06).
- `src/features/contexts/MapContextEditorPanel.tsx` + `contexts-columns.tsx` — left intact (not
  deleted); removal happens once all consumers are repointed (Plan 06).

Out-of-scope pre-existing lint (NOT Plan 04's changes), to clean opportunistically:
- `src/components/GeoEditorInfoPanel.tsx:686,739` — `lint/a11y/noLabelWithoutControl` on the
  legacy attach-context `<label>` rows (pre-existing; in the unmodified view branch).

## Plan 05 — out-of-scope pre-existing biome errors (logged, not fixed)

- `src/components/GeoEditorInfoPanel.tsx`: 2 × `lint/a11y/noLabelWithoutControl` in the LEGACY "Attached contexts" section (the per-context `<label>` rows). Pre-existing on master (confirmed via `git stash` baseline — present before Plan 05's changes), in the legacy MapContext attach UI that Plan 05 does NOT touch. Out of scope per the executor scope boundary. The legacy attach section is slated for removal/replacement during the map-context consumer-migration tail; fix there.
