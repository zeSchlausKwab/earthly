# VPS operations module

`bun run deploy` is the external interface for production deployment. This
module keeps its implementation local: release packaging, upload verification,
activation, PM2 definitions, SearXNG, restart, and rollback live here.

## Interfaces

- `bun run deploy:check` validates local production configuration and shell.
- `bun run setup:vps` prepares the release/shared directories and audits VPS prerequisites.
- `bun run deploy` builds, uploads, verifies, and activates a release.
- `bash ops/vps/runtime.sh restart` restarts the active release from the VPS.
- `bash ops/vps/runtime.sh status` shows PM2 and SearXNG status.
- `bash ops/vps/rollback.sh` activates the retained previous release.

Setup inspects the live Caddy configuration without elevation. Application
deployments never replace it: the VPS also owns the Blossom route and its
administrator-managed TLS settings, so changing Caddy is a separate operation.

Cordn remains a specialized internal module because it snapshots persistent
SQLite state and can restore its previous binary. The other four PM2 processes
share `services.config.cjs` as their single runtime definition.

## VPS layout

```text
$VPS_PATH/
  current -> releases/<active-id>/
  releases/<active-id>/
  releases/<previous-id>/
  shared/
    backups/cordn/
    bin/
    data/cordn/
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
