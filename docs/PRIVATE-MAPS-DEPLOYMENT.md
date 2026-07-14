# Private maps web deployment

This runbook deploys Earthly's browser application and the Cordn-compatible MLS coordinator. It
deliberately excludes Tauri, mobile packaging, local relays, and offline device transport.

## Runtime shape

```text
Browser ── ContextVM requests over Nostr ──> relay.earthly.city
                                                │
                                                └── Cordn v0.4.0 container
                                                    └── /data/cordn.sqlite
```

Cordn is a ContextVM server over Nostr. It does not listen on a public HTTP port and needs no Caddy
hostname. Docker is only the pinned distribution/runtime package. The browser bundle contains the
coordinator public key; the matching private key exists only in the VPS `.env` and Cordn process.

## Prepare configuration

1. Copy `.env.deploy.example` to `.env` and set the SSH target.
2. Copy `.env.production.example` to `.env.production`.
3. Generate two distinct secp256k1 keypairs: one for Earthly's geo ContextVM server and one for
   Cordn. Never reuse an account key or the public local-development scalar `1`.
4. Put each private key and its derived public key into the matching variables. Keep
   `.env.production` out of git and restrict it with `chmod 600 .env.production`.
5. Run the preflight:

```bash
bun --env-file=.env.production scripts/validate-production-env.ts
./scripts/deploy.sh --check
```

`--check` validates both environment files and the deployment shell without building, connecting to
the VPS, uploading files, or restarting services.

One way to generate a keypair without putting a secret in shell history is:

```bash
bun -e "import { bytesToHex } from '@noble/hashes/utils.js'; import { generateSecretKey, getPublicKey } from 'nostr-tools'; const sk=generateSecretKey(); console.log('private='+bytesToHex(sk)); console.log('public='+getPublicKey(sk))"
```

Run it twice and store the results in a password manager before placing them in the ignored
production environment file.

The preflight rejects:

- missing, malformed, mismatched, or known development keys;
- insecure or loopback relay URLs;
- in-memory Cordn storage or an unexpected SQLite mount path;
- an image other than the compatible Cordn v0.4.0 tag or an immutable GHCR digest;
- absent rate-limit, quota, or retention settings.

## VPS prerequisites

The deploy user needs these commands on `PATH`:

- Bun and PM2;
- Go with CGO support for the Earthly relay;
- Docker for the pinned Cordn image;
- Caddy, with permission to replace/reload its configuration;
- `curl` and `tar`.

The deployment directory defaults to `/var/www/earthly`. The deploy user must be able to write it.
Docker access should be granted through the normal `docker` group or an equivalent rootless setup;
the deployment scripts do not use `sudo docker`.

## Deploy

```bash
bun run deploy
```

The local deploy script validates the production environment before building, creates the browser
bundle with the validated Cordn public key, uploads the release and production environment over
SSH, then runs the remote activation script.

Remote activation:

- installs exactly `bun.lock` with production dependencies;
- builds the Go relay;
- restarts only `earthly-*` PM2 processes, leaving unrelated VPS apps untouched;
- starts `ghcr.io/cordn-msg/cordn:v0.4.0` with SQLite storage and abuse limits;
- preserves the `earthly-cordn-data` Docker volume across application deployments;
- stops Cordn and writes a consistent compressed SQLite-directory snapshot before replacing its
  container. Snapshots live in `backups/cordn/` and default to 14-day retention.
- retains the stopped previous Cordn container until the replacement remains running, restoring it
  automatically when replacement startup fails.

## Verify

On the VPS:

```bash
pm2 list
docker ps --filter name=earthly-cordn
docker logs --tail 100 earthly-cordn
docker run --rm -v earthly-cordn-data:/data:ro alpine:3.20 test -s /data/cordn.sqlite
```

Then verify `https://earthly.city`, `wss://relay.earthly.city`, and the complete private-group flow
with two isolated browser profiles: create, copy a signed invitation, request access, approve,
accept the Welcome, exchange a comment and Dataset, restart Cordn, and confirm both records remain
available.

## Operational boundaries

- Treat `CORDN_SERVER_PRIVATE_KEY` as durable service identity. Existing workspace records and
  invitations retain that coordinator pubkey; changing it is a migration, not ordinary rotation.
- Cordn v0.4's `CORDN_MAX_AGE_DAYS` cleans expired Welcomes and join requests. It does not prune
  group-message history, so monitor the SQLite file and VPS free space.
- Version-2 Earthly invitations expire after 24 hours, but Cordn v0.4 cannot atomically consume the
  invitation nonce. Explicit administrator approval remains the admission boundary.
- Cordn stores opaque MLS ciphertext and routing metadata, not map plaintext or epoch secrets.
- Browser MLS state remains origin-bound IndexedDB state. This web release makes no Tauri or
  hardware-backed storage claim.
- The Mapnolia binary is still fetched from its latest GitHub release by the existing deployment
  path. Pinning it by version and checksum is a separate supply-chain hardening item.
