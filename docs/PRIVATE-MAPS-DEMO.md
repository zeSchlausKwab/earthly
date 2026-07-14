# Private groups browser/Tauri demo

Earthly now has a browser-first vertical slice for MLS-protected private groups. The same React,
domain, storage, and Cordn coordinator client code is bundled into the Tauri application. This is
an implementation checkpoint on the full plan in `docs/TAURI-IMPLEMENTATION-PLAN.md`, not a claim
that the security and recovery work is finished.

## What the demo proves

- an Earthly account signs an identity-bound MLS KeyPackage publication;
- an administrator creates a private map without publishing its name, description, or basemap;
- an invitation carries only opaque rendezvous data, coordinator identity, relays, and a nonce;
- a second browser profile requests access and an administrator explicitly approves its device;
- the new device retrieves an MLS Welcome and decrypts workspace metadata;
- a member joining an established workspace receives a versioned post-Add checkpoint containing
  the accepted administrator policy, fresh metadata, and the latest authenticated version of each
  current Dataset, while earlier discussion and its geometry attachments remain undisclosed;
- members exchange Nostr-shaped private envelopes containing kind-37517 Comments, optional inline
  comment geometry, and standalone kind-37515 Dataset records;
- every private envelope carries a detached Nostr authorization proof over its payload ID and opaque
  MLS group ID. The proof ID is also bound into MLS authenticated data, receivers verify it before
  projection, and the private payload itself remains an unsigned, non-publishable Nostr-shaped
  record;
- comments and Dataset updates arrive reactively without requiring the recovery Sync control;
- private Datasets use the normal Earthly editor and remain independently controllable in the Map
  Stack, including its existing zoom, inspect, and edit actions;
- private comments can reference workspace Datasets or individual features with the normal `$`
  mention UI. Reference lookup stays inside the loaded workspace instead of querying public relays,
  and the serialized reference is protected inside the MLS application message;
- comment geometry appears as a default-visible attachment in Chat and in the Geometry overview;
- MLS client state, cursors, envelopes, KeyPackages, and pending joins survive browser reloads in
  IndexedDB;
- a member Remove/Commit advances the epoch and the removed profile cannot decrypt a later record;
- Cordn sees ordered opaque payloads and never receives workspace plaintext or MLS epoch secrets.

## Run it locally

Start the complete development stack:

```bash
bun dev
```

This starts the local relay, Earthly's geo/AI ContextVM server, frontend, and the separate Cordn
v0.4.0 ContextVM MLS coordinator. Cordn always communicates through ContextVM over Nostr. Docker is
only one reproducible way to package and launch that coordinator; it is not an alternative transport
or architecture. If a Docker daemon is available, the launcher uses the pinned
`ghcr.io/cordn-msg/cordn:v0.4.0` image. Otherwise it verifies and runs the exact
`96ecdd277cdd9051c81f113dda521ce5ce380e94` source commit from the ignored `.cache` directory.

The loopback coordinator uses the documented insecure development key with public key:

```text
79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
```

Do not deploy that key.

Open `http://localhost:3000` in two isolated browser profiles, sign in with different accounts,
then open **Private groups** from the left workspace rail:

1. Profile A opens `/private-groups`, creates a private group, and copies an invitation. Its stable
   detail URL is `/privategroup/:id`.
2. Profile B opens the invitation and selects **Request access**.
3. Profile A opens **Settings**, selects **Check requests**, then **Approve member**.
4. Profile B selects **Check approval**.
5. Either profile can post a private comment with or without drawn geometry. New comments arrive
   automatically; attachments appear on the map by default and can be hidden or zoomed from Chat or
   Geometry. A comment can also `$`-reference an existing encrypted Dataset or feature.
6. Either profile can create and edit a standalone private Dataset with the normal Earthly editor.
   Removing its reference from the Map Stack does not delete it or cause automatic sync to add it
   back; Geometry remains the overview from which it can be restored. Map Stack Inspect/Edit use the
   standard Dataset panels, and their back action returns to the same private group.
7. Profile A removes Profile B and posts another record. Profile B moves into the removed state and
   cannot decrypt that later record.

The repeatable MLS crypto smoke gate is:

```bash
bun run test:private-maps
```

Bun 1.3 cannot import the raw X25519 keys required by `@hpke/core`, despite advertising X25519 key
generation. The command therefore bundles the browser-safe client and executes the interoperability
gate with Node's WebCrypto. Chromium and Node both complete the selected Cordn ciphersuite.

## Build the desktop application against the loopback coordinator

