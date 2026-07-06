<!-- refreshed: 2026-05-24 -->
# Codebase Structure

**Analysis Date:** 2026-05-24

## Directory Layout

```
earthly/
├── relay/                    # Go Nostr relay (Khatru)
│   └── main.go               # Single-file relay: SQLite + Bluge FTS + Blossom
│
├── scripts/                  # Bun seed/utility scripts
│   ├── seed.ts               # Main seeding orchestrator
│   ├── gen_geo_events.ts     # GeoJSON event generation (uses NDK)
│   ├── gen_collections.ts    # Collection event generation
│   ├── gen_user.ts           # User/keypair generation
│   └── dev-clean.sh          # Dev startup script (called by `bun dev`)
│
├── src/
│   ├── index.ts              # Bun HTTP server (SPA + OG routes + API)
│   ├── frontend.tsx          # React SPA entry: providers + App mount
│   ├── App.tsx               # Root component: GeoEditorView + Toaster + TourManager
│   ├── index.html            # HTML entry for Bun dev bundler
│   ├── index.css             # Global CSS (Tailwind v4 imports)
│   │
│   ├── config/               # Environment configuration
│   │   ├── env.schema.ts     # Zod validation schema for env vars
│   │   ├── env.client.ts     # Frontend config (build-time injected, relay routing logic)
│   │   ├── env.server.ts     # Server-side config
│   │   ├── platform.ts       # Platform detection utilities
│   │   └── index.ts          # Re-exports `config` from env.client.ts
│   │
│   ├── components/           # Shared UI components (non-feature-specific)
│   │   ├── ui/               # Radix-based primitives (30+ components)
│   │   │   ├── button.tsx, card.tsx, dialog.tsx, ...
│   │   │   └── sidebar.tsx   # App sidebar shell (Radix-based)
│   │   ├── AppSidebar.tsx    # Left sidebar: navigation + all panel views
│   │   ├── GeoDatasetsPanel.tsx   # Dataset list with filter/sort
│   │   ├── GeoEditorInfoPanel.tsx # Dataset detail / inspect panel
│   │   ├── MapStackPanel.tsx      # Visible layers management
│   │   ├── BlossomUploadDialog.tsx # Blob upload UI
│   │   ├── WorkspaceDraftNavigator.tsx # Workspace/draft switcher
│   │   ├── UserProfilePanel.tsx
│   │   ├── HelpPanel.tsx
│   │   ├── DebugDialog.tsx
│   │   ├── info-panel/       # InfoPanel sub-components (11 files, ~2,700 lines)
│   │   │   ├── EntityPanelShell.tsx
│   │   │   ├── DatasetActionCard.tsx
│   │   │   ├── DatasetFeaturesList.tsx
│   │   │   ├── ViewModePanel.tsx
│   │   │   ├── MapContextViewPanel.tsx
│   │   │   └── geometry/     # Geometry visualization sub-components
│   │   ├── editor/           # Rich text editing components (5 files)
│   │   │   ├── GeoRichTextEditor.tsx    # TipTap-based rich text editor
│   │   │   ├── GeoMentionExtension.tsx  # Custom mention node
│   │   │   ├── MediaExtensions.tsx      # Image/video embedding
│   │   │   ├── RichContentRenderer.tsx
│   │   │   └── contentParser.ts
│   │   ├── data-filter/      # Dataset filter/sort toolbar
│   │   ├── entity-search/    # Entity search popover (datasets, contexts)
│   │   ├── blossom/          # Blossom upload button
│   │   ├── user-profile/     # User profile display
│   │   └── nav-user.tsx      # Account menu in sidebar footer
│   │
│   ├── features/             # Feature-scoped modules
│   │   ├── geo-editor/       # Main map editor feature (primary feature)
│   │   │   ├── GeoEditorView.tsx    # Top-level orchestration (~2,088 lines)
│   │   │   ├── commands.ts          # Editor command definitions/executors
│   │   │   ├── constants.ts         # BLOSSOM_UPLOAD_THRESHOLD_BYTES, etc.
│   │   │   ├── shapefile.ts         # Shapefile import/export
│   │   │   ├── utils.ts             # Feature conversion utilities
│   │   │   ├── types.ts             # Shared editor types (CollectionMeta, etc.)
│   │   │   ├── types/               # Additional type modules
│   │   │   │   ├── index.ts
│   │   │   │   └── styleProperties.ts
│   │   │   ├── core/                # Imperative editor engine
│   │   │   │   ├── GeoEditor.ts     # Main editor class (~1,841 lines)
│   │   │   │   ├── index.ts         # Re-exports: EditorFeature, EditorMode, GeoEditor
│   │   │   │   ├── managers/        # 10 focused capability managers
│   │   │   │   │   ├── LayerManager.ts       # MapLibre layer management (612 lines)
│   │   │   │   │   ├── RenderingManager.ts   # Rendering pipeline (296 lines)
│   │   │   │   │   ├── SelectionManager.ts   # Feature selection (160 lines)
│   │   │   │   │   ├── HistoryManager.ts     # Undo/redo (102 lines)
│   │   │   │   │   ├── SnapManager.ts        # Vertex snapping (184 lines)
│   │   │   │   │   ├── TransformManager.ts   # Move/rotate/scale (169 lines)
│   │   │   │   │   ├── LineOperationsManager.ts (205 lines)
│   │   │   │   │   ├── CombineManager.ts     (108 lines)
│   │   │   │   │   ├── BooleanManager.ts     (129 lines)
│   │   │   │   │   └── SimplifyManager.ts    (66 lines)
│   │   │   │   ├── modes/           # Drawing mode implementations
│   │   │   │   │   ├── DrawMode.ts  # Point/Line/Polygon/Annotation draw modes
│   │   │   │   │   └── EditMode.ts  # Vertex edit mode
│   │   │   │   ├── types/           # Core type definitions
│   │   │   │   └── utils/           # Core utilities
│   │   │   ├── store/               # Zustand store (11 slices)
│   │   │   │   ├── index.ts         # Store creation + type re-exports
│   │   │   │   ├── types.ts         # All EditorState slice type definitions (422 lines)
│   │   │   │   ├── persistence.ts   # LocalStorage read/write helpers
│   │   │   │   ├── editorCoreSlice.ts    # Editor instance, features, mode, selection
│   │   │   │   ├── draftSlice.ts         # Persisted collection edit drafts
│   │   │   │   ├── workspaceSlice.ts     # Named resumable workspaces
│   │   │   │   ├── publishingSlice.ts    # Publish state + errors
│   │   │   │   ├── metadataSlice.ts      # Dataset metadata (name, tags, etc.)
│   │   │   │   ├── viewModeSlice.ts      # View/edit mode toggle
│   │   │   │   ├── mapStackSlice.ts      # Map stack layer entries
│   │   │   │   ├── uiSlice.ts            # Panel visibility, mobile state
│   │   │   │   ├── searchSlice.ts        # Geo search query/results
│   │   │   │   ├── mapSourceSlice.ts     # Active map source
│   │   │   │   └── sessionSyncSlice.ts   # Per-account session hydration
│   │   │   ├── hooks/               # Business logic hooks (13 hooks)
│   │   │   │   ├── usePublishing.ts      # Dataset publish/update/delete (768 lines)
│   │   │   │   ├── useDatasetManagement.ts # Dataset CRUD + blob resolution (775 lines)
│   │   │   │   ├── useMapLayers.ts       # MapLibre source sync (786 lines)
│   │   │   │   ├── useRouting.ts         # Hash route parsing + sidebar state (457 lines)
│   │   │   │   ├── useViewMode.ts        # View/edit mode toggle (156 lines)
│   │   │   │   ├── useBlobResolution.ts
│   │   │   │   ├── useContextEditor.ts
│   │   │   │   ├── useCommentGeometry.ts
│   │   │   │   ├── useProposalGeometry.ts
│   │   │   │   ├── useOsmQuery.ts
│   │   │   │   ├── useMagnifier.ts
│   │   │   │   ├── useInspector.ts
│   │   │   │   ├── useMentionActions.ts
│   │   │   │   └── useMapInteractions.ts
│   │   │   └── components/          # Editor-specific React components
│   │   │       ├── Map.tsx              # MapLibre GL map container
│   │   │       ├── Toolbar.tsx          # Drawing/publish/file toolbar
│   │   │       ├── Editor.tsx           # Editor panel component
│   │   │       ├── MobilePanel.tsx      # Mobile bottom sheet panel
│   │   │       ├── MobileSearch.tsx
│   │   │       ├── FeaturePopup.tsx     # Map click popup
│   │   │       ├── MapFeatureHoverOverlay.tsx
│   │   │       ├── LocationInspectorPopup.tsx
│   │   │       ├── LocationInspectorPanel.tsx
│   │   │       ├── CommentAnnotationPopup.tsx
│   │   │       ├── Magnifier.tsx
│   │   │       ├── UserLocationMarker.tsx
│   │   │       ├── LocateButton.tsx
│   │   │       ├── ImportOsmDialog.tsx
│   │   │       ├── OsmResultsPanel.tsx
│   │   │       ├── CreateMapPopover.tsx
│   │   │       ├── MapSettingsPanel.tsx
│   │   │       ├── OsmQueryPopover.tsx
│   │   │       ├── map-popup-positioning.ts
│   │   │       ├── toolbar/             # Toolbar sub-components
│   │   │       │   ├── DrawButtonGroup.tsx
│   │   │       │   ├── PublishDropdown.tsx
│   │   │       │   ├── FileDropdown.tsx
│   │   │       │   ├── GeometryOpsDropdown.tsx
│   │   │       │   ├── SessionButton.tsx
│   │   │       │   ├── SimplifyDialog.tsx
│   │   │       │   └── OsmImportPopover.tsx
│   │   │       └── share/               # Share/export popover
│   │   │           └── ShareExportPopover.tsx
│   │   │
│   │   ├── auth/             # Authentication (NIP-07, NIP-46, private key)
│   │   │   ├── LoginSessionButtons.tsx
│   │   │   ├── Nip46LoginDialog.tsx
│   │   │   ├── SessionsManager.tsx
│   │   │   └── SignupDialog.tsx
│   │   │
│   │   ├── social/           # Social features
│   │   │   ├── comments/     # Threaded comments on datasets (kind 37517)
│   │   │   │   ├── CommentsPanel.tsx
│   │   │   │   ├── GeoCommentItem.tsx
│   │   │   │   ├── GeoCommentForm.tsx
│   │   │   │   ├── GeoMention.tsx
│   │   │   │   ├── GeoSocialActions.tsx
│   │   │   │   ├── CommentAnnotationComposer.tsx
│   │   │   │   └── index.ts
│   │   │   ├── proposals/    # Edit proposals (kind 37519)
│   │   │   │   ├── ProposalsPanel.tsx
│   │   │   │   ├── ProposalCard.tsx
│   │   │   │   └── index.ts
│   │   │   ├── shoutbox/     # City-based local discussions
│   │   │   │   ├── ShoutboxPanel.tsx
│   │   │   │   ├── PostCard.tsx
│   │   │   │   ├── PostForm.tsx
│   │   │   │   ├── CommentThread.tsx
│   │   │   │   └── useShoutboxComments.ts
│   │   │   └── hooks/
│   │   │       ├── useGeoComments.ts
│   │   │       ├── useGeoReactions.ts
│   │   │       └── useGeoProposals.ts
│   │   │
│   │   ├── chat/             # AI chat panel
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── ChatGeometryAttachment.tsx
│   │   │   ├── store.ts
│   │   │   ├── routstr.ts
│   │   │   ├── settingsStorage.ts
│   │   │   ├── useChatSettingsSync.ts
│   │   │   ├── index.ts
│   │   │   └── tools/        # Chat tool implementations
│   │   │
│   │   ├── contexts/         # Map context editing
│   │   │   ├── MapContextEditorPanel.tsx
│   │   │   └── contexts-columns.tsx
│   │   │
│   │   ├── settings/         # Settings panel
│   │   │   └── UserRelayManager.tsx
│   │   │
│   │   ├── wallet/           # NIP-60 ecash wallet
│   │   │   └── components/   # Wallet UI (deposit, withdraw, receive, send)
│   │   │
│   │   └── tour/             # Onboarding tour
│   │       ├── TourManager.tsx
│   │       ├── steps.ts
│   │       └── store.ts
│   │
│   ├── lib/                  # Shared libraries (cross-feature)
│   │   ├── nostr/            # Nostr integration layer
│   │   │   ├── index.ts      # Applesauce singletons: eventStore, pool, accounts, publish()
│   │   │   ├── kinds.ts      # Event kind constants (37515, 37517, 37518, 37519, 34444)
│   │   │   ├── hooks.ts      # useTimeline, useTimelineWithEose
│   │   │   ├── references.ts # Nostr address/reference utilities
│   │   │   ├── dTag.ts       # d-tag generation
│   │   │   ├── geo-event/    # kind 37515: GeoJSON datasets
│   │   │   │   ├── cast.ts      # GeoDataset (read-side EventCast)
│   │   │   │   ├── factory.ts   # GeoDatasetFactory (write-side EventFactory)
│   │   │   │   ├── helpers.ts   # Pure tag/content accessors + type guards
│   │   │   │   └── index.ts
│   │   │   ├── geo-comment/  # kind 37517: threaded comments
│   │   │   │   ├── cast.ts, factory.ts, helpers.ts, index.ts
│   │   │   ├── map-context/  # kind 37518: taxonomy/validation contexts
│   │   │   │   ├── cast.ts      # MapContext (read-side EventCast)
│   │   │   │   ├── factory.ts
│   │   │   │   ├── helpers.ts
│   │   │   │   └── index.ts
│   │   │   ├── geo-proposal/ # kind 37519: edit proposals + NIP-34 status
│   │   │   │   ├── cast.ts, factory.ts, helpers.ts, status.ts, index.ts
│   │   │   └── map-layer-set/ # kind 34444: server-signed layer announcements
│   │   │       └── index.ts
│   │   │
│   │   ├── hooks/            # Shared React hooks (cross-feature)
│   │   │   ├── useGeoDatasets.ts        # useGeoDatasets + useMapContexts
│   │   │   ├── useAvailableGeoFeatures.ts
│   │   │   └── useIsMobile.ts
│   │   │
│   │   ├── geo/              # GeoJSON utilities
│   │   │   ├── resolveBlobReferences.ts # Fetch + merge external blob GeoJSON
│   │   │   ├── normalizeGeoJSON.ts      # Normalize any GeoJSON shape to FeatureCollection
│   │   │   ├── bbox.ts                  # Bounding box utilities
│   │   │   ├── geometry.ts              # Geometry helpers
│   │   │   ├── geoJsonParseWorker.ts    # Web worker for large JSON parsing
│   │   │   └── workerJsonParse.ts       # Worker invocation wrapper
│   │   │
│   │   ├── blossom/          # Blossom blob upload
│   │   │   └── blossomUpload.ts  # uploadGeoJsonToBlossom() (NIP-98 auth)
│   │   │
│   │   ├── context/          # Map context validation + scoping logic
│   │   │   ├── validation.ts    # AJV-based feature validation against context schema
│   │   │   ├── scope.ts         # Context map scope mode resolution
│   │   │   ├── references.ts    # Context reference tag utilities
│   │   │   └── displayOrdering.ts
│   │   │
│   │   ├── og/               # OpenGraph metadata server-side
│   │   │   ├── cache.ts, crawler.ts, fetchEvent.ts, fetchContextEvent.ts
│   │   │   ├── renderImage.ts   # PNG OG image generation
│   │   │   ├── template.ts      # OG HTML templates
│   │   │   └── index.ts
│   │   │
│   │   ├── wallet/           # NIP-60 wallet runtime
│   │   │   ├── runtime.ts, actions.ts, hooks.ts, storage.ts, types.ts
│   │   │
│   │   ├── seed-relay/       # Relay seeding utilities
│   │   │   └── index.ts
│   │   │
│   │   ├── fixtures.ts       # Test fixture data
│   │   ├── utils.ts          # General utilities (cn() class merging, etc.)
│   │   └── worldGeohash.ts   # World-level geohash helper
│   │
│   └── ctxcn/                # ContextVM MCP client (geo services)
│       ├── EarthlyGeoServerClient.ts  # MCP client: SearchLocation, ReverseLookup
│       └── index.ts
│
├── styles/                   # Global style assets
├── public/                   # Static public assets (served at /static/*)
├── base-assets/              # Base assets for build
├── data/                     # Runtime data (events.db, search index) — gitignored
├── dist/                     # Production build output — gitignored
│
├── build.ts                  # Custom Bun build script with Tailwind + env injection
├── package.json
├── bun.lock
├── tsconfig.json
├── biome.json                # Biome linter/formatter config
├── bunfig.toml
├── components.json           # shadcn/ui component registry config
├── mapnolia.config.example.json  # Mapnolia tile server config template
├── mapnolia.config.json      # Mapnolia config (gitignored — contains private key)
├── ctxcn.config.json         # ContextVM config
├── Caddyfile                 # Caddy reverse proxy config for production
└── ecosystem.config.cjs      # PM2 process manager config for production
```

