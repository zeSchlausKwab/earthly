# Earthly Local Nostr Node

Status: implementation contract, version 0.1
Created: 2026-07-14
Scope: reusable embedded Nostr relay, Blossom server, pairing, and offline reachability

## 1. Intent

Earthly ships its own local Nostr infrastructure. A single native node provides:

- a persistent NIP-01 relay;
- a persistent Blossom server;
- one node identity and peer authorization policy;
- same-device and offline-LAN reachability where the operating system permits it;
- discovery and pairing without an internet relay;
- clean Rust interfaces that can be reused by other Tauri and native Nostr applications.

This removes Citrine, Morganite, or any other companion application from Earthly's runtime
requirements. Offline maps, event caching, publishing, and partner mirroring become consumers of
the local node rather than separate native subsystems.

Discovery and bearer selection are defined in
[`OFFLINE-TRANSPORT-STRATEGY.md`](./OFFLINE-TRANSPORT-STRATEGY.md).

## 2. First proof

With internet access disabled:

1. Earthly starts its local node.
2. A separate reference client obtains a one-use pairing invitation.
3. The reference client authenticates its pubkey and receives an explicit capability grant.
4. It publishes a signed Nostr event through the embedded relay.
5. It subscribes and receives that event through ordinary NIP-01 messages.
6. It uploads a blob through ordinary Blossom HTTP endpoints.
7. It retrieves the blob with `HEAD`, `GET`, and multiple Range requests.
8. Earthly is restarted.
9. The client reconnects and recovers the same event and blob.
10. An unpaired client is denied relay writes and protected Blossom operations. Pairing-aware relay
    reads become part of this gate once the selected relay exposes the authenticated session pubkey
    to query policy.

The reference client must depend only on published protocols and the pairing document. It may not
import Earthly application code.

### Implementation checkpoint — 2026-07-14

The native foundation and transport-neutral handshake are implemented:

- Tauri supervises the node and exposes a read-only `starting`/`running`/`failed` status command;
- one stable node identity, an exclusive data-directory lock, and peer grants survive restart;
- the loopback relay uses persistent LMDB, NIP-42, bounded connections/filters/subscriptions, and
  a paired-event-author write policy;
- Blossom implements authenticated BUD-01 GET/HEAD with single ranges, BUD-02 streaming upload,
  and BUD-11 authorization with paired-pubkey enforcement;
- independent rust-nostr and HTTP clients pass publish/query/upload/range/restart tests;
- signed, ten-minute invitations, peer-signed claims, explicit approval/rejection, one-use
  consumption, crash-recoverable decisions, and capability-scoped grants are implemented;
- independent host and client processes complete pairing and then prove a relay write, Blossom
  upload, and Blossom byte-range read without a public relay;
- arm64 and x86_64 Android APKs build, and the arm64 application has run its own embedded listeners
  on an API 36.1 emulator and a physical Pixel;
- the Earthly frontend now uses a versioned, runtime-validated platform adapter to show node state,
  create QR/copy invitations, review and approve or reject pending claims, display capabilities,
  list paired devices, and revoke grants; the browser adapter reports this capability as unsupported
  without attempting native IPC;
- a host can explicitly select a private IPv4 interface and serve for a bounded 15-minute LAN
  session; expiry or an explicit stop returns the node to loopback;
- a second Earthly installation can paste or photograph the QR invitation, sign a claim with its
  stable installation identity, poll for approval, and persist the joined-node descriptor and
  capability state across restart;
- the LAN reference proof completes claim approval, relay publish/query, Blossom upload, and a
  Blossom byte-range read through the advertised private-IP endpoints;
- newly issued grants include `relay-read`; an accepted peer can explicitly run a pull-only NIP-77
  reconciliation for Earthly entity, comment, proposal, status, reaction, and deletion kinds;
- synchronized events retain their original user signatures, enter the peer's local LMDB through a
  verified in-process ingestion path, and are returned through a bounded Tauri response so
  Applesauce updates immediately. Profiles, wallets, and arbitrary kinds are not pulled by that
  operation;
- synchronized dataset `blob` tags and NIP-92 `imeta` hashes populate a bounded durable inventory.
  The user can explicitly mirror those hashes from the approved node's advertised Blossom endpoint;
  downloads require `blob-read`, send BUD-11 authorization, reject redirects, stream within the
  configured size cap, verify SHA-256, and atomically enter the local content-addressed store;
