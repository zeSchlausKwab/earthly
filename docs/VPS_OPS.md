# VPS operations

Earthly keeps the active application at `$VPS_PATH/current`, with one previous
release retained for rollback. Four processes share the canonical PM2
definition in `ops/vps/services.config.cjs`; Cordn uses its specialized launcher
for SQLite snapshots and binary rollback. SearXNG runs separately under Docker.

| Process | Port | Runtime |
|---|---:|---|
| `earthly-web` | 3000 | `src/index.ts` with Bun |
| `earthly-contextvm` | — | `contextvm/server.ts` with Bun |
| `earthly-mapnolia` | — | pinned native Mapnolia binary |
| `earthly-relay` | 3334 | locally built Go relay |
| `earthly-cordn` | — | pinned native Cordn binary |

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
binary caches, and the SearXNG secret live under `$VPS_PATH/shared`; release
pruning does not remove them. First activation migrates the corresponding old
in-place paths when present.