## Directory Purposes

**`src/features/geo-editor/`:**
- Purpose: The primary application feature — all code for the interactive map editor
- Contains: Top-level view orchestration, imperative editor engine, Zustand store, business logic hooks, editor-specific UI components
- Key files: `GeoEditorView.tsx` (orchestration), `core/GeoEditor.ts` (engine), `store/index.ts` (state)

**`src/features/geo-editor/core/`:**
- Purpose: Imperative MapLibre GL editor engine, isolated from React
- Contains: `GeoEditor` class + 10 manager classes + 2 draw mode classes
- Key constraint: No React imports. No Zustand imports. Pure imperative MapLibre API.

**`src/features/geo-editor/store/`:**
- Purpose: All editor state management, slice by domain concern
- Contains: 11 slice files + `types.ts` + `persistence.ts` + `index.ts`
- Key constraint: One store instance only (`useEditorStore`). No secondary stores.

**`src/features/geo-editor/hooks/`:**
- Purpose: Business logic hooks — multi-step workflows coordinating store, Nostr, and editor
- Contains: 13 hooks, each owning a distinct concern
- Key constraint: Hooks are the only place that calls both `useEditorStore` and Nostr data APIs together.

**`src/lib/nostr/`:**
- Purpose: All Nostr protocol concerns: singletons, subscriptions, event construction, event reading
- Contains: Applesauce singletons + 5 event-kind sub-modules + hook utilities
- Key constraint: The singletons in `index.ts` are constructed once. Import from `@/lib/nostr`, never re-instantiate.

