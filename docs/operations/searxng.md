# Private SearXNG operations

Earthly runs a pinned SearXNG container on loopback as a private dependency of
the ContextVM server. It is not exposed through Caddy.

## Local development

```bash
bun run searxng:dev
curl -fsS 'http://127.0.0.1:8888/search?q=earthly&format=json'
bun run searxng:stop
```

The shared interface is `ops/vps/searxng.sh`. Locally it creates the ignored
`ops/vps/searxng/.env`; on the VPS it uses `$VPS_PATH/shared/searxng.env`.
Neither file is included in release archives.

## Production

`bun run setup:vps` checks Docker and its Compose plugin. Every deployment calls
the same SearXNG interface before restarting ContextVM. On the VPS:

```bash
cd "$VPS_PATH/current"
bash ops/vps/searxng.sh status
curl -fsS 'http://127.0.0.1:8888/search?q=earthly&format=json'
```

The production environment must contain:

```dotenv
SEARXNG_URL=http://127.0.0.1:8888
```

To update SearXNG, change both the image tag and digest in
`ops/vps/searxng/compose.yml`, review upstream configuration changes, and run a
normal deploy. Pinning both values prevents unrelated upstream changes from
altering search behavior.
