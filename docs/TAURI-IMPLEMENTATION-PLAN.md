# Earthly Tauri Application Implementation Plan

> Current release scope (July 2026): the browser application and persistent Cordn ContextVM
> coordinator are live, and native implementation has resumed. The Tauri shell, embedded node,
> Android host, signed pairing protocol, and first product-facing pairing administration bridge are
> implemented. Explicit time-bounded LAN exposure, QR/photo invitation import, signed peer claims,
> approval polling, durable joined-node records, and explicit pull-only synchronization of signed
> Earthly records are also implemented. Deep links, mobile lifecycle, platform-protected MLS
> storage, Blossom mirroring, and offline map regions remain staged work.

Status: committed product direction
Created: 2026-07-13
Scope: production desktop and mobile application for Earthly using Tauri v2
Targets: macOS, Windows, Linux, Android, and iOS

## 1. Outcome

Earthly will ship as a supported Tauri v2 application. The native application will retain the
existing React 19, TypeScript, Bun, MapLibre, Applesauce, and Zustand application while adding
durable native capabilities:

- a reusable local Nostr node with an embedded relay, Blossom server, pairing, and offline
  reachability;
- filesystem-backed, multi-gigabyte offline map regions;
- Range-capable local PMTiles delivery without copying whole archives through IPC;
- an embedded rust-nostr event database;
- a durable signed-event outbox with retry and per-relay delivery state;
- import and export of portable Earthly offline bundles;
- native file dialogs, deep links, QR scanning, geolocation, and operating-system sharing;
- signed desktop installers and Android/iOS store releases;
- platform-specific lifecycle, permission, update, backup, and recovery behavior.

The browser application remains supported. Tauri is a first-class runtime of the same Earthly
product, not a separate frontend and not a Rust rewrite.

Private map collaboration is an adjacent application workstream shared by the browser and Tauri
runtimes. It is included in this plan so its identity, storage, server, and offline requirements do
not accidentally conflict with the native architecture; it is specified in section 18 and is not a
prerequisite for completing phases 1–12.

## 2. Product definition

The first completed vertical slice is local-node interoperability:

1. Earthly starts its embedded relay and Blossom server without an internet connection.
2. A separate application pairs with the node and receives explicit pubkey-bound capabilities.
3. The application publishes and queries a Nostr event through ordinary relay messages.
4. It uploads and retrieves a content-addressed blob through ordinary Blossom requests.
5. Both resources survive an Earthly restart and remain available according to platform lifecycle
   constraints.

The complete local-node contract is maintained in
[`LOCAL-NOSTR-NODE-SPEC.md`](LOCAL-NOSTR-NODE-SPEC.md).

That foundation then supports the offline hiking workflow:

1. The user opens Earthly on desktop or mobile and selects a geographic region.
2. Earthly resolves the trusted Mapnolia announcement and shows the required basemap, overlay,
   style, sprite, and Earthly-event storage size.
3. The native backend downloads immutable blobs with mirror failover, verifies their SHA-256
   hashes, and atomically saves a region manifest.
4. After a restart with all networking disabled, the map opens, pans, and zooms throughout the
   saved region. Saved datasets, groups, stories, sightings, comments, and profiles remain
   readable.
5. The user creates or edits content and signs it with the existing Earthly signer flow. The exact
   signed event is persisted to the native outbox before delivery is attempted.
6. On reconnection, Earthly delivers the same event to the intended relays, records
   acknowledgements, and clearly reports partial or complete success.
7. The user can export the region as an integrity-checked bundle, share it through the operating
   system, and import it on another Earthly installation.

## 3. Architectural decisions

### 3.1 One frontend, explicit runtime adapters

React components and Earthly domain services must not import Tauri APIs directly. All native
access goes through typed interfaces in `src/platform/`:

```text
React / domain services
        |
        v
Earthly platform interfaces
        |
        +-- Web adapters: IndexedDB, OPFS, browser sharing
        |
        `-- Tauri adapters: invoke/events, native protocols, native plugins
                          |
                          v
                  Rust application core
```

Runtime selection happens once during application bootstrap. Feature code receives capabilities
through the platform registry and renders a truthful unsupported state rather than probing global
objects throughout the component tree.

### 3.2 Responsibility boundary

TypeScript owns:

- region selection and user intent;
- Mapnolia announcement parsing and trusted-pubkey policy;
- Earthly event casting, schema validation, and UI models;
- routing intent (`configured`, `outbox`, `inbox`, and `reply`);
- MapLibre source selection and local-first behavior;
- progress presentation, recovery actions, and user-facing errors;
- signing through Earthly's existing account and signer system.

Rust owns:

- application data directories and file permissions;
- streaming downloads, mirror retries, hashing, temporary files, and atomic commits;
- native metadata transactions and schema migrations;
- local, random-access PMTiles reads over a custom URI scheme inside the Earthly process (not map
  streaming to paired applications);
- rust-nostr database access;
- durable outbox persistence and delivery of already-signed events;
- bundle archive streaming, validation, and safe extraction;
- native lifecycle hooks, file associations, deep links, and plugin integration;
- structured native logs and crash-safe recovery.

Rust must not duplicate Earthly event business rules or own React/Zustand state. TypeScript must
not read arbitrary native paths or move multi-gigabyte byte streams through `invoke()`.

### 3.3 Three native storage layers

Use each storage engine for the shape it handles best:

1. **Filesystem blob store** — immutable PMTiles, styles, sprites, attachments, and bundles,
   addressed by SHA-256.
2. **rust-nostr LMDB store** — validated Nostr events queried through the rust-nostr database
   abstraction.
3. **SQLite application database** — regions, blob references, download jobs, outbox state,
   per-relay acknowledgements, settings metadata, and migrations.

Do not put multi-gigabyte blobs in SQLite or LMDB. Do not use JSON files as the authoritative
outbox or region catalog.

### 3.4 Embedded local node

The application embeds a persistent Nostr relay and Blossom server. They default to loopback and
become LAN-reachable only through explicit user action. Paired peers authenticate by pubkey and
receive narrow relay/blob capabilities.

Applesauce remains the frontend's in-memory event model and live subscription layer. Under Tauri,
Earthly connects to the same local relay interface available to other clients rather than using a
private persistence shortcut. The reusable node is transport-neutral Rust; Tauri and mobile
lifecycle code are adapters.

Desktop and Android support same-device clients while the native service is running. iOS supports
Earthly's in-process use and cross-device serving while foregrounded, but it does not promise that
another foreground app can keep a backgrounded Earthly process serving sockets.

### 3.5 Signing remains outside the native storage bridge

The first production release keeps all current signer types and signing semantics:

- NIP-07/browser extension where available;
- NIP-46 remote signer;
- Earthly's existing locally managed account flow.

The native backend receives only fully signed events for storage and delivery. It must never
receive an `nsec` as part of an outbox command. Native key custody using Stronghold or platform
keychains requires a separate security design and migration plan.

### 3.6 Local PMTiles use a custom URI scheme

Register an asynchronous `earthly-blob` URI scheme in Rust. A URL identifies a content hash, not
an arbitrary path:

```text
earthly-blob://localhost/sha256/<64-lowercase-hex>
```

The handler must:

- reject malformed hashes and all path traversal syntax;
- resolve hashes only through the native blob catalog;
- support `GET` and `HEAD`;
- parse exactly one byte range;
- return `200`, `206`, `400`, `404`, `416`, and `500` correctly;
- include `Accept-Ranges`, `Content-Length`, `Content-Range`, a stable immutable cache header,
  content type, and the required CORS headers for Tauri's platform-specific custom-protocol
  origins;
- stream only the requested range from disk;
- never buffer an entire PMTiles archive;
- record last access asynchronously without delaying the response.

The existing `pmtiles` JavaScript library continues parsing PMTiles. The only changed dependency
is its byte source.

### 3.7 Full target support, staged release order

The implementation targets all five platforms from the beginning, but release gates are staged:

1. macOS and Android establish the desktop and mobile paths.
2. Windows and Linux close desktop portability.
3. iOS closes mobile portability and App Store distribution.

Platform staging is scheduling, not an experiment and not permission to create incompatible data
formats. Storage schemas, command contracts, and bundles are versioned and cross-platform from
their first merge.

## 4. Proposed repository structure

```text
earthly/
├── Cargo.toml
├── Cargo.lock
├── crates/
│   └── earthly-local-node/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── descriptor.rs
│           ├── relay/
│           ├── blossom/
│           ├── pairing/
│           ├── policy/
│           └── storage/
├── src/
│   ├── platform/
│   │   ├── contracts.ts
│   │   ├── capabilities.ts
│   │   ├── registry.ts
│   │   ├── web/
│   │   └── tauri/
│   ├── features/offline/
│   │   ├── domain/
│   │   ├── store/
│   │   ├── components/
│   │   └── workers/
│   └── lib/nostr/
│       ├── cache-adapter.ts
│       └── outbox/
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── tauri.android.conf.json
│   ├── tauri.ios.conf.json
│   ├── tauri.macos.conf.json
│   ├── tauri.windows.conf.json
│   ├── tauri.linux.conf.json
│   ├── capabilities/
│   │   ├── desktop.json
│   │   └── mobile.json
│   ├── permissions/
│   ├── migrations/
│   └── src/
│       ├── lib.rs
│       ├── error.rs
│       ├── paths.rs
│       ├── protocol.rs
│       ├── storage/
│       │   ├── blobs.rs
│       │   ├── catalog.rs
│       │   └── events.rs
│       ├── downloads/
│       ├── outbox/
│       ├── bundles/
│       └── commands/
└── test/fixtures/offline/
```

The workspace-root `Cargo.lock` is committed. `target/`, generated packages, downloaded fixture
blobs, signing credentials, and store artifacts are ignored.

## 5. TypeScript platform contracts

The interfaces below are stable application boundaries, not one-to-one mirrors of Tauri plugins:

```ts
interface BlobStore {
  has(hash: string): Promise<boolean>
  stat(hash: string): Promise<BlobInfo | null>
  localUrl(hash: string): Promise<string | null>
  remove(hash: string): Promise<void>
}