**`src/lib/nostr/<event-type>/`:**
- Purpose: Self-contained module per Nostr event kind with helpers / cast / factory
- Key constraint: `helpers.ts` is pure functions on raw events (no class dependency). `cast.ts` is read-only. `factory.ts` is write-only. Never mix.

**`src/components/`:**
- Purpose: Shared UI components not owned by a specific feature
- Contains: Radix-based UI primitives in `ui/`, domain panels referenced from multiple features
- Key constraint: Components here should not import from `src/features/*/` except via props.

**`src/components/ui/`:**
- Purpose: Radix UI + Tailwind primitive components (shadcn/ui pattern)
- Contains: 30+ primitive components (button, dialog, sidebar, table, tooltip, etc.)
- Key constraint: These are presentational. No Nostr or editor logic.

**`relay/`:**
- Purpose: The Go Nostr relay — entirely separate from the TypeScript frontend
- Contains: Single `main.go` with Khatru relay, SQLite event store, Bluge FTS index
- Key constraint: Started separately (`bun relay`). The frontend communicates via WebSocket only.

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `GeoEditorView.tsx`, `MapStackPanel.tsx`)
- Hooks: `camelCase` with `use` prefix, `.ts` extension (e.g., `usePublishing.ts`, `useGeoDatasets.ts`)
- Store slices: `camelCase` with `Slice` suffix (e.g., `editorCoreSlice.ts`, `publishingSlice.ts`)
- Utilities and helpers: `camelCase.ts` (e.g., `resolveBlobReferences.ts`, `normalizeGeoJSON.ts`)
- Index files: `index.ts` — re-export public API of the directory
- Types file: `types.ts` — co-located type definitions for a directory

