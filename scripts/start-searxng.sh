#!/usr/bin/env bash
# Start Earthly's loopback-only SearXNG service. Safe to run repeatedly.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
searxng_dir="$repo_root/infra/searxng"
secret_file="$searxng_dir/.env"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required. Start Docker Desktop/OrbStack locally, or run scripts/setup-searxng-vps.sh on Ubuntu." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "The Docker Compose plugin is required. Start Docker Desktop/OrbStack locally, or run scripts/setup-searxng-vps.sh on Ubuntu." >&2
  exit 1
}

if [[ ! -f "$secret_file" ]]; then
  command -v bun >/dev/null 2>&1 || {
    echo "Bun is required to generate the SearXNG secret." >&2
    exit 1
  }
  umask 077
  secret="$(bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toHex())')"
  printf 'SEARXNG_SECRET=%s\n' "$secret" > "$secret_file"
fi
chmod 600 "$secret_file"

docker compose \
  --env-file "$secret_file" \
  -f "$searxng_dir/compose.yml" \
  up -d --pull always --remove-orphans

for attempt in {1..30}; do
  if response="$(curl -fsS --max-time 5 \
    'http://127.0.0.1:8888/search?q=earthly&format=json' 2>/dev/null)" && \
    RESPONSE="$response" bun -e '
      const value = JSON.parse(process.env.RESPONSE || "null")
      if (!value || !Array.isArray(value.results)) process.exit(1)
    '; then
    echo "SearXNG is ready on http://127.0.0.1:8888"
    exit 0
  fi
  [[ "$attempt" -eq 30 ]] || sleep 1
done

docker compose --env-file "$secret_file" -f "$searxng_dir/compose.yml" logs --tail 100 >&2 || true
echo "SearXNG did not become ready." >&2
exit 1
