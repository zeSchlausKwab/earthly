# Technology Stack

**Analysis Date:** 2026-05-24

## Languages

**Primary:**
- TypeScript (ESNext target, strict mode) - All frontend and backend application code
- Go 1.24.1 (toolchain go1.24.5) - Nostr relay (`relay/`)

**Secondary:**
- CSS (Tailwind v4) - Styling via PostCSS-style processing
- HTML - Entry point templates in `src/` processed by Bun bundler

## Runtime

**Environment:**
- Bun (no version pin in package.json; lockfile v1 present)
- Node.js is explicitly NOT used — all scripts use `bun <file>`

**Package Manager:**
- Bun (`bun install`)
- Lockfile: `bun.lock` (present, version 1)

## Frameworks

**Core Frontend:**
- React 19.2.5 - UI rendering (`react`, `react-dom`)
- Tailwind CSS 4.2.4 - Utility-first styling (via `bun-plugin-tailwind` at build time and `bunfig.toml` serve plugin)
- Radix UI - Headless component primitives (13 `@radix-ui/*` packages, all pinned to recent minor versions)
- shadcn/ui conventions - Component wiring via `components.json` (New York style, neutral base)

**State Management:**
- Zustand 5.0.12 - Local UI state stores (`src/features/*/store.ts`, `src/features/geo-editor/store/*.ts`)
- RxJS 7.x (transitive via applesauce) - Reactive event streams used in `src/lib/nostr/index.ts`, `src/lib/wallet/runtime.ts`, `src/lib/nostr/hooks.ts`
- applesauce-core `EventStore` - Reactive Nostr event database (single global instance in `src/lib/nostr/index.ts`)

**Mapping:**
- MapLibre GL 5.24.0 - WebGL map rendering (`maplibre-gl`, `@types/maplibre-gl`)
- Protomaps Basemaps 5.7.2 - Named basemap style flavors (`@protomaps/basemaps`)
- PMTiles 4.4.1 - Local tile serving from `.pmtiles` files (`pmtiles`)
- Turf.js 7.3.5 - Geospatial analysis: bearing, union, difference, centerOfMass (`@turf/turf`)

**Rich Text:**
- TipTap 3.22.5 - Rich text editor with ProseMirror backend (`@tiptap/react`, `@tiptap/starter-kit`, extensions for image, link, mention, placeholder, YouTube, PM state)

**Build:**
- `bun build` (native Bun bundler) - Frontend bundle via `build.ts`
- `bun-plugin-tailwind 0.1.2` - Tailwind CSS integration for both dev HMR and production build
- `bun-plugin-env` (local script `scripts/bun-plugin-env.ts`) - Environment injection during dev HMR serve

**Testing:**
- Bun test runner (`bun test`) - No dedicated test framework; uses Bun's built-in test runner

**Linting/Formatting:**
- Biome 2.4.14 - Linter + formatter (`biome.json`): tabs, 100-char line width, single quotes, no semicolons; excludes `src/components/ui/`

**Go Relay:**
- Khatru 0.19.1 - Nostr relay framework (`github.com/fiatjaf/khatru`)
- go-nostr 0.52.0 - Go Nostr protocol primitives (`github.com/nbd-wtf/go-nostr`)
- eventstore 0.17.2 - Storage adapters: SQLite3 (primary), Badger (transitive), Bluge (full-text search)

## Key Dependencies

**Critical:**
- `applesauce-*` (all at ^6.0.x) - Nostr reactive layer replacing NDK: `applesauce-core`, `applesauce-accounts`, `applesauce-actions`, `applesauce-common`, `applesauce-loaders`, `applesauce-react`, `applesauce-relay`, `applesauce-signers`, `applesauce-wallet`
- `nostr-tools` - Low-level Nostr protocol utilities: nip19 encoding, event helpers, types (`nostr-tools`)
- `nostr-idb` 5.0.0 - IndexedDB-backed Nostr event cache wired into applesauce (`nostr-idb`)
- `blossom-client-sdk` 5.0.0 - Blossom blob upload with NIP-98 auth (`blossom-client-sdk`), used in `src/lib/blossom/blossomUpload.ts`
- `@contextvm/sdk` 0.9.1 - ContextVM MCP transport over Nostr WebSocket, used in `src/ctxcn/EarthlyGeoServerClient.ts` and `contextvm/server.ts`
- `@modelcontextprotocol/sdk` 1.29.0 - MCP server/client primitives; used by ContextVM geo server (`contextvm/server.ts`)
- `zod` (transitive via `@contextvm/sdk`) - Runtime schema validation; used directly in `src/config/env.schema.ts` for env validation