interface RegionRepository {
  plan(input: RegionSelection): Promise<RegionPlan>
  save(plan: RegionPlan): AsyncIterable<RegionProgress>
  list(): Promise<SavedRegion[]>
  verify(regionId: string): AsyncIterable<VerificationProgress>
  remove(regionId: string): Promise<void>
}

interface EventCache {
  add(events: NostrEvent[]): Promise<void>
  query(filters: Filter[]): Promise<NostrEvent[]>
  remove(ids: string[]): Promise<void>
  pin(ids: string[], owner: CacheOwner): Promise<void>
  unpin(owner: CacheOwner): Promise<void>
}

interface PublishOutbox {
  enqueue(item: SignedPublishIntent): Promise<OutboxItem>
  list(): Promise<OutboxItem[]>
  retry(id: string): Promise<void>
  discard(id: string): Promise<void>
  subscribe(listener: (event: OutboxEvent) => void): Unsubscribe
}

interface BundleExchange {
  export(input: BundleSelection): AsyncIterable<BundleProgress>
  inspect(source: ImportSource): Promise<BundleInspection>
  import(source: ImportSource): AsyncIterable<BundleProgress>
}
```

Every DTO crossing IPC has a version and a Zod schema on the TypeScript side. Rust uses matching
Serde structures and rejects unknown protocol versions with a typed error.

## 6. Native command and event surface

Keep commands coarse enough to preserve transactions and avoid chatty IPC:

### Storage and regions

- `storage_status_v1`
- `region_plan_v1`
- `region_save_v1`
- `region_cancel_v1`
- `region_list_v1`
- `region_verify_v1`
- `region_remove_v1`
- `region_repair_v1`
- `storage_gc_v1`

### Events

- `events_add_v1`
- `events_query_v1`
- `events_remove_v1`
- `events_pin_v1`
- `events_unpin_v1`
- `events_stats_v1`

### Outbox

- `outbox_enqueue_v1`
- `outbox_list_v1`
- `outbox_retry_v1`
- `outbox_discard_v1`
- `outbox_flush_v1`

### Bundles

- `bundle_export_v1`
- `bundle_inspect_v1`
- `bundle_import_v1`
- `bundle_cancel_v1`

Long operations return a job id immediately and emit versioned progress events. Event names are
namespaced, for example `earthly://region-progress/v1`. Commands never return multi-gigabyte
payloads.

## 7. Native data model

### 7.1 Blob layout

```text
AppLocalData/
├── earthly.sqlite3
├── nostr-lmdb/
├── blobs/
│   └── ab/cd/abcdef...<64 hex>
├── staging/
│   ├── downloads/
│   └── imports/
├── exports/
└── logs/
```

Blob filenames are derived exclusively from verified hashes. Downloads write to a random
staging file, flush, verify, and atomically rename. A crash leaves a removable staging file, never
a valid-looking blob.

### 7.2 SQLite tables

The initial migration defines:

- `schema_migrations(version, applied_at)`
- `blobs(hash, size, media_type, verified_at, last_accessed_at, created_at)`
- `regions(id, name, bbox_json, source_pubkey, announcement_id, status, created_at, updated_at)`
- `region_blobs(region_id, hash, role, required, ordinal)`
- `region_events(region_id, event_id, role)`
- `download_jobs(id, region_id, state, bytes_total, bytes_done, error_code, updated_at)`
- `outbox_items(id, event_json, event_id, event_kind, routing, target_pubkey, state,
  attempt_count, next_attempt_at, created_at, updated_at, last_error)`
- `outbox_relays(outbox_id, relay_url, state, attempts, acknowledged_at, last_error)`
- `settings(key, value_json, updated_at)` for non-secret native metadata only.

Foreign keys are enabled. Region/blob reference changes and outbox transitions are transactional.
Migrations are forward-only, idempotent under restart, and backed up before any destructive
transformation.

### 7.3 Outbox states

```text
queued -> delivering -> delivered
                  |-> partial -> delivering
                  |-> retry_wait -> delivering
                  `-> rejected

