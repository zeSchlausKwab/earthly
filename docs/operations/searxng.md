# Private SearXNG operations

Earthly runs SearXNG as a private, loopback-only dependency of its ContextVM server. It is not exposed through Caddy and cannot be queried from the public internet. `web_search` combines its results with direct Wikipedia and Wikidata searches, so a SearXNG outage degrades coverage instead of failing the entire tool.

## Local development

Start Docker Desktop or OrbStack, then launch the same pinned, loopback-only
container used in production:

```bash
bun run searxng:dev
curl -fsS 'http://127.0.0.1:8888/search?q=earthly&format=json'
```

The start command creates `infra/searxng/.env` with a private random secret on
first use. The file is ignored by Git. Keep `SEARXNG_URL=http://127.0.0.1:8888`
in the environment used to launch the local ContextVM server.

Stop the container when it is not needed:

```bash
bun run searxng:stop
```

Stopping preserves the cache volume. SearXNG is intentionally not started by
`bun run dev`, so ordinary frontend work does not require a container runtime.

## First installation on the VPS

From the Earthly deployment directory:

```bash
./scripts/setup-searxng-vps.sh
```

The setup uses Ubuntu's packaged Docker engine and Compose plugin. If the script adds your account to the `docker` group, reconnect over SSH and then run:

```bash
./scripts/start-searxng.sh
```

The first start creates `infra/searxng/.env` with a random secret at mode `0600`. This file is intentionally not committed or included in deployment archives.

## Normal deployment and checks

`bun run deploy` starts or updates the pinned SearXNG image before restarting the ContextVM service. Check it directly on the VPS with:

```bash
curl -fsS 'http://127.0.0.1:8888/search?q=earthly&format=json'
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yml ps
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yml logs --tail 100
```

The production environment must contain:

```dotenv
SEARXNG_URL=http://127.0.0.1:8888
```

## Updating SearXNG

Update both the image tag and digest in `infra/searxng/compose.yml`, review upstream configuration changes, then run `./scripts/start-searxng.sh`. Keeping both values pinned makes deployments repeatable and prevents an unrelated upstream release from changing search behavior.
