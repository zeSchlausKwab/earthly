#!/usr/bin/env bash
# Build and deploy Earthly's web, relay, ContextVM, and native Cordn services to the VPS.

set -euo pipefail

mode="${1:-}"
if [[ -n "$mode" && "$mode" != "--check" ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Deployment target .env not found. Copy .env.deploy.example to .env." >&2
  exit 1
fi
if [[ ! -f .env.production ]]; then
  echo "Production configuration not found. Copy .env.production.example to .env.production." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env

: "${VPS_HOST:?VPS_HOST is required in .env}"
: "${VPS_USER:?VPS_USER is required in .env}"
: "${VPS_PATH:?VPS_PATH is required in .env}"

if [[ ! "$VPS_USER" =~ ^[A-Za-z0-9._-]+$ ]] ||
   [[ ! "$VPS_HOST" =~ ^[A-Za-z0-9._:-]+$ ]] ||
   [[ ! "$VPS_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "VPS_USER, VPS_HOST, or VPS_PATH contains unsupported shell characters" >&2
  exit 1
fi

echo "Validating production identities, URLs, and Cordn persistence..."
(
  set -a
  # shellcheck disable=SC1091
  source .env.production
  set +a
  bun scripts/validate-production-env.ts
)

if [[ "$mode" == "--check" ]]; then
  bash -n scripts/deploy.sh scripts/deploy-remote.sh scripts/start-cordn-production.sh
  echo "Deployment configuration and shell scripts are valid; no build, upload, or restart was performed."
  exit 0
fi

echo "Building the production browser bundle..."
./scripts/build-production.sh

archive="deploy.tar.gz"
trap 'rm -f "$archive"' EXIT

archive_paths=(
  dist/
  src/
  public/
  relay/
  contextvm/
  scripts/
  docs/
  ecosystem.config.cjs
  Caddyfile
  package.json
  bun.lock
)
if [[ -d legacy-db && -f legacy-db/latest.sql ]]; then
  archive_paths+=(legacy-db/)
fi

echo "Creating deployment archive..."
COPYFILE_DISABLE=1 tar -czf "$archive" \
  --exclude='contextvm/node_modules' \
  --exclude='relay/relay' \
  --exclude='relay/data' \
  --exclude='src-tauri' \
  "${archive_paths[@]}"

remote="${VPS_USER}@${VPS_HOST}"
echo "Uploading release to ${remote}:${VPS_PATH}..."
ssh "$remote" "mkdir -p '$VPS_PATH'"
scp "$archive" "$remote:$VPS_PATH/"
ssh "$remote" "umask 077 && cat > '$VPS_PATH/.env.next'" < .env.production
scp mapnolia.config.json "$remote:$VPS_PATH/" 2>/dev/null || \
  echo "No local mapnolia.config.json; retaining the VPS copy"
scp scripts/deploy-remote.sh "$remote:$VPS_PATH/"

echo "Activating release on the VPS..."
ssh "$remote" "cd '$VPS_PATH' && chmod 600 .env.next && mv .env.next .env && bash deploy-remote.sh"

echo
echo "Deployment complete."
echo "PM2 logs: ssh $remote 'pm2 logs'"
echo "Cordn logs: ssh $remote 'pm2 logs earthly-cordn --lines 100'"
