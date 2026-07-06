# External Integrations

**Analysis Date:** 2026-05-24

## APIs & External Services

**Nostr Protocol Network:**
- Nostr Relay (self-hosted, Khatru/Go) - Primary event storage and pub/sub
  - SDK/Client: `applesauce-relay` RelayPool + `nostr-tools`
  - Connection: `RELAY_URL` env var (default `wss://relay.earthly.city`)
  - NIP support: 1, 9, 11, 12, 15, 16, 20, 22, 33, 40, 50 (full-text search)
  - Relay code: `relay/main.go`

**Blossom Blob Storage:**
- Blossom server (self-hosted, `blossom.earthly.city`) - External storage for large GeoJSON datasets exceeding relay event size limits (2MB relay cap)
  - SDK/Client: `blossom-client-sdk` 5.0.0
  - Auth: NIP-98 Nostr HTTP auth signed by active applesauce signer
  - Config: `BLOSSOM_SERVER` env var (default `https://blossom.earthly.city` / `http://localhost:3544` in dev)
  - Implementation: `src/lib/blossom/blossomUpload.ts`, `contextvm/tools/blossom.ts`
  - Protocol: BUD-02 (Blossom upload/download)

**ContextVM / MCP Geo Server:**
- ContextVM (self-hosted sidecar process) - AI geo assistant tools served over Nostr transport
  - SDK/Client: `@contextvm/sdk` 0.9.1, `@modelcontextprotocol/sdk` 1.29.0
  - Auth: Nostr keypair (`SERVER_KEY` / `SERVER_PUBKEY` / `CLIENT_KEY` env vars)
  - Transport: `NostrServerTransport` / `NostrClientTransport` over `ApplesauceRelayPool`
  - Server: `contextvm/server.ts` (runs as separate PM2 process `earthly-contextvm`)
  - Client: `src/ctxcn/EarthlyGeoServerClient.ts` (frontend MCP client)
  - Tools exposed: `SearchLocation`, `ReverseLookup`, `QueryById`, `QueryNearby`, `QueryBbox`, `ResolveOsmEntity`, `GetOsmRelationGeometry`, `GetCountryBoundary`, `ValhallaRoute`, `ValhallaIsochrone`, `CreateMapExtract`, `CreateMapUpload`, `WebSearch`, `FetchUrl`, `WikipediaLookup`

**Nominatim (OpenStreetMap Geocoding):**
- `https://nominatim.openstreetmap.org` - Place name search and reverse geocoding
  - No API key required (public instance, rate-limited)
  - User-Agent: `EarthlyCity/1.0 Map MCP Server (https://earthly.city)`
  - Used by: `contextvm/tools/nominatim.ts` → exposed as `SearchLocation`, `ReverseLookup` MCP tools

**Overpass API (OSM Data):**
- Public Overpass instances (fallback chain):
  - `https://overpass-api.de/api/interpreter`
  - `https://overpass.kumi.systems/api/interpreter`
  - `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
  - No API key required
  - Used by: `contextvm/tools/overpass.ts` → exposed as `QueryById`, `QueryNearby`, `QueryBbox`, OSM boundary tools

**Valhalla Routing:**
- Self-hosted or external Valhalla instance - Route computation and isochrone generation
  - Config: `VALHALLA_URL` env var (optional, backend-only)
  - Used by: `contextvm/tools/valhalla.ts` → exposed as `ValhallaRoute`, `ValhallaIsochrone` MCP tools
  - Frontend triggers via ContextVM chat tool execution (`src/features/chat/tools/execute.ts`)

**SearXNG Web Search:**
- Self-hosted SearXNG instance - Meta-search for web search tool
  - Config: `SEARXNG_URL` env var (optional, backend-only)
  - Used by: `contextvm/tools/web-search.ts` → exposed as `WebSearch` MCP tool

**Wikipedia:**
- `https://{language}.wikipedia.org/w/api.php` - Article lookup and content extraction
  - No API key required (public API)
  - Used by: `contextvm/tools/wikipedia.ts` → exposed as `WikipediaLookup` MCP tool