- the main Earthly webview can read local hashes through the `earthly-blob` custom protocol with
  GET, HEAD, and single-Range semantics. Paths are exact lowercase SHA-256 values, full responses
  are capped at 64 MiB, and larger files require bounded Range reads. Dataset resolution probes
  this local source first and falls back to the event URL only when the hash is absent.

Before the interoperability proof is product-complete in the Earthly UI it still needs:

- deep-link invitation import and an optional live-camera scanner (photo-based QR import ships now);
- Android 17/iOS local-network permission adapters and denial diagnostics;
- relay authorization against the authenticated NIP-42 session pubkey, including separate
  read/write capabilities;
- BUD-12 deletion, persistent blob ownership/quota metadata, and NIP-11 relay information;
- an Android foreground service for user-visible background availability.

`nostr-relay-builder` 0.44 exposes event-author and socket information to write policies, but not
the authenticated NIP-42 session pubkey. The implemented network write policy therefore safely
accepts events authored by a paired pubkey but cannot authorize a paired client to push arbitrary
third-party events. Pull synchronization does not weaken that policy: the receiving native process
reconciles downward, verifies the original signatures, and writes through its trusted internal
database boundary. Bidirectional relay mirroring still requires an upstream policy-context hook or
a narrowly maintained patch; it must not be approximated by weakening NIP-42.

## 3. Supported reachability

### Same device

- Desktop: supported through loopback TCP while the Earthly process is running.
- Android: currently supported while the Earthly process is alive; a user-visible foreground
  service is required before background availability can be promised.
- iOS: Earthly itself uses the node in-process, but another foreground app cannot rely on Earthly
  remaining available after iOS suspends Earthly.

### Separate devices without internet

- Supported over an existing LAN, a phone hotspot, or another local IP link.
- The serving application must be running; iOS serving is foreground-only.
- Local discovery is an optimization. A QR/deep-link invitation containing direct endpoints is
  sufficient for the first implementation.

Offline means no internet path and no public relay. It does not mean there is no local IP link.

## 4. Module shape

The reusable Rust crate lives outside the Tauri application implementation:

```text
crates/earthly-local-node/
├── Cargo.toml
├── examples/
│   ├── pairing_host.rs
│   └── pairing_client.rs
└── src/
    ├── lib.rs
    ├── config.rs
    ├── descriptor.rs
    ├── error.rs
    ├── identity.rs
    ├── node.rs
    ├── policy.rs
    ├── relay.rs
    ├── blossom.rs
    └── pairing.rs
```

Tauri, Android, and iOS lifecycle code are adapters. They must not be required to instantiate the
node in a CLI, test harness, or another native application.

The external Rust interface stays small:

```rust
impl LocalNode {
    pub async fn start(config: NodeConfig) -> Result<Self, NodeError>;
    pub fn descriptor(&self) -> &NodeDescriptor;
    pub async fn create_pairing_invitation(/* ... */) -> Result<PairingInvitation, PairingError>;
    pub async fn pending_pairing_claims(&self) -> Result<Vec<PendingPairingClaim>, PairingError>;
    pub async fn approve_pairing_claim(/* ... */) -> Result<PendingPairingClaim, PairingError>;
    pub async fn reject_pairing_claim(/* ... */) -> Result<(), PairingError>;
    pub fn shutdown(&self);
}
```

Listener coordination, storage engines, authentication, policy, recovery, and graceful shutdown
are implementation details behind this interface.

## 5. Node identity

- The node has an installation-scoped Nostr key distinct from every user account.
- The private node key never crosses into the webview and is never included in logs, bundles, or
  pairing invitations.
- The public key identifies the node across address, port, and network changes.
- Production key custody uses an operating-system-backed secret store or Tauri Stronghold.
- Deleting the node identity is an explicit destructive reset that invalidates existing pairings.

Earthly user accounts still sign user events. The node identity signs node descriptors and pairing
responses; it does not impersonate the active Earthly user.

## 6. Node descriptor

The versioned descriptor is serializable and transport-neutral:

```json
{
  "version": 1,
  "nodeId": "<32-byte lowercase hex>",
  "relayUrl": "ws://127.0.0.1:17447/",
  "blossomUrl": "http://127.0.0.1:17448/",
  "scope": "loopback",
  "availability": "foreground"
}
```

