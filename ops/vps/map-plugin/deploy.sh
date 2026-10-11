#!/usr/bin/env bash
# Deploy only the committed public-map service; never activate the main app.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"
mode="${1:-deploy}"
[[ "$mode" == "deploy" || "$mode" == "--check" ]] || { echo 'Usage: deploy.sh [--check]' >&2; exit 1; }
target_env="${EARTHLY_DEPLOY_ENV:-.env.deploy}"
settings_env="${EARTHLY_MAP_DEPLOY_ENV:-.env.map-plugin.deploy}"
[[ -f "$target_env" && -f "$settings_env" ]] || { echo 'Copy .env.deploy.example and .env.map-plugin.deploy.example to their local config files' >&2; exit 1; }
# These are operator-owned local configuration files, never uploaded.
source "$target_env"
set -a
source "$settings_env"
set +a
: "${VPS_HOST:?Missing VPS_HOST}" "${VPS_USER:?Missing VPS_USER}" "${VPS_PATH:?Missing VPS_PATH}"
[[ "$VPS_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ && "$VPS_USER" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*$ && "$VPS_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$VPS_PATH" != / && "$VPS_PATH" != *..* && "$VPS_PATH" != *//* ]] || { echo 'Unsupported VPS target or path' >&2; exit 1; }
map_root="$VPS_PATH/map-plugin"
for tool in bun git ssh scp tar python3; do command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }; done
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/earthly-map-deploy.XXXXXX")"
trap 'rm -rf -- "$temporary_root"' EXIT
bun ops/vps/map-plugin/config.ts settings "$temporary_root/settings.json"
bash -n ops/vps/map-plugin/deploy.sh ops/vps/map-plugin/activate.sh ops/vps/map-plugin/install-caddy.sh
python3 -m py_compile ops/vps/map-plugin/merge-caddy.py
if [[ "$mode" == "--check" ]]; then
  echo "Map service configuration valid: $VPS_USER@$VPS_HOST:$map_root"
  cat "$temporary_root/settings.json"
  exit 0
fi
# Ship one exact commit, not unrelated working files, secrets, or local test artifacts.
paths=(package.json bun.lock tsconfig.json src contextvm spec ops/vps/map-plugin)
[[ -z "$(git status --porcelain --untracked-files=normal -- "${paths[@]}")" ]] || { echo 'Commit runtime/deployment changes before deploying map service' >&2; exit 1; }
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
git archive --format=tar.gz -o "$temporary_root/release.tar.gz" HEAD -- "${paths[@]}"
git show HEAD:ops/vps/map-plugin/activate.sh > "$temporary_root/activate.sh"
(
  cd "$temporary_root"
  if command -v sha256sum >/dev/null; then sha256sum release.tar.gz settings.json activate.sh > SHA256SUMS
  else shasum -a 256 release.tar.gz settings.json activate.sh > SHA256SUMS; fi
)
remote="$VPS_USER@$VPS_HOST"
incoming="$map_root/incoming/$release_id"
ssh -o BatchMode=yes "$remote" "mkdir -p '$incoming'"
scp "$temporary_root/release.tar.gz" "$temporary_root/settings.json" "$temporary_root/activate.sh" "$temporary_root/SHA256SUMS" "$remote:$incoming/"
ssh -o BatchMode=yes "$remote" "cd '$incoming' && sha256sum -c SHA256SUMS && bash activate.sh '$map_root' '$release_id'"
echo "Map service process deployed. Install the generated Caddy block separately:"
echo "ssh -t $remote 'sudo bash $map_root/current/ops/vps/map-plugin/install-caddy.sh $map_root/current'"