```bash
CORDN_SERVER_PUBKEY=79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798 \
RELAY_URL=ws://localhost:3334 \
bun run tauri:build -- --debug
```

The macOS debug application is emitted at `target/debug/bundle/macos/Earthly.app`. Production
deployments must provide their own `CORDN_SERVER_PUBKEY` and relay configuration.

## Deliberate limitations of this checkpoint

- `ts-mls` is pinned to `2.0.0-rc.12`; it is not professionally audited and this code has not had
  an independent cryptographic review.
- Browser MLS state and decrypted projections are origin-bound in IndexedDB but are not yet
  encrypted under a hardware-backed device key. Tauri secure storage is a later phase.
- Invitation nonces are not yet consumed by a coordinator-side one-use rendezvous record. Device
  approval remains explicit, but replay-resistant invitation expiry is not complete.
- Delivery currently uses serialized bounded Cordn fetches on an automatic watcher. Empty fetches
  take a no-op path: Earthly does not deserialize or rewrite MLS state and does not publish a new
  React workspace snapshot, while repeated quiet polls back off to reduce background work. Cordn's
  ContextVM `msg_sub` stream still needs browser teardown/removal hardening before Earthly can rely
  on a long-lived subscription. Coordinator-acknowledged application sends persist their advanced
  MLS state and remain pending until a later fetch confirms the cursor, so an immediate self-echo is
  not required. Member approval now persists a version-1 recovery journal containing the exact
  Add/checkpoint ciphertext plan before any group message is posted. A reload recognizes already
  accepted ciphertext, resumes missing writes, stores the Welcome only after the complete
  checkpoint, and consumes duplicate Welcomes for the same KeyPackage together. General offline
  application outbox recovery remains; manual **Sync** is a recovery control rather than the normal
  receive path.
- The demo projects standalone Datasets plus Comments with optional small inline GeoJSON through a
  workspace-scoped store. It does not yet provide encrypted large-object/blob attachments,
  threaded private replies, tombstones, or a complete concurrent-edit conflict protocol.
- Private inline references currently reuse a Dataset's Nostr address tuple inside the ciphertext
  and resolve only against the active workspace projection. A future protocol profile should make
  cross-workspace reference semantics and coordinate collisions explicit.
- Administrator roles now come from a signed, MLS-encrypted, versioned policy chain rather than a
  local role toggle. The creator is the trust anchor, current administrators can promote or demote
  other members, each transition extends one predecessor, and coordinator delivery order selects
  the first valid concurrent transition. The MLS incoming-message callback also rejects sensitive
  membership proposals from a sender whose verified MLS credential is not a current administrator.
  Simultaneous administrator commits and their stale-epoch conflict recovery remain a
  production-hardening item.
- Every new Earthly access request publishes a fresh Cordn-profile last-resort KeyPackage and
  verifies that the coordinator recognized the profile. Cordn returns that package
  non-destructively, so an administrator can retry `kp_take` after losing its response even before
  the local approval journal exists. Earthly removes the package after the member durably accepts
  its Welcome; it is a bounded retry mechanism, not a permanently reusable device package. Legacy
  pending requests created with a regular KeyPackage retain the old one-shot behavior and should be
  re-requested if that retrieval response is lost.
- Creating a private application record asks the active Nostr signer for its detached authorization
  proof. Browser extension and remote signers may therefore prompt per record until Earthly defines
  a narrowly scoped, revocable device/session authorization mechanism.
- Authorization kind 27523 is an Earthly-experimental ephemeral-range inner event, never an event
  the client intentionally publishes to a relay. A reusable protocol profile still needs
  interoperability review and kind coordination.
- Private envelopes written before authorization version 1 remain readable from an existing local
  projection, but are rejected if received again from the coordinator. This is an intentional
  security compatibility boundary for the current development checkpoint.
- A newly added MLS member cannot decrypt records sent before the Add epoch. Earthly re-encrypts the
  accepted administrator-policy chain, fresh metadata, and the latest Dataset envelope for each
  `pubkey` + `d` coordinate into the post-Add epoch. An administrator-authored kind-37525 manifest
  binds the bounded checkpoint to its source cursor and authenticated envelope IDs. Version 1
  deliberately excludes prior Comments and their geometry attachments; the optional, explicitly
  shared history archive is not implemented yet.
- Metadata is encrypted as an Earthly application record. It is intentionally not copied into an
  MLS GroupContext extension, public Nostr tags, or the invitation.
- Removal protects future epochs; it cannot retract content or keys that a former member already
  received.
- Offline/LAN delivery is not part of this checkpoint. It remains an additional delivery path after
  browser lifecycle and recovery behavior are hardened.
