# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Earthly** is a Nostr-based GeoJSON collaborative mapping application. Users can publish, discover, and edit geographic datasets over a decentralized Nostr relay network.

**Tech Stack:**
- **Runtime:** Bun (not Node.js)
- **Frontend:** React 19 + TypeScript
- **Backend:** Bun.serve() + Go relay (Khatru)
- **Mapping:** MapLibre GL with GeoJSON
- **State Management:** Zustand
- **Nostr Integration:** NDK (Nostr Dev Kit)
- **Styling:** Tailwind CSS v4 + Radix UI

## Common Commands

### Development
```bash
bun dev                    # Start dev server with HMR (runs ./scripts/dev-clean.sh)
bun relay                  # Start Go relay on port 3334
bun relay:reset            # Reset relay database and restart
bun relay:kill             # Kill relay process
bun run seed              # Generate seed data with Faker
```

### Building & Deployment
```bash
bun run build             # Frontend build (dev mode)
bun run build:production  # Production build with minification
bun start                 # Run production server (requires build first)
bun run setup:vps         # VPS setup script
bun run deploy            # Deploy to production
```

### Testing
```bash
bun test                  # Run tests with Bun's test runner
```

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
     ↓
MapLibre GL Editor
     ↓
GeoJSON Events (kind 31991)
Collections (kind 30406)
```

### Core Components

**1. GeoEditor (`src/features/geo-editor/core/GeoEditor.ts`)**
- Main editing engine built on MapLibre GL
- Manages drawing modes: point, linestring, polygon
- Handles selection, snapping, undo/redo, transforms
- Organized into managers: SelectionManager, HistoryManager, SnapManager, TransformManager

**2. Editor State (`src/features/geo-editor/store.ts`)**
- Zustand store with 50+ actions
- Manages features, mode, selection, datasets, publishing state
- Syncs between GeoEditor instance and React UI

**3. GeoEditorView (`src/features/geo-editor/GeoEditorView.tsx`)**
- ~2000 line orchestration component
- Coordinates map, toolbar, panels, and editor state
- Handles dataset loading/publishing workflow
- Manages blob reference resolution

**4. Nostr Event Classes**
- `NDKGeoEvent` (kind 31991) - GeoJSON datasets
- `NDKGeoCollectionEvent` (kind 30406) - Dataset collections
- Custom NDK event wrappers with GeoJSON-specific methods

**5. Go Relay (`relay/main.go`)**
- Khatru-based Nostr relay
- SQLite for event storage
- Bluge for full-text search (NIP-50)
- Supports Blossom blob storage

### Nostr Event Specification

**Kind 31991 - GeoJSON Data Event**
- `content`: RFC 7946 FeatureCollection (JSON string)
- Mandatory tags: `d` (UUID), `bbox` (west,south,east,north)
- Recommended tags: `g` (geohash), `checksum`, `v` (version), `t` (hashtags)
- Blob references: `["blob", "<scope>", "<url>", "sha256=<hex>", "size=<bytes>"]`
  - Scope: `collection` or `feature:<id>`
  - Used for large datasets exceeding relay limits

**Kind 30406 - Collection Event**
- `content`: JSON metadata (name, description, picture, license)
- Tags: `d` (collection ID), `a` (references to 31991 events), `bbox`, `g`

Full spec: See `SPEC.md`

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
5. Create NDKGeoEvent, set content and blob references
6. `event.publishNew()` signs and publishes to relay
7. Relay stores in SQLite + indexes in Bluge

**Loading a Dataset:**
1. User selects dataset from GeoDatasetsPanel
2. `loadDatasetForEditing(event)`
3. `ensureResolvedFeatureCollection()` fetches blob references if present
4. `convertGeoEventsToEditorFeatures()` converts to editor format
5. `editor.setFeatures(features)` updates MapLibre layers

### External Integrations

**ContextVM (MCP):**
- `src/ctxcn/EarthlyGeoServerClient.ts` - MCP client for geo services
- `SearchLocation(query, limit)` - Place name search
- `ReverseLookup(lat, lon, zoom)` - Reverse geocoding
- Uses Nostr transport for communication

**MapLibre Ecosystem:**
- Protomaps basemaps for tile rendering
- PMTiles for local tile serving
- OpenFreeMap styles (Liberty style default)

## Code Organization Principles

1. **Feature-based directory structure** - Each major feature in its own directory
2. **Separation of concerns** - Core editor logic separate from UI components
3. **Type-safe throughout** - TypeScript with strict mode
4. **State management patterns:**
   - Zustand for local UI state
   - Nostr events for shared/persistent state
5. **MapLibre layer abstraction** - GeoEditor manages all map layers internally

## Development Notes

- **Editor size:** `GeoEditorView.tsx` is intentionally large (~2000 lines) as the orchestration layer
- **Managers:** Core editor functionality split into focused managers (Selection, History, Snap, Transform)
- **Blob handling:** Large GeoJSON can be external (HTTPS/IPFS) with references in event tags
- **Mobile-first:** Responsive UI with collapsible panels
- **Test data:** Use `bun run seed` to generate fake datasets with Faker

## File References

When referencing code, use the format `file_path:line_number` for easy navigation.

Example: The GeoEditor class is initialized in `src/features/geo-editor/GeoEditorView.tsx:234`