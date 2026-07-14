#!/usr/bin/env bash
# Executed on the VPS by scripts/deploy.sh.

set -euo pipefail

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"

for command in bun go pm2 docker curl tar; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required deployment command is missing: $command" >&2
    exit 1
  }
done
if [[ ! -f .env ]]; then
  echo "VPS production .env is missing" >&2
  exit 1
fi

echo "Extracting release..."
tar -xzf deploy.tar.gz
rm deploy.tar.gz

echo "Installing frozen production dependencies..."
bun install --frozen-lockfile --production
bun --env-file=.env scripts/validate-production-env.ts

echo "Building Earthly relay..."
(cd relay && CGO_ENABLED=1 go build -o relay .)

# Mapnolia is still distributed separately from this repository.
echo "Downloading mapnolia server..."
curl -fSL "https://github.com/zeSchlausKwab/mapnolia/releases/latest/download/mapnolia-server-linux-amd64" -o mapnolia-server
chmod +x mapnolia-server
mkdir -p logs

if sudo -n cp Caddyfile /etc/caddy/Caddyfile 2>/dev/null && \
   sudo -n systemctl reload caddy 2>/dev/null; then
  echo "Caddy configuration reloaded"
else
  echo "Caddy reload skipped; verify it manually if the configuration changed"
fi

echo "Restarting Earthly-owned PM2 services..."
for service in earthly-web earthly-contextvm earthly-mapnolia earthly-relay; do
  pm2 delete "$service" >/dev/null 2>&1 || true
done

BUN_PATH="$HOME/.bun/bin/bun"

NODE_ENV=production PORT=3000 pm2 start src/index.ts \
  --name earthly-web \
  --interpreter "$BUN_PATH" \
  --max-memory-restart 1G \
  --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
  -e logs/web-error.log \
  -o logs/web-out.log \
  --merge-logs

NODE_ENV=production pm2 start contextvm/server.ts \
  --name earthly-contextvm \
  --interpreter "$BUN_PATH" \
  --max-memory-restart 500M \
  --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
  -e logs/contextvm-error.log \
  -o logs/contextvm-out.log \
  --merge-logs

pm2 start ./mapnolia-server \
  --name earthly-mapnolia \
  --max-memory-restart 1G \
  --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
  -e logs/mapnolia-error.log \
  -o logs/mapnolia-out.log \
  --merge-logs

PORT=3334 pm2 start relay/relay \
  --name earthly-relay \
  --max-memory-restart 500M \
  --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
  -e logs/relay-error.log \
  -o logs/relay-out.log \
  --merge-logs

echo "Starting persistent Cordn ContextVM coordinator..."
bash scripts/start-cordn-production.sh .env

pm2 save

echo
echo "Deployment services are running:"
pm2 list
docker ps --filter name=earthly-cordn --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