**Directories:**
- Feature directories: `kebab-case` (e.g., `geo-editor/`, `map-context/`)
- Sub-feature directories: noun or noun-phrase (e.g., `managers/`, `hooks/`, `components/`, `store/`)

**Event modules (`lib/nostr/<event-type>/`):**
- Directory: kebab-case event name (e.g., `geo-event/`, `map-context/`, `geo-proposal/`)
- Files always: `cast.ts`, `factory.ts`, `helpers.ts`, `index.ts`
- Cast class: `PascalCase` matching the concept (e.g., `GeoDataset`, `MapContext`, `GeoComment`)
- Factory class: `PascalCase` + `Factory` suffix (e.g., `GeoDatasetFactory`, `GeoProposalFactory`)

**Zustand store slices:**
- Slice file: `<concern>Slice.ts`
- Creator function: `create<Concern>Slice` (e.g., `createEditorCoreSlice`)
- Slice type: `<Concern>Slice` in `types.ts`

## Where to Add New Code

**New Nostr event kind:**
1. Create `src/lib/nostr/<event-type>/` directory
2. Add `helpers.ts` (pure functions + type guard), `cast.ts` (EventCast subclass), `factory.ts` (EventFactory subclass), `index.ts` (re-exports)
3. Add kind constant to `src/lib/nostr/kinds.ts`
4. Add React hook to `src/lib/hooks/use<EventType>s.ts` using `useTimelineWithEose` + `castEvent`

