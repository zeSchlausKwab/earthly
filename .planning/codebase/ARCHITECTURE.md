<!-- refreshed: 2026-05-24 -->
# Architecture

**Analysis Date:** 2026-05-24

## System Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│                  Browser (React 19 SPA)                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            GeoEditorView (~2,088 lines)                  │    │
│  │         `src/features/geo-editor/GeoEditorView.tsx`      │    │
│  │                                                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │    │
│  │  │  AppSidebar  │  │   Toolbar    │  │  MapComponent │  │    │
│  │  │ `components/ │  │ `components/ │  │ `components/  │  │    │
│  │  │ AppSidebar`  │  │  Toolbar`    │  │   Map.tsx`    │  │    │
│  │  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │    │
│  │         │                 │                   │          │    │
│  │         └─────────────────┼───────────────────┘          │    │
│  │                           ▼                               │    │
│  │              ┌────────────────────────┐                   │    │
│  │              │   useEditorStore       │                   │    │
│  │              │ (Zustand, 11 slices)   │                   │    │
│  │              │ `store/index.ts`       │                   │    │
│  │              └────────────┬───────────┘                   │    │
│  │                           │                               │    │
│  │              ┌────────────┴───────────┐                   │    │
│  │              │  GeoEditor class       │                   │    │
│  │              │  (10 managers+2 modes) │                   │    │
│  │              │ `core/GeoEditor.ts`    │                   │    │
│  │              └────────────────────────┘                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                ┌──────────┴──────────┐                           │
│                │   applesauce-core   │                           │
│                │  EventStore + Pool  │                           │
│                │ `lib/nostr/index.ts`│                           │
│                └──────────┬──────────┘                           │
└───────────────────────────┼──────────────────────────────────────┘
                            │ WebSocket
          ┌─────────────────┴────────────────┐
          │     Go Relay (Khatru)            │
          │     `relay/main.go`              │
          │  SQLite (events) + Bluge (FTS)   │
          └──────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `GeoEditorView` | Top-level orchestration — wires all hooks, panels, and map instance | `src/features/geo-editor/GeoEditorView.tsx` |
| `AppSidebar` | Left sidebar navigation — dataset/context lists, social panels, settings | `src/components/AppSidebar.tsx` |
| `Toolbar` | Drawing controls, publish actions, file operations | `src/features/geo-editor/components/Toolbar.tsx` |
| `GeoEditor` | MapLibre-based imperative editor engine with 10 managers | `src/features/geo-editor/core/GeoEditor.ts` |
| `useEditorStore` | Zustand store — 11 slices, single source of truth for all editor state | `src/features/geo-editor/store/index.ts` |
| `lib/nostr/index.ts` | Applesauce singletons: EventStore, RelayPool, AccountManager | `src/lib/nostr/index.ts` |
| `GeoDatasetFactory` | Write-side builder for kind 37515 events | `src/lib/nostr/geo-event/factory.ts` |
| `GeoDataset` | Read-side cast (EventCast) for kind 37515 events | `src/lib/nostr/geo-event/cast.ts` |
| `MapContext` | Read-side cast for kind 37518 map context events | `src/lib/nostr/map-context/cast.ts` |
| `GeoProposalFactory` | Builder for kind 37519 edit proposal events | `src/lib/nostr/geo-proposal/factory.ts` |
| `EarthlyGeoServerClient` | MCP client for ContextVM geo services (search, geocoding) | `src/ctxcn/EarthlyGeoServerClient.ts` |
| Go relay | Khatru Nostr relay with SQLite + Bluge FTS backend | `relay/main.go` |
| Bun server (`src/index.ts`) | Serves SPA, OG metadata routes, and API endpoints | `src/index.ts` |

## Pattern Overview

**Overall:** Feature-based React SPA with an imperative MapLibre editor engine, decoupled from a reactive Nostr data layer via applesauce-core singletons.

**Key Characteristics:**
- Nostr data is handled by `applesauce-core` (`EventStore`, `RelayPool`, `AccountManager`) — not NDK. The migration away from NDK is complete for the main app; seed scripts still use NDK.
- The Zustand store (`useEditorStore`) is the bridge between the imperative `GeoEditor` class and the declarative React UI. The store holds a reference to the live `GeoEditor` instance.
- All Nostr event construction uses the **Factory + Cast** pattern: `*Factory` for building/signing events, `EventCast` subclasses (`GeoDataset`, `MapContext`) for reading.
- Business logic is extracted into hooks under `src/features/geo-editor/hooks/`. The `GeoEditorView` itself only orchestrates; it does not contain logic.

