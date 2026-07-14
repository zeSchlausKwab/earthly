#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="${1:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Cordn environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CORDN_SERVER_PRIVATE_KEY:?CORDN_SERVER_PRIVATE_KEY is required}"
: "${CORDN_RELAY_URLS:?CORDN_RELAY_URLS is required}"
: "${CORDN_IMAGE:?CORDN_IMAGE is required}"
: "${CORDN_STORAGE_BACKEND:?CORDN_STORAGE_BACKEND is required}"
: "${CORDN_SQLITE_PATH:?CORDN_SQLITE_PATH is required}"

if [[ "$CORDN_STORAGE_BACKEND" != "sqlite" || "$CORDN_SQLITE_PATH" != "/data/cordn.sqlite" ]]; then
  echo "Production Cordn must use sqlite at /data/cordn.sqlite" >&2
  exit 1
fi
if [[ ! "$CORDN_IMAGE" =~ ^ghcr\.io/cordn-msg/cordn:v0\.4\.0$ && ! "$CORDN_IMAGE" =~ ^ghcr\.io/cordn-msg/cordn@sha256:[0-9a-f]{64}$ ]]; then
  echo "CORDN_IMAGE must pin Cordn v0.4.0 or an immutable ghcr.io digest" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to run the pinned Cordn ContextVM server" >&2
  exit 1
}

# Pull every required image before stopping the healthy coordinator.
docker pull "$CORDN_IMAGE"
docker pull alpine:3.20

CORDN_VOLUME="${CORDN_VOLUME:-earthly-cordn-data}"
CORDN_BACKUP_DIR="${CORDN_BACKUP_DIR:-$PWD/backups/cordn}"
CORDN_BACKUP_RETENTION_DAYS="${CORDN_BACKUP_RETENTION_DAYS:-14}"
if [[ ! "$CORDN_VOLUME" =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "CORDN_VOLUME contains unsupported characters" >&2
  exit 1
fi
if [[ ! "$CORDN_BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "CORDN_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi
mkdir -p "$CORDN_BACKUP_DIR"
chmod 700 "$CORDN_BACKUP_DIR"
docker volume create "$CORDN_VOLUME" >/dev/null
find "$CORDN_BACKUP_DIR" -type f -name 'cordn-*.tar.gz' -mtime "+$CORDN_BACKUP_RETENTION_DAYS" -delete

previous_container="earthly-cordn-previous"
if docker container inspect "$previous_container" >/dev/null 2>&1; then
  if docker container inspect earthly-cordn >/dev/null 2>&1; then
    docker rm -f "$previous_container" >/dev/null
  else
    docker rename "$previous_container" earthly-cordn
    docker start earthly-cordn >/dev/null
  fi
fi

had_previous=false
if docker container inspect earthly-cordn >/dev/null 2>&1; then
  docker stop earthly-cordn >/dev/null
  backup_name="cordn-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  if ! docker run --rm --user 0:0 \
    -v "$CORDN_VOLUME:/data:ro" \
    -v "$CORDN_BACKUP_DIR:/backup" \
    alpine:3.20 \
    sh -c "tar -czf '/backup/$backup_name' -C /data . && chown $(id -u):$(id -g) '/backup/$backup_name'"; then
    docker start earthly-cordn >/dev/null
    echo "Cordn snapshot failed; the existing container was restarted" >&2
    exit 1
  fi
  echo "Cordn SQLite snapshot written to $CORDN_BACKUP_DIR/$backup_name"
  docker rename earthly-cordn "$previous_container"
  had_previous=true
fi

export CORDN_ANNOUNCED="${CORDN_ANNOUNCED:-false}"
export CORDN_SERVER_NAME="${CORDN_SERVER_NAME:-earthly-cordn}"
export CORDN_MAX_AGE_DAYS="${CORDN_MAX_AGE_DAYS:-30}"
export CORDN_RATE_LIMIT_ENABLED="${CORDN_RATE_LIMIT_ENABLED:-true}"
export CORDN_RATE_LIMIT_REFILL_PER_MINUTE="${CORDN_RATE_LIMIT_REFILL_PER_MINUTE:-500}"
export CORDN_RATE_LIMIT_BURST="${CORDN_RATE_LIMIT_BURST:-160}"
export CORDN_RATE_LIMIT_IDLE_TTL_SECONDS="${CORDN_RATE_LIMIT_IDLE_TTL_SECONDS:-3600}"
export CORDN_MAX_KEY_PACKAGES_PER_IDENTITY="${CORDN_MAX_KEY_PACKAGES_PER_IDENTITY:-50}"
export CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY="${CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY:-1}"
export CORDN_LOG_ABUSE_REJECTIONS="${CORDN_LOG_ABUSE_REJECTIONS:-true}"

rollback_cordn() {
  docker rm -f earthly-cordn >/dev/null 2>&1 || true
  if [[ "$had_previous" == "true" ]]; then
    docker rename "$previous_container" earthly-cordn
    docker start earthly-cordn >/dev/null
    echo "Previous Cordn container restored after replacement failure" >&2
  fi
}

if ! docker run -d \
  --name earthly-cordn \
  --restart unless-stopped \
  -v "$CORDN_VOLUME:/data" \
  -e CORDN_SERVER_PRIVATE_KEY \
  -e CORDN_RELAY_URLS \
  -e CORDN_ANNOUNCED \
  -e CORDN_SERVER_NAME \
  -e CORDN_STORAGE_BACKEND \
  -e CORDN_SQLITE_PATH \
  -e CORDN_MAX_AGE_DAYS \
  -e CORDN_RATE_LIMIT_ENABLED \
  -e CORDN_RATE_LIMIT_REFILL_PER_MINUTE \
  -e CORDN_RATE_LIMIT_BURST \
  -e CORDN_RATE_LIMIT_IDLE_TTL_SECONDS \
  -e CORDN_MAX_KEY_PACKAGES_PER_IDENTITY \
  -e CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY \
  -e CORDN_LOG_ABUSE_REJECTIONS \
  "$CORDN_IMAGE" >/dev/null; then
  rollback_cordn
  echo "Cordn replacement could not be created" >&2
  exit 1
fi

for attempt in {1..10}; do
  if [[ "$(docker inspect -f '{{.State.Running}}' earthly-cordn 2>/dev/null || true)" != "true" ]]; then
    docker logs --tail 100 earthly-cordn >&2 || true
    rollback_cordn
    echo "Cordn did not stay running" >&2
    exit 1
  fi
  [[ "$attempt" -eq 10 ]] || sleep 1
done

if [[ "$had_previous" == "true" ]]; then
  docker rm "$previous_container" >/dev/null
fi

echo "Cordn ContextVM coordinator is running with SQLite persistence"