**New editor manager:**
- Implementation: `src/features/geo-editor/core/managers/<Name>Manager.ts`
- Registration: Add as a public property on `GeoEditor` class in `src/features/geo-editor/core/GeoEditor.ts`
- Pattern: Class that receives `GeoEditor` instance in constructor; pure methods, no React

**New editor store slice:**
- Implementation: `src/features/geo-editor/store/<concern>Slice.ts`
- Registration: Add to `src/features/geo-editor/store/index.ts` composite `create()` call
- Types: Add slice interface to `src/features/geo-editor/store/types.ts` and extend `EditorState`

**New business logic hook (geo-editor):**
- Location: `src/features/geo-editor/hooks/use<Concern>.ts`
- Export from: `src/features/geo-editor/hooks/index.ts` (if this barrel file exists) or import directly
- Pattern: Hook receives options from `GeoEditorView`, reads `useEditorStore`, may use Nostr hooks

**New shared React component:**
- Stateless/presentational: `src/components/<Name>.tsx`
- Feature-specific (geo-editor): `src/features/geo-editor/components/<Name>.tsx`
- Toolbar button group: `src/features/geo-editor/components/toolbar/<Name>.tsx`

**New UI primitive:**
- Location: `src/components/ui/<name>.tsx`
- Pattern: Thin Radix wrapper with Tailwind styling; follow existing files in `src/components/ui/`

