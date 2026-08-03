#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="${1:-.env}"
BINARY_PATH="${2:-$PWD/bin/cordn-server-v0.4.0}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Cordn environment file not found: $ENV_FILE" >&2
  exit 1
fi
if [[ ! -x "$BINARY_PATH" ]]; then
  echo "Cordn server binary is not executable: $BINARY_PATH" >&2
  exit 1
fi

# Keep unrelated Earthly secrets out of the coordinator environment. The PM2
# process receives only the Cordn variables assembled below.
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${CORDN_SERVER_PRIVATE_KEY:?CORDN_SERVER_PRIVATE_KEY is required}"
: "${CORDN_RELAY_URLS:?CORDN_RELAY_URLS is required}"
: "${CORDN_STORAGE_BACKEND:?CORDN_STORAGE_BACKEND is required}"

if [[ "$CORDN_STORAGE_BACKEND" != "sqlite" ]]; then
  echo "Production Cordn must use sqlite storage" >&2
  exit 1
fi

command -v pm2 >/dev/null 2>&1 || {
  echo "PM2 is required to supervise the native Cordn server" >&2
  exit 1
}
command -v bun >/dev/null 2>&1 || {
  echo "Bun is required to inspect PM2 process metadata" >&2
  exit 1
}
command -v tar >/dev/null 2>&1 || {
  echo "tar is required to snapshot Cordn SQLite state" >&2
  exit 1
}

