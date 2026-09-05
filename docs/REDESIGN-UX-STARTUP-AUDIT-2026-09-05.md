# Redesign, UX and startup audit — 2026-09-05

## Verdict

The redesign's structural foundation is implemented. The remaining work is not another layout rewrite: it is finishing inconsistent entity flows, making first-use states understandable, reducing startup work, and completing the release acceptance gates.

Map inspection is the strongest reference implementation. Atlas inspection still exposes the older product model, and Story inspection does not yet follow the same header grammar. There is at least one confirmed functional bug in the Atlas flow, so this is not only a styling pass.

**Recommendation:** keep the new route/layout architecture, MapLibre, existing icons and drawing tools. Replace the map wrapper's loading/readiness policy; split expensive optional features out of initial loading; finish the shared inspection experience before declaring the whole migration complete. These are implementation work packages, not partial rollouts or feature flags.

This audit changes no product behavior. Browser experiments and generated evidence are excluded from version control.

## Scope and evidence

- Compared the current application with the migration contract and sketch behavior.
- Exercised the local application on port 3001 at desktop 1440×900 and phone 390×844, using anonymous and seeded local-owner sessions.
- Inspected Browse, Map/Atlas/Story inspection, Comments, Thread, Me, first-visit onboarding, drawing entry, the WW1 reader, and Story proposal entry.
- Used repository AI-suite actions and diagnostics. Checked keyboard navigation and map-instance lifetime across route transitions.
- Built a fresh minified production bundle and served it through a temporary read-only loopback preview with the repository's static-asset cache headers. Compared fresh-context loading, cached reload, 4× CPU throttling, and deliberately blocked basemap requests.
- Published nothing, changed no accounts on external services, and did not modify the existing development servers or relay.

Evidence is under [/tmp/earthly-redesign-review-20260905](/tmp/earthly-redesign-review-20260905). These screenshots and JSON captures are temporary local artifacts, not durable release evidence. The reusable audit conclusions are recorded here.

This is an expert walkthrough and diagnostic sampling, **not a novice usability study, full accessibility certification, or statistically representative performance benchmark**. External relays, model discovery and image hosts were live dependencies. Failed/aborted network requests are distinguished from application exceptions.

## How far along are we?

| Area | Current evidence | Remaining work |
| --- | --- | --- |
| Routes and persistent map | Browse and entity/tab transitions work; the main map remains mounted across the tested transitions. The reported maximum-update-depth error did not recur. | Complete the full deep-link, Back/Forward, compatibility and Bun/OG acceptance matrix; today's browser walkthrough does not certify all of it. |
| Desktop/phone shell | Browse, Me, half-height phone sheets, transparent rows, drawing entry and retained map context are present. | Phone density and touch targets; first-visit clarity; consistent section sizing. |
| Map inspection | Compact header, proposal/fork entry, Details/Comments/Thread, map visibility and feature information are present. | Preserve Details when Thread opens beside it; make the phone comment composer easier to discover. |
| Story presentation and authoring | WW1 fixture, inline views/figures and the direct pencil-to-proposal editor are present. Prior focused verification covers view serialization and deterministic AI tool authoring. | Shared inspector header; body-first proposal entry; defer off-screen figure maps. A live-model quality evaluation was not performed today. |
| Atlases | Browse, inspection, curated/community sections and scope routing exist. | Complete the user-facing Atlas migration; fix pinned-reference actions; expose the intended owner/lens actions consistently. |
| Comments and AI | Both surfaces exist, with transparent Comments and a more compact Thread header. | Clear shared discussion versus personal AI distinction, model-error recovery and contextual empty states. |
| Release readiness | Fresh production build passes; no page exceptions in the successful walkthroughs. | Full feature-preservation testing and existing type/test-isolation debt remain open. |

There is no defensible completion percentage without finishing the acceptance matrix. We are substantially through implementation, but not yet at a release-ready consistency/verification checkpoint.

