#!/bin/bash
set -euo pipefail

CONTAINER_NAME="earthly-cordn"
IMAGE="ghcr.io/cordn-msg/cordn:v0.4.0"
CORDN_VERSION="v0.4.0"
CORDN_COMMIT="96ecdd277cdd9051c81f113dda521ce5ce380e94"
CACHE_DIR="$(pwd)/.cache/cordn-$CORDN_VERSION"
# Deliberately public, insecure loopback-only development key (scalar 1).
DEV_SERVER_KEY="0000000000000000000000000000000000000000000000000000000000000001"

if docker info >/dev/null 2>&1; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

  docker run --rm \
    --name "$CONTAINER_NAME" \
    --add-host host.docker.internal:host-gateway \
    -e CORDN_SERVER_PRIVATE_KEY="$DEV_SERVER_KEY" \
    -e CORDN_RELAY_URLS="ws://host.docker.internal:3334" \
    -e CORDN_ANNOUNCED=false \
    -e CORDN_STORAGE_BACKEND=memory \
    "$IMAGE"
  exit 0
fi

echo "Docker daemon unavailable; running pinned Cordn source from .cache"
if [[ ! -d "$CACHE_DIR/.git" ]]; then
  git clone --quiet --depth 1 --branch "$CORDN_VERSION" https://github.com/Cordn-msg/cordn.git "$CACHE_DIR"
fi

ACTUAL_COMMIT="$(git -C "$CACHE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$CORDN_COMMIT" ]]; then
  echo "Cordn cache commit mismatch: expected $CORDN_COMMIT, got $ACTUAL_COMMIT" >&2
  exit 1
fi

cd "$CACHE_DIR"
corepack pnpm install --frozen-lockfile --silent
cleanup_source() {
  pkill -P $$ >/dev/null 2>&1 || true
}
trap cleanup_source EXIT INT TERM
CORDN_SERVER_PRIVATE_KEY="$DEV_SERVER_KEY" \
CORDN_RELAY_URLS="ws://localhost:3334" \
CORDN_ANNOUNCED=false \
CORDN_STORAGE_BACKEND=memory \
corepack pnpm run dev
