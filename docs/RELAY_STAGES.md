# Relay Stages — the isolation contract

**One sentence:** in dev, content lives ONLY on the local relay; profile and wallet data may be
read from public relays; nothing is written publicly unless you flip an explicit dev flag.

Enforced by `src/lib/nostr/relay-router.ts`. If you touch relay selection anywhere, route it
through the router — never hard-code a relay URL in feature code.

## Buckets

Every read/write belongs to one bucket, classified by event kind (`bucketForKind`):

| Bucket | Kinds | Dev reads | Dev writes | Prod |
|---|---|---|---|---|
| **content** | 37515–37522, 34444, comments, reactions 7, zaps 9734/9735, proposal status 163x, and **every kind not listed below** (safe default) | local relay only | local relay only | configured relays |
| **profile** | 0, 3, 10002, 10065 | public allowed | local only (NIP-65 publishes collapse to local) | configured relays |
| **wallet** | 17375, 7375, 7376, 7374, 10019, 9321 | public allowed | **exception:** wallet ActionRunner publishes to the wallet's real relays even in dev — NIP-60 state is per-user, NIP-44-encrypted, and forking it across relay sets corrupts the user's real wallet | wallet relays + outboxes |
| **discovery** | ContextVM/MCP transport, NIP-50 entity search | local relay only (`bun dev` runs a local geo server) | n/a (RPC) | configured relays |

## Dev flags (settings → Relays → "Dev relay isolation")

Persisted in `localStorage['earthly:dev-relay-flags']`, applied live:

- **allowPublicReads** — content/discovery reads also hit `config.readRelays` (debugging).
- **allowPublicWrites** — `publish()` stops collapsing outbox/inbox routing to the local relay
  (authoring from dev). Never enable while seeding.

## Enforcement layers (why this is watertight)

1. **Publish collapse** — `publish()` in `src/lib/nostr/index.ts` sends everything to
   `config.writeRelays` (local in dev) unless `allowPublicWrites` is on. Explicit `relays:`
   overrides are the caller's responsibility.
2. **Bucket-routed loaders** — the store's missing-event loader is split: content pointers load
   from the content read set, profile/wallet pointers from the profile read set. Both loaders
   run `followRelayHints: false`: relay hints embedded in tags, naddr/nevent pointers, or
   mailboxes NEVER open implicit sockets (this was the main applesauce leak vector).
3. **Kind-aware timeline defaults** — `useTimeline`/`useTimelineWithEose` derive their default
   relay set from the filter kinds via the router.
4. **Pool guard (backstop)** — in dev the RelayPool's WebSocket constructor refuses connections
   to any relay outside the allowlist (configured sets + explicitly vouched relays) and logs
   `[relay-router] BLOCKED …`. If you ever see that log, something upstream is leaking — fix the
   routing, don't just allowlist.

### Vouched exceptions (`allowRelays()`)

Non-content transports may legitimately need public sockets in dev; they vouch for their relays
with the pool guard at the call site:

- NIP-60 wallet reads/writes (`src/lib/wallet/{hooks,runtime}.ts`) — user-approved exception.
- NIP-46 bunker login relays (`src/features/auth/Nip46LoginDialog.tsx`).

## Seeding

All seeding goes through the unified CLI (`scripts/seed.ts` + `src/lib/seeder/`):

```bash
bun run seed <command> [flags]

# commands
bun run seed minimal              # profiles + 1 dataset (fast smoke seed)
bun run seed full                 # rich v1.2 entity seed: groups, datasets, beacons,
                                  #   stories, geo-annotated comments, reactions
bun run seed sightings            # temporal sightings (37522), all observation states
bun run seed canonical            # real-world datasets from base-assets/base_rips
bun run seed purge                # NIP-09 delete canonical data signed by the key

# flags
--relay <url>      # default ws://localhost:3334
--allow-remote     # REQUIRED for any non-loopback relay (see guard below)
--key <hex>        # signing key; falls back to $SEED_KEY, then devUser1
                   #   (canonical/purge also honour $APP_PRIVATE_KEY)
--dry-run          # build + enumerate every event, publish nothing
--verbose          # log each published event
--only <name>      # canonical/purge: one sub-seeder (e.g. sea-cables)
--force            # purge: skip the confirmation prompt
```

`seed:entities` / `seed:sightings` in package.json are thin aliases onto
`seed full` / `seed sightings` (used by `scripts/dev-clean.sh`).

**The structural guard:** `validateRelayURL()` in `src/lib/seeder/config.ts` hard-errors on any
non-loopback relay URL unless `--allow-remote` was passed — seed data cannot leak to a public
relay by accident, regardless of env vars. Loopback = localhost / 127.0.0.1 / ::1 / 0.0.0.0.
Never combine seeding with the `allowPublicWrites` dev flag.

## Server side

`contextvm/server.ts` binds to `ws://localhost:3334` only when `NODE_ENV !== 'production'`,
regardless of `RELAY_URL` — a dev geo server must not announce or answer on public relays.

## How to verify

1. `bun dev`, open the app, DevTools → Network → WS: every socket is `ws://localhost:3334`,
   except wallet/profile reads (`wss://…` from `RELAY_URL`/`EXTRA_READ_RELAYS`) and any wallet
   or bunker relays you use.
2. Flip **allowPublicReads**: newly-mounted content views may open configured public read
   sockets; nothing else changes.
3. Watch the console for `[relay-router] BLOCKED` — it must stay silent in normal use.
