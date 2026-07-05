# VPS Operations — PM2

The VPS runs four PM2 processes (defined by the start block in
[scripts/deploy-remote.sh](../scripts/deploy-remote.sh)):

| Process             | Port | Script / binary        |
|---------------------|------|------------------------|
| `earthly-web`       | 3000 | `src/index.ts` (Bun)   |
| `earthly-contextvm` | —    | `contextvm/server.ts` (Bun) |
| `earthly-mapnolia`  | —    | `./mapnolia-server`    |
| `earthly-relay`     | 3334 | `relay/relay`          |

All commands below run **on the VPS**, from the app directory (`$VPS_PATH`).
SSH in first: `ssh $VPS_USER@$VPS_HOST` then `cd <app dir>`.

## Restart everything if not running

Recommended — idempotent: restarts what exists, starts what's missing, then
`pm2 save`. Mirrors the deploy start block so processes get the right
interpreter, env, and log files:

```bash
./scripts/restart-remote.sh
```

### When to use which raw command

| Situation | Command |
|-----------|---------|
| Daemon alive, processes stopped/errored | `pm2 restart all` |
| Daemon dead / VPS rebooted (`pm2 list` empty) | `pm2 resurrect` (restores the `pm2 save` dump) |
| Ensure all four up regardless of state | `./scripts/restart-remote.sh` |
| Reload web with zero downtime | `pm2 reload earthly-web` |
| Restart a single process | `pm2 restart earthly-relay` |

> `pm2 restart all` does nothing when the process list is empty;
> `pm2 resurrect` won't touch processes the daemon already tracks. The
> ensure-script handles both cases, which is why it's preferred.

## Inspect status & logs

```bash
pm2 list                       # status table (online / stopped / errored)
pm2 status                     # alias for list
pm2 describe earthly-web       # detailed info for one process
pm2 logs                       # tail all logs
pm2 logs earthly-relay         # tail one process
pm2 logs --err                 # only error streams
tail -f logs/web-error.log     # raw log file (see logs/ dir)
pm2 monit                      # live CPU/memory dashboard
```

## Survive reboots

Run once per VPS so PM2 comes back automatically after a reboot:

```bash
pm2 startup            # prints a sudo command — run it to install the systemd unit
pm2 save               # snapshot current process list (resurrect target)
```

After this, a reboot auto-runs `pm2 resurrect`. Always run `pm2 save` again
after adding/removing processes so the dump stays current.
(`deploy-remote.sh` already calls `pm2 save` at the end of every deploy.)

## Full clean restart (last resort)

```bash
pm2 delete all         # remove all processes from PM2
./scripts/restart-remote.sh   # start them fresh
```
