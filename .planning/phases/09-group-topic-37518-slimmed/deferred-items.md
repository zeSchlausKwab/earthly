# Deferred Items — Phase 09 (Group/Topic 37518 slimmed)

## From Plan 03 execution

- `src/lib/group/noModMinimum.test.ts` (GROUP-08 RED baseline from Plan 01) remains RED
  after Plan 03. It pins `@/lib/group/noModMinimum` (kind→sig→mute gate, 50-cap, flipToClosed)
  which is NOT in Plan 03's `files_modified` scope. A later plan (06) implements it. Out of
  scope for Plan 03 — no action taken.