queued/retry_wait/partial/rejected -> discarded
```

An item is `delivered` when the configured success policy is met and every required baseline relay
has acknowledged it. Optional NIP-65 inbox/outbox relays may remain failed while the item is
`partial`; the UI shows both facts.

The stored event JSON is immutable after enqueue. Retries may update relay targets only through an
explicit re-resolution operation that preserves the event id and records the change.

Live-beacon heartbeat events are not accepted by the durable outbox. The Rust command validates
the exclusion in addition to the TypeScript call site.

## 8. Download and local map behavior

### 8.1 Region planning

The planner receives a trusted, validated Mapnolia announcement plus a bbox and selected layers.
It resolves intersecting chunks, styles, sprites, and optional Earthly event coverage. Planning
returns:

- exact content hashes and ordered mirror URLs;
- known and unknown byte counts;
- already-present and missing bytes;
- warnings for incomplete coverage or absent metadata;
- the source pubkey and announcement id to pin as provenance.

A region cannot enter `ready` state unless every required artifact is verified.

### 8.2 Downloading

- Use a Rust HTTP client and stream bodies to disk.
- Limit global and per-host concurrency.
- Retry only safe failures with capped exponential backoff and jitter.
- Rotate mirrors on network, timeout, 5xx, hash, or invalid-Range failures.
- Treat 401, 402, and 403 as actionable auth/payment states, not generic retries.
- Support cancellation through a native cancellation token.
- Persist enough job state to resume after restart.
- Re-hash a completed file before catalog commit even when transport metadata supplied a digest.
- Deduplicate simultaneous requests for the same hash.

### 8.3 Local-first resolution

For each immutable Mapnolia blob:

1. If a verified native blob exists, use `earthly-blob://`.
2. Otherwise use the mirror-aware remote source.
3. If the network request succeeds and the user enabled opportunistic caching, stream it into the
   native store without delaying the visible tile response.
4. If neither source succeeds, render an explicit unavailable-region state rather than silently
   returning empty tiles.

## 9. Native Nostr persistence

Use `nostr-lmdb` through the rust-nostr `NostrDatabase` interface. Hide the concrete engine behind
Earthly's Rust `EventRepository` so engine upgrades do not change IPC.

On Tauri bootstrap:

1. Open/migrate SQLite.
2. Open the LMDB environment in `AppLocalData/nostr-lmdb`.
3. Run bounded integrity checks.
4. Initialize the TypeScript `EventCache` adapter.
5. Hydrate Applesauce on demand through the same filter shapes used by `queryCache()` today.
6. Persist all newly accepted events in batches.

The adapter must preserve replaceable-event semantics expected by Applesauce. Rust validates
event JSON, ids, and signatures before database insertion; TypeScript still applies Earthly model
version, expiration, schema, and mute/filter policy before display.

Saved regions pin their provenance announcement and selected Earthly events. General cache
retention may be bounded, but pinned events cannot be evicted until all owning regions/bundles are
removed.

## 10. Bundle format

Use a versioned ZIP container with a dedicated extension such as `.earthly`:

```text
manifest.json
events.jsonl
blobs/<sha256>
```

`manifest.json` includes format version, created time, bbox, source announcements, event ids,
blob hashes/sizes/roles, and an optional human-readable title. It never contains private keys.

Import is two-phase:

1. **Inspect** — stream-read central directory and manifest, enforce size/count limits, reject
   duplicate paths, absolute paths, traversal, symlinks, unsupported compression, and version
   mismatches; report required disk space and untrusted authors.
2. **Commit** — extract to staging, verify every hash and event signature, then transactionally
   adopt blobs/events/region metadata. Any failure removes staging and leaves the catalog
   unchanged.

Bundles are interoperable across all Earthly targets. The format receives fixtures and a small
standalone validation command before its first stable release.

## 11. Native integrations

Use official Tauri plugins where they meet the contract:

- file dialogs for bundle open/save;
- deep-link handling for `earthly://` routes and associated web links;
- barcode scanner for QR rendezvous and identity data;
- geolocation for foreground map position and existing live-beacon flows;
- opener for external URLs/files;
- logging for redacted native diagnostics;
- updater on supported desktop channels;
- notifications only for user-meaningful completed/failed background work.

OS sharing has no single assumption in the domain layer. Implement a `ShareBridge` with official
plugin support where available and a small scoped Swift/Kotlin plugin where required. The fallback
is an exported file plus the platform file dialog, not a JavaScript download anchor.

Deep-link processing validates schemes, hosts, path length, decoded Nostr identifiers, and bundle
source before updating the router. Cold-start links use the plugin's initial-link API; warm links
use its event listener.

Location remains foreground and explicit by default. This plan does not introduce permanent
background tracking or weaken the existing live-beacon privacy model.

## 12. Security model

### 12.1 Capabilities

Define separate desktop and mobile capability files. Grant only the main bundled webview access;
remote pages and iframes receive no native commands. Avoid wildcard filesystem scopes and shell
permissions.

The frontend may request only Earthly application operations. It does not receive generic native
filesystem read/write commands for the blob store or database directories.

### 12.2 Command validation

Every command:

- uses typed Serde inputs and rejects unknown versions;
- validates hashes, ids, URLs, bboxes, counts, sizes, and enum values;
- canonicalizes only native-owned paths;
- applies hard resource limits before allocation;
- returns stable error codes with safe user messages;
- logs correlation ids, never event plaintext marked private, auth tokens, wallet proofs, or keys.

### 12.3 Content and network trust

- Kind-34444 announcements must be signed by a configured trusted pubkey.
- Downloaded blobs must match their content hash regardless of HTTPS validity.
- Mirror URLs are limited to HTTP(S) and pass SSRF/private-network policy appropriate to the
  runtime configuration.
- Imported Nostr events must pass id and signature verification.
- The custom protocol exposes only catalogued hashes and never maps user-supplied paths.
- CSP allows bundled application code and the minimum custom-protocol/network endpoints required
  by Earthly; no remote page receives IPC capability.

### 12.4 Supply chain and release security

- Commit Bun and Cargo lockfiles.
- Pin Tauri plugins and Rust dependencies through normal lockfile review.
- Run `cargo audit`, license checks, TypeScript/Bun tests, and secret scanning in CI.
- Protect Apple, Android, and desktop signing material in CI environment secrets with restricted
  release workflows.
- Generate release checksums and a software bill of materials.

### 12.5 ContextVM session identity

Earthly generates one ephemeral secp256k1 credential for ContextVM transport messages per running
app session. The credential is shared by ContextVM clients in that process but is never bundled,
logged, or persisted. It is separate from the user's Nostr signer and the native local-node
identity.

`FRONTEND_ENV_KEYS` is an explicit public-value allow-list and excludes all private keys. Regression
tests enforce the allow-list and ensure the retired shared `CLIENT_KEY` is ignored by environment
parsing. A future platform-keystore identity can replace the session credential if stable ContextVM
client identity becomes a product requirement; it must not reintroduce a build-time secret.

## 13. Failure recovery and observability

The app must recover automatically from:

- interrupted downloads and imports;
- orphan staging files;
- interrupted SQLite migrations;
- missing catalogued blobs;
- corrupt blobs detected by verification;
- LMDB open/query failures;
- outbox delivery interrupted by process suspension;
- custom-protocol read errors;
- disk-full and permission-denied errors.

