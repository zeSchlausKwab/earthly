# Component communication, performance, and simplification audit

Date: 2026-09-03 · Scope: `src/` as on `master` (the sketch branch has not touched it)
Method: counted with grep/awk, then read the hot paths. Numbers are from the code, not estimates.
Companion to [`MAP-WITH-A-MARGIN-SPEC.md`](MAP-WITH-A-MARGIN-SPEC.md) §15, which says what replaces what; this
document says why, with evidence, and what can be done before that rebuild.

## 1. How components talk today

| Mechanism | Count | Where |
| --- | --- | --- |
| Zustand editor store selectors `useEditorStore(fn)` | 496 | everywhere; `EditorState` has 14 slices and **229 fields** |
| Imperative reads `useEditorStore.getState()` | 108 | hooks, tools, event handlers |
| Whole-store `useEditorStore.subscribe(cb)` (runs on every `set()`) | 4 | `GeoEditorView` repair, `MobilePanel` intent clock, chat `registry.ts` target guard, plus chat store |
| Props from the composition root | **105** into `AppSidebar` (interface: 117), **107** into `MobilePanel`, 25 into `Toolbar` | `GeoEditorView.tsx` |
| Shared prop names between `AppSidebar` and `MobilePanel` | **93** | the desktop and phone panels are one tree passed twice |
| `window.dispatchEvent` / `CustomEvent` | 12 | outbox changed, deep link, local blobs, field-session change, location change, default mint, NWC |
| React contexts | 17 (11 are shadcn/ui internals) | sidebar, map wrapper, mobile header action, embedded list |
| Nostr → React | `useTimelineWithEose` per caller, 13 call sites | `lib/nostr/hooks.ts`; each caller owns an effect, a cache query and a live subscription |
| Editor → store mirror | `GeoEditor.emit('update' \| 'create' \| 'selection.change')` → `setFeatures` | drags update MapLibre directly; the store only sees commits (good) |

So there are four channels: store selectors, store imperative reads, props from the root, and window events, with applesauce observables underneath. The root (`GeoEditorView.tsx`, 5,626 lines) is the switchboard between them:

| In `GeoEditorView` | Count |
| --- | --- |
| store selectors | 73 |
| `useEffect` | 54 |
| `useCallback` | 81 |
| `useMemo` | 43 |
| distinct custom hooks | 39 |
| `usePublishing` options | 24 fields |

`usePublishing`, `useDatasetManagement` (positional args), and `useMapLayers` (9 options) are called once, from the root, with root-built callbacks. A hook with 24 parameters is a component without a render function; it exists to receive things the root already has.

Two things are good and should stay: dataset content parsing is cached per event (`getOrComputeCachedValue` + `castEvent` symbol cache), so the 300 KB FeatureCollections are parsed once; and drag interactions never touch React (MapLibre sources are updated directly, the store sees the commit).

## 2. Performance opportunities, ranked by payoff over effort

### P1. Geometry edits re-render the composition root and both panel trees
`GeoEditorView` selects `state.features` (line 627) and references `features` 47 times, mostly for counts and emptiness checks. Every commit replaces the array, so every edit re-renders the root, which re-renders `AppSidebar` (105 props) and `MobilePanel` (107 props) since neither is memoized (`memo` is used 3 times in the whole app). Thirteen components select `state.features`; most need a scalar.

Fix now: select derived scalars (`state.features.length > 0`) at the root and move array consumers into leaves; memoize the two panels as an interim. Fix properly: delete the props (§3.1).

### P2. `ChatPanel` subscribes to the whole chat store
`ChatPanel.tsx` (2,971 lines) destructures `useChatStore()` with no selector. The store coalesces streaming tokens into one write per animation frame, and its own comment says why: a write per token "pegged the CPU and froze the UI". The coalescing is the only thing between the panel and a full re-render per SSE chunk.

Fix now: selectors per field, and split the panel into Transcript, Composer, and RunReview with their own subscriptions. `MessageBubble` is already memoized.

### P3. Four whole-store subscribers run on every store write
`ensureActiveDraftMapPresentation` runs on each `set()` of a 229-field store, as does the mobile intent clock and the chat target guard. Each is cheap alone; together they run on every selection change, every draft save, every mobile panel toggle.

Fix now: `subscribeWithSelector` and subscribe to the two or three fields each one actually watches.

### P4. The entry chunk is 4.5 MB minified
`dist/chunk-pf7k99av.js` = 4,565,040 bytes, with MapLibre, TipTap + ProseMirror, PMTiles, QuickJS, applesauce and part of Turf inside. Only ExcelJS, shpjs, jszip, jsQR, resvg-wasm and the tour page are split out. 95 runtime dependencies.

