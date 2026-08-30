# VPS operations module

`bun run deploy` is the external interface for production deployment. This
module keeps its implementation local: release packaging, upload verification,
activation, PM2 definitions, SearXNG, restart, and rollback live here.

## Interfaces

- `bun run deploy:check` validates local production configuration and shell.
- `bun run setup:vps` prepares the release/shared directories and audits VPS prerequisites.
- `bun run deploy` builds, uploads, verifies, and activates a release.
- `bun run deploy -- --update-geocatalog[=RELEASE]` explicitly queues a
  GeoCatalog rebuild after activation.
- `bun run geocatalog:vps:status` reports the remote catalog and build state;
  `geocatalog:vps:logs` prints recent logs and `geocatalog:vps:follow` follows
  them.
- `bash ops/vps/runtime.sh restart` restarts the active release from the VPS.
- `bash ops/vps/runtime.sh status` shows PM2 and SearXNG status.
- `bash ops/vps/rollback.sh` activates the retained previous release.

Setup inspects the live Caddy configuration without elevation. Application
deployments never replace it: the VPS also owns the Blossom route and its
administrator-managed TLS settings, so changing Caddy is a separate operation.

Cordn remains a specialized internal module because it snapshots persistent
SQLite state and can restore its previous binary. The other four PM2 processes
share `services.config.cjs` as their single runtime definition.

The GeoCatalog snapshot is persistent data, but its build tools are part of the
release bundle. A normal deploy leaves a valid snapshot untouched. When no
snapshot exists, activation starts in temporary bootstrap mode and queues a
durable PM2 build on the VPS. An explicit `--update-geocatalog` is required to
replace a valid snapshot. Invalid, empty, incomplete, or dangling snapshots
still fail activation; the missing-only exception never hides corruption.

The builder exports five resumable Overture slices (`division_area`,
`division`, `place`, `water`, and `infrastructure`) and deliberately excludes
the transportation segment layer. Valhalla supplies road routing. After
validation, the worker atomically promotes the new SQLite file, retains one
previous catalog for rollback, and restarts only `earthly-contextvm`. See
`docs/operations/geocatalog.md` for lifecycle, progress, rollback, and service
boundary details.

## VPS layout

```text
$VPS_PATH/
  current -> releases/<active-id>/
  releases/<active-id>/
  releases/<previous-id>/
  shared/
    backups/cordn/
    bin/
    data/
      cordn/
      geocatalog/
        current.sqlite -> snapshots/<snapshot-id>.sqlite
        previous.sqlite -> snapshots/<previous-id>.sqlite
        build-state.json
        build-progress.json
        jobs/
        snapshots/
    geocatalog/workers/
    logs/
    mapnolia-data/
    searxng.env
```

Release archives never contain environment files, ignored relay output,
symbolic links, or local state. Checksums cover the archive, production
environment, activator, and optional Mapnolia configuration before activation.
The production environment belongs to its release. New installations keep
persistent state under `shared/`; an existing in-place relay, Cordn, backup, or
Mapnolia store is referenced where it already lives instead of being copied
while live or duplicated during deployment.

GeoCatalog builds additionally require `flock`, `nice`, and `ionice` on the
VPS. Activation installs a pinned, checksum-verified `uv` into `shared/bin` and
the persistent worker resolves it there. The source exports, staging databases,
state, progress, and immutable snapshots all remain under persistent shared
storage, so a release prune or interrupted SSH session does not discard
completed checkpoints.