CORDN_DATA_DIR="${CORDN_DATA_DIR:-$PWD/data/cordn}"
if [[ "$CORDN_DATA_DIR" != /* ]]; then
  CORDN_DATA_DIR="$PWD/$CORDN_DATA_DIR"
fi
CORDN_NATIVE_SQLITE_PATH="${CORDN_NATIVE_SQLITE_PATH:-$CORDN_DATA_DIR/cordn.sqlite}"
if [[ "$CORDN_NATIVE_SQLITE_PATH" != /* ]]; then
  CORDN_NATIVE_SQLITE_PATH="$PWD/$CORDN_NATIVE_SQLITE_PATH"
fi
if [[ "$CORDN_NATIVE_SQLITE_PATH" != "$CORDN_DATA_DIR/"* ]]; then
  echo "CORDN_NATIVE_SQLITE_PATH must live inside CORDN_DATA_DIR" >&2
  exit 1
fi

CORDN_BACKUP_DIR="${CORDN_BACKUP_DIR:-$PWD/backups/cordn}"
CORDN_BACKUP_RETENTION_DAYS="${CORDN_BACKUP_RETENTION_DAYS:-14}"
if [[ ! "$CORDN_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "CORDN_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi
mkdir -p "$CORDN_DATA_DIR" "$CORDN_BACKUP_DIR" logs
chmod 700 "$CORDN_DATA_DIR" "$CORDN_BACKUP_DIR"
find "$CORDN_BACKUP_DIR" -type f -name 'cordn-*.tar.gz' -mtime "+$CORDN_BACKUP_RETENTION_DAYS" -delete

export CORDN_ANNOUNCED="${CORDN_ANNOUNCED:-false}"
export CORDN_SERVER_NAME="${CORDN_SERVER_NAME:-earthly-cordn}"
export CORDN_SERVER_ABOUT="${CORDN_SERVER_ABOUT:-Earthly private-map MLS delivery coordinator}"
export CORDN_SERVER_WEBSITE="${CORDN_SERVER_WEBSITE:-https://earthly.city}"
export CORDN_SQLITE_SYNCHRONOUS="${CORDN_SQLITE_SYNCHRONOUS:-full}"
export CORDN_MAX_AGE_DAYS="${CORDN_MAX_AGE_DAYS:-30}"
export CORDN_RATE_LIMIT_ENABLED="${CORDN_RATE_LIMIT_ENABLED:-true}"
export CORDN_RATE_LIMIT_REFILL_PER_MINUTE="${CORDN_RATE_LIMIT_REFILL_PER_MINUTE:-500}"
export CORDN_RATE_LIMIT_BURST="${CORDN_RATE_LIMIT_BURST:-160}"
export CORDN_RATE_LIMIT_IDLE_TTL_SECONDS="${CORDN_RATE_LIMIT_IDLE_TTL_SECONDS:-3600}"
export CORDN_MAX_KEY_PACKAGES_PER_IDENTITY="${CORDN_MAX_KEY_PACKAGES_PER_IDENTITY:-50}"
export CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY="${CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY:-1}"
export CORDN_LOG_ABUSE_REJECTIONS="${CORDN_LOG_ABUSE_REJECTIONS:-true}"
CORDN_STARTUP_CHECK_ATTEMPTS="${CORDN_STARTUP_CHECK_ATTEMPTS:-10}"
if [[ ! "$CORDN_STARTUP_CHECK_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "CORDN_STARTUP_CHECK_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

process_name="earthly-cordn"
previous_binary=""
had_previous=false
if pm2 describe "$process_name" >/dev/null 2>&1; then
  previous_binary="$(pm2 jlist | bun -e '
    const processes = JSON.parse(await Bun.stdin.text());
    const process = processes.find((candidate) => candidate.name === "earthly-cordn");
    console.log(process?.pm2_env?.pm_exec_path ?? "");
  ')"
  pm2 stop "$process_name" >/dev/null
  had_previous=true
fi

if find "$CORDN_DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  backup_name="cordn-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  if ! tar -czf "$CORDN_BACKUP_DIR/$backup_name" -C "$CORDN_DATA_DIR" .; then
    if [[ "$had_previous" == "true" ]]; then pm2 restart "$process_name" >/dev/null; fi
    echo "Cordn snapshot failed; the existing process was restarted" >&2
    exit 1
  fi
  chmod 600 "$CORDN_BACKUP_DIR/$backup_name"
  echo "Cordn SQLite snapshot written to $CORDN_BACKUP_DIR/$backup_name"
fi

pm2 delete "$process_name" >/dev/null 2>&1 || true

start_cordn() {
  local binary="$1"
  env -i \
    HOME="$HOME" \
    PATH="$PATH" \
    USER="${USER:-deploy}" \
    PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
    CORDN_SERVER_PRIVATE_KEY="$CORDN_SERVER_PRIVATE_KEY" \
    CORDN_RELAY_URLS="$CORDN_RELAY_URLS" \
    CORDN_ANNOUNCED="$CORDN_ANNOUNCED" \
    CORDN_SERVER_NAME="$CORDN_SERVER_NAME" \
    CORDN_SERVER_ABOUT="$CORDN_SERVER_ABOUT" \
    CORDN_SERVER_WEBSITE="$CORDN_SERVER_WEBSITE" \
    CORDN_STORAGE_BACKEND=sqlite \
    CORDN_SQLITE_PATH="$CORDN_NATIVE_SQLITE_PATH" \
    CORDN_SQLITE_SYNCHRONOUS="$CORDN_SQLITE_SYNCHRONOUS" \
    CORDN_MAX_AGE_DAYS="$CORDN_MAX_AGE_DAYS" \
    CORDN_RATE_LIMIT_ENABLED="$CORDN_RATE_LIMIT_ENABLED" \
    CORDN_RATE_LIMIT_REFILL_PER_MINUTE="$CORDN_RATE_LIMIT_REFILL_PER_MINUTE" \
    CORDN_RATE_LIMIT_BURST="$CORDN_RATE_LIMIT_BURST" \
    CORDN_RATE_LIMIT_IDLE_TTL_SECONDS="$CORDN_RATE_LIMIT_IDLE_TTL_SECONDS" \
    CORDN_MAX_KEY_PACKAGES_PER_IDENTITY="$CORDN_MAX_KEY_PACKAGES_PER_IDENTITY" \
    CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY="$CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY" \
    CORDN_LOG_ABUSE_REJECTIONS="$CORDN_LOG_ABUSE_REJECTIONS" \
    pm2 start "$binary" \
      --name "$process_name" \
      --interpreter none \
      --max-memory-restart 500M \
      --log-date-format 'YYYY-MM-DD HH:mm:ss Z' \
      -e logs/cordn-error.log \
      -o logs/cordn-out.log \
      --merge-logs >/dev/null
}

rollback_cordn() {
  pm2 delete "$process_name" >/dev/null 2>&1 || true
  if [[ "$had_previous" == "true" && -x "$previous_binary" ]]; then
    start_cordn "$previous_binary"
    echo "Previous Cordn binary restored after replacement failure" >&2
  fi
}

if ! start_cordn "$BINARY_PATH"; then
  rollback_cordn
  echo "Native Cordn replacement could not be started" >&2
  exit 1
fi

for ((attempt = 1; attempt <= CORDN_STARTUP_CHECK_ATTEMPTS; attempt++)); do
  pid="$(pm2 pid "$process_name" 2>/dev/null || true)"
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]]; then
    pm2 logs "$process_name" --nostream --lines 100 >&2 || true
    rollback_cordn
    echo "Native Cordn did not stay running" >&2
    exit 1
  fi
  [[ "$attempt" -eq "$CORDN_STARTUP_CHECK_ATTEMPTS" ]] || sleep 1
done

echo "Native Cordn ContextVM coordinator is running with SQLite persistence"
