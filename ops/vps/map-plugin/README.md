# Production public-map service

This is an independent release stream for the ChatGPT/MCP map service. It runs
one PM2 process (`earthly-maps`), listens on loopback, and uses the existing
production Nostr relay. It does not redeploy the main Earthly application or
start, reset, or restart a relay. Durable map data stays on Nostr.

## Deploy

1. Set the target in the existing `.env.deploy` (`VPS_HOST`, `VPS_USER`, `VPS_PATH`).
2. Copy `.env.map-plugin.deploy.example` to `.env.map-plugin.deploy`. Set the
   HTTPS origin, unused local port, and explicit public WSS relay URLs.
3. Point the map hostname's DNS A record at the VPS. Configure AAAA only if IPv6
   is also routed to this server. Ports 80/443 must reach Caddy.
4. Run `bun run deploy:map-plugin:check`, commit runtime/deployment changes, then
   run `bun run deploy:map-plugin`.
5. On first installation, run the administrator command printed by deployment
   to install the generated Caddy block. Repeat after hostname/port changes.
6. Verify `https://maps.earthly.city/health` reports the intended release before
   adding `https://maps.earthly.city/mcp` to ChatGPT.

The VPS needs Bun, Node, PM2, curl, Python 3.9+, flock, sha256sum, tar, and Caddy.
The deployment account owns `$VPS_PATH/map-plugin`. Caddy remains administrator
managed. Deployment never copies `.env.production`, keys, local data, or
uncommitted source; `git archive HEAD` supplies the runtime. Bun dependency
lifecycle scripts are disabled. Non-secret configuration is uploaded as JSON.

`EARTHLY_DEPLOY_ENV` and `EARTHLY_MAP_DEPLOY_ENV` can select alternate local
configuration files. `--check` validates configuration and scripts without SSH.

## Runtime and recovery

```text
$VPS_PATH/map-plugin/
  current -> releases/<release-id>
  previous -> releases/<previous-release-id>
  releases/<release-id>/
    ecosystem.config.cjs
    maps.caddy
    maps.json
  incoming/<release-id>/
  shared/logs/
  deploy.lock
```

Activation is serialized. It verifies upload checksums, installs dependencies,
and builds the viewer/worker before restarting. The HTTP health check must
report the **new release ID**, so an old process cannot mask a failed start.
A failed activation restores the previous map runtime; a failed first install
removes only `earthly-maps`. Other PM2 processes and relay data are untouched.
Successful activation saves PM2 state and atomically advances `current`.
Releases are retained for inspection and rollback; there is no automatic pruning.

Every restart loses unpublished drafts and guest signing keys. Published maps
remain readable from the relay. Use one fork-mode instance because guest drafts
and keys are in memory. Reconnecting with a draft's private editing capability
resumes it until its fixed expiry; a new connection cannot recover a key lost
to expiry or restart. `--check` builds without binding a port
or publishing events. `EARTHLY_MAP_RELEASE` is included in `/health`.

For a manual rollback on the VPS (substitute the configured root):

```sh
cd /var/www/earthly/map-plugin
# Coordinate with deployers and hold this lock for the entire operation.
flock deploy.lock bash -c '
  old=$(readlink -f previous)
  test -f "$old/ecosystem.config.cjs" || exit 1
  pm2 startOrRestart "$old/ecosystem.config.cjs" --update-env || exit 1
  pm2 save || exit 1
  ln -sfn "$old" current.next
  mv -Tf current.next current
'
```

Verify the release through `/health` after rollback. If its hostname or port
changed, reinstall that release's generated Caddy block too.

## Caddy installation

`install-caddy.sh` merges only the marked `earthly-map-plugin` site block. It
refuses conflicting hostnames or ambiguous markers, validates the full candidate,
checks that the original has not changed, saves a backup, then reloads Caddy.
A failed reload restores the previous file. Existing Earthly, relay, Blossom,
logging, and TLS settings remain intact. Ordinary app deployments do not alter
Caddy. The HTTP upstream preserves the public Host; response buffering is
disabled for streaming MCP. Public viewers allow cross-origin iframe use.

The service is currently an anonymous public-map pilot with bounded requests
and editing sessions. It has no account authentication or per-user quotas.
Use synthetic or intentionally public data for the initial hosted test.

## ChatGPT acceptance test

Add a custom MCP server in ChatGPT's Plugins UI using the HTTPS `/mcp` URL and
**No authentication**; create/install the personal plugin. This is separate
from submitting to the public directory.

In a fresh chat with Earthly Maps selected:

1. Ask for a map of clearly fictional locations with supplied coordinates.
2. Verify the interactive map appears inside the chat; select a feature.
3. Request a style change and verify the revised preview.
4. Ask to publish publicly and share it. Open the returned link in another tab.
5. Ask for a dark, 500-pixel-high iframe with scroll zoom disabled. Open the
   embed and verify the settings and same map data.
6. Read the reference from a fresh MCP session to establish that persistence
   depends on Nostr rather than the original editing session.

Do not run mutating AI Suite scenarios against production. Deployment tests use
stub processes; the repository's browser scenarios require loopback relays.

```sh
bun run test:map-plugin:deploy
bun run test:map-plugin
bun --no-env-file src/map-plugin/index.ts --check
```