## Prioritized UX findings

### 1. Atlas pinned-map actions are broken — high priority

**Reproduced:** in Vienna Heritage, both a pinned reference's **Inspect** and **Zoom** leave the route and camera unchanged and log “Could not find dataset for address”.

Both callbacks use `onMentionZoomTo` with a raw `kind:pubkey:identifier` coordinate. That resolver accepts a geographic coordinate or an `naddr`, not this address representation. Even after conversion, wiring Inspect to Zoom would still violate the labels' different promises.

- Resolve addresses through one entity resolver that understands both representations.
- Inspect should open the Map's inspection route; Zoom should frame its geometry without replacing the current inspection.
- Render a title, author and thumbnail rather than a raw protocol address. Keep the raw address in secondary details/copy actions.

Sources: [GroupViewPanel.tsx](/Users/schlaus/workspace/earthly/src/components/info-panel/GroupViewPanel.tsx:272), [useMentionActions.ts](/Users/schlaus/workspace/earthly/src/features/geo-editor/hooks/useMentionActions.ts:42), [CuratedLane.tsx](/Users/schlaus/workspace/earthly/src/components/info-panel/group-lane/CuratedLane.tsx:122). Evidence: [Atlas action capture](/tmp/earthly-redesign-review-20260905/atlas-actions.json).

### 2. Finish one inspection grammar for Map, Story and Atlas — high priority

Atlas currently repeats its title and exposes **Governance: closed**, **Canonical references**, and raw addresses. Browse adds **TAXONOMY / NONE / CLOSED**. These require knowledge of implementation concepts that the redesign intentionally translates into ordinary language.

Story inspection also repeats its title. Its second title is squeezed into a narrow column beside Read/Present/Zoom/Edit, wrapping a normal title over many lines. Map inspection already demonstrates a better arrangement.

Use the shared compact header and consistent placement of author, status, social actions and primary action. For Atlases, prefer **Who can add maps**, **Pinned by the author**, and **Added by others**. Put protocol/configuration detail behind disclosure. Owner Edit should be available in inspection, not only through a Browse overflow menu. The inspected Atlas page also lacks the explicit **Enter atlas** action promised by the contract; existing scope routing is not a substitute for a discoverable entry/leave flow.

Sources: [GroupViewPanel.tsx](/Users/schlaus/workspace/earthly/src/components/info-panel/GroupViewPanel.tsx:192), [contexts-columns.tsx](/Users/schlaus/workspace/earthly/src/features/contexts/contexts-columns.tsx), [header/action contract](/Users/schlaus/workspace/earthly/docs/MAP-WITH-A-MARGIN-SPEC.md:150). Evidence: [Atlas](/tmp/earthly-redesign-review-20260905/desktop-inspect-atlas.png), [Story](/tmp/earthly-redesign-review-20260905/desktop-inspect-story.png).

### 3. Desktop Thread should not empty the left pane — high priority

Opening Thread in a wide layout produces three columns, but the left details area becomes almost entirely blank except for a notice explaining that Thread is on the right. This wastes space and removes exactly the material the user may want to discuss.

Keep Details or Comments visible on the left while Thread is pulled out. The contract already specifies this. Phone Thread can continue replacing the details body. Provide the corresponding dock/pull-out controls without creating a second navigation hierarchy.

Source: [ObjectTabs.tsx](/Users/schlaus/workspace/earthly/src/components/info-panel/ObjectTabs.tsx:58). Evidence: [desktop Thread](/tmp/earthly-redesign-review-20260905/desktop-thread-settled.png).

### 4. Phone compactness should come from fewer rows, not tiny controls — medium/high priority

The required half-height Browse sheet is working. However, tabs, scope/favorites controls, filtering, sorting and the count/hint row consume much of that space before the first result. At 390px, People is clipped and the sort selection is truncated. Several visible controls are small: the All/Favorites/Recent group is about 21px high, sorting 24px, and the create button 30×28px.

