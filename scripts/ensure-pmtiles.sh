#!/usr/bin/env bash
# Install the pinned PMTiles CLI into a cache path and verify its release digest.

set -euo pipefail

PMTILES_VERSION="1.29.1"
os_name="$(uname -s)"
machine="$(uname -m)"

case "$os_name/$machine" in
  Darwin/arm64)
    archive_name="go-pmtiles-${PMTILES_VERSION}_Darwin_arm64.zip"
    archive_sha256="287384c83c296f7ee3260d84be49613c5e89099ba69310580bd9b2fa4a34e07b"
    archive_type="zip"
    platform_name="darwin-arm64"
    ;;
  Darwin/x86_64)
    archive_name="go-pmtiles-${PMTILES_VERSION}_Darwin_x86_64.zip"
    archive_sha256="4893946557965d5bf2a56b8401dcda10a431181931dd59297e4cd4643289bdc8"
    archive_type="zip"
    platform_name="darwin-amd64"
    ;;
  Linux/x86_64)
    archive_name="go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
    archive_sha256="870c3aa968a75430ca1772351c3a6a6d30103b466d6df5837351bfb340640f54"
    archive_type="tar"
    platform_name="linux-amd64"
    ;;
  Linux/aarch64|Linux/arm64)
    archive_name="go-pmtiles_${PMTILES_VERSION}_Linux_arm64.tar.gz"
    archive_sha256="e44823cff328c2ea354096ccbfd7e7ef6c8f05b11553ad28fcaa33989123a57f"
    archive_type="tar"
    platform_name="linux-arm64"
    ;;
  *)
    echo "No pinned PMTiles binary is configured for $os_name/$machine" >&2
    exit 1
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_path="${1:-$repo_root/.cache/tools/pmtiles-v$PMTILES_VERSION/$platform_name/pmtiles}"
if [[ "$output_path" != /* ]]; then
  output_path="$repo_root/$output_path"
fi

if [[ -x "$output_path" ]]; then
  installed_version="$($output_path version 2>/dev/null || true)"
  if [[ "$installed_version" == "pmtiles $PMTILES_VERSION,"* ]]; then
    printf '%s\n' "$output_path"
    exit 0
  fi
  echo "Existing PMTiles binary has an unexpected version: $output_path" >&2
  exit 1
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v install >/dev/null 2>&1 || { echo "install is required" >&2; exit 1; }
if [[ "$archive_type" == "zip" ]]; then
  command -v unzip >/dev/null 2>&1 || { echo "unzip is required" >&2; exit 1; }
else
  command -v tar >/dev/null 2>&1 || { echo "tar is required" >&2; exit 1; }
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/earthly-pmtiles.XXXXXX")"
if [[ -z "$temporary_dir" || ! -d "$temporary_dir" ]]; then
  echo "Could not create a temporary PMTiles directory" >&2
  exit 1
fi
cleanup_pmtiles() {
  rm -rf -- "${temporary_dir:?}"
}
trap cleanup_pmtiles EXIT

archive_path="$temporary_dir/$archive_name"
release_url="https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION/$archive_name"
curl -fSL "$release_url" -o "$archive_path"

if command -v sha256sum >/dev/null 2>&1; then
  echo "$archive_sha256  $archive_path" | sha256sum -c -
else
  actual_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$archive_sha256" ]]; then
    echo "PMTiles archive checksum mismatch" >&2
    exit 1
  fi
fi

extract_dir="$temporary_dir/extracted"
mkdir -p "$extract_dir"
if [[ "$archive_type" == "zip" ]]; then
  unzip -q "$archive_path" -d "$extract_dir"
else
  tar -xzf "$archive_path" -C "$extract_dir"
fi
[[ -f "$extract_dir/pmtiles" ]] || {
  echo "The verified PMTiles archive did not contain the expected binary" >&2
  exit 1
}

mkdir -p "$(dirname "$output_path")"
install -m 755 "$extract_dir/pmtiles" "$output_path"
installed_version="$($output_path version)"
if [[ "$installed_version" != "pmtiles $PMTILES_VERSION,"* ]]; then
  rm -f -- "$output_path"
  echo "Installed PMTiles binary reported an unexpected version" >&2
  exit 1
fi

printf '%s\n' "$output_path"
