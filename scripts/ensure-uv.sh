#!/usr/bin/env bash
# Install the pinned uv CLI into Earthly-managed persistent storage.

set -euo pipefail

UV_VERSION="0.12.7"
os_name="$(uname -s)"
machine="$(uname -m)"

case "$os_name/$machine" in
  Linux/x86_64)
    target="x86_64-unknown-linux-gnu"
    archive_sha256="788f18abea7c5f55d6216e4f5613fd89d4d59b631efeec117b2b07fe72f1da21"
    platform_name="linux-amd64"
    ;;
  Linux/aarch64|Linux/arm64)
    target="aarch64-unknown-linux-gnu"
    archive_sha256="66393193038dd7eb108abd7a218d9cec04ac70ab98242b0720fa94de19223b7c"
    platform_name="linux-arm64"
    ;;
  *)
    echo "No pinned uv binary is configured for $os_name/$machine" >&2
    exit 1
    ;;
esac

if [[ "$#" -gt 0 ]]; then
  install_root="$1"
else
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  install_root="$repo_root/.cache/tools/uv-v$UV_VERSION/$platform_name"
fi
if [[ "$install_root" != /* || "$install_root" == "/" || "$install_root" == "$HOME" ||
      "$install_root" == *"/../"* || "$install_root" == *"/.." ||
      "$install_root" == *"/./"* || "$install_root" == *"/." ]]; then
  echo "uv install root must be a narrow absolute path: $install_root" >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v install >/dev/null 2>&1 || { echo "install is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }

mkdir -p "$install_root"
output_path="$install_root/uv-v$UV_VERSION-$platform_name"
link_path="$install_root/uv"

verify_uv() {
  local candidate="$1" installed_version
  installed_version="$("$candidate" --version)"
  if [[ "$installed_version" != "uv $UV_VERSION" &&
        "$installed_version" != "uv $UV_VERSION "* ]]; then
    echo "uv reported an unexpected version at $candidate: $installed_version" >&2
    return 1
  fi
}

temporary_dir=""
candidate_path=""
next_link=""
cleanup_uv() {
  if [[ -n "$candidate_path" ]]; then rm -f -- "$candidate_path"; fi
  if [[ -n "$next_link" ]]; then rm -f -- "$next_link"; fi
  if [[ -n "$temporary_dir" ]]; then rm -rf -- "${temporary_dir:?}"; fi
}
trap cleanup_uv EXIT

if [[ -x "$output_path" ]]; then
  verify_uv "$output_path"
else
  archive_name="uv-$target.tar.gz"
  temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/earthly-uv.XXXXXX")"
  if [[ -z "$temporary_dir" || ! -d "$temporary_dir" ]]; then
    echo "Could not create a temporary uv directory" >&2
    exit 1
  fi
  archive_path="$temporary_dir/$archive_name"
  release_url="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$archive_name"
  curl --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 \
    --retry 3 --retry-delay 2 --retry-connrefused -fL \
    "$release_url" -o "$archive_path"
  echo "$archive_sha256  $archive_path" | sha256sum -c -

  extract_dir="$temporary_dir/extracted"
  mkdir -p "$extract_dir"
  tar -xzf "$archive_path" -C "$extract_dir"
  extracted_uv="$extract_dir/uv-$target/uv"
  [[ -f "$extracted_uv" ]] || {
    echo "The verified uv archive did not contain the expected binary" >&2
    exit 1
  }

  candidate_path="$output_path.next-$$"
  install -m 755 "$extracted_uv" "$candidate_path"
  verify_uv "$candidate_path"
  mv -f -- "$candidate_path" "$output_path"
  candidate_path=""
fi

if [[ -e "$link_path" && ! -L "$link_path" ]]; then
  echo "Earthly's managed uv path is not a symbolic link: $link_path" >&2
  exit 1
fi
next_link="$install_root/.uv.next-$$"
ln -s "$(basename "$output_path")" "$next_link"
mv -Tf -- "$next_link" "$link_path"
next_link=""
verify_uv "$link_path"
printf '%s\n' "$link_path"
