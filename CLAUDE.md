# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Earthly** is a Nostr-based GeoJSON collaborative mapping application. Users can publish, discover, and edit geographic datasets over a decentralized Nostr relay network. The app includes social features like comments, reactions, and city-based discussions.

**Tech Stack:**
- **Runtime:** Bun (not Node.js)
- **Frontend:** React 19 + TypeScript
- **Backend:** Bun.serve() + Go relay (Khatru)
- **Mapping:** MapLibre GL with GeoJSON
- **State Management:** Zustand
- **Nostr Integration:** NDK (Nostr Dev Kit)
- **Styling:** Tailwind CSS v4 + Radix UI
- **Rich Text:** TipTap editor with custom extensions

## Common Commands

### Development
```bash
bun dev                    # Start dev server with HMR (runs ./scripts/dev-clean.sh)
bun relay                  # Start Go relay on port 3334
bun relay:reset            # Reset relay database and restart
bun relay:kill             # Kill relay process
bun run seed full          # Seed local relay: groups/datasets/beacons/stories/comments/reactions
bun run seed sightings     # Seed temporal sightings (37522)
bun run seed minimal       # Fast smoke seed: profiles + 1 dataset
bun run seed canonical     # Real-world datasets from base-assets/base_rips
bun run seed purge         # NIP-09 delete canonical seed data
# All seed commands: --relay <url> --allow-remote --key <hex> --dry-run --verbose
# Non-loopback relays are a HARD ERROR without --allow-remote (docs/RELAY_STAGES.md § Seeding)
```

### Mapnolia (Map Tile Server)
Map chunking and blob storage are handled by **mapnolia** (`github.com/zeSchlausKwab/mapnolia`).
Run the mapnolia binary separately — it serves PMTiles chunks via Blossom and publishes kind 34444 announcements.
Config: `mapnolia.config.json` (gitignored, contains private key). See `mapnolia.config.example.json` for template.

### Building & Deployment
```bash
bun run build             # Frontend build (dev mode)
bun run build:production  # Production build with minification
bun start                 # Run production server (requires build first)
bun run setup:vps         # VPS setup script
bun run deploy            # Deploy to production
```

### Code Quality
```bash
bun run lint              # Check code with Biome
bun run lint:fix          # Auto-fix with Biome
```

### Testing
```bash
bun test                  # Run tests with Bun's test runner
bun run ai:list           # List reusable Earthly browser tasks
bun run ai:e2e            # Run the repo-owned Playwright AI/E2E suite
```

Before writing browser automation, read `ai-suite/README.md` and reuse `ai-suite/tasks/`. Put
one-off browser experiments in `ai-suite/scratch/`.

## Runtime & APIs

**Always use Bun instead of Node.js:**
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build` instead of `webpack` or `vite`
- Bun automatically loads .env files (no need for dotenv)

**Prefer Bun APIs:**
- `Bun.serve()` for HTTP/WebSocket servers (not Express)
- `Bun.file` over `node:fs` readFile/writeFile
- `bun:sqlite` for SQLite (not better-sqlite3)
- Built-in `WebSocket` (not ws package)

## Architecture

### High-Level Structure

```
Frontend (React/Bun) ←→ Nostr Relay (Go/Khatru) ←→ Other Nostr Clients
     ↓                        ↓
MapLibre GL Editor      Mapnolia (Blossom + Chunking)
     ↓                        ↓
