# VPS operations

Earthly keeps the active application at `$VPS_PATH/current`, with one previous
release retained for rollback. Four core processes share the canonical PM2
definition in `ops/vps/services.config.cjs`; Cordn uses its specialized launcher
for SQLite snapshots and binary rollback. SearXNG runs separately under Docker.
The persistent GeoCatalog builder is a separate PM2 worker created only after a
missing-catalog bootstrap or explicit catalog update.

| Process | Port | Runtime |
|---|---:|---|
| `earthly-web` | 3000 | `src/index.ts` with Bun |
| `earthly-contextvm` | — | `contextvm/server.ts` with Bun |
| `earthly-mapnolia` | — | pinned native Mapnolia binary |
| `earthly-relay` | 3334 | locally built Go relay |
| `earthly-cordn` | — | pinned native Cordn binary |
| `earthly-geocatalog-build` | — | resumable Overture export and SQLite builder |

All commands below run on the VPS:

```bash
cd "$VPS_PATH/current"
```

## Normal operations

```bash
bash ops/vps/runtime.sh status
bash ops/vps/runtime.sh health
bash ops/vps/runtime.sh restart
pm2 logs
pm2 logs earthly-cordn --lines 100
```

`runtime.sh restart` starts the pinned SearXNG container, snapshots and restarts
Cordn, applies the canonical PM2 definition, waits for consecutive health
observations, and saves the PM2 process list.

## GeoCatalog lifecycle

A normal deploy never refreshes a valid catalog. If `current.sqlite` is absent,
the new release is allowed to start in temporary bootstrap mode and activation
queues the global build in the background. If a catalog path exists but is
invalid, empty, incomplete, or a dangling link, activation fails instead of
silently rebuilding or falling back.

From an operator checkout, use:

```bash
# Deploy the app; build only when the catalog is absent
bun run deploy

# Explicitly replace a valid catalog
bun run deploy -- --update-geocatalog
bun run deploy -- --update-geocatalog=2026-08-19.0

# Ship only the current catalog worker and resume a failed build. This leaves
# the active application release untouched and reuses verified checkpoints.
bun run geocatalog:vps:resume

# Observe the remote background job
bun run geocatalog:vps:status
bun run geocatalog:vps:logs
bun run geocatalog:vps:follow
```

On the VPS, the equivalent inspection commands are:

```bash
cd "$VPS_PATH/current"
bash ops/vps/geocatalog.sh status "$VPS_PATH/shared" "$VPS_PATH/current"
bash ops/vps/geocatalog.sh logs "$VPS_PATH/shared" "$VPS_PATH/current"
bash ops/vps/geocatalog.sh logs "$VPS_PATH/shared" "$VPS_PATH/current" --follow
```

The worker processes `division_area`, `division`, `place`, `water`, and
`infrastructure` as separately verified checkpoints. It does not export the
Overture transportation segment layer. Road, bus, bicycle, pedestrian, and
truck routing are served by the configured Valhalla service; Valhalla does not
provide rail routing or a general named-road inventory.

Use the worker-only resume command after correcting a builder or normalization
bug. It uploads a small, checksummed worker bundle, replaces only a stopped or
failed GeoCatalog worker through the normal update lifecycle, and never
changes the `current` application link. It does not bypass an active build or
remove a valid catalog while the replacement is built.

Completed source checkpoints survive interruption. The worker publishes
atomic state and progress files, validates the finished immutable snapshot,
switches `current.sqlite` atomically, retains the former target as
`previous.sqlite`, and restarts only `earthly-contextvm`. Other Earthly
processes continue to serve throughout an explicit update.

To roll back the catalog independently of the application release:

```bash
cd "$VPS_PATH/current"
bash ops/vps/geocatalog.sh rollback "$VPS_PATH/shared" "$VPS_PATH/current"
```

The VPS must provide `uv`, `flock`, `nice`, and `ionice`. Setup and activation
check them. A reachable `VALHALLA_URL` is also a production prerequisite and is
preflighted before activation. See `docs/operations/geocatalog.md` for the full
build policy, disk reserve, progress, and failure semantics.

## Roll back

```bash
bash ops/vps/rollback.sh
```

Rollback starts and health-checks the retained previous release before changing
the `current` link. If the previous release fails, it restores the current
runtime and leaves the link unchanged.

## Raw PM2 commands

```bash
pm2 list
pm2 describe earthly-web
pm2 restart earthly-relay --update-env
pm2 logs --err
pm2 monit
```

Use `pm2 startup` once to install the user systemd unit. Deploy and runtime
restart both call `pm2 save`, so a reboot can resurrect the latest process list.

Persistent logs, relay and Cordn data, Mapnolia data, Cordn backups, verified
binary caches, GeoCatalog source checkpoints and snapshots, and the SearXNG
secret live under `$VPS_PATH/shared`; release pruning does not remove them.
First activation migrates the corresponding old in-place paths when present.