- Keep the initial half-height Browse behavior.
- Consolidate secondary filters into a clearly labelled filter menu, showing active-filter count.
- Preserve legible sort values and make overflow in the entity tabs apparent.
- Give important phone actions larger hit areas; roughly 44px is a useful comfort target, not a claim that every smaller control necessarily fails accessibility requirements.

For Comments, the initial half-height state shows the entity header, tabs, sorting and empty state, with only the beginning of the composer at the bottom. Posting is reachable after expanding/scrolling, but the initial view does not make that obvious. Expand on composer focus or use a compact tab-specific header and a persistent “Write a comment” affordance.

Evidence: [phone Browse](/tmp/earthly-redesign-review-20260905/mobile-browse-maps.png), [signed-in Comments](/tmp/earthly-redesign-review-20260905/mobile-signed-in-comments.png). The automated geometry audit also counts controls clipped by scroll containers, so its raw totals must not be interpreted as a count of accessibility violations.

### 5. Make first-use AI setup and intent explicit — medium/high priority

The new Thread header is considerably more compact. In this environment, however, the model endpoint returned 404, leaving a small warning/retry affordance, a disabled “Select a model…” composer, and a long list of generic example prompts. The user needs a clear route to a working provider/model, not only an error retry.

- Show one prominent **Choose a model / Configure AI** action when no working model is available; retain retry for transient failures.
- Explain **Comments = discussion with this entity's audience** and **Thread = your AI conversation** without changing the underlying feature split. Do not label restricted-audience comments public or imply that AI requests never reach the configured provider.
- Start with two or three short prompts relevant to the current entity, rather than an extensive generic mapping catalogue.
- Keep advanced safety, provider and usage settings collapsible; keep the active safety level visible.

The observed model-host 404 is an external dependency/configuration failure, not evidence that the Story AI tool contract itself is broken. Model discovery was requested even on the initial page before opening Thread, making this a startup concern as well.

Evidence: [phone Thread](/tmp/earthly-redesign-review-20260905/mobile-thread-settled.png), [production network capture](/tmp/earthly-redesign-review-20260905/perf-production-cold.json).

### 6. Story proposals should begin at the editable narrative — medium priority

The pencil now correctly enters the normal editor instead of the old dialog. But the first screen is dominated by Cover details that are read-only for proposals. On a phone, the editable narrative is below the fold.

Collapse cover/opening information into a read-only summary for proposal mode, bring the narrative first, and focus the writing surface. Keep the existing limitation: proposals carry Markdown, so this recommendation does not imply expanding the protocol to propose cover or opening-view changes.

Source: [StoryEditorPanel.tsx](/Users/schlaus/workspace/earthly/src/components/info-panel/StoryEditorPanel.tsx:1167). Evidence: [proposal editor](/tmp/earthly-redesign-review-20260905/desktop-story-editor.png).

### 7. Smaller consistency and accessibility follow-ups

- Entity opening leaves focus on the document body in the recorded transitions. Move focus to the new heading or a suitable first control for user-initiated navigation. The tested desktop tab sequence had named, in-viewport stops; that is not a full keyboard/screen-reader audit.
- First visit opens a large Discover dialog over the phone map. It preserves an existing feature, but introduces a second browsing experience immediately. Consider a dismissible welcome with clear Browse/Create/Tour choices rather than requiring users to interpret another directory first.
- Use **On the map** consistently in user-facing entry points where some surfaces still say Shelf; retain the composition functionality.
- Continue transparency/input treatment consistently through the edit forms, without reducing text contrast or making focused fields ambiguous.

## Startup and loading

### Measured production preview

One sample per condition, on the same desktop host. Values are elapsed time from navigation. This is a fresh minified build on loopback, not deployed CDN performance or a physical low-end phone benchmark. CPU throttling is emulated; network throttling was not applied.