**Nostr/Crypto:**
- `@noble/hashes` (transitive, also direct) - Cryptographic hash utilities, used in `src/index.ts` and `src/lib/seed-relay/index.ts`
- `@noble/curves` (transitive) - Elliptic curve operations underlying Nostr key handling

**Payments/Wallet:**
- `@cashu/cashu-ts` 3.6.4 - Cashu ecash protocol client
- `coco-cashu-core` / `coco-cashu-indexeddb` / `coco-cashu-react` (^1.0.0-rc11 / ^1.1.1) - Cashu wallet UI + IndexedDB persistence
- `applesauce-wallet` 6.0.0 - NIP-60 wallet implementation built on applesauce
- Lightning zaps supported via `parseLNURLOrAddress`, `getInvoice` from `applesauce-common/helpers`

**UI Utilities:**
- `lucide-react` 0.577.0 - Icon set
- `sonner` 2.0.7 - Toast notifications
- `next-themes` 0.4.6 - Dark/light theme management
- `date-fns` 4.1.0 - Date formatting
- `class-variance-authority` 0.7.1 - Component variant system (CVA)
- `clsx` 2.1.1 + `tailwind-merge` 3.5.0 - Class name utilities (`src/lib/utils.ts`)
- `react-resizable-panels` 2.1.7 - Resizable panel layouts
- `@formkit/auto-animate` 0.9.0 - Automatic list animations
- `@tanstack/react-table` 8.21.3 - Headless table primitives
- `driver.js` 1.4.0 - Onboarding tour (`src/features/tour/`)

**GeoData I/O:**
- `shpjs` 6.2.0 - Shapefile import (browser, dynamic import)
- `@mapbox/shp-write` 0.4.3 - Shapefile export (browser, dynamic import)
- `ajv` 8.20.0 + `ajv-formats` 3.0.1 - JSON Schema validation for Map Context events

**OG Image Generation:**
- `@resvg/resvg-wasm` 2.6.2 - SVG-to-PNG rendering for Open Graph images (`src/lib/og/renderImage.ts`)
- `linkedom` 0.18.12 - Server-side DOM for OG HTML generation
- `@mozilla/readability` 0.6.0 - Article extraction for web fetch tool

**Auth/Identity QR:**
- `qrcode.react` 4.2.0 - QR code display
- `@yudiel/react-qr-scanner` 2.5.1 - QR code scanning (camera)

**Data Display:**
- `react18-json-view` 0.2.10 - JSON tree viewer component
- `@faker-js/faker` 10.4.0 - Seed data generation (`scripts/seed.ts`)

## Configuration

**Environment:**
- Bun auto-loads `.env` files (no dotenv needed)
- `.env` and `.env.production` present (contents not read)
- Validated at build time and server startup via Zod schema in `src/config/env.schema.ts`
- Frontend env vars injected as `process.env.*` literals by Bun bundler `define` option

**Key env vars:**
- `RELAY_URL` - Primary Nostr relay WebSocket URL
- `EXTRA_READ_RELAYS` - Optional additional read-only relays
- `SERVER_PUBKEY` / `CLIENT_KEY` - ContextVM MCP communication keys
- `SERVER_KEY` - Backend-only private key for ContextVM server
- `APP_PRIVATE_KEY` - Backend signing key
- `BLOSSOM_SERVER` - Blossom blob storage URL
- `SEARXNG_URL` - Optional SearXNG instance for web search tool
- `VALHALLA_URL` - Optional Valhalla routing API

**Build:**
- `build.ts` - Custom Bun build script; reads all `src/**/*.html` as entrypoints, injects frontend env vars, enables code splitting and minification for production
- `bunfig.toml` - Dev serve config loads `bun-plugin-tailwind` and `./scripts/bun-plugin-env.ts`
- `tsconfig.json` - Path alias `@/*` → `./src/*`; strict mode on; bundler module resolution

## Platform Requirements

**Development:**
- Bun runtime (latest stable recommended)
- Go 1.24.1+ for relay development
- Local Nostr relay on port 3334 (Go/Khatru)
- Optional: mapnolia binary for PMTiles tile serving (external, `github.com/zeSchlausKwab/mapnolia`)
- Optional: SearXNG instance, Valhalla instance for full ContextVM geo server capabilities

**Production:**
- VPS with Bun, Go, PM2 (process manager)
- Caddy web server (reverse proxy, TLS termination) — `Caddyfile` present
- PM2 manages `earthly-web` (port 3000) and `earthly-contextvm` processes (`ecosystem.config.cjs`)
- Caddy proxies: `earthly.city` → 3000, `relay.earthly.city` → 3334, `blossom.earthly.city` → 3001
- Frontend served from `dist/` (SPA with HTML fallback)
- Relay data stored in `relay/data/events.db` (SQLite) + `relay/data/search/` (Bluge index)

---

*Stack analysis: 2026-05-24*