## Layers

**Nostr Data Layer:**
- Purpose: Subscribe to relays, ingest events, cache to IndexedDB, publish signed events
- Location: `src/lib/nostr/`
- Contains: Applesauce singletons (`index.ts`), event kinds (`kinds.ts`), `publish()` utility, `useTimeline` / `useTimelineWithEose` hooks, geo-event / map-context / geo-comment / geo-proposal sub-modules
- Depends on: `applesauce-core`, `applesauce-relay`, `applesauce-accounts`, `nostr-idb`, `nostr-tools`
- Used by: All feature hooks and components that need Nostr data

**Domain Event Module Pattern (`lib/nostr/<event-type>/`):**
Each Nostr event kind has its own sub-module with three files:
- `helpers.ts` — pure functions on raw `NostrEvent` (tag reads, type guards)
- `cast.ts` — `EventCast` subclass for read-side typed access
- `factory.ts` — `EventFactory` subclass for write-side event construction

Event kinds:
- `geo-event/` (kind 37515): GeoJSON datasets
- `map-context/` (kind 37518): Taxonomy / validation contexts for datasets
- `geo-comment/` (kind 37517): NIP-22 threaded comments
- `geo-proposal/` (kind 37519): Edit proposals with NIP-34 status events
- `map-layer-set/` (kind 34444): Server-signed map layer announcements

**Editor Engine Layer:**
- Purpose: MapLibre GL imperative editing — drawing, selection, snapping, undo, transforms
- Location: `src/features/geo-editor/core/`
- Contains: `GeoEditor.ts` (1,841 lines), 10 managers, 2 draw modes
- Depends on: `maplibre-gl`, `@turf/turf`, geojson types
- Used by: `GeoEditorView` (creates and holds the instance), store (holds reference)

Managers in `src/features/geo-editor/core/managers/`:
| Manager | Lines | Purpose |
|---------|-------|---------|
| `LayerManager.ts` | 612 | MapLibre source/layer lifecycle |
| `RenderingManager.ts` | 296 | Feature rendering pipeline |
| `TransformManager.ts` | 169 | Move, rotate, scale operations |
| `SnapManager.ts` | 184 | Vertex snapping during drawing |
| `SelectionManager.ts` | 160 | Feature selection and highlighting |
| `HistoryManager.ts` | 102 | Undo/redo stack |
| `LineOperationsManager.ts` | 205 | Line-specific operations |
| `CombineManager.ts` | 108 | Feature merge operations |
| `BooleanManager.ts` | 129 | Boolean geometry operations |
| `SimplifyManager.ts` | 66 | Geometry simplification |

**Zustand Store Layer:**
- Purpose: Single source of truth for all editor/UI state; bridges imperative editor with React
- Location: `src/features/geo-editor/store/`
- Contains: 11 slices composed via `create<EditorState>` in `index.ts`
- Depends on: zustand, editor core types
- Used by: All geo-editor hooks, `GeoEditorView`, `AppSidebar`, toolbar components

Store slices in `src/features/geo-editor/store/`:
| Slice | Lines | Purpose |
|-------|-------|---------|
| `editorCoreSlice.ts` | 112 | Editor instance, features, drawing mode, selection |
| `draftSlice.ts` | 223 | Persisted collection edit drafts |
| `workspaceSlice.ts` | 319 | Named resumable workspaces |
| `publishingSlice.ts` | 162 | Publish in-progress state, errors |
| `metadataSlice.ts` | 73 | Dataset metadata (name, description, tags) |
| `viewModeSlice.ts` | 41 | View vs edit mode (slated for collapse to `stance`) |
| `mapStackSlice.ts` | 72 | Map stack entries (visible layers) |
| `uiSlice.ts` | 69 | Panel visibility, mobile state |
| `searchSlice.ts` | 83 | Geo search state |
| `mapSourceSlice.ts` | 43 | Active map source configuration |
| `sessionSyncSlice.ts` | 58 | Session-level hydration for the active account |