URLs and ports are examples, not standardized constants. Pairing transfers the descriptor, so the
node may use operating-system-assigned ports. A later discovery adapter may advertise the same
descriptor over mDNS/Bonjour.

## 7. Pairing

Pairing grants a pubkey narrowly scoped access to the local node.

1. Earthly creates a random, one-use, short-lived invitation nonce.
2. Earthly presents the invitation as QR, deep link, or copyable text.
3. The peer sends its pubkey and a signature over the invitation challenge.
4. The node verifies the signature, invitation expiry, nonce, and requested capabilities.
5. Earthly shows the peer identity and requested access for approval.
6. The node stores a persistent grant and consumes the nonce atomically.
7. Later relay access uses NIP-42; Blossom access uses BUD-11.

Initial capability vocabulary:

- `relay.read`
- `relay.write`
- `blob.read`
- `blob.list-own`
- `blob.write`
- `blob.delete-own`
- `blob.mirror`

Capabilities are deny-by-default, revocable, and bound to the peer pubkey. Loopback or LAN
membership never implies authorization. Invitations never contain the node private key or an
unlimited bearer credential.

### 7.1 Implemented draft v1 wire format

The implemented invitation is a signed Nostr event wrapped as
`earthly-pair-v1:z<base64url-zlib-json>`. Decoders continue to accept the earlier uncompressed
`earthly-pair-v1:<base64url-json>` form. Compression keeps the signed envelope near 700 characters
so the QR retains scannable modules at phone size; it does not alter or replace signature
verification. The event:

- uses experimental ephemeral kind `24243`;
- is signed by the stable node identity;
- contains the versioned node descriptor, a random 32-byte nonce, expiry, and offered capabilities;
- repeats the expiry as a NIP-40 `expiration` tag;
- has a maximum lifetime of ten minutes and is persisted until consumed or expired.

The peer claim is a separately signed ephemeral event of experimental kind `24244`. It binds the
peer pubkey to the invitation event id, host pubkey, nonce, and a non-empty subset of offered
capabilities. The peer submits it to:

```text
POST /.well-known/earthly-local-node/pairing/claims
GET  /.well-known/earthly-local-node/pairing/claims/{claim-id}
```

Submission returns `pending`; it never grants access by itself. Host approval durably reserves one
winning claim, moves the invitation to the consumed set, persists the capability grant, and changes
the claim status to `accepted`. Each step is idempotent so the same approval can resume after a
crash without allowing another winner. Replaying the invitation returns a conflict. Rejection
records a terminal status but does not consume the invitation.

The v1 implementation offers and enforces `relay.write`, `blob.read`, and `blob.write`. The broader
capability names above are reserved for the endpoints that implement them. The selected relay
dependency requires NIP-42 authentication for reads but does not expose the authenticated pubkey to
its query-policy hook; therefore pubkey-specific `relay.read` authorization remains an explicit
upstream integration gap and is not offered by v1 invitations.

Kinds `24243` and `24244`, the HTTP paths, and the invitation prefix are an Earthly interoperability
draft. They are not registered Nostr kinds and no NIP or BUD number is claimed.

## 8. Embedded relay

The first relay implementation uses `nostr-relay-builder` behind Earthly's relay module seam and a
`nostr-database` implementation backed by LMDB.

Required behavior:

- NIP-01 `EVENT`, `REQ`, `CLOSE`, `EVENT`, `EOSE`, `OK`, `CLOSED`, and `NOTICE`;
- event id and Schnorr signature verification before persistence;
- correct regular, ephemeral, replaceable, and parameterized-replaceable handling;
- NIP-11 relay information;
- NIP-42 peer authentication with explicit `OK` outcome;
- NIP-45 event counts where the dependency supports it;
- NIP-77 negentropy when stable in the selected rust-nostr dependency set;
- bounded filters, subscriptions, message sizes, and connections;
- per-peer query and write policies derived from pairing grants;
- graceful listener shutdown and crash-safe persistent recovery.

The relay is local-first and partition-available. It accepts valid local writes while internet
relays are unreachable; later synchronization is eventual and outside the first relay proof.

## 9. Embedded Blossom

The first Blossom implementation provides:

- BUD-01 `HEAD` and `GET /<sha256>` with ETag, immutable caching, CORS, and single Range requests;
- BUD-02 upload and blob-descriptor behavior;
- BUD-11 kind-24242 authorization;
- BUD-11 clients backdate short-lived authorization events slightly so independently clocked
  offline devices still satisfy the requirement that `created_at` is in the server's past;
