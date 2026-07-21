#!/usr/bin/env bash
# Stop Earthly's local SearXNG container without deleting its cache volume.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
searxng_dir="$repo_root/infra/searxng"
secret_file="$searxng_dir/.env"

if [[ ! -f "$secret_file" ]]; then
  echo "SearXNG has not been initialized in this checkout."
  exit 0
fi

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to stop SearXNG." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "The Docker Compose plugin is required to stop SearXNG." >&2
  exit 1
}

docker compose \
  --env-file "$secret_file" \
  -f "$searxng_dir/compose.yml" \
  down --remove-orphans

echo "SearXNG stopped; its cache volume was preserved."