**Business Logic Hook Layer:**
- Purpose: Encapsulate multi-step workflows that coordinate store, Nostr, and editor
- Location: `src/features/geo-editor/hooks/`
- Contains: 13 hooks

Key hooks:
| Hook | Lines | Purpose |
|------|-------|---------|
| `usePublishing.ts` | 768 | Dataset publish/update/delete/propose-edit workflow |
| `useDatasetManagement.ts` | 775 | Dataset CRUD: load, resolve blobs, convert features |
| `useMapLayers.ts` | 786 | Sync Nostr datasets with MapLibre layer sources |
| `useRouting.ts` | 457 | Hash-based route parsing and sidebar view state |
| `useViewMode.ts` | 156 | Edit/view mode toggle, info panel coordination |
| `useBlobResolution.ts` | — | Blob URL fetching and caching |
| `useContextEditor.ts` | — | Map context curation workflow |
| `useCommentGeometry.ts` | — | Comment annotation geometry on map |
| `useProposalGeometry.ts` | — | Edit proposal geometry overlay |
| `useOsmQuery.ts` | — | OpenStreetMap data import |
| `useMagnifier.ts` | — | Map magnifier tool |
| `useInspector.ts` | — | Location inspector / reverse geocode |
| `useMentionActions.ts` | — | Rich text mention interactions |
| `useMapInteractions.ts` | — | Map click/hover event routing |

**UI Component Layer:**
- Purpose: Rendering only — receive props/store slices, no data fetching
- Location: `src/components/`, `src/features/geo-editor/components/`
- Contains: Radix-based UI primitives, domain panels (datasets, info, social), geo-editor-specific map components
- Depends on: `useEditorStore`, Nostr hook data, `src/components/ui/` (30+ Radix primitives)

**Bun Server Layer:**
- Purpose: SPA static serving, OG meta for crawlers, API endpoints, dev HMR
- Location: `src/index.ts`
- Contains: `Bun.serve()` with hash-based SPA routing, OG routes (`/geoevent/:naddr`, `/context/:naddr`), `/og/image/:type/:naddr` PNG generation
- Depends on: `src/lib/og/` (cache, crawl, render)

**Go Relay:**
- Purpose: WebSocket Nostr relay with full-text search
- Location: `relay/main.go`
- Backend: SQLite (`eventstore/sqlite3`) + Bluge FTS index
- Features: 2MB event size limit for large GeoJSON, Khatru Blossom blob support, NIP-50 search

## Data Flow

### Publishing a Dataset (Primary Write Path)

1. User draws features in `GeoEditor` (`src/features/geo-editor/core/GeoEditor.ts`)
2. `GeoEditor` fires `featuresChange` event → `useEditorStore.setFeatures()` (`store/editorCoreSlice.ts`)
3. User clicks "Publish New" in `Toolbar` → calls `onPublishNew` prop
4. `usePublishing.publishNew()` (`hooks/usePublishing.ts`) builds `FeatureCollection` from store features via `extractCollectionMeta` + `sanitizeEditorProperties`
5. If size > `BLOSSOM_UPLOAD_THRESHOLD_BYTES`: upload geometry to Blossom → get blob URL → `GeoDatasetFactory.create(stub).blobReferences([...]).withSpatialMetadata()`
6. Otherwise: `GeoDatasetFactory.create(fc).hashtags([...]).withDerivedMetadata()`
7. `.sign(signer)` → `publish(event, { routing: 'outbox' })` (`lib/nostr/index.ts`)
8. `publish()` resolves outbox relays from `MailboxesModel`, calls `pool.publish()`, then `eventStore.add(event)`
9. Go relay receives event over WebSocket, stores in SQLite, indexes in Bluge

### Loading a Dataset for Editing (Primary Read Path)

1. `useGeoDatasets()` (`lib/hooks/useGeoDatasets.ts`) → `useTimelineWithEose` → `pool.req()` → events flow into `eventStore`
2. EventStore emits updated timeline → `castEvent(event, GeoDataset, eventStore)` wraps each raw event
3. User selects dataset in `GeoDatasetsPanel` → calls `loadDatasetForEditing(event)`
4. `useDatasetManagement.loadDatasetForEditing()` (`hooks/useDatasetManagement.ts`):
   - `resolveGeoEventFeatureCollection()` (`lib/geo/resolveBlobReferences.ts`) — fetches external blob URLs if blob tags present
   - `convertGeoEventsToEditorFeatures()` — converts GeoJSON to `EditorFeature[]`
   - `useEditorStore.setFeatures(features)` — updates store
