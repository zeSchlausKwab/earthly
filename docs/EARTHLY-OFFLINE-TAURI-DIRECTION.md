# Earthly Offline and Tauri Direction

Authoritative source: `/Users/schlaus/.codex/attachments/04fed690-febb-445e-b60d-a473cda6884f/pasted-text.txt`
Identical workspace copy: `/Users/schlaus/workspace/blosmap/MAPNOLIA-PLAN.md`
Extracted: 2026-07-13
Status: architecture brief for discussion; not an implementation plan

## Purpose

This document isolates the parts of the Mapnolia strategy that Earthly must implement or
integrate. It deliberately excludes Mapnolia server operations such as chunk production,
mirroring engines, access-control ledgers, monetization settlement, request ranking, and
planet-file distribution.

The central product direction is an offline hiking workflow built in two stages:

1. Make Earthly genuinely offline-capable as a web app.
2. Ship a supported Tauri v2 application that reuses those web-facing capabilities while replacing
   quota-limited browser storage and remote-only Nostr access with native facilities.

Tauri is therefore an adapter over shared offline domain services, not a fork of the application.
Its complete production plan is defined in [`TAURI-IMPLEMENTATION-PLAN.md`](TAURI-IMPLEMENTATION-PLAN.md).

## Decisions inherited from the source plan

- Keep geohash-indexed PMTiles chunks and longest-prefix lookup. Do not add H3 or fork PMTiles.
- Use mirrors and ordered server failover for client-side resilience. Do not use client-side
  WebTorrent.
- Store complete immutable PMTiles chunk blobs explicitly for offline use. Do not depend on the
  browser HTTP cache for Range/206 responses.
- Keep Citrine and Morganite as optional interoperability targets. Earthly must not require
  companion apps for core offline behavior.
- QR codes exchange identity or rendezvous information, not map or event payloads.
- Build storage, map-source, event-cache, and outbox boundaries that both web and Tauri adapters
  can implement.
- Treat Tauri as a committed production application with desktop/mobile release, security,
  migration, and operational ownership.

## Earthly scope

### 1. Secure and resilient Mapnolia consumption

Earthly must migrate its local kind-34444 discovery and `pmworld://` implementation to the
Mapnolia MapLibre package once that package is consumable. The integration must:

- require one or more trusted announcement pubkeys instead of accepting the newest kind-34444
  event from any author;
- understand `blossomServers[]` and retry immutable chunk reads across mirrors;
- preserve compatibility with the legacy singular `blossomServer` field;
- expose Mapnolia authentication and payment hooks without embedding server policy in the map
  renderer;
- consume announced style and sprite blobs, rewrite their source URLs to the Mapnolia protocol,
  and retain the built-in Protomaps style as a fallback;
- keep kind-34444 read-only in Earthly.

This is partly a cross-repository integration, but the security boundary and user-facing failure
behavior are Earthly responsibilities.

### 2. Offline application shell

Add a service worker that precaches versioned production assets and serves the app shell without
a network connection. Updates must be explicit and recoverable: a stale worker must not strand
the user on an incompatible IndexedDB or OPFS schema.

This delivers an app that opens offline, but it does not by itself make maps or publishing work.

### 3. Offline map regions

Introduce a storage-neutral immutable blob interface and a PMTiles source that can satisfy Range
reads from that interface. The browser implementation stores whole content-addressed chunks in
OPFS.

The user-facing operation is **Save region offline**:

- choose or derive a bounding box;
- resolve every required chunk from the trusted kind-34444 announcement;
- calculate required bytes before download when announcement metadata permits;
- download each whole chunk with progress, cancellation, hash verification, and mirror failover;
- commit a region manifest only after all required blobs are valid;
- show stored size, coverage, source announcement, verification state, and last access;
- allow removal and garbage collection without deleting blobs shared by another saved region;
- prefer local blobs while offline and permit deterministic local-first behavior while online.

The storage UI must report quota pressure and explain browser persistence limitations. Installing
the PWA may improve durability, but Earthly must never promise that browser-managed data cannot
be evicted.

### 4. Offline Nostr reads

Earthly already persists a bounded event cache with `nostr-idb`. The offline work is therefore an
audit and product-hardening pass rather than a new event store:

- hydrate every offline-critical view from the cache before relay results;
- represent offline, loading, empty, and relay-error states distinctly;
- pin or otherwise protect events referenced by saved offline regions and bundles from ordinary
  cache eviction;
- ensure a relay failure does not erase cached content from the current view;
- define which profiles, map announcements, datasets, stories, groups, sightings, and comments
  belong to a saved region.

### 5. Durable publish outbox

Persist already-signed Nostr events before attempting relay delivery. A failed or partial publish
must remain visible and retryable across reloads and reconnects.

The outbox must preserve the routing intent used by Earthly today (`configured`, `outbox`,
`inbox`, or `reply`, including the target pubkey), track acknowledgements per target relay, and
deduplicate by event id. Because signatures are final, retries resend the same event; they never
re-sign or mutate it.

The UI must distinguish queued, partially delivered, delivered, and permanently rejected items,
with retry and discard controls. Live-beacon heartbeats are explicitly excluded: they are
ephemeral, foreground, and must not replay later as stale positions.

### 6. Portable offline bundles and nearby exchange

Add export/import of a versioned, integrity-checked bundle containing:

- a manifest and schema version;
- selected PMTiles chunks or excerpts;
- relevant Nostr events as JSONL;
- content hashes and source metadata.