Fix now: lazy-load the rich-text editor (Story and comment composers only), the chat runtime (tool registry 2,079 lines, schemas 1,742, helpers 1,525, QuickJS) until a Thread opens, and the MLS private-workspace runtime until a Circle is used. Make the remaining static `@turf/turf` import dynamic like the two that already are.

### P5. Lists are not virtualized
`EntityListTable` maps every TanStack row; rows subscribe per item. Fine at 30 datasets, not at 1,000. Low priority until the relay grows; note it so the Browse rewrite (spec §5) picks a virtualized list from the start.

### P6. Persistence is synchronous `JSON.stringify` to `localStorage`
`writeScopedStorage` serialises workspaces, pinned and recent lists on each change; drafts carry full feature arrays. This is bounded by the 5 MB localStorage ceiling and blocks the main thread proportionally to draft size. Move drafts to IndexedDB (the app already uses `nostr-idb`) with a debounced writer.

## 3. Simplification opportunities

### S1. Delete the twin
`AppSidebar` and `MobilePanel` render the same panels (`GeoDatasetsPanelContent`, `StoriesPanelContent`, `SightingsPanelContent`, `UserProfilePanel`, `ShoutboxPanel`…) and share 93 prop names. Replace both with one Margin whose panels read the store directly; the phone gets a shell (sheet, dock, nav), not a second panel tree. This removes ~210 props, the 81 root callbacks that exist to feed them, and most of P1.

### S2. Collapse the six mode machines into the route
`stance` (browse/focus/author), `viewMode`, `sidebarView` (19 values), `mobilePanelTab` (18), `mobilePanelOpen`/`snap`, and the Inspector subject are reconciled against each other in the root (`useRouting` with `reconcileStore`, `applyRouteState`, `viewToMobileTab`). Spec §2 replaces them with `{kind, id, edit, on, live, in}`. Dozens of setters leave `EditorState`.

### S3. Split the store by lifecycle, not by file
229 fields in one store mix ephemeral UI (panels, mobile surfaces, search), editor session (features, mode, selection, history flags), durable drafts, and remote catalog. The architecture docs already ask for this split. Do it along the lifecycle seam: `uiStore` (never persisted, reset on route), `editorSession` (mirrors `GeoEditor`), `drafts` (persisted, account-scoped), `catalog` (derived from the EventStore). Whole-store subscribers (P3) then cost nothing.

### S4. Make layer sync and publishing runtimes, not hooks
`useMapLayers` (1,562 lines, 39 source/layer calls) and `usePublishing` (1,197 lines, 24 options) run inside React only because they were written as hooks. A `LayerSync` object that subscribes to the store with selectors and writes to MapLibre needs no render cycle at all, and `publish()` is a command that takes a working copy and a destination. This is the same move the private-workspace runtime already made (`PrivateWorkspaceRuntime` serialises operations, React reads snapshots).

### S5. One signalling mechanism
Keep the three platform-boundary window events (deep link, outbox changed, local blobs changed): they cross the Tauri seam. Move the rest into stores: field-session change, default mint and NWC change belong to their stores; `LOCATION_CHANGE_EVENT` disappears with S2.

### S6. Two editors for one kind
`MapContextEditorPanel` (1,144 lines) and `GroupEditorPanel` (981) both edit kind 37518; `contexts-columns.tsx` and `groups-columns.tsx` both define `createContextColumns` with a migration note. The Atlas panel (spec §11) replaces both.

### S7. Trim `components/ui/map.tsx`
2,119 lines of generic React-MapLibre wrapper (markers, popups, controls via portals) of which the app uses `Map`, `MapControls`, `useMap`, `ControlButton`, `ControlGroup`. `GeoEditor` owns the map; the wrapper should be the ~200 lines that mount it and expose the controls.

### S8. Split `Toolbar`
1,837 lines, 30 store selectors, 25 props. The tool groups already exist as files (`DrawButtonGroup`, `GeometryOpsDropdown`, `PublishDropdown`, …); finish the split so each reads its own state and the parent is a layout.

## 4. Suggested order

1. **Cheap and safe, this week**: P1 scalar selectors + memo on the two panels; P2 selectors in `ChatPanel`; P3 `subscribeWithSelector`; P4 lazy-load TipTap and the chat runtime. No behaviour change, all covered by existing tests (185 test files).
2. **With the Margin rebuild (spec step 1)**: S1, S2, S6, S8 fall out of building the Margin and the router; do not refactor the old panels first.
3. **With spec step 2–4**: S3, S4 as the working-copy and Shelf work lands; P6 with the working-copy persistence.
4. **Anytime**: S5, S7, P5.

## 5. What not to touch

`GeoEditor` and its managers, the `Authoring` facade, the tool registry's dispatch contract, the applesauce runtime and relay router, the MLS runtime, the Tauri services. They are the deep modules; the debt is in the layer that wires them to React.