| Condition | Application shell/canvas element appears | Full-map loading veil disappears |
| --- | ---: | ---: |
| Fresh browser context | 0.52s | 1.75s |
| Cached reload | 0.15s | 0.97s |
| Fresh context, 4× CPU slowdown | 1.17s | 5.69s |
| Basemap service deliberately blocked | 0.52s | Did not disappear during the 12-second observation; no recovery action |

Shell/canvas appearance is not proof of useful rendered map content. First Contentful Paint can also be the boot screen, so it is not the right standalone success metric here.

The development run provides additional MapLibre event instrumentation: first map render at 1.51s, veil removal at 2.17s. It demonstrates the visual delay after rendering has begun; it is not substituted for production performance.

### A. Replace the loading policy, not all map UI

The local shadcn-style wrapper renders a blurred full-map loader until MapLibre's `load` event. The overlay has `pointer-events: none`: it obscures the view, but does not itself intercept clicks. The wrapper has no corresponding user-facing recovery path when basemap loading fails.

Its shared readiness value also combines full load with a debounced `styledata` flag. This conflates map creation, readiness for adding application layers, and completed visible basemap loading. MapLibre documents `load` as occurring after necessary resources and the first visually complete rendering. [MapLibre event documentation](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapEventType/)

Recommended implementation:

1. Keep map creation independent of basemap completion. The drawing editor already follows this principle; preserve that improvement.
2. Attach/re-attach owned sources and layers at the appropriate style lifecycle boundary, rather than waiting for every visible basemap tile.
3. Allow progressive map painting. Use a small status indicator for outstanding basemap work instead of a full-screen veil.
4. Handle failure with a visible retry and a usable no-basemap/background-style fallback, preserving authored geometry, the current route and drafts.
5. Keep the existing controls and map integration API where useful. Extract a small Earthly-owned lifecycle adapter rather than replacing 2,000 lines of map controls/popups/markers unnecessarily.

Sources: [map wrapper](/Users/schlaus/workspace/earthly/src/components/ui/map.tsx:164), [readiness wiring](/Users/schlaus/workspace/earthly/src/components/ui/map.tsx:342), [editor initialization](/Users/schlaus/workspace/earthly/src/features/geo-editor/components/Editor.tsx:14).

### B. Initial JavaScript is a larger, separate problem

The fresh production page requested **50 JavaScript resources totalling 7,591,726 bytes of minified, uncompressed body content** by the time the veil disappeared. Gzipping those same files locally totals about **2.26 MB**. That is a compression estimate, not a measurement of deployed transfer size; the preview served uncompressed assets and deployed proxy compression was not checked.

This is the actual initial request set, not the sum of every output file in the build. Source maps show:

| Initial chunk | Minified size | Notable included modules |
| --- | ---: | --- |
| Largest shared chunk | 2.37 MB | MapLibre, Tiptap/ProseMirror, Cashu and shared application dependencies |
| Main editor/application chunk | 2.29 MB | GeoEditorView, ChatPanel/store/tools, mobile panels, table and editor code |
| Geometry chunk | 0.53 MB | Turf/JSTS and related geometry utilities |

The shared chunk's source list is not a byte-accurate allocation between those libraries. It does establish that optional editor/wallet functionality enters the initial graph. Additional initial chunks include model/ContextVM clients, schema tooling and another Cashu module. There are nested copies of Nostr/crypto and Tiptap dependencies worth investigating for compatible deduplication, not blindly forcing to a single version.

