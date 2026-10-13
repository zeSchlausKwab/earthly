#!/usr/bin/env bash
# Explicit administrator operation, separate from ordinary application deployments.
set -euo pipefail
release="${1:?Usage: install-caddy.sh <absolute map service release/current directory>}"
[[ "$EUID" -eq 0 ]] || { echo 'Caddy installation requires an administrator (sudo)' >&2; exit 1; }
[[ "$release" == /* && -f "$release/maps.caddy" ]] || { echo 'Missing generated maps.caddy' >&2; exit 1; }
config=/etc/caddy/Caddyfile
exec 9>/etc/caddy/earthly-maps.lock
flock -n 9 || { echo 'Another map service Caddy installation is running' >&2; exit 1; }
candidate="$(mktemp /etc/caddy/.earthly-maps.XXXXXX)"
trap 'rm -f -- "$candidate"' EXIT
original_hash="$(sha256sum "$config" | cut -d' ' -f1)"
python3 "$release/ops/vps/map-plugin/merge-caddy.py" "$config" "$release/maps.caddy" "$candidate"
caddy validate --config "$candidate" --adapter caddyfile
[[ "$original_hash" == "$(sha256sum "$config" | cut -d' ' -f1)" ]] || { echo 'Caddyfile changed during validation; rerun installation' >&2; exit 1; }
if cmp -s "$config" "$candidate"; then echo 'Map service Caddy block already installed'; exit 0; fi
backup="$config.before-maps-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$config" "$backup"
install -m 0644 -o root -g root "$candidate" "$config"
if ! caddy reload --config "$config" --adapter caddyfile; then
  cp -p "$backup" "$config"
  caddy reload --config "$config" --adapter caddyfile
  echo "Reload failed; original Caddyfile restored from $backup" >&2
  exit 1
fi
echo "Map service HTTPS route installed; previous Caddyfile saved at $backup"
