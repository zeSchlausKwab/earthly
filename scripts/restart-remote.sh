#!/bin/bash
# Ensure all Earthly PM2 processes are running ON the VPS.
# Idempotent: restarts processes that exist, (re)starts any that are missing.
#
# Usage (on the VPS, from the app directory, e.g. $VPS_PATH):
#   ./scripts/restart-remote.sh

set -e

# Load Bun and Go into PATH (same as deploy-remote.sh)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:/usr/local/go/bin:$PATH"
BUN_PATH="$HOME/.bun/bin/bun"

command -v pm2 >/dev/null 2>&1 || { echo "❌ pm2 not found in PATH"; exit 1; }

mkdir -p logs

# If the PM2 daemon has no processes (e.g. after a reboot or `pm2 kill`),
# try to restore the saved dump first.
if [ "$(pm2 jlist 2>/dev/null | tr -d '[:space:]')" = "[]" ]; then
    echo "ℹ️  PM2 process list is empty — attempting resurrect from saved dump..."
    pm2 resurrect 2>/dev/null || true
fi

# Returns 0 if the named process exists in PM2 (any state).
pm2_has() {
    pm2 describe "$1" >/dev/null 2>&1
}

ensure() {
    local name="$1"; shift
    if pm2_has "$name"; then
        echo "🔄 Restarting $name..."
        pm2 restart "$name" --update-env
    else
        echo "🚀 Starting $name (was not registered)..."
        "$@"
    fi
}

ensure earthly-web \
    env NODE_ENV=production PORT=3000 pm2 start src/index.ts \
        --name earthly-web \
        --interpreter "$BUN_PATH" \
        --max-memory-restart 1G \
        --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
        -e logs/web-error.log -o logs/web-out.log --merge-logs

ensure earthly-contextvm \
    env NODE_ENV=production pm2 start contextvm/server.ts \
        --name earthly-contextvm \
        --interpreter "$BUN_PATH" \
        --max-memory-restart 500M \
        --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
        -e logs/contextvm-error.log -o logs/contextvm-out.log --merge-logs

ensure earthly-mapnolia \
    pm2 start ./mapnolia-server \
        --name earthly-mapnolia \
        --max-memory-restart 1G \
        --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
        -e logs/mapnolia-error.log -o logs/mapnolia-out.log --merge-logs

ensure earthly-relay \
    env PORT=3334 pm2 start relay/relay \
        --name earthly-relay \
        --max-memory-restart 500M \
        --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
        -e logs/relay-error.log -o logs/relay-out.log --merge-logs

# Persist the (possibly updated) process list so a future reboot can resurrect it.
pm2 save

echo ""
echo "✅ All Earthly services ensured running."
pm2 list
