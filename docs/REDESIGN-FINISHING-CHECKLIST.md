# Redesign finishing pass

Implementation follows the September 5 UX/startup audit. This is one full migration, not a staged rollout. Preserve all existing features, icons, protocol/event kinds, comment formats, and draft/account isolation.

## Implementation checkpoint

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
- [x] Defer optional AI, rich-text editing, wallet panels, settings and audience-management surfaces; remeasure the actual production request graph.
- [x] Bound initial discovery with pagination; preserve direct links, search, live updates and account isolation.
- [x] Share identical live requests and cache hydration; keep account filters and relay scopes separate.
- [x] Finish first-use, navigation focus, transparency and user-facing terminology consistency.
- [x] Run focused feature-preservation, deep-link/OG, unit, type and desktop/phone browser checks; distinguish existing debt from regressions.
- [ ] Complete the broader milestone release gates: strict repository typing, remaining acceptance-matrix scenarios, and physical native-device verification. This checkpoint is not release certification.

## Loading contract and remaining optimization

- Ordinary Browse initially requests the latest 100 Maps, Stories and Atlases. **Load older** increases the window by 100. Growing windows avoid skipping events with tied timestamps; the shared EventStore deduplicates repeated results. Its local read stays unbounded so previously loaded or directly requested objects never disappear behind a page boundary.
- A route or retained public Map requests its exact author/address. Private Circle, nearby-session and working-copy identities never enter these public stack requests. Historical search, Favorites/Recent, alternate sorting and larger display limits explicitly widen discovery. Atlas/profile scopes retain complete historical reach, including child Atlases and foreign attachments.
- First use now presents a dismissible welcome, not a blocking directory. Discover and the guided tour remain available. Comments keep their audience-aware discussion model; Thread identifies the AI conversation and offers configuration/retry without filling the sheet with settings.
- The actual initial request graph excludes the AI runtime and Tiptap editing runtime. Wallet panels are deferred, but shared Cashu dependencies remain. Advanced geometry/Turf/JSTS also remains on the initial graph: geometry previews, manager operations and the authoring API currently have synchronous callers. Making that asynchronous is follow-up optimization requiring its own cancellation/history tests, not a prerequisite for removing the map loading veil. Do not claim all wallet/geometry code was removed from startup.

## Validation notes

- September 5 final focused gate: 349 tests passed in 46 isolated files; three additional catalog-vocabulary tests passed after updating stale fixtures. Isolation avoids unrelated global mock contamination. Separately, all 43 OG tests, four account-persistence tests and 58 chat-store tests passed.
- Browse/finishing scenarios: 13 passed, 3 viewport-specific skips. Atlas Inspect/Zoom/Enter/Leave, first-use Welcome, comment writing/focus, desktop content beside Thread, and phone Filters/Escape verified.
- Basemap recovery/delayed tiles: 4 passed. Phone drawing: 2 passed. Story edit entry: 4 passed. Story manual authoring/reload and Reader views: 6 passed after repairing Tiptap's disposed-instance reconnection and updating the progressive-figure expectation.
- Final broad browser regression batch: **29 passed, 7 intentional viewport skips**. Covers catalog paging/search and old deep links, map-route authentication/reload stability, Comments/replies/annotations, Thread setup/reopen, small-window control hit testing, half-height Browse, Create, and retained Story/Atlas presentation lifetime.
- Final workflow verification: **3 proposal tests passed**, covering Story acceptance/rejection/change requests, Map proposal preview/decisions, and a mobile-authored geometry change accepted by its owner and preserved after reload. Updated test actions follow Propose changes → Send proposal and the Publish dropdown; the removed Load copy/Proposals-tab selectors are no longer used. **18 smoke tests passed, 2 viewport skips**, covering Welcome/tour/Discover, retained Map/Story drafts, audience selection, Circles, Nearby and delivery.
- Fresh production build passed. Initial minified, uncompressed JavaScript measured **5,843,259 bytes versus 7,591,726 at baseline (23.0% reduction)**. No initial model-discovery request or page exception in cold/warm/slow-CPU/basemap-failure samples. This is not deployed compressed transfer size, nor a repeated timing benchmark.
- Single-sample shell/canvas appearance: cold **383 ms**, cached **113 ms**, 4× CPU **958 ms**, failed basemap **368 ms**. Recovery controls were visible by the failed-basemap observation at **487 ms**. A canvas element appearing does not prove useful tile rendering. Raw samples/screenshots: `/tmp/earthly-redesign-finish-evidence/` (temporary artifacts).
- Strict TypeScript remains a failing repository-wide gate: **432 diagnostics**, versus 434 at the earlier checkpoint; no new diagnostic messages after normalizing line positions. The missing line-splitting import and overly wide label-anchor return type were repaired. Do not represent a successful build or focused tests as a green type gate.
- Server restored directly on port 3001 with the existing local relay data on 3334; no reset or reseed. Production measurements use a separate read-only preview. Proposal acceptance tests add ordinary test fixtures only to the loopback relay; they do not publish to external relays.

## Saved commits

- `0ef42e6`: progressive map rendering and basemap recovery.
- `4b68c7b`: shared live subscriptions and cache hydration.
- `6bd18db`: accumulated Story authoring and compact Margin migration.
- `619fae0`: bounded Browse with historical/direct-reference access and terminology cleanup.
