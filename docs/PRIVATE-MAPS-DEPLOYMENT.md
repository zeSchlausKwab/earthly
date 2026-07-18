# Private maps web deployment

This runbook deploys Earthly's browser application and the Cordn-compatible MLS coordinator. It
deliberately excludes Tauri, mobile packaging, local relays, and offline device transport.

## Runtime shape

```text
Browser ── ContextVM requests over Nostr ──> relay.earthly.city
                                                │
                                                └── cordn-rs v0.4.0 under PM2
                                                    └── data/cordn/cordn.sqlite
```

Cordn is a ContextVM server over Nostr. It does not listen on a public HTTP port and needs no Caddy
hostname. Production uses the official native `cordn-rs` v0.4.0 binary, which is wire- and
database-compatible with the TypeScript coordinator. The deployment pins and verifies the official
release archive's SHA-256 digest before PM2 starts it. The browser bundle contains the coordinator
public key; the matching private key exists only in the VPS `.env` and Cordn process.

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
- in-memory Cordn storage, an unsafe native SQLite path, or relaxed SQLite durability;
- absent rate-limit, quota, or retention settings.

## VPS prerequisites

The deploy user needs these commands on `PATH`:

- Bun and PM2;
- Go with CGO support for the Earthly relay;
- Caddy, with permission to replace/reload its configuration;
- `curl`, `tar`, `sha256sum`, and standard GNU userland tools.

The deployment directory defaults to `/var/www/earthly`. The deploy user must be able to write it.
No Docker daemon, root access, or public HTTP endpoint is needed for Cordn.

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
- downloads the architecture-specific `cordn-rs` v0.4.0 release and verifies its pinned SHA-256;
- supervises `earthly-cordn` with PM2 using SQLite storage and abuse limits;
- preserves `data/cordn/` outside release archives across application deployments;
- stops Cordn and writes a consistent compressed SQLite-directory snapshot before replacing its
  process. Snapshots live in `backups/cordn/` and default to 14-day retention.
- retains the previous versioned Cordn binary and restores it automatically when replacement startup
  fails;
- downloads Mapnolia beside the live executable and replaces it atomically, avoiding partial binaries
  and replacement failures while the previous process is still running;
- keeps the currently served browser entrypoint active while the release is prepared, verifies the
  generated module asset, and switches the HTML atomically only after all five PM2 services and the
  loopback web endpoint remain ready across consecutive checks.

## Verify

On the VPS:

```bash
pm2 list
pm2 logs earthly-cordn --lines 100
test -s /var/www/earthly/data/cordn/cordn.sqlite
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
