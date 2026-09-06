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

## Panel scrolling and edit-chat follow-up — September 5

- Reproduced desktop Settings import clipping with a long dummy JSON paste and ordinary wheel scrolling. Utility and Browse/account surfaces now have a bounded scroll owner; existing nested catalog/editor scroll areas remain intact. The settings JSON field has its own capped height and an associated label.
- Reproduced and fixed Profile section access in a 500px-high desktop window. Tests check viewport hit-testing, not just forced scrolling from automated clicks.
- Map edit controls now expose **Chat about this map**, with a brief description of AI drawing/styling help. Phone drawing guidance also points to Ask. The entry opens the current Map's Thread without creating a working copy or dispatching a model request; target binding remains part of Send. A separate 320px phone check confirms the entry remains visible with a 44px touch target.
- Verification: **17 browser checks passed, 7 viewport skips**, covering Settings import, Profile scrolling, Browse/Me, mobile drawing sheets, draft retention, and separate route-bound Threads. Nine focused unit tests, AI-suite typecheck and a production build passed. Full repository typing remains at the unchanged **432-diagnostic** baseline.
- Verified against the already-running server on port 3000 using isolated browser storage and a deterministic provider. No relay reset, reseeding, real API credentials, or paid model calls.

## Publishing feedback and Thread placement — September 5

- Map publish errors (including guard/signing/delivery failures) now produce a ten-second error toast as well as the retained inline error. Story and Atlas publishing failures also toast with the actual reason and the matching retry action. Repeated attempts update one notification instead of stacking duplicates.
- The web publisher now checks relay acknowledgements: a resolved request containing only rejected/error responses is not success. Failed events are not inserted into the local published catalog. One accepted relay is sufficient; explicit relay-management calls still return individual results, and native durable-outbox enqueue/delivery behavior is unchanged.
- At desktop widths of 1100px and above, the panel icon in the Thread header moves the same mounted conversation to the left panel or right column. The covered left panel becomes inert. Closing restores the object/editor; moving preserves the composer, target, messages, and active run. The toolbar's Move action does not close a left Thread. Compact layouts keep a single Thread panel and omit an unavailable right-column action.
- The existing desktop toolbar and icons remain in use. The initial wrapping correction was superseded by the single-row overflow design below. Map navigation reserves the measured toolbar height, and portaled search results follow panel-induced reflow.
- Final new browser regression: **10 passed, 2 desktop-only skips**. Includes Map relay rejection followed by acknowledged retry, signing failures for Map/Story/Atlas on both viewports, a single AI request continuing across docking, close/reopen retention, and full control hit-testing at 1024/1100/1280/1440/1920px widths.
- Across the associated existing/new scenarios, **26 distinct browser checks passed**, with 8 intentional viewport skips. Two old small-window selectors were updated for the compact Thread label; one mobile provider-readiness timeout passed on an isolated rerun (no provider implementation changes). The final new regression batch was clean. **23 unit tests**, AI-suite typecheck, and a fresh production build passed. Repository-wide TypeScript still reports the same **432 diagnostic headers** after normalizing line numbers; the broader type gate remains open.
- Tests used isolated browser storage and a deterministic provider on the already-running port 3000 server. Relay rejection/retry was intercepted in the test browser; no relay reset, reseeding, external publication, or paid AI calls.

## Single-row toolbar correction — September 6

- Removed wrapping entirely. File, Draw and Edit retain their labeled menus; drawing and editing buttons expand when the **canvas** has room. Search becomes an icon-launched field in a constrained canvas. Audience/Publish and Thread remain pinned; publication and utility labels compact at the narrowest desktop layout.
- Secondary actions live in a grouped, labeled **More tools** menu: location lookup, measurements, callouts, OpenStreetMap import, map excerpts, sharing/image export, map settings and theme. These launch the existing components from a shared anchor, without remounting their state when the menu closes or panels resize. The phone dock is unchanged.
- Escape returns keyboard focus to More; clicking another field keeps that field's focus. Compact search retains empty/error/loading/results feedback and keyboard/click selection. Resetting the result highlight prevents reopening the search from immediately selecting a stale highlighted result.
- The Share workflow now uses the existing canonical route builder rather than generating legacy `/geoevent` or `/context` aliases.
- Verification: **26 distinct browser checks passed**, including a final clean 10-test desktop batch and the related desktop/mobile Browse, drawing, and control-layout checks; 14 intentional viewport skips in the broader batch. The toolbar remains one row and every visible control passes hit-testing at 13 window widths from 1024 to 2560px. Overflow keyboard/pointer focus, actual measurement, theme/location toggles, compact drawing, excerpt draw-and-reopen state, location search and canonical Share are covered. No page exceptions during the overflow workflow.
- The docking test exposed a setup race: its settings helper waited for *any* encrypted envelope, which could still contain defaults before the imported snapshot's debounced save. The helper now verifies the saved snapshot without returning decrypted credentials to diagnostics. The unchanged reload/active-run docking assertions then passed.
- Three layout-policy unit tests, AI-suite typecheck, and a fresh production build passed. Repository TypeScript remains at **432 unchanged diagnostic headers**; the broader release gates above remain open. No relay reset/reseed, external publication, or paid provider calls.

## Saved commits

- `0ef42e6`: progressive map rendering and basemap recovery.
- `4b68c7b`: shared live subscriptions and cache hydration.
- `6bd18db`: accumulated Story authoring and compact Margin migration.
- `619fae0`: bounded Browse with historical/direct-reference access and terminology cleanup.