Prioritize real import boundaries around Thread/AI, rich-text editors and comments, wallet/private-audience management, import/export and advanced geometry. Keep the basic shell, requested entity, map and current working copy on the critical path. Existing route-level lazy imports alone do not separate these eagerly imported features. Load only when needed, then prefetch after the primary interface is ready where appropriate. [Web performance guidance on code splitting](https://web.dev/articles/reduce-javascript-payloads-with-code-splitting)

At 4× CPU throttling the startup observation contained 20 long tasks totalling about 3 seconds. This supports investigating main-thread work; the sample alone does not attribute all of that time to JavaScript parsing rather than React, map rendering or event processing.

Sources: [frontend bootstrap](/Users/schlaus/workspace/earthly/src/frontend.tsx), [GeoEditorView.tsx](/Users/schlaus/workspace/earthly/src/features/geo-editor/GeoEditorView.tsx), [AppSidebar.tsx](/Users/schlaus/workspace/earthly/src/components/AppSidebar.tsx). Raw evidence: [production cold load](/tmp/earthly-redesign-review-20260905/perf-production-cold.json).

### C. Defer off-screen Story maps

Opening the WW1 reader mounts **four map canvases**: the main map plus three inline figures, including figures well below the viewport. The main map was otherwise stable across tested entity transitions, so this is distinct from a route-remount bug.

Initialize figures when they approach the viewport, reserving their dimensions and retaining captions. Consider freezing/releasing distant figures if memory measurements justify it. This preserves the view-block feature and needs no new image publication or protocol convention.

Source: [ReaderFigure](/Users/schlaus/workspace/earthly/src/pages/read/ReadRoute.tsx:132). Evidence: [phone reader capture](/tmp/earthly-redesign-review-20260905/mobile-reader.json).

### D. Bound and prioritize initial data work

The main editor starts broad Map, Atlas, Story and live-content subscriptions. The default Map filter has no application-specified limit. Event-store deduplication and stable request keys already help, but they do not bound how much initial content is requested or processed. Atlas data also has multiple hook consumers; verify subscription sharing before claiming duplicate network traffic.

Load the directly requested object and its dependencies first, bound the initial Browse page, paginate older results, and defer unopened-panel enrichment. Share compatible cached timelines. Preserve live updates, unread badges, search reach and account isolation rather than merely unmounting everything hidden.

Sources: [useGeoDatasets.ts](/Users/schlaus/workspace/earthly/src/lib/hooks/useGeoDatasets.ts:27), [timeline hooks](/Users/schlaus/workspace/earthly/src/lib/nostr/hooks.ts:105).

### E. Lower-priority delivery checks

- Existing hashed-asset immutable caching is useful; preserve it and verify Brotli/gzip at the deployed edge.
- Inspect the Google Fonts stylesheet/weight set; consider self-hosting critical weights and loading editorial fonts only where required. This was not established as the largest bottleneck.
- Model discovery and optional content failures should not make basic map browsing appear broken or consume critical startup work.
- Native account-persistence startup and real-device memory/thermal behavior were not measured. Do not remove identity initialization barriers without checking account/draft isolation.

## Recommended next implementation order

1. **Startup correctness:** remove the visual loading gate, separate map/style/content readiness, and add basemap failure recovery. Verify drawing, authored layers and style switching under delayed/failed tiles.
2. **Finish entity behavior:** repair Atlas Inspect/Zoom, apply the shared header to Atlas/Story, expose Atlas actions, retain desktop Details alongside Thread.
3. **Reduce unnecessary startup work:** lazy-load off-screen figures and optional editors/AI/wallet/geometry modules; bound initial subscriptions. Measure the actual request set again after each change.
4. **Phone and first-use pass:** consolidate Browse filters, improve hit areas, surface the Comments composer, make AI setup explicit, start Story proposals at the narrative, and restore navigation focus.
5. **Release verification:** run the complete feature-preservation matrix across desktop/phone, owner/contributor, refresh/back/forward, read/edit/propose, comments, audiences and OG/deep links. No partial rollout is implied.

The spec's last recorded release gates still include 434 strict TypeScript diagnostics, old E2E flows needing migration, and monolithic-test mock isolation. These counts were **not rerun today** and must not be presented as current green checks. Today's successful production build and focused walkthrough do not replace those gates.

For the next pass, record repeated production samples for shell readiness, first useful map frame, first usable drawing action, initial JS bytes and reader canvas count. Include delayed and failed basemaps as correctness tests, not just benchmark cases.