On startup, a bounded recovery pass reconciles staging jobs and database state. Expensive full
verification is explicit or scheduled when charging/idle, not forced on every launch.

Native logs use structured fields: subsystem, operation, job id, region id, hash prefix, platform,
duration, bytes, result, and safe error code. A diagnostics export redacts URLs containing tokens,
event content configured as private, wallet material, and all signing data.

## 14. Implementation phases

### Phase 1 — Tauri shell and deterministic builds

Deliver:

- `src-tauri` scaffold and Bun build integration;
- platform-specific Tauri configuration;
- desktop and mobile capability files;
- development commands for desktop, Android, and iOS;
- environment handling that does not inject server secrets into the webview;
- CI compile jobs for Rust and TypeScript;
- a booted Earthly map on macOS and Android.

Exit criteria:

- existing web build and tests remain green;
- Tauri development and production bundles load nested Earthly routes and all emitted workers/WASM;
- no broad filesystem, shell, or remote-IPC permission exists;
- Cargo.lock is committed and reproducible builds are documented.

### Phase 2 — Reusable local-node core and lifecycle boundary

Deliver:

- the standalone `earthly-local-node` Rust crate;
- versioned node descriptor, configuration, state, errors, and lifecycle interfaces;
- a stable node identity stored separately from user signing identities;
- explicit loopback, LAN, foreground, foreground-service, and process-lifetime semantics;
- a Tauri supervisor that starts, reports, and stops the node without putting Tauri types in the
  reusable crate;
- temporary-directory test harnesses and conformance fixtures usable by other applications.

Exit criteria:

- the crate builds and its public data contracts round-trip through Serde;
- invalid descriptors, unsafe bind configurations, and unsupported versions fail closed;
- start/stop is idempotent and a restart never changes node identity;
- Tauri can report truthful node state without exposing signing secrets.

### Phase 3 — Embedded persistent Nostr relay

Deliver:

- a rust-nostr relay-builder runtime inside `earthly-local-node`;
- durable event persistence and migration/recovery behavior;
- NIP-01 subscriptions, publication, notices, limits, and connection cleanup;
- NIP-11 relay information and NIP-42 authentication;
- policy hooks for pubkey capabilities, event validation, quotas, and rate limits;
- loopback-by-default binding with explicit ephemeral-port support for tests.

Exit criteria:

- an independent Nostr client publishes, subscribes, disconnects, and retrieves the same event
  while all internet routes are disabled;
- valid events survive a complete Earthly restart and invalid signatures/ids are rejected;
- an unauthenticated or unpaired client cannot write;
- slow consumers, abusive filters, oversized events, and connection floods remain bounded;
- relay protocol fixtures are not coupled to the Earthly frontend.

### Phase 4 — Embedded persistent Blossom server

Deliver:

- BUD-01 retrieval, HEAD, CORS, and single-range behavior;
- BUD-02 streaming upload, blob descriptors, hash-address validation, and content integrity checks;
- BUD-11 kind-24242 authorization events bound to the authenticated peer, server, hash, and
  requested operation;
- BUD-12 authenticated deletion; the discouraged owner-list endpoint is deferred unless an
  interoperability case requires it;
- optional BUD-04 mirroring only after its SSRF, redirect, DNS-rebinding, and size controls pass a
  separate security review;
- atomic temporary-file adoption into a shared content-addressed blob store;
- quotas, MIME/size policy, cleanup, and relay/Blossom shared-capability enforcement.

Exit criteria:

- an independent Blossom client uploads a blob, retrieves identical bytes by hash, restarts
  Earthly, and retrieves the same bytes again with all internet routes disabled;
- wrong hashes, unauthorized deletes, oversized uploads, partial writes, and path traversal are
  rejected without leaving authoritative files;
- relay events and Blossom blobs are governed by one peer capability and quota policy;
- large transfers are streaming and memory-bounded.

### Phase 5 — Pairing, discovery, and offline interoperability proof

Deliver:

- short-lived, signed pairing invitations represented as QR and copyable text;
- explicit accept/deny UI with peer identity and requested capabilities;
- pubkey-bound, revocable relay and Blossom capabilities;
- versioned discovery descriptor and service metadata;
- opt-in LAN binding and local discovery, with loopback remaining the default;
- small TypeScript and Rust reference clients plus protocol conformance fixtures;
- an automated two-process acceptance scenario that disables internet access.

Exit criteria:

- a second application pairs, publishes/queries an event, uploads/downloads a blob, and repeats
  both reads after an Earthly restart while offline;
- revocation closes existing access and prevents reconnect without corrupting stored data;
- LAN exposure cannot be enabled silently and node services are never bound to WAN interfaces;
- desktop lifecycle behavior is demonstrated; Android is demonstrated with a visible
  foreground/bound service; iOS limitations are reported truthfully rather than hidden;
- the protocol-facing crates and fixtures are usable without depending on Earthly or Tauri.

### Phase 6 — Earthly platform contracts and local-node integration

Deliver:

- `src/platform` contracts, capability registry, web adapters, and Tauri adapters;
- typed invoke/event helpers with Zod validation and one application bootstrap path;
- Applesauce integration through the ordinary embedded relay interface;
- region event pinning, retention policy, and offline-state audit of saved entity views;
- platform and node diagnostics UI;
- contract tests against both web and native adapter families.

Exit criteria:

- feature modules contain no direct `@tauri-apps/*` imports;
- the browser build excludes native modules cleanly and unsupported capabilities are truthful;
- cached announcements, datasets, groups, stories, sightings, comments, and profiles hydrate after
  a cold offline restart through the local relay;
- expired and legacy-incompatible events remain filtered by existing Earthly policy;
- Tauri IPC and node descriptor version mismatches fail safely.

### Phase 7 — Native content catalog and local PMTiles access

Deliver:

- SQLite catalog migrations and native paths;
- the shared content-addressed blob-store implementation;
- asynchronous `earthly-blob` protocol with full single-range behavior;
- native storage status, reference accounting, and garbage collection;
- Rust protocol, path, migration, and crash-recovery tests.

Exit criteria:

- PMTiles headers and arbitrary tiles can be read locally from a multi-gigabyte fixture without
  whole-file IPC or memory buffering;
- Range conformance tests cover valid, invalid, suffix, open-ended, out-of-bounds, HEAD, and
  cancellation behavior;
- malformed paths cannot access any filesystem object;
- this local random-access path is not exposed as remote map streaming;
- restart recovery leaves no false verified entries.

### Phase 8 — Saved regions and Mapnolia integration

Deliver:

- trusted announcement configuration;
- region planning and size estimation;
- streaming native download manager with mirror failover;
- hash verification, deduplication, resume, cancellation, repair, and reference-counted removal;
- saved-region UI with coverage, progress, storage, and error states;
- local-first PMTiles and style/sprite resolution.

Exit criteria:

- a defined hiking fixture downloads, verifies, survives restart, and renders with networking
  disabled;
- shared blobs are downloaded once and are not removed while referenced;
- auth/payment failures remain actionable and are never retried as transient failures;
- tampered mirror content is rejected and the next mirror is attempted.

### Phase 9 — Durable native publish outbox

Deliver:

- immutable signed-event enqueue before first network attempt;
- transactional item/relay state machine;
- rust-nostr delivery worker and acknowledgement capture;
- lifecycle-triggered flush on start, resume, connectivity recovery, and user request;
- queued/partial/delivered/rejected UI with retry and discard;
- explicit live-beacon exclusion.

Exit criteria:

- process termination at every transition cannot lose or duplicate an event;
- the event id and serialized event remain byte-equivalent across retries;
- configured baseline and NIP-65 target delivery semantics match current `publish()` behavior;
- an offline-created sighting is delivered after reconnection and visible after a clean restart;
- beacon heartbeats can never replay from durable storage.

### Phase 10 — Bundles, file associations, deep links, and sharing

Deliver:

- `.earthly` format, fixtures, validator, export, inspect, and import;
- safe streaming archive implementation;
- file dialogs and file association;
- cold/warm deep-link routing;
- native share/open bridge;
- QR scanning for identity/rendezvous data.

Exit criteria:

- bundles round-trip byte-for-byte across macOS and Android, then all supported targets;
- corrupt, oversized, traversal, duplicate-path, unsupported-version, and invalid-event bundles are
  rejected without partial catalog changes;
- a shared bundle imports on a clean installation and renders offline;
- deep links never grant broader native capabilities.

### Phase 11 — Mobile lifecycle and platform completeness

Deliver:

- iOS build and platform configuration;
- Windows and Linux build closure;
- foreground geolocation and permission UX;
- mobile suspension/resume handling;
- disk pressure, battery, metered-network, and large-download policy;
- accessibility, safe areas, keyboard, rotation, and mobile MapLibre verification;
- platform-native share behavior.

Exit criteria:

- the hiking workflow passes on physical Android and iOS devices;
- suspend/resume cannot corrupt a download, import, database, or outbox transition;
- denied permissions leave usable non-native alternatives;
- platform differences do not change bundle or database semantics.

### Phase 12 — Distribution and operations

Deliver:

- signed macOS, Windows, and Linux packages;
- Android App Bundle and iOS archive/store metadata;
- desktop update channels with rollback policy;
- privacy disclosures, data export/delete behavior, and support diagnostics;
- release CI, checksums, SBOM, provenance, and operational runbooks;
- staged release and telemetry-free health reporting unless users explicitly opt in.

Exit criteria:

- every target installs, upgrades, retains data, and uninstalls according to documented behavior;
- signing and store submissions run from protected CI workflows;
- upgrade tests cover every released native schema version;
- support can diagnose failures from a redacted user-exported report.

## 15. Test strategy

### Rust unit and property tests

- Range parsing and response headers;
- hash/path validation;
- atomic blob adoption and recovery;
- SQLite migrations and state transitions;
- outbox retry scheduling and relay policy;
- ZIP traversal and decompression-limit defenses;
- Serde command compatibility;
- event id/signature rejection;
- garbage collection reference safety.

### TypeScript tests

- platform adapter contracts;
- runtime capability selection;
- local-first source choice;
- region planning DTO validation;
- offline UI state reducers;
- outbox state presentation;
- deep-link normalization;
- existing Earthly Factory/Cast and relay-routing suites.

### Integration tests

- Rust command harness against temporary data directories;
- custom protocol against real PMTiles fixtures;
- controlled local HTTP servers for Range, mirror, auth, corruption, timeout, and resume cases;
- LMDB query parity fixtures against the filters Earthly uses;
- forced process termination between each durable transition;
- cross-platform bundle fixtures.

### End-to-end acceptance

Use local relays and loopback Mapnolia fixtures only. The canonical journey is:

1. install clean app;
2. save fixture region;
3. terminate and restart offline;
4. navigate map and open pinned entities;
5. create and sign a sighting offline;
6. restart again and observe queued state;
7. restore loopback relay, deliver, and verify acknowledgement;
8. export bundle;
9. import on clean second installation;
10. verify equivalent offline rendering and content.

No E2E test may mutate a public relay or non-loopback Mapnolia service.

## 16. Performance budgets

The implementation establishes budgets during Phase 1 and enforces them by Phase 12. Initial
targets:

- no whole-PMTiles allocation in the webview or Rust process;
- Range response memory bounded by the requested range plus a small fixed buffer;
- UI progress updates throttled to avoid render storms;
- event-cache hydration paginated and cancellable;
- native startup recovery bounded and moved off the UI thread;
- downloads concurrency- and bandwidth-limited;
- bundle import/export streaming with bounded buffers;
- application binary and cold-start regressions reported in CI.

The multi-gigabyte acceptance fixture and low-memory mobile device class must be named before
Phase 7 closes so these budgets become measurable release gates.

## 17. Migration and compatibility

- Browser and Tauri storage are separate; no native code reaches into another browser's private
  IndexedDB/OPFS directories.
- Users move offline data through the `.earthly` bundle format.
- Existing browser accounts remain in the existing signer system. A user logs in or imports the
  supported encrypted account backup; secret localStorage copying is not attempted.
- Nostr events are portable and deduplicated by id.
- Map blobs are portable and deduplicated by SHA-256.
- Native command and bundle versions remain backward-readable for all stable releases.
- Database migrations are tested from every released native schema version.

## 18. Private map workspaces over MLS

This workstream adds confidential, member-managed collaboration to Earthly using Messaging Layer
Security (MLS) for group key agreement and Nostr-based infrastructure for delivery. It is a full
product implementation plan, not a requirement of the Tauri shell and offline-map release. The web
and Tauri applications share the protocol and domain implementation; the native application adds
secure durable state, offline queuing, and local-node integration.

### 18.1 Domain boundary and terminology

Introduce a new `PrivateMapWorkspace` aggregate, presented to users as a **Private map**. Do not
turn the existing kind-37518 `Group` into the private-workspace entity:

- an Earthly `Group` is a public, single-author curation topic whose governance controls which
  foreign attachments are surfaced;
- a `PrivateMapWorkspace` is a confidential collaboration and authorization boundary with shared
  content, explicit membership, and membership epochs;
- an MLS group is the cryptographic mechanism that protects a workspace, not the product entity
  users organize or edit;
- a Nostr pubkey identifies a person/account, while each of that person's devices is a distinct MLS
  client with its own key material and group state;
- a coordinator is the MLS Delivery Service that stores KeyPackages, Welcomes, and ordered opaque
  group messages. It is not a signer or a NIP-46 delegation service.

Use one MLS group per private workspace initially, but keep that one-to-one mapping behind a
workspace crypto interface. This leaves room to split a large workspace into content channels or
rotate to a replacement group without changing the product identity.

Existing Earthly entities are reused as private application payloads rather than republished as
ordinary public events. Dataset, comment, annotation, story, and sighting schemas retain their
semantic fields and kind numbers. Public event signing and relay publication are replaced by an
MLS-authenticated private envelope at the publish boundary. Decrypted records must retain their
proven sender identity and authentication result without fabricating a Nostr signature.

The existing kind-30078 encrypted-dataset shape is not the workspace aggregate: it does not define
group epochs, shared administration, multi-device membership, comments, or coordinated removal.
Likewise, a public kind-30000 role list is not authoritative private-workspace policy. Both formats
may inform compatibility work, but neither substitutes for the MLS-backed workspace lifecycle.

