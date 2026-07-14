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
- members exchange Nostr-shaped private envelopes containing chat and kind-37515 Dataset records;
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
3. Profile A selects **Requests**, then **Approve device**.
4. Profile B selects **Check approved invites**.
5. Either profile can post a message or demo Dataset; the other selects **Sync**.
6. Profile A removes Profile B and posts another record. Profile B moves into the removed state and
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
- Delivery currently uses explicit bounded Cordn fetches. Cordn's ContextVM `msg_sub` stream works
  for live records, but its browser teardown/removal lifecycle still needs hardening before Earthly
  can rely on it. Timer polling is also unsuitable while each fetch creates a new ephemeral delivery
  session. Durable transactional pending commits and crash recovery remain; manual **Sync** is the
  current recovery path.
- The demo projects chat and a small Dataset envelope. It does not yet route the full map editor,
  comments, encrypted blobs, attachments, or conflict resolution through a workspace-scoped store.
- Metadata is encrypted as an Earthly application record. It is intentionally not copied into an
  MLS GroupContext extension, public Nostr tags, or the invitation.
- Removal protects future epochs; it cannot retract content or keys that a former member already
  received.
- Offline/LAN delivery is not part of this checkpoint. It remains an additional delivery path after
  browser lifecycle and recovery behavior are hardened.
