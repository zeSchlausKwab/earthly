#!/usr/bin/env bash
# Activate the retained previous release and keep the current one as the next rollback target.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
release_dir="$(cd "$script_dir/../.." && pwd -P)"
app_root="$(cd "$release_dir/../.." && pwd -P)"
release_root="$app_root/releases"

[[ -L "$app_root/current" ]] || {
  echo "Current release link is missing" >&2
  exit 1
}
current_release="$(readlink -f "$app_root/current")"
if [[ "$current_release" != "$release_root/"* || ! -d "$current_release" ]]; then
  echo "Current release link points outside the release root" >&2
  exit 1
fi

previous_release=""
while IFS= read -r -d '' candidate_release; do
  [[ "$candidate_release" == "$current_release" ]] && continue
  if [[ -n "$previous_release" ]]; then
    echo "More than one rollback candidate exists; refusing to guess" >&2
    exit 1
  fi
  previous_release="$candidate_release"
done < <(find "$release_root" -mindepth 1 -maxdepth 1 -type d -print0)

[[ -n "$previous_release" && "$previous_release" == "$release_root/"* && \
   -d "$previous_release" && ! -L "$previous_release" ]] || {
  echo "No retained previous release is available" >&2
  exit 1
}

echo "Rolling back from $(basename "$current_release") to $(basename "$previous_release")..."
if ! bash "$previous_release/ops/vps/runtime.sh" restart "$previous_release"; then
  echo "Previous release failed health checks; restoring the current runtime" >&2
  bash "$current_release/ops/vps/runtime.sh" restart "$current_release" || true
  exit 1
fi

ln -sfn "$previous_release" "$app_root/current"
echo "Rollback active: $(basename "$previous_release")"
