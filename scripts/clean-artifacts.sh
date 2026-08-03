#!/usr/bin/env bash
# Preview or remove only known, ignored build/test outputs.

set -euo pipefail

mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo "Usage: $0 [--dry-run|--apply]" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
relative_targets=(
  target
  src-tauri/gen/android/.gradle
  src-tauri/gen/android/app/build
  src-tauri/gen/android/build
  ai-suite/artifacts
  android-suite/artifacts
  out
  dist
  deploy.tar.gz
)

existing_targets=()
for relative_target in "${relative_targets[@]}"; do
  absolute_target="$repo_root/$relative_target"
  [[ "$absolute_target" == "$repo_root/"* ]] || {
    echo "Cleanup target escaped the repository: $absolute_target" >&2
    exit 1
  }
  if [[ -L "$absolute_target" ]]; then
    echo "Refusing to clean a symbolic link: $relative_target" >&2
    exit 1
  fi
  if [[ -e "$absolute_target" ]]; then
    existing_targets+=("$absolute_target")
    du -sh "$absolute_target"
  fi
done

if [[ "${#existing_targets[@]}" -eq 0 ]]; then
  echo "No known generated artifacts are present"
  exit 0
fi

if [[ "$mode" == "--dry-run" ]]; then
  echo
  echo "Preview only. Run 'bun run clean:artifacts:apply' to remove these exact targets."
  exit 0
fi

for absolute_target in "${existing_targets[@]}"; do
  [[ "$absolute_target" == "$repo_root/"* && ! -L "$absolute_target" ]] || {
    echo "Cleanup target changed after validation: $absolute_target" >&2
    exit 1
  }
done
rm -rf -- "${existing_targets[@]}"
echo "Removed ${#existing_targets[@]} generated artifact target(s)"
