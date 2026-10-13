#!/usr/bin/env bash
set -euo pipefail
map_root="${1:?map service root required}"
release_id="${2:?release ID required}"
[[ "$map_root" =~ ^/[A-Za-z0-9._/-]+/map-plugin$ && "$map_root" != *..* && "$map_root" != *//* && "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]] || { echo 'Invalid map service root or release ID' >&2; exit 1; }
export PATH="$PATH:$HOME/.bun/bin:/usr/local/go/bin"
for tool in bun pm2 node curl flock sha256sum; do command -v "$tool" >/dev/null || { echo "Missing VPS tool: $tool" >&2; exit 1; }; done
mkdir -p "$map_root/shared/logs" "$map_root/releases"
exec 9>"$map_root/deploy.lock"
flock -n 9 || { echo 'A map service deployment is already in progress' >&2; exit 1; }
incoming="$map_root/incoming/$release_id"
new_release="$map_root/releases/$release_id"
old_release=""
if [[ -L "$map_root/current" ]]; then
  old_release="$(readlink -f "$map_root/current")"
elif [[ -e "$map_root/current" ]]; then
  echo "Expected current to be a release symlink" >&2; exit 1
fi
if [[ -n "$old_release" && "$old_release" != "$map_root"/releases/* ]]; then echo 'Unexpected map service current link' >&2; exit 1; fi
[[ ! -e "$new_release" ]] || { echo 'Release already exists; run a new deployment' >&2; exit 1; }
(cd "$incoming" && sha256sum -c SHA256SUMS)
mkdir "$new_release"
tar -xzf "$incoming/release.tar.gz" -C "$new_release"
cd "$new_release"
bun install --frozen-lockfile --ignore-scripts
bun ops/vps/map-plugin/config.ts runtime "$incoming/settings.json" "$new_release" "$map_root/shared" "$release_id" "$(command -v bun)"
# Build the UI/worker before stopping the active map process.
bun --no-env-file src/map-plugin/index.ts --check
pm2 jlist | MAP_ROOT="$map_root" node -e '
let text=""; process.stdin.on("data",data=>text+=data); process.stdin.on("end",()=>{
  const names=["earthly-maps"];
  for (const app of JSON.parse(text)) if(names.includes(app.name) && !app.pm2_env.pm_cwd.startsWith(process.env.MAP_ROOT+"/releases/")) throw Error("Map service process name is already owned by another directory");
});'
runtime_started=false
recover() {
  local status=$?
  trap - ERR
  if [[ "$runtime_started" == true ]]; then
    echo 'Map service activation failed; restoring the previous map service runtime' >&2
    if [[ -n "$old_release" && -f "$old_release/ecosystem.config.cjs" ]]; then
      pm2 startOrRestart "$old_release/ecosystem.config.cjs" --update-env
    else
      pm2 delete earthly-maps || true
    fi
    pm2 save
  fi
  exit "$status"
}
trap recover ERR
runtime_started=true
pm2 startOrRestart "$new_release/ecosystem.config.cjs" --update-env
hostname="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).hostname)' "$new_release/maps.json")"
http_port="$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).httpPort)' "$new_release/maps.json")"
health_timeout="${EARTHLY_MAP_HEALTH_TIMEOUT_SECONDS:-60}"
[[ "$health_timeout" =~ ^[0-9]+$ && "$health_timeout" -ge 1 && "$health_timeout" -le 300 ]] || { echo 'Health timeout must be 1–300 seconds' >&2; false; }
deadline=$((SECONDS + health_timeout))
until curl --fail --silent --show-error --max-time 3 -H "Host: $hostname" "http://127.0.0.1:$http_port/health" > "$incoming/health.json" 2>/dev/null &&
  bun -e 'const h=await Bun.file(process.argv[1]).json(); if(h.service!=="earthly-public-maps" || h.release!==process.argv[2]) process.exit(1)' "$incoming/health.json" "$release_id"; do
  if (( SECONDS >= deadline )); then echo 'Map service health check timed out' >&2; false; fi
  sleep 1
done
# Save the verified runtime before publishing the release pointer.
pm2 save
if [[ -n "$old_release" && -d "$old_release" ]]; then ln -sfn "$old_release" "$map_root/previous"; fi
ln -sfn "$new_release" "$map_root/current.next"
# GNU mv -T makes the replacement atomic instead of following the directory symlink.
mv -Tf "$map_root/current.next" "$map_root/current"
trap - ERR
echo "Map service release active: $release_id"
echo "Public endpoint (after Caddy/DNS setup): https://$hostname/mcp"