- BUD-12 authenticated deletion; the discouraged owner-list endpoint is not required initially;
- BUD-04 mirroring only after a separate SSRF, redirect, DNS-rebinding, and size-control review;
- streaming upload into a staging file;
- SHA-256 verification before atomic adoption;
- content-addressed deduplication;
- persistent ownership/reference metadata;
- bounded request bodies, ranges, concurrency, and storage quotas;
- restart cleanup of incomplete staging files.

The implementation stores full blobs. Range is a read mechanism for locally stored files, not a
partial mirroring strategy.

## 10. Shared policy and storage

The relay and Blossom server share:

- node lifecycle and cancellation;
- peer grants;
- node identity;
- application-local data root;
- structured logging and safe error codes;
- quotas and health reporting;
- schema migration coordination.

They do not share user content tables:

- Nostr events live in the rust-nostr database.
- Blob bytes live in a content-addressed filesystem.
- Peer grants, blob ownership, jobs, and migrations live in an application metadata database.

## 11. Lifecycle adapters

### Desktop

- Start with the application and stop gracefully on exit.
- Default to loopback.
- LAN serving requires an explicit toggle, visible status, and firewall guidance.

### Android

- Use a bound service while Earthly is visible.
- Use a foreground service with a persistent notification when the user explicitly enables
  availability to other apps.
- Never silently start long-running service availability from the background.

### iOS

- Start the node for Earthly's in-process use while the app is active.
- Stop advertising and close listeners during background transition.
- Do not promise same-device service availability to another foreground app.
- Support cross-device serving while Earthly remains in the foreground.

## 12. Security requirements

- All inbound events and authorization events are cryptographically verified.
- Relay and Blossom writes require an authenticated peer grant.
- Public reads are off by default and independently configurable per protocol.
- LAN mode never binds without explicit user action.
- The UI always shows whether the node is stopped, loopback-only, or LAN-reachable.
- Listener addresses, ports, peer pubkeys, and capability changes are auditable.
- Pairing nonces are random, expiring, one-use, and transactionally consumed.
- Clock skew is reported distinctly from signature or permission failure.
- Blossom mirroring rejects loopback, link-local, private, and metadata endpoints unless the user
  explicitly selected a local peer flow that safely pins the destination.
- No generic filesystem or shell command is exposed to the Tauri webview.

## 13. Reusable deliverables

The foundation should yield:

1. `earthly-local-node` — transport-neutral Rust node crate.
2. `earthly-local-node-tauri` — Tauri lifecycle and command adapter, if the adapter becomes useful
   outside Earthly.
3. `@earthly/local-node` — TypeScript descriptor, invitation, capability, and status types.
4. A minimal reference client/CLI.
5. A versioned Local Nostr Node Discovery and Pairing document.
6. Cross-implementation fixtures and conformance tests.

Extraction into separately published packages happens after the first Earthly integration proves
the interfaces. The repository structure must make extraction mechanical rather than forcing a
redesign.

## 14. Foundation phases

### A. Tauri shell and deterministic build

Boot Earthly under Tauri on desktop, define mobile configuration, and establish the Rust workspace
and lifecycle seam.

### B. Local-node core

Start and stop coordinated test listeners, persist node configuration, expose a descriptor, and
prove the crate runs without Tauri.

### C. Embedded relay

Add LMDB, NIP-01, NIP-11, NIP-42, peer policy, restart persistence, and a generic relay test
client.

### D. Embedded Blossom

Add content-addressed files, BUD-01/02/04/11, Range conformance, restart persistence, and a generic
HTTP test client.

### E. Offline interoperability

Implement pairing, the reference client, same-device desktop/Android tests, offline-LAN tests, and
documented iOS foreground behavior.

The foundation is complete only after the canonical proof in section 2 passes.

## 15. Authoritative protocol references

- [NIP-01 basic relay protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-11 relay information](https://github.com/nostr-protocol/nips/blob/master/11.md)
- [NIP-42 relay authentication](https://github.com/nostr-protocol/nips/blob/master/42.md)
- [Blossom Upgrade Documents](https://github.com/hzrd149/blossom)
- [rust-nostr RelayBuilder](https://docs.rs/nostr-relay-builder/latest/nostr_relay_builder/builder/struct.RelayBuilder.html)