**New feature panel (sidebar view):**
1. Create `src/features/<feature>/` directory with main component
2. Add view mode entry to `SidebarViewMode` type in `src/features/geo-editor/store/types.ts`
3. Wire into `AppSidebar.tsx` panel switch
4. Wire navigation into `useRouting.ts` if it needs a URL

**New environment variable:**
1. Add to Zod schema: `src/config/env.schema.ts`
2. Add to client config: `src/config/env.client.ts` (with `safeEnv()` fallback)
3. Add to server config: `src/config/env.server.ts` if needed server-side

## Special Directories

**`data/`:**
- Purpose: SQLite event database and Bluge search index for the Go relay
- Generated: Yes (created by relay on first run)
- Committed: No (gitignored)

**`dist/`:**
- Purpose: Production frontend build output
- Generated: Yes (`bun run build:production`)
- Committed: No (gitignored)

**`relay/`:**
- Purpose: Go relay source — compiled and run separately from the Bun frontend
- Generated: No (hand-authored Go source)
- Committed: Yes

**`.agents/skills/` and `.claude/skills/`:**
- Purpose: GSD agent skill definitions for AI-assisted development
- Generated: No (maintained alongside codebase)
- Committed: Yes

**`public/`:**
- Purpose: Static assets served directly at `/static/*` (stable URLs, not hashed)
- Generated: No
- Committed: Yes

**`base-assets/`:**
- Purpose: Base assets for build pipeline
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-05-24*