An optional public Group may link to a private workspace as a public landing page, but it is never
the membership list, encryption root, or authorization source.

### 18.2 Confidential envelope and storage model

The private publish path is:

```text
Earthly entity template
        |
        v
versioned Nostr-shaped private envelope
        |
        v
MLS PrivateMessage -----> coordinator -----> member clients
        |                                          |
        `-- local encrypted outbox                 `-- decrypt, authenticate, project
```

The envelope should follow Cordn's Nostr-shaped application-message model where interoperability
is useful: `id`, `pubkey`, `created_at`, `kind`, `tags`, and `content` retain familiar Nostr
semantics, while MLS authenticates the sender. The exact profile must be versioned by Earthly and
specified before implementation, including deterministic ids, replay handling, replaceable-event
semantics, tombstones, threading, and format migration.

Do not place large GeoJSON, media, or PMTiles payloads directly in MLS application messages. Store
them as content-addressed ciphertext in Blossom-compatible or local blob storage. An encrypted
manifest carried inside the workspace contains the object key, ciphertext hash, plaintext hash,
media type, size, and logical attachment relationship. New objects created after a membership
change use keys unavailable to removed members. Removing a member cannot retract data or keys that
the member already received.

The coordinator and public relays may retain opaque ciphertext, but clients remain authoritative
for MLS validation, application authorization, and content schema validation.

### 18.3 Workspace metadata and privacy budget

Workspace metadata includes:

- name, description, and optional icon;
- default viewport and optional working bounds;
- recommended basemap and overlays, including local/offline alternatives;
- member roles and workspace policy;
- content-envelope version and required client capabilities;
- retention, export, and external-network policy.

Sensitive presentation metadata must be an encrypted, replaceable workspace application record.
Do not copy the name, description, bounds, geohash, basemap, member list, or administrator list into
public Nostr tags, coordinator indexes, invitation URLs, or an MLS GroupContext extension. MLS
GroupContext is authenticated public group state; Cordn's draft metadata extension protects
integrity but is not an appropriate confidentiality boundary for location-sensitive metadata.
Only opaque routing identifiers, protocol/ciphersuite negotiation, and the minimum coordinator data
needed for delivery may be externally visible.

A basemap is a recommendation and initial default, not a restriction. Members can choose another
map. Earthly must explain that a public tile server, geocoder, router, AI service, or remote media
host can learn network and location-related metadata even though workspace content is encrypted.
For sensitive work, the preferred path is a downloaded local PMTiles basemap and local processing.

Traffic timing, message size, coordinator access, and possibly group relationships remain observable
unless a later privacy layer adds padding, batching, or stronger metadata-hiding transport. The UI
and documentation must not describe MLS as making participation anonymous.

### 18.4 Membership, invitations, and roles

The initial product flow is:

1. An administrator creates a private workspace and its first MLS client state.
2. The administrator creates a short-lived, one-use invitation link or QR code. It carries only
   rendezvous information and an invitation nonce, never an epoch secret or durable bearer key.
3. The invitee authenticates their Nostr identity and publishes or submits a signed MLS KeyPackage
   for the joining device.
4. An administrator verifies that the pubkey is allowed and explicitly approves the device.
5. The administrator creates an MLS Add/Commit; the coordinator stores the resulting Welcome until
   the new client retrieves it.
6. Every member sees the authenticated membership change and the new workspace epoch.

Earthly's implemented version-2 invitation is a signed ephemeral Nostr event carried inside the
URL rather than published. It binds the opaque workspace/group identifiers, original policy trust
anchor, coordinator, relay set, nonce, and a 24-hour expiration to the current administrator's
signature. The client verifies the signature and expiry before generating or publishing the
invitee's MLS KeyPackage. Unsigned version-1 links remain readable only for development
compatibility. True one-use consumption is not implementable against Cordn v0.4's current
`join_request_store` input because it contains only `gid` and `kp_ref`; the coordinator contract
must accept and atomically consume the signed nonce (or an equivalent rendezvous handle) before
Earthly can claim replay-resistant single use.

Whitelisting a pubkey is an admission policy, not the cryptographic act of joining. Removal requires
an MLS Remove/Commit and protects future epochs; it cannot erase previously decrypted or exported
content. Device loss, a second device, key rotation, recovery, and complete account removal must be
first-class lifecycle cases rather than treated as a single-login edge case.

Start with two application roles:

- **administrator** — manages membership, metadata, and policy, and can create normal content;
- **member** — reads and creates normal workspace content.

The workspace creator is the first administrator, but administration is not permanently tied to
that pubkey. Promotion adds another pubkey through an encrypted, versioned policy transition
authorized by the administrator set that was valid at the previous accepted revision. Demotion
uses the same mechanism. Roles are derived from validated policy history on every client; the
stored `role` field is only a UI projection, never the authority source.

The implementation binds every MLS application envelope to a version-1 detached Nostr
authorization proof. The proof commits to the private payload ID and opaque MLS group ID; its event
ID is carried in MLS authenticated data and checked before projection. The private payload remains
unsigned, so decrypted location data does not become a normal publishable Nostr event. Normal
outbound messages require the proof author to match the local MLS BasicCredential. For membership
proposals and commits, `ts-mls` rc.12 supplies the verified sender leaf to its incoming-message
callback even though it is absent from the final `processMessage` result. Earthly resolves that leaf
to its BasicCredential and rejects sensitive proposals from non-administrators.

Administrator promotion and demotion use encrypted kind `37524` policy records. Each transition has
a strict revision, predecessor envelope ID, and canonically sorted administrator set; it changes
exactly one member. Clients evaluate records in coordinator cursor order, accept the first valid
extension, and ignore stale or unauthorized alternatives. Accepted policy records are re-encrypted
into the post-Add epoch before a newcomer can retrieve its Welcome, giving that device the trusted
current policy without exposing the administrator list publicly. Account signers may still prompt
once per private record; a future narrowly scoped, revocable device/session authorization can
improve that UX without weakening the identity binding.

MLS membership grants decryption capability; application roles govern which decrypted messages a
client accepts as authorized. If editor and read-only viewer roles are later added, they are
application authorization rules and do not create cryptographically distinct audiences inside one
MLS group. Administrator policy updates must be encrypted, authenticated, versioned, and evaluated
against the policy state that was current for the message's workspace epoch. Clients must reject
membership commits from a sender who was not an authorized administrator in that state; coordinator
admission checks are defense in depth, not the source of that authorization.

A newly added MLS member receives the current epoch secrets, not the secrets for epochs before the
Add operation. Pre-join chat and geometry history therefore require a separate application-level
bootstrap after the member joins:

- by default, an existing authorized member publishes a current-state snapshot in the new epoch so
  the newcomer receives the present datasets and annotations without disclosing the full audit
  trail;
- an optional **Share prior history** policy can publish a bounded encrypted archive in the new
  epoch when the workspace explicitly wants newcomers to read older comments and revisions;
- the coordinator cannot manufacture this history transfer because it stores ciphertext and does
  not possess old application plaintext or epoch secrets.