5. `GeoEditor.setFeatures()` — updates MapLibre sources via `LayerManager`

### Nostr Subscription Path (Reactive Read)

1. React hook calls `useTimeline(filters)` (`lib/nostr/hooks.ts`)
2. `useEffect` → `pool.req(relays, filters)` → Observable of relay messages
3. EVENT messages piped to `mapEventsToStore(eventStore)` — adds and deduplicates
4. EOSE messages counted per relay → `setEose(true)` when all relays done
5. `use$(() => eventStore.timeline(filters))` — reactive read, re-renders on changes
6. Callers wrap raw events: `castEvent(event, GeoDataset, eventStore)` for typed access

### Blob Resolution Path

1. `GeoDataset.blobReferences` — reads `blob` tags from raw event
2. `resolveGeoEventFeatureCollection(dataset)` (`lib/geo/resolveBlobReferences.ts`)
3. For each blob ref: check `blobCache` Map → check `failedUrls` Set → `fetchWithProgress()` with retry/timeout
4. Large response bodies parsed in web worker: `parseJsonInWorker()` (`lib/geo/workerJsonParse.ts`)
5. Normalized to `FeatureCollection` → merged into full dataset

## Key Abstractions

**EventCast subclasses (read side):**
- Purpose: Type-safe read access to raw `NostrEvent` tag/content data
- Pattern: `class GeoDataset extends EventCast<GeoDatasetEvent>` — getters backed by `helpers.ts` pure functions
- Examples: `src/lib/nostr/geo-event/cast.ts`, `src/lib/nostr/map-context/cast.ts`, `src/lib/nostr/geo-comment/cast.ts`
- Never use directly to publish — only for reading

**EventFactory subclasses (write side):**
- Purpose: Composable builder chain for constructing and signing Nostr events
- Pattern: `class GeoDatasetFactory extends EventFactory<kind>` — fluent methods like `.hashtags([]).withDerivedMetadata().sign(signer)`
- Examples: `src/lib/nostr/geo-event/factory.ts`, `src/lib/nostr/geo-proposal/factory.ts`
- Always produce a `NostrEvent`; pass to `publish()` from `lib/nostr`

**EditorFeature (internal editing format):**
- Purpose: GeoJSON Feature with editor-specific metadata (color, style, selection state)
- Location: `src/features/geo-editor/core/types/`
- Used internally by `GeoEditor` and store; converted to/from GeoJSON for Nostr events

**MapStackEntry:**
- Purpose: Represents a layer currently rendered on the map (dataset, context, draft, AI result, etc.)
- Location: `src/features/geo-editor/store/types.ts`
- Used by `mapStackSlice` and `useMapLayers` to drive MapLibre source updates

## Entry Points

**Browser SPA:**
- Location: `src/frontend.tsx`
- Sets up `EventStoreProvider` + `AccountsProvider` (applesauce-react), renders `<App />`
- `App` (`src/App.tsx`) renders `<GeoEditorView />` + `<Toaster />` + `<TourManager />`

**Bun HTTP Server:**
- Location: `src/index.ts`
- Dev: `Bun.serve()` with HMR, HTML import for `index.html`
- Prod: Static serving from `dist/`, OG meta routes, `/og/image/:type/:naddr` PNG generation

**Nostr Singletons:**
- Location: `src/lib/nostr/index.ts`
- Constructed once at module import time: `eventStore`, `pool`, `accounts`, IndexedDB cache
- `createEventLoaderForStore(eventStore, pool, { cacheRequest, lookupRelays })` wired here
- `NostrConnectSigner.pool = pool` set here for NIP-46 bunker transport

**Go Relay:**
- Location: `relay/main.go`
- Started separately with `bun relay`; listens on port 3334 (default)

## Architectural Constraints

