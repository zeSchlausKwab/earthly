#!/usr/bin/env bash
# Executed on the VPS by scripts/deploy.sh.

set -euo pipefail

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"

for command in bun go pm2 curl tar sha256sum install cmp; do
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

CORDN_VERSION="v0.4.0"
case "$(uname -m)" in
  x86_64)
    cordn_target="x86_64-unknown-linux-gnu"
    cordn_archive_sha256="3f1775f6b32427a7b5e6ed6a880c2355ca3a73a0b79a8a0f766daa89aaf47b5f"
    ;;
  aarch64|arm64)
    cordn_target="aarch64-unknown-linux-gnu"
    cordn_archive_sha256="96d0ca4749022f3ed2f2b23fdd7d17075e36c18d934462e9ce4bd274af100c56"
    ;;
  *)
    echo "No pinned Cordn binary is configured for architecture $(uname -m)" >&2
    exit 1
    ;;
esac
cordn_tmp="$(mktemp -d)"
trap 'rm -rf "$cordn_tmp"' EXIT
cordn_archive="$cordn_tmp/cordn-server.tar.gz"
cordn_url="https://github.com/Cordn-msg/cordn-rs/releases/download/$CORDN_VERSION/cordn-server-$cordn_target.tar.gz"
echo "Downloading native Cordn $CORDN_VERSION for $cordn_target..."
curl -fSL "$cordn_url" -o "$cordn_archive"
echo "$cordn_archive_sha256  $cordn_archive" | sha256sum -c -
tar -xzf "$cordn_archive" -C "$cordn_tmp"
cordn_binary="bin/cordn-server-$CORDN_VERSION-${cordn_archive_sha256:0:12}"
mkdir -p bin
if [[ -f "$cordn_binary" ]]; then
  if ! cmp -s "$cordn_tmp/cordn-server" "$cordn_binary"; then
    echo "Existing versioned Cordn binary does not match the verified release" >&2
    exit 1
  fi
else
  install -m 755 "$cordn_tmp/cordn-server" "$cordn_binary"
fi

if sudo -n cp Caddyfile /etc/caddy/Caddyfile 2>/dev/null && \
   sudo -n systemctl reload caddy 2>/dev/null; then
  echo "Caddy configuration reloaded"
else
  echo "Caddy reload skipped; verify it manually if the configuration changed"
fi

echo "Starting pinned native Cordn ContextVM coordinator..."
bash scripts/start-cordn-production.sh .env "$PWD/$cordn_binary"

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

pm2 save

echo
echo "Deployment services are running:"
pm2 list
