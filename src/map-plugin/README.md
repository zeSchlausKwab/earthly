# Earthly public map plugin — initial vertical slice

A separate Bun service reuses Earthly's kind-37515 event builder and MapLibre feature-layer bundle. It supplies a ChatGPT/MCP Apps component, a public map page, and a configurable iframe. Saved maps are Nostr events, not database records owned by this service.

## Run locally

From the repository root, with dependencies installed:

```sh
# Use an existing disposable local Earthly relay, or start one:
bun run relay

# In another terminal:
bun run dev:map-plugin
```

The server defaults to `http://127.0.0.1:3337`, with MCP at `/mcp` and relay `ws://127.0.0.1:3334`. No application or ContextVM signing key is required. The service builds its viewer and MapLibre worker on startup; restart after source changes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `EARTHLY_MAP_HOST` | `127.0.0.1` | Listening address |
| `EARTHLY_MAP_PORT` | `3337` | HTTP port |
| `EARTHLY_MAP_PUBLIC_URL` | `http://127.0.0.1:<port>` | Trusted origin for assets, links, and host validation; no path |
| `EARTHLY_MAP_RELEASE` | `development` | Release identifier reported by `/health` |
| `EARTHLY_MAP_RELAYS` | `ws://127.0.0.1:3334` | One to five comma-separated read/write relays |

Production deployment is available through `bun run deploy:map-plugin`; see [PM2 and Caddy operations](../../ops/vps/map-plugin/README.md). It requires an explicit HTTPS origin and WSS relay configuration. Plugin installation in ChatGPT is a separate step. The initial unauthenticated guest service has bounded sessions/maps/request sizes, but has no account authentication, durable key recovery, distributed session store, or deployment-wide abuse controls. Run one process or use session affinity; these are the current limits of the hosted pilot.

## Tools and lifecycle

- `find_map_locations`: reuse Earthly's rate-limited/cached Nominatim adapter; return up to five named candidates, coordinates, and sources. The model resolves ambiguity before map creation.
- `preview_map`: validate a complete FeatureCollection, return a temporary map and stable feature IDs. Supplying draftId plus its current revision revises that draft. No relay writes.
- `publish_map`: publish the exact preview revision under a per-map guest key, requiring `visibility: "public"`. Only acknowledged publication returns a public reference. Failed/uncertain publication retains the signed event for retry and blocks edits until retried.
- `read_map`: read the latest matching event from configured relays, verify its signature, and return inline geometry. Relay hints inside an input reference never cause arbitrary server-side connections.
- `get_map_embed`: verify the published map is readable and return a configured embed URL plus HTML.

The MCP adapter uses Streamable HTTP with session IDs. Connections last at most **two hours from initialization** and can create at most 20 maps; the process supports at most 64 connections and 1,280 retained drafts. Drafts and guest keys live in a bounded process-local store because ChatGPT can reconnect between turns. A draft's original expiry never extends when edited or resumed: it lasts at most two hours, or until server restart.

The random UUID `draftId` is a bearer editing capability, not a public map identifier. An MCP client presenting it and the current revision can resume editing or publication after reconnecting. Keep it in the originating conversation; never include it in published properties, public URLs, or iframe code. Public readers receive only the Nostr reference, with no editing capability. No private signing key is passed to the model or UI. Closing an MCP connection does not revoke its drafts; expiry clears them and wipes retained key bytes. After expiry or restart, a caller can read a saved map and publish a copy with a different address.

Updates keep the map's author and d-tag and advance its version/time using the shared event factory. A read-before-write detects observed conflicts, not a global Nostr lock. Repeat publication calls reuse the same signed event. Public reading after expiry/restart depends only on the configured relays retaining the event.

## Viewer and embedding

`ui://earthly/public-map/v1.html` is the MCP Apps resource. It uses the standard initialize/initialized handshake, tool-result notifications, selection context, and fullscreen request. Its declared resource policy covers this service and OpenFreeMap. MapLibre's worker is bundled and loaded into a local Blob to work across the host sandbox's origin boundary.

- `/maps/<naddr>` — public reader, no account required.
- `/embed/<naddr>` — iframe reader, no account or chat state required.
- `/api/maps/<naddr>` — public map data resolved from Nostr.
- `/component` — component entrypoint for local host testing; requires an MCP Apps parent to receive data.
- `/health` — service status and configured relay URLs.

Embed schema version `v=1` supports `theme=light|dark`, `title=true|false`, `legend=true|false`, `controls=true|false`, `scrollZoom=true|false`, `center=longitude,latitude`, and `zoom=0..20`. Generated HTML is responsive (`width="100%"`) with configurable height 200–2000 px. Source attribution is independent of the legend/title settings. Links resolve the latest published version on load; they are not historical snapshots or continuous live subscriptions.

Basic geometry styling, icons, line arrows, and labels reuse Earthly's existing layer bundle. The pilot displays text callouts; rich callout media and advanced layout are not implemented. A source link and feature description appear when a feature is selected. The map list supplies a keyboard-accessible selection path.

## Current limits

- Inline GeoJSON only: **300 features / 48 KiB**, with validation before rendering or signing. Blob-backed maps return an explicit unsupported error rather than an incomplete preview.
- Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon. GeometryCollection and null geometry are not supported by this slice.
- Coordinate bounds, polygon closure, duplicate IDs, basic style values, and payload limits are validated. No automatic topology repair or guarantee that supplied geographic claims are true.
- A small map can originate anywhere, but binary file ingestion is still the caller/host's responsibility. No upload tool, fleet optimizer, PDF renderer, private groups, web-component package, or Napplet runtime.
- Guest signing policy is an initial implementation default, not a recovery promise. Connected user signers remain follow-up work.
- No hosted ChatGPT connection has been verified. The local browser contract tests the MCP component in a sandbox; a real hosted handshake/resource-policy check remains necessary before release.

## Verification

```sh
bun run test:map-plugin
bun test src/lib/nostr/geo-event/factory.test.ts src/lib/nostr/publishAcknowledgement.test.ts

# Plugin and a disposable loopback relay must already be running:
bun run test:map-plugin:browser
```

The browser scenarios refuse a server configured with any non-loopback relay. They use the real MCP tools, signature/publishing path, and public viewer on desktop/mobile; only basemap requests are replaced with a deterministic background style. They also test a sandboxed MCP host handshake and selection context across separate origins. They create disposable local events and never reset existing relay contents. The normal AI Suite skips these scenarios unless `AI_SUITE_MAP_PLUGIN=1` is set.

The source plugin package is in [plugins/earthly-maps](../../plugins/earthly-maps/README.md). The broader discussion remains in [the architecture roadmap](../../docs/HEADLESS-EARTHLY-ARCHITECTURE-ROADMAP.md).