- **Applesauce-only for main app:** All Nostr event handling in the main app uses applesauce-core singletons. NDK is not imported in the frontend. Seed scripts (`scripts/`) still use NDK and are excluded from this constraint.
- **Single Zustand store for editor:** `useEditorStore` is the only store for the geo-editor feature. All state for drawing, publishing, UI panels, workspace, and draft management lives here in named slices.
- **Imperative editor, declarative UI:** `GeoEditor` is a class with direct MapLibre API calls. It is created once by `GeoEditorView` and stored in the Zustand store via `setEditor()`. It must not be recreated on re-renders.
- **Factory + Cast — never mutate events:** Raw `NostrEvent` objects from the EventStore are immutable. Use `GeoDataset` (cast) for reading and `GeoDatasetFactory` (factory) for any new or updated event. Never manually mutate tag arrays on a received event.
- **Dev relay isolation:** `src/config/env.client.ts` hard-locks writes to `ws://localhost:3334` when running on a loopback origin, regardless of `RELAY_URL`. Outbox/inbox routing in dev also collapses to `writeRelays`. This prevents accidental public relay publishing in development.
- **Global state:** `eventStore`, `pool`, `accounts`, `cache` are module-level singletons in `src/lib/nostr/index.ts`. HMR cleanup handlers exist (`import.meta.hot.dispose`) to tear down subscriptions on hot reload.
- **Blossom threshold:** `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (defined in `src/features/geo-editor/constants.ts`) controls when large GeoJSON is split to external blob storage vs inline in the event content.

## Anti-Patterns

### Implicit mode transitions
**What happens:** Several places auto-promote state (e.g., `useDatasetManagement.ts:225` calls `setViewMode('edit')` on dataset load, `useViewMode.ts:87` mutates sidebar on inspect).
**Why it's wrong:** Creates an implicit state graph users cannot navigate; bugs concentrate at transition boundaries. Documented in `UX_REWRITE.md §8`.
**Do this instead:** All stance transitions should be explicit user actions. The UX rewrite collapses `viewMode` + `editIsolationEnabled` + split flags into a single `stance` enum; new code should not add new implicit transitions.

### Querying filtered events at call-site instead of via EventStore timeline
**What happens:** Occasionally components fetch events via direct `pool.req()` without going through `useTimeline`.
**Why it's wrong:** Bypasses the EventStore deduplication and reactive update pipeline; events won't be in cache and won't trigger re-renders.
**Do this instead:** Use `useTimeline(filters)` or `useTimelineWithEose(filters)` from `src/lib/nostr/hooks.ts`, or the domain-specific wrappers in `src/lib/hooks/useGeoDatasets.ts`.

### Constructing GeoDataset or MapContext directly with `new`
**What happens:** Some older call-sites pass events to components as raw `NostrEvent` without casting.
**Why it's wrong:** Loses all typed accessors; callers have to hand-parse tags.
**Do this instead:** Use `castEvent(event, GeoDataset, eventStore)` or `castEvent(event, MapContext, eventStore)` from `applesauce-core/casts`.

## Error Handling

**Strategy:** Toast notifications for user-visible errors, `console.error` for developer errors, silent fallbacks for non-critical failures.

**Patterns:**
- Blob fetch failures: added to `failedUrls` Set, logged, silently skipped on retry (`lib/geo/resolveBlobReferences.ts`)
- Publish errors: stored in `publishingSlice.publishError`, shown as toast via `sonner`
- IndexedDB errors: caught and logged; `disableCache()` called on fatal IDB errors to degrade gracefully (`lib/nostr/index.ts`)
- Nostr relay errors: pool handles reconnection; EOSE tracking allows UI to show loading state

## Cross-Cutting Concerns

**Logging:** `console.log/error/warn` with `[module]` prefix (e.g., `[nostr]`, `[OG image route]`). No structured logging framework.

**Validation:** AJV (JSON Schema 2020-12) used in `lib/context/validation.ts` for validating GeoJSON features against map context schemas. Zod used in `src/config/env.schema.ts` for environment config validation at build time.

**Authentication:** `applesauce-accounts` (`AccountManager`) with NIP-07 extension, NIP-46 Nostr Connect, and private key signer support. Accounts persisted in `localStorage`. Active account's signer used for event signing via `accounts.signer`.

---

*Architecture analysis: 2026-05-24*
