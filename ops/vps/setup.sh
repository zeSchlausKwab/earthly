#!/usr/bin/env bash
# Idempotently prepare and audit an existing Ubuntu VPS deployment account.

set -euo pipefail

mode="${1:-configure}"
if [[ "$mode" != "configure" && "$mode" != "--check" ]]; then
  echo "Usage: $0 [configure|--check]" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

deploy_env="${EARTHLY_DEPLOY_ENV:-.env.deploy}"
if [[ ! -f "$deploy_env" && "$deploy_env" == ".env.deploy" && -f .env ]]; then
  echo "Warning: using VPS_* values from legacy .env; copy .env.deploy.example to .env.deploy" >&2
  deploy_env=".env"
fi
[[ -f "$deploy_env" ]] || {
  echo "Deployment target not found. Copy .env.deploy.example to .env.deploy" >&2
  exit 1
}

# shellcheck disable=SC1090
source "$deploy_env"
: "${VPS_HOST:?VPS_HOST is required in $deploy_env}"
: "${VPS_USER:?VPS_USER is required in $deploy_env}"
: "${VPS_PATH:?VPS_PATH is required in $deploy_env}"
if [[ ! "$VPS_USER" =~ ^[A-Za-z0-9._-]+$ ]] ||
   [[ ! "$VPS_HOST" =~ ^[A-Za-z0-9._:-]+$ ]] ||
   [[ ! "$VPS_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
   [[ "$VPS_PATH" == "/" || "$VPS_PATH" == *"//"* ||
      "$VPS_PATH" == *"/../"* || "$VPS_PATH" == *"/.." ||
      "$VPS_PATH" == *"/./"* || "$VPS_PATH" == *"/." ]]; then
  echo "VPS_USER, VPS_HOST, or VPS_PATH contains unsupported shell characters" >&2
  exit 1
fi

remote="${VPS_USER}@${VPS_HOST}"
ssh -o ConnectTimeout=10 "$remote" true

if [[ "$mode" == "configure" ]]; then
  echo "Preparing $remote:$VPS_PATH (sudo may prompt once)..."
  ssh -t "$remote" \
    "if [ ! -d '$VPS_PATH' ]; then sudo install -d -o \"\$USER\" -g \"\$(id -gn)\" '$VPS_PATH'; fi; test -w '$VPS_PATH'; mkdir -p '$VPS_PATH/releases' '$VPS_PATH/shared/logs' '$VPS_PATH/shared/data' '$VPS_PATH/shared/backups' '$VPS_PATH/shared/bin'"
fi

echo "Checking required VPS commands..."
missing_commands="$(ssh "$remote" '
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:/usr/local/go/bin:$PATH"
  missing=""
  for command_name in bun go pm2 curl tar sha256sum install caddy docker uv flock nice ionice; do
    command -v "$command_name" >/dev/null 2>&1 || missing="$missing $command_name"
  done
  docker compose version >/dev/null 2>&1 || missing="$missing docker-compose-plugin"
  printf "%s" "$missing"
')"
if [[ -n "$missing_commands" ]]; then
  echo "VPS prerequisites are missing:$missing_commands" >&2
  echo "Install the normal runtime prerequisites, plus uv and util-linux for GeoCatalog; see docs/operations/geocatalog.md, then rerun this command" >&2
  exit 1
fi

if ! ssh "$remote" "test -r /etc/caddy/Caddyfile && caddy adapt --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl is-active --quiet caddy"; then
  echo "The active Caddy configuration is unreadable, invalid, or Caddy is not running" >&2
  echo "Inspect Caddy on the VPS before deploying" >&2
  exit 1
fi

echo "VPS deployment account and prerequisites are ready"
echo "Caddy remains VPS-managed and is not replaced by application deployments"