Snapshot and history-bootstrap records need content hashes, a source epoch/cursor, authorization,
replay protection, size limits, and deterministic projection rules. They must not weaken the
forward-secrecy guarantee for members who are removed later.

The implemented checkpoint version 1 uses an administrator-authored kind-37525 manifest after the
Add commit. It binds a pre-Add coordinator cursor to at most 4,096 authenticated envelope IDs,
replays the accepted administrator-policy chain and the latest kind-37515 Dataset per `pubkey` +
`d` coordinate, and publishes fresh encrypted metadata before storing the Welcome. Earlier Comments
and their geometry attachments are excluded. An optional prior-history archive and encrypted
large-object manifests remain later work.

### 18.5 Product surface inside a private map

Do not build a reduced parallel map editor. Preserve the core Earthly workflow:

- browse workspace datasets and layers;
- draw and edit datasets and annotations;
- create threaded comments with map geometry;
- attach encrypted media and larger geometry objects;
- inspect authorship, history, membership, and synchronization state;
- export content when workspace policy permits it.

Add private-specific surfaces for member/device management, invitations, roles, security state,
coordinator status, offline queues, and recovery. The active workspace must be visually persistent
so a user can tell whether an action is private, local-only, queued, or public.

Disable or gate operations that cross the privacy boundary:

- public discovery, public search indexing, zaps, public reactions, and ordinary public sharing;
- automatic publication to public relays or upload of plaintext to public Blossom servers;
- external geocoding, routing, content-processing AI/ContextVM tools, remote media, and public
  basemap requests without explicit policy and user awareness;
- implicit references that reveal a private workspace or object from a public event;
- copying private content into another workspace without an explicit export/import decision.

Provide a deliberate **Publish a public copy** flow later. It must preview exactly which geometry,
properties, attachments, authorship, and metadata leave the workspace and create a new public
lineage rather than silently changing the private record's visibility.

### 18.6 Relationship to offline and local-node work

Private maps are useful offline even though their normal rendezvous service is online:

- a member can read already-decrypted local projections and create MLS application messages while
  disconnected, provided the client has current usable group state;
- Tauri persists MLS client state in a dedicated secure store. The durable outbox retains the
  application envelope encrypted at rest under a device key, its current MLS ciphertext, and
  ciphertext blobs; it never retains unprotected workspace plaintext;
- the embedded relay and Blossom server may cache and exchange opaque private messages and blobs
  between paired devices on the same LAN without learning workspace content;
- comments, field notes, annotation discussions, and status updates already use the private
  application channel. A separate free-form group-chat feature is useful but not required for the
  hiking workflow.

The first offline release does not allow membership, role, or workspace-policy changes while
disconnected. Those operations create MLS commits and require one accepted order for each epoch.
On reconnection, a client catches up on commits before publishing newly queued application data. If
the workspace epoch advanced, the client discards the stale MLS ciphertext and re-encrypts the
protected application envelope under the current epoch. If the client was removed, the queued
operation fails visibly and cannot be delivered. Concurrent edits to map entities still require
application-level conflict and merge rules; MLS orders and authenticates messages but does not
merge GeoJSON.

Direct LAN synchronization is an additional delivery path, not a second source of membership truth.
The implementation must define coordinator reconciliation, per-group cursors, duplicate detection,
commit conflict handling, and stale-epoch recovery before local private sync is enabled.

### 18.7 Coordinator and deployment model

Earthly should provide or adopt a Cordn-compatible coordinator exposed as a ContextVM server over
Nostr transport. Its minimum responsibilities are:

- publish, fetch, consume, and remove identity-bound KeyPackages;
- store and deliver pending Welcomes;
- accept opaque MLS handshake and application messages;
- provide monotonic per-workspace ordering, bounded catch-up, and live subscriptions;
- authenticate callers, apply quotas, and retain enough history for offline members;
- never receive or persist MLS epoch secrets or plaintext workspace content.

This service is an MLS coordinator/Delivery Service, not a delegation server. Earthly may operate a
default instance, but the protocol and invitation format must allow a workspace to select a
self-hosted or third-party compatible coordinator. Coordinator migration, multi-coordinator
replication, retention guarantees, and abuse handling are explicit protocol work; they must not be
hidden behind a hard-coded Earthly endpoint.

The browser and Tauri clients use the same coordinator protocol. Tauri's embedded local node can
later implement a compatible local cache or delivery adapter, but it must not become mandatory for
web clients or for private-map interoperability.

### 18.8 Integration depth and API seams

This is not a thin wrapper around the current relay API. The reusable portion is the Earthly entity
model before public signing. The following seams need explicit implementation:

- split entity construction from public Nostr signing so the same validated template can enter a
  public signed-event path or a private MLS-envelope path;
- project authenticated private envelopes into UI/domain records without pretending they are
  relay-validated signed `NostrEvent` objects;
- add workspace-scoped queries, subscriptions, replacement/deletion rules, comments, and entity
  references alongside the public Applesauce event store;
- persist transactional MLS group state, epochs, sender ratchets, KeyPackages, pending commits,
  Welcomes, coordinator cursors, and encrypted outbox records;
- bind each MLS device credential to a Nostr identity with a signed, independently verifiable
  statement;
- verify a detached, group-bound Nostr authorization proof for each private application envelope
  and bind its proof ID into MLS authenticated data;
- implement encrypted-object storage, key rotation, local projection encryption, backup, recovery,
  and device removal;
- define replay, ordering, stale-client, concurrent-commit, and schema-migration behavior.

The browser implementation now journals the complete member-approval write set inside the
workspace record before posting its MLS Add and current-map checkpoint. The version-1 journal keeps
the exact opaque ciphertext and final post-plan client state, recognizes a coordinator write whose
response was lost, resumes missing messages after reload, delays Welcome publication until the
checkpoint is complete, and retires duplicate Welcomes together. This makes the Add/checkpoint/
Welcome/request sequence retryable without duplicating MLS commits. Cordn still needs an
idempotent KeyPackage handoff for regular packages, but Earthly closes its own response-loss window
without a coordinator fork: each new access request publishes a fresh Cordn-profile last-resort
KeyPackage, verifies the coordinator recognized it, and removes it once the Welcome is durably
accepted. The non-destructive `kp_take` retry plus the version-1 approval journal covers every
coordinator response boundary in the single-administrator approval path. Approval recovery now
also handles genuinely concurrent administrators: coordinator cursor order selects the first valid
Add, a losing plan discards its unpublished Welcome/checkpoint ciphertext, replays the winning
epoch, and rebuilds the same semantic approval with the cached retryable KeyPackage. Remove
operations use a parallel version-1 semantic journal: an exact ciphertext makes response loss
idempotent, losing commits are skipped with bounded diagnostics, and a still-authorized removal
intent is regenerated against the accepted epoch. The repeatable established-workspace smoke gate
covers two promoted administrators, concurrent Add plans for different members, two simultaneous
removals, lost post and Welcome responses, process restarts, convergence, new-member catch-up, and
future-epoch exclusion of both removed members. Permanent loss of the only administrator device
holding a winning but unpublished Welcome still needs an explicit recovery design.