Use the browser file APIs on the web and the operating-system share/open surfaces where
available. QR remains suitable for npubs, relay hints, or a rendezvous token only. Imported events
must pass ordinary signature and model validation before entering Earthly's store.

### 7. Tauri v2 application

The native application wraps the existing React application and implements the same capability
boundaries with native adapters:

- filesystem-backed immutable blob storage without browser quota or eviction;
- a local Range-capable source or protocol for in-process PMTiles reads, not remote map streaming;
- a reusable embedded Nostr relay and Blossom server that Earthly and explicitly paired clients
  use through ordinary protocols;
- durable native outbox wake/flush behavior where the platform permits it;
- camera/QR scanning and operating-system share/open integration;
- mobile-safe deep links and file associations for Earthly bundles.

The implementation must not rewrite domain logic in Rust. Rust owns native storage, protocol,
and platform bridges; TypeScript retains region selection, manifests, routing intent, validation,
and UI state unless profiling proves a specific boundary inadequate.

The full architecture, phases, release targets, test strategy, and definition of done live in
[`TAURI-IMPLEMENTATION-PLAN.md`](TAURI-IMPLEMENTATION-PLAN.md).

### 8. Routing and offline data products

Earthly already has typed ContextVM calls for remote Valhalla routing and isochrones. The relevant
follow-on work is:

- expose remote routing as a coherent user workflow;
- later recognize Mapnolia `valhalla-graph` announcements and save graph bundles with a region;
- evaluate on-device Valhalla only in the native era;
- consider a small JavaScript A* path-network fallback for excerpt-scale hiking reroutes.

For Overpass-like use cases, Earthly should consume precomputed thematic kind-37515 GeoJSON
datasets (water, huts, trail facilities) and include selected datasets in offline bundles rather
than embedding an Overpass engine.

## Current Earthly baseline (verified 2026-07-13)

- A PWA manifest exists, but no service worker is registered.
- `nostr-idb` persists up to 20,000 events and some timelines hydrate cache-first.
- `publish()` broadcasts first and only then adds the event to the local store; there is no
  durable retry queue.
- `pmworld://` reads directly from one `blossomServer`; no local blob source or mirror failover is
  present.
- The kind-34444 Cast says callers should trust-filter authors, but the active subscription asks
  for the latest event from any pubkey. The basemap-hijack gap remains.
- Earthly has QR/link and PNG export UI, but no offline bundle format or OS share-sheet bridge.
- ContextVM Valhalla route and isochrone client methods already exist.
- No Tauri scaffold, Rust workspace, OPFS region store, or native protocol bridge exists.

## Dependency order

The recommended order is intentionally strict. The native local-node proof now precedes the map
work because it validates the packaging, native runtime, protocol, persistence, and cross-process
assumptions shared by everything that follows:

1. Tauri shell and deterministic desktop/mobile builds.
2. Reusable local-node core and lifecycle boundary.
3. Embedded persistent relay, embedded Blossom, pairing, and offline two-app proof.
4. Platform capability interfaces and Earthly integration through the local relay.
5. Trusted Mapnolia package integration and mirror-aware fetching.
6. Local PMTiles Range source and saved-region lifecycle.
7. Offline-read audit and region-linked event retention.
8. Signed-event publish outbox.
9. Bundle export/import and native share integration.
10. Platform hardening, packaging, and store releases.
11. Offline routing graph distribution and on-device routing as a later feature.

The Mapnolia package migration may be split from the offline milestone if package publication or
auth APIs are not ready, but trusted-author filtering must land before any offline region pins an
announcement as authoritative.

## Tauri release criteria

The application is releasable only after demonstrating all of the following across the supported
desktop and mobile targets:

- open an existing Earthly route and preserve current web behavior;
- save, restart, and read a multi-gigabyte-capable PMTiles region through the normal map source
  abstraction without copying it into webview memory;
- verify content hashes and serve arbitrary Range reads correctly;
- query and hydrate cached Nostr events through the native event-store adapter;
- queue a signed event offline and deliver the identical event after connectivity returns;
- import/export an Earthly bundle and invoke the platform share/open flow;
- keep signing keys outside the native bridge unless a separately reviewed native signer is
  intentionally introduced;
- document binary size, cold-start time, memory use, platform-specific code, build reproducibility,
  signing/notarization steps, and expected app-store maintenance.

These are intermediate gates; the complete cross-platform definition of done is maintained in
[`TAURI-IMPLEMENTATION-PLAN.md`](TAURI-IMPLEMENTATION-PLAN.md).

## Product inputs still required during planning

1. Should saved regions include only the basemap, or a selectable snapshot of nearby Earthly
   entities and thematic datasets by default?
2. What is the authoritative Mapnolia server pubkey configuration UX: build-time deployment
   config, user-managed trust list, or both with pinned defaults?
3. What concrete multi-gigabyte dataset and hiking region will act as the release fixture?
4. Which bundle interoperability is required initially: Earthly-to-Earthly only, or a documented
   format intended for other Nostr mapping clients?

## Explicitly excluded from the Earthly plan

- Mapnolia chunk production and recursive server-side subdivision.
- Mapnolia mirror pull engine, fleet registry, whitelist ledger, dashboard, and treasury.
- Server-side NIP-98 validation, subscription provisioning, Cashu redemption, and HTTP 402 logic.
- Mapnolia request ranking and torrent sidecar.
- H3 chunking, a PMTiles fork, and client-side WebTorrent.
- Always-on background beacon recording or replaying stale beacon updates from the outbox.
