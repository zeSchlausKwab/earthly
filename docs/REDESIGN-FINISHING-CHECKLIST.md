# Redesign finishing pass

Implementation follows the September 5 UX/startup audit. This is one full migration, not a staged rollout. Preserve all existing features, icons, protocol/event kinds, comment formats, and draft/account isolation.

## Work in progress

- [x] Replace the full-map loading veil with progressive rendering and a lifecycle adapter.
- [x] Add retry and a no-basemap fallback without discarding the working copy.
- [x] Defer off-screen reader figures while reserving their layout space.
- [x] Repair Atlas reference routing and show names/authors instead of raw addresses.
- [x] Share compact Atlas/Story inspection headers and expose Atlas Edit/Enter actions.
- [x] Retain Details/Comments alongside a wide-screen Thread.
- [x] Verify the above in desktop and mobile scenarios, including failure and delayed tiles.
- [x] Start Story proposals at the editable narrative; collapse read-only metadata.
- [x] Improve phone Browse filters, touch targets and comment-composer discovery.
- [x] Make AI setup/recovery and contextual starting prompts explicit.
- [ ] Remove optional AI/editor/wallet/geometry work from initial loading; remeasure the actual production request graph.
- [ ] Bound initial discovery with pagination; preserve direct links, search, live updates and account isolation.
- [x] Share identical live requests and cache hydration; keep account filters and relay scopes separate.
- [ ] Finish first-use, navigation focus, transparency and user-facing terminology consistency.
- [ ] Run feature-preservation, deep-link/OG, unit, type and browser release gates; record remaining pre-existing debt separately from regressions.

## Validation notes

- September 5 checkpoint: 338 unit tests passed in 42 isolated files, plus the new disposed-editor regression and four shared-timeline tests. Isolation avoids unrelated global mock contamination.
- Browse/finishing scenarios: 13 passed, 3 viewport-specific skips. Atlas Inspect/Zoom/Enter/Leave, first-use Welcome, comment writing/focus, desktop content beside Thread, and phone Filters/Escape verified.
- Basemap recovery/delayed tiles: 4 passed. Phone drawing: 2 passed. Story edit entry: 4 passed. Story manual authoring/reload and Reader views: 6 passed after repairing Tiptap's disposed-instance reconnection and updating the progressive-figure expectation.
- Intermediate production measurement: 6,164,048 initial minified, uncompressed JavaScript bytes versus 7,591,726 at audit baseline (18.8% reduction). No initial model-discovery request or page exception in cold/warm/slow-CPU/basemap-failure samples. This is not deployed compressed transfer size, nor a repeated timing benchmark.
- Strict TypeScript remains a failing repository-wide gate (baseline: 434 diagnostics). Do not represent a successful build or focused tests as a green type gate.
- Server restored directly on port 3001 with the existing local relay data on 3334; no reset or reseed. Production measurements use a separate read-only preview.
