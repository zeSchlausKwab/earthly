#!/usr/bin/env bash
# Manage the same pinned, loopback-only SearXNG container locally and on the VPS.

set -euo pipefail

mode="${1:-start}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_dir="$script_dir/searxng"
secret_file="${SEARXNG_ENV_FILE:-$config_dir/.env}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to manage SearXNG" >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "The Docker Compose plugin is required to manage SearXNG" >&2
  exit 1
}

compose=(docker compose --env-file "$secret_file" -f "$config_dir/compose.yml")

ensure_secret() {
  if [[ -f "$secret_file" ]]; then
    chmod 600 "$secret_file"
    return
  fi
  command -v bun >/dev/null 2>&1 || {
    echo "Bun is required to generate the SearXNG secret" >&2
    exit 1
  }
  mkdir -p "$(dirname "$secret_file")"
  umask 077
  local secret
  secret="$(bun -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).toHex())')"
  printf 'SEARXNG_SECRET=%s\n' "$secret" > "$secret_file"
  chmod 600 "$secret_file"
}

case "$mode" in
  start)
    ensure_secret
    "${compose[@]}" up -d --pull always --remove-orphans
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
    "${compose[@]}" logs --tail 100 >&2 || true
    echo "SearXNG did not become ready" >&2
    exit 1
    ;;
  stop)
    if [[ ! -f "$secret_file" ]]; then
      echo "SearXNG has not been initialized"
      exit 0
    fi
    "${compose[@]}" down --remove-orphans
    echo "SearXNG stopped; its cache volume was preserved"
    ;;
  status)
    if [[ ! -f "$secret_file" ]]; then
      echo "SearXNG has not been initialized"
      exit 1
    fi
    "${compose[@]}" ps
    ;;
  *)
    echo "Usage: $0 [start|stop|status]" >&2
    exit 1
    ;;
esac