GeoJSON Events (kind 37515)  Map Layer Announcements (kind 34444)
Collections (kind 37516)
Comments (kind 37517)
```

### Core Components

**1. GeoEditor (`src/features/geo-editor/core/GeoEditor.ts`)**
- Main editing engine built on MapLibre GL (~1,800 lines)
- Manages drawing modes: point, linestring, polygon
- Handles selection, snapping, undo/redo, transforms
- Organized into managers: SelectionManager, HistoryManager, SnapManager, TransformManager, LayerManager, RenderingManager

**2. Editor State (`src/features/geo-editor/store.ts`)**
- Zustand store with 50+ actions (~660 lines)
- Manages features, mode, selection, datasets, publishing state
- Syncs between GeoEditor instance and React UI

**3. GeoEditorView (`src/features/geo-editor/GeoEditorView.tsx`)**
- ~2,000 line orchestration component
- Coordinates map, toolbar, panels, and editor state
- Handles dataset loading/publishing workflow
- Manages blob reference resolution
- Uses extracted hooks: useDatasetManagement, usePublishing, useMapLayers, useViewMode, useRouting

**4. Nostr Event Classes (`src/lib/ndk/`)**
- `NDKGeoEvent` (kind 37515) - GeoJSON datasets (~370 lines)
- `NDKGeoCollectionEvent` (kind 37516) - Dataset collections (~150 lines)
- `NDKGeoCommentEvent` (kind 37517) - Comments on datasets (~390 lines)
- `NDKMapLayerSetEvent` - Map layer configuration (~70 lines)

**5. Social Features**
- `src/components/comments/` - Threaded comments on datasets
  - `CommentsPanel.tsx` - Comment list container
  - `GeoComment.tsx` - Individual comment display
  - `GeoCommentForm.tsx` - Comment composition
  - `GeoMention.tsx` - @mentions with feature references
  - `GeoSocialActions.tsx` - Reactions and engagement
- `src/components/shoutbox/` - City-based discussions
  - `ShoutboxPanel.tsx` - Local posts panel
  - `PostCard.tsx` - Post display
  - `CommentThread.tsx` - Threaded replies
- `src/components/editor/` - Rich text editing
  - `GeoRichTextEditor.tsx` - TipTap-based editor (~540 lines)
  - `GeoMentionExtension.tsx` - Custom mention handling
  - `MediaExtensions.tsx` - Image/video embedding

**6. Go Relay (`relay/main.go`)**
- Khatru-based Nostr relay
- SQLite for event storage
- Bluge for full-text search (NIP-50)

**7. Mapnolia (External - `github.com/zeSchlausKwab/mapnolia`)**
- Single Go binary providing Blossom blob server + PMTiles chunking
- Publishes kind 34444 map layer announcements to Nostr relays
- Geohash-based chunking for efficient regional tile serving
- Config: `mapnolia.config.json` (gitignored secret)

### Managers (`src/features/geo-editor/core/managers/`)

| Manager | Lines | Purpose |
|---------|-------|---------|
| LayerManager.ts | ~630 | Map layer management |
| RenderingManager.ts | ~300 | Rendering pipeline |
| SnapManager.ts | ~180 | Grid/object snapping |
| SelectionManager.ts | ~160 | Feature selection |
| TransformManager.ts | ~170 | Geometry transforms |
| HistoryManager.ts | ~100 | Undo/redo |

### Hooks (`src/features/geo-editor/hooks/`)

| Hook | Lines | Purpose |
|------|-------|---------|
| usePublishing.ts | ~550 | Dataset publishing workflow |
| useDatasetManagement.ts | ~440 | Dataset CRUD operations |
| useMapLayers.ts | ~410 | Map layer state coordination |
| useRouting.ts | ~270 | Route/sidebar state management |
| useViewMode.ts | ~210 | Edit/view mode toggle |

### Nostr Event Specification

**Kind 37515 - GeoJSON Data Event**
- `content`: RFC 7946 FeatureCollection (JSON string)
- Mandatory tags: `d` (UUID), `bbox` (west,south,east,north)
- Recommended tags: `g` (geohash), `checksum`, `v` (version), `t` (hashtags)
- Blob references: `["blob", "<scope>", "<url>", "sha256=<hex>", "size=<bytes>"]`
  - Scope: `collection` or `feature:<id>`
  - Used for large datasets exceeding relay limits

**Kind 37516 - Collection Event**
- `content`: JSON metadata (name, description, picture, license)
- Tags: `d` (collection ID), `a` (references to 37515 events), `bbox`, `g`

**Kind 37517 - Geo Comment Event**
- `content`: Comment text (supports rich text, mentions)
- Tags: `a` (reference to dataset), `e` (parent comment for threading)

Full spec: See `SPEC.md`

### Blob Handling (Blossom)

Large datasets are stored externally via Blossom blob storage:

**Upload Flow (`src/lib/blossom/blossomUpload.ts`):**
1. User creates dataset exceeding relay size limits
2. `detectBlobScope()` identifies large features
3. `BlossomUploadDialog` shows upload UI with size indicator
4. Geometry uploaded to Blossom server
5. Blob reference tag added to event: `["blob", "feature:id", "url", "sha256=...", "size=..."]`

**Resolution Flow (`src/lib/geo/resolveBlobReferences.ts`):**
1. `ensureResolvedFeatureCollection()` checks for blob tags
2. Fetches external GeoJSON from Blossom URLs
3. Merges with inline features
4. Replaces placeholder features with full geometry

### Build System

**Build Script (`build.ts`)**
- Custom Bun build using `bun-plugin-tailwind`
- Environment variable injection via `define` (bundler replaces `process.env.*`)
- Validates env with Zod schema before build
- Processes all HTML entrypoints in `src/`

**Environment Config:**
- `src/config/env.schema.ts` - Zod validation schema
- `src/config/env.client.ts` - Frontend config (bundler-injected)
- `src/config/env.server.ts` - Backend config
- Required vars: `RELAY_URL`, `SERVER_PUBKEY`, `CLIENT_KEY`

**Server (`src/index.ts`)**
- Development: HTML imports with HMR via `Bun.serve()`
- Production: Serves static files from `dist/` with SPA fallback

### Data Flow

**Publishing a Dataset:**
1. User draws features in GeoEditor
2. Features stored in EditorState.features
3. Click "Publish New"
4. `buildCollectionFromEditor()` creates FeatureCollection
5. If large: upload to Blossom, get blob URL
6. Create NDKGeoEvent, set content and blob references
7. `event.publishNew()` signs and publishes to relay
8. Relay stores in SQLite + indexes in Bluge

**Loading a Dataset:**
1. User selects dataset from GeoDatasetsPanel
2. `loadDatasetForEditing(event)`
3. `ensureResolvedFeatureCollection()` fetches blob references if present
4. `convertGeoEventsToEditorFeatures()` converts to editor format
5. `editor.setFeatures(features)` updates MapLibre layers

### External Integrations

**ContextVM (MCP):**
- `src/ctxcn/EarthlyGeoServerClient.ts` - MCP client for geo services (~440 lines)
- `SearchLocation(query, limit)` - Place name search
- `ReverseLookup(lat, lon, zoom)` - Reverse geocoding
- Uses Nostr transport for communication

**MapLibre Ecosystem:**
- Protomaps basemaps for tile rendering
- PMTiles for local tile serving (supports raster and vector tiles)
- OpenFreeMap styles (Liberty style default)
- Geohash-based tile chunking for efficient regional loading

## Code Organization Principles

1. **Feature-based directory structure** - Each major feature in its own directory
2. **Separation of concerns** - Core editor logic separate from UI components
3. **Type-safe throughout** - TypeScript with strict mode
4. **State management patterns:**
   - Zustand for local UI state
   - Nostr events for shared/persistent state
5. **MapLibre layer abstraction** - GeoEditor manages all map layers internally
6. **Hook composition** - Business logic extracted into reusable hooks
7. **Manager pattern** - Editor functionality split into focused managers

## Development Notes

- **Editor size:** `GeoEditorView.tsx` is intentionally large (~2000 lines) as the orchestration layer
- **Managers:** Core editor functionality split into 6 focused managers
- **Hooks:** Business logic extracted to 5 custom hooks in `hooks/` directory
- **Blob handling:** Large GeoJSON stored externally via Blossom with event references
- **Mobile-first:** Responsive UI with collapsible panels
- **Test data:** Use `bun run seed full` (+ `seed sightings`) for the dev fixture set; the unified seeder lives in `src/lib/seeder/`
- **Code quality:** Biome is used for linting and formatting (not ESLint/Prettier)
- **Map tiles:** PMTiles chunking and blob storage handled by mapnolia (external binary)
- **Social hooks:** `useGeoComments` and `useGeoReactions` in `src/lib/hooks/` for comment subscriptions

## Directory Structure

```
src/
├── components/           # Shared UI components
│   ├── ui/              # Radix-based primitives (30+ components)
│   ├── info-panel/      # InfoPanel sub-components (11 files, ~2,700 lines)
│   │   └── geometry/    # Geometry visualization (2 files)
│   ├── comments/        # Comment system (5 files, ~1,100 lines)
│   ├── shoutbox/        # City discussions (6 files, ~1,900 lines)
│   └── editor/          # Rich text editor (5 files, ~1,400 lines)
│
├── features/
│   └── geo-editor/      # Main editor feature
│       ├── core/        # Editor engine
│       │   ├── GeoEditor.ts (~1,800 lines)
│       │   ├── managers/ (6 files, ~1,500 lines)
│       │   └── modes/ (2 files)
│       ├── components/ (10+ files)
│       ├── hooks/ (5 files, ~1,900 lines)
│       ├── GeoEditorView.tsx (~2,000 lines)
│       └── store.ts (~660 lines)
│
├── lib/                 # Shared libraries
│   ├── ndk/            # Nostr event wrappers (4 files)
│   ├── blossom/        # Blob upload utilities
│   ├── geo/            # GeoJSON utilities
│   └── hooks/          # Shared hooks (comments, reactions, etc.)
│
├── ctxcn/              # MCP Geo Server Client
└── config/             # Environment configuration
```

## File References

When referencing code, use the format `file_path:line_number` for easy navigation.

Example: The GeoEditor class is initialized in `src/features/geo-editor/GeoEditorView.tsx:234`