Ordinary private application records now use a version-1 write-ahead journal as well. Earthly
persists the authenticated Comment/Dataset envelope, exact Cordn ciphertext, basis cursor, and
post-send MLS state before calling `msg_post`. A reload searches coordinator history for that exact
ciphertext before retrying, restores the sender ratchet state, and hands the acknowledged record to
the existing delayed-echo reconciler. The failure-injection smoke gate loses a post response after
durable coordinator storage, recreates the service, and proves one ciphertext and one projected
record. Once Cordn assigns a cursor, recovery also processes every earlier coordinator-ordered
record from the journal's basis. If a membership commit advanced the epoch first, Earthly catches
up, records the superseded ciphertext as a bounded diagnostic, and re-encrypts the same authenticated
application envelope under the accepted epoch. The six-profile smoke injects a removal precisely
between application encryption and coordinator storage and proves both active clients project one
envelope. This closes the single in-flight response-loss and stale-epoch windows; a multi-record
offline queue and coordinator idempotency key are still required for the complete private outbox.

Dataset/comment schemas and most map presentation components should be highly reusable. Membership,
state persistence, multi-device identity, recovery, delivery ordering, and encrypted blobs are the
high-risk work. `ts-mls` is a suitable TypeScript implementation candidate and already targets
browsers and Node, but it has not undergone a professional security audit; production adoption
requires an independent review, pinned interoperability vectors, and a maintained fallback or fork
strategy.

MLS private keys are not Nostr account keys, but they are long-lived sensitive client state. Browser
storage must use the strongest available origin-bound storage; Tauri must use platform-protected
storage with an explicit backup and recovery design. The coordinator never gets these keys.

### 18.9 Delivery phases

#### Private phase A — protocol, threat model, and domain contracts

Deliver the `PrivateMapWorkspace` terminology and state model, threat model, metadata privacy
budget, versioned private envelope, Nostr-to-MLS identity binding, role authorization rules,
encrypted-object manifest, coordinator contract, and library security/interoperability assessment.

Exit when two independent reference clients can validate the same fixtures and every plaintext
field visible to relays/coordinators is documented and justified.

#### Private phase B — complete group lifecycle

Deliver coordinator deployment, durable browser client state, workspace creation, invitation,
allowlist approval, join/Welcome processing, multi-device membership, administrator policy, member
removal, catch-up, live delivery, recovery diagnostics, and revocation tests.

Exit when two accounts on three devices can create, join, restart, catch up, add/remove a device,
and prove that a removed device cannot decrypt new-epoch content.

#### Private phase C — collaborative Earthly content

Deliver private Dataset, annotation, Comment, and attachment envelopes; workspace-scoped
projections and queries; editor reuse; encrypted blob storage; authorship/history UI; application
authorization; tombstones; and deterministic conflict behavior.

Exit when members collaboratively draw, edit, comment, annotate, restart, and retrieve large
encrypted content without plaintext appearing in relay, coordinator, Blossom, or log fixtures.

#### Private phase D — production web experience

Deliver the persistent private-context UI, member administration, invitations, sync/recovery state,
privacy-boundary prompts, external-service controls, export/declassification flow, accessibility,
abuse limits, browser compatibility, and security review remediation.

Exit when the full lifecycle works in supported browsers and a privacy audit verifies all network
egress and metadata claims.

#### Private phase E — Tauri secure state and offline delivery

Deliver platform-protected MLS state, encrypted local projections, durable private outbox, encrypted
blob integration, lifecycle recovery, local-node opaque caching, and an opt-in same-LAN delivery
path. Membership and policy mutation remain online-only until a later protocol supports safe commit
coordination.

Exit when two physical mobile devices can work in one existing private workspace without internet,
exchange opaque changes locally, restart safely, and reconcile through the coordinator without
duplicate content or divergent MLS state.

#### Private phase F — interoperability and operations

Deliver a publishable protocol profile, reusable client/coordinator libraries, compatibility tests,
self-hosting documentation, coordinator migration and retention policy, independent cryptographic
review, incident response, upgrade vectors, and operational runbooks.

Exit when an Earthly client interoperates with a separately implemented compatible client and no
Earthly-operated service is a mandatory trust or availability root.

### 18.10 Decisions to close before private phase B

- Whether Earthly implements the Cordn draft exactly, profiles it, or contributes the map-specific
  envelope and encrypted-object extensions upstream.
- The recovery model when every administrator device is lost.
- Coordinator retention duration and what a long-offline client does after history expiry.
- Whether the first release has only administrator/member roles or also read-only viewers.
- The accepted conflict model for simultaneous dataset edits and replaceable workspace records.
- Padding and batching policy for location-sensitive traffic analysis.
- Coordinator migration and fork resolution when the current service is unavailable.
- Whether a public Group may advertise a private workspace and exactly what that link is allowed to
  reveal.

## 19. Explicit non-goals

- Rewriting Earthly UI or domain logic in Rust.
- Replacing Applesauce live subscriptions with a second complete Nostr frontend stack.
- Running an inbound public relay inside the application.
- Requiring Citrine, Morganite, or another companion app.
- Persisting or replaying live-beacon heartbeats.
- Adding always-on background location tracking.
- Client-side WebTorrent, H3 chunking, or a PMTiles fork.
- Exposing arbitrary filesystem or shell access to the webview.
- Storing signing keys in LMDB, SQLite, bundles, logs, or outbox rows.

## 20. Definition of done

The Tauri implementation is complete when:

- the canonical offline hiking journey passes on macOS, Windows, Linux, physical Android, and
  physical iOS;
- offline maps use verified native blobs through correct Range responses;
- offline Nostr reads survive restarts through the embedded event database;
- signed publishes are crash-safe and eventually delivered with transparent relay state;
- `.earthly` bundles safely round-trip across every platform;
- native deep links, QR, geolocation, file dialogs, and sharing have permission-aware UX;
- platform capability scopes and command validation pass security review;
- installers/store packages are signed, reproducible, upgrade-tested, and supported by runbooks;
- the web application remains functional through the same platform contracts;
- no production path, document, or UI describes the native application as experimental.

## 21. Authoritative implementation references

- [Tauri development and mobile commands](https://v2.tauri.app/develop/)
- [Tauri platform-specific configuration](https://v2.tauri.app/develop/configuration-files/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri permissions](https://v2.tauri.app/security/permissions/)
- [Tauri official plugin catalog](https://v2.tauri.app/plugin/)
- [Tauri filesystem plugin](https://v2.tauri.app/plugin/file-system/)
- [Tauri distribution](https://v2.tauri.app/distribute/)
- [Tauri asynchronous custom URI protocol API](https://docs.rs/tauri/latest/tauri/struct.Builder.html#method.register_asynchronous_uri_scheme_protocol)
- [rust-nostr LMDB backend](https://docs.rs/nostr-lmdb/latest/nostr_lmdb/struct.NostrLMDB.html)
- [Messaging Layer Security protocol (RFC 9420)](https://www.rfc-editor.org/rfc/rfc9420.html)
- [Messaging Layer Security architecture (RFC 9750)](https://www.rfc-editor.org/rfc/rfc9750.html)
- [Cordn coordinator and protocol reference](https://github.com/Cordn-msg/cordn)
- [ts-mls TypeScript MLS implementation](https://github.com/LukaJCB/ts-mls)