**Mapnolia (External Binary):**
- `github.com/zeSchlausKwab/mapnolia` - PMTiles chunking + Blossom blob server + kind 34444 map layer announcements
  - Runs as separate process (not managed by this repo's PM2 config)
  - Config: `mapnolia.config.json` (gitignored, contains private key; see `mapnolia.config.example.json`)
  - Serves PMTiles chunks via Blossom at port 3001 (proxied by Caddy as `blossom.earthly.city`)
  - Publishes Nostr kind 34444 events announcing map tile layers

**Protomaps / OpenFreeMap:**
- Protomaps basemap styles via `@protomaps/basemaps` 5.7.2 - Vector tile style definitions (Liberty style default)
- PMTiles files loaded via local or Blossom-served chunks

## Data Storage

**Databases:**
- SQLite3 (Go relay primary store)
  - Connection: file at `relay/data/events.db` (configurable via `--db-path` flag)
  - Client: `github.com/fiatjaf/eventstore/sqlite3` + `github.com/mattn/go-sqlite3`
  - Stores all Nostr events

- Bluge (full-text search index in Go relay)
  - Path: `relay/data/search/` (configurable via `--search-path` flag)
  - Client: `github.com/fiatjaf/eventstore/bluge` + `github.com/blugelabs/bluge`
  - Powers NIP-50 full-text event search

**Browser Storage:**
- IndexedDB via `nostr-idb` 5.0.0 - Client-side Nostr event cache (max 20,000 events, 2,000 cache indexes)
  - Managed in `src/lib/nostr/index.ts` (`cache`, `cacheReady`, `stopPersist`)
  - Events written via `persistEventsToCache` from `applesauce-core/helpers`

- IndexedDB via `coco-cashu-indexeddb` - Cashu wallet token storage
  - Runtime singleton: `couch` (`IndexedDBCouch`) in `src/lib/wallet/runtime.ts`

- localStorage - User preferences and session state
  - Account persistence: `earthly:accounts`, `earthly:active-account` keys (`src/lib/nostr/index.ts`)
  - Editor draft state: scoped per-user keys (`src/features/geo-editor/store/persistence.ts`)
  - Chat settings: `chat-store`, per-pubkey chat settings (`src/features/chat/`)
  - Tour seen state: `earthly:tour-seen` (`src/features/tour/store.ts`)
  - Default mint preference for NIP-60 wallet (`src/features/chat/store.ts`)

**File Storage:**
- Blossom server (`blossom.earthly.city` / mapnolia binary) - Large GeoJSON blobs and PMTiles chunks
- `public/` directory - Static assets served at stable URLs

**Caching:**
- In-memory: applesauce `EventStore` (reactive event database, global singleton)
- IndexedDB: `nostr-idb` write-through cache for Nostr events
- In-memory OG data cache: `src/lib/og/cache.ts` (TTL-based for OG meta generation)

## Authentication & Identity

**Auth Provider:**
- Nostr keypairs (self-sovereign) - All identity is Nostr public/private key pairs
  - No centralized auth provider
  - Implementation: `applesauce-accounts` + `applesauce-signers`

**Supported Login Methods (NIP implementations):**
- NIP-07: Browser extension signer (`ExtensionAccount` from `applesauce-accounts/accounts`) — `src/features/auth/SessionsManager.tsx`
- NIP-46: Remote signer (Nostr Connect / bunker) via `NostrConnectSigner`, `NostrConnectAccount` — `src/features/auth/Nip46LoginDialog.tsx`
- NIP-01: Raw private key (`PrivateKeyAccount`, `PrivateKeySigner`) — `src/features/auth/SignupDialog.tsx`
- NIP-65: Outbox/inbox relay routing per user mailbox — `src/features/settings/UserRelayManager.tsx`

**Account Persistence:**
- Accounts serialized to localStorage as JSON; ephemeral accounts (rememberMe=false) excluded
- Active account ID stored separately; restored on page load
- `src/lib/nostr/index.ts` owns full persistence lifecycle

## Monitoring & Observability

**Error Tracking:**
- Not detected — no Sentry, Datadog, or similar configured

**Logs:**
- PM2 log files: `logs/web-error.log`, `logs/web-out.log`, `logs/contextvm-error.log`, `logs/contextvm-out.log`
- Caddy access logs: `/var/log/caddy/*.log` (JSON format)
- Console logs in source code (no structured logging library on frontend)
- Go relay: standard `log` package to stdout

## CI/CD & Deployment

**Hosting:**
- VPS (Linux) with Caddy + PM2
- Production domain: `earthly.city`
- Caddy handles TLS (automatic via Let's Encrypt), reverse proxying to local ports

**Deployment Pipeline:**
- `bun run deploy` → `scripts/deploy.sh` (rsync + remote commands)
- `bun run build:production` → `scripts/build-production.sh` (minified Bun build)
- `bun run setup:vps` → `scripts/setup-vps.sh` (initial server provisioning)
- No CI service detected (no GitHub Actions, CircleCI, etc.)

**Process Management:**
- PM2 manages two processes:
  - `earthly-web`: `src/index.ts` via Bun, port 3000
  - `earthly-contextvm`: `contextvm/server.ts` via Bun
- Go relay run separately: `bun relay` (or `go run . --port 3334` in `relay/`)
- Mapnolia binary run separately (external)

## Environment Configuration

**Required env vars:**
- `RELAY_URL` - Nostr relay WebSocket URL (defaults to `wss://relay.earthly.city` in prod, `ws://localhost:3334` in dev)
- `SERVER_PUBKEY` - ContextVM geo server public key (has hardcoded dev default)
- `CLIENT_KEY` - ContextVM client private key (has hardcoded dev default)
- `BLOSSOM_SERVER` - Blossom server URL (defaults to `https://blossom.earthly.city` in prod, `http://localhost:3544` in dev)

**Optional env vars (backend-only):**
- `SERVER_KEY` - ContextVM server private key (64-char hex)
- `APP_PRIVATE_KEY` - App signing key (64-char hex)
- `SEARXNG_URL` - SearXNG instance URL for web search
- `VALHALLA_URL` - Valhalla routing API URL
- `EXTRA_READ_RELAYS` - Comma-separated additional read-only relay URLs
- `PORT` - HTTP server port (default 3000)

**Secrets location:**
- `.env` (development, gitignored)
- `.env.production` (production, gitignored)
- `mapnolia.config.json` (gitignored, contains mapnolia private key)
- Bun auto-loads `.env` files at runtime; no dotenv package needed

## Webhooks & Callbacks

**Incoming:**
- None detected (no webhook receiver endpoints)

**Outgoing:**
- None detected (no outgoing webhook dispatchers)

**Nostr Subscriptions (real-time):**
- WebSocket subscriptions to Nostr relay via `applesauce-relay` RelayPool
- Subscriptions managed by `createEventLoaderForStore` in `src/lib/nostr/index.ts`
- Individual feature subscriptions via applesauce React hooks (`use$`, `useActiveAccount`, etc.)

**OG Metadata Routes (production only):**
- `GET /geoevent/:naddr` - Serves OG HTML for social media crawlers; redirects regular users
- `GET /context/:naddr` - Serves OG HTML for map contexts; redirects regular users
- `GET /og/image/:type/:naddr` - Generates PNG OG images via `@resvg/resvg-wasm`
- Crawler detection in `src/lib/og/crawler.ts`; event data fetched from relay for OG generation

---

*Integration audit: 2026-05-24*
