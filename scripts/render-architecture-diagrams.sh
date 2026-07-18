#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIAGRAM_DIR="$ROOT_DIR/docs/architecture/diagrams"
EXPECTED_D2_VERSION="v0.7.1"
CACHE_ROOT="${EARTHLY_TOOLS_CACHE:-$ROOT_DIR/.cache/tools}"
D2_BIN_OVERRIDE="${D2_BIN:-}"
D2_BIN=""
BOOTSTRAP_TEMP_DIR=""

cleanup_bootstrap() {
  if [[ -n "$BOOTSTRAP_TEMP_DIR" && -d "$BOOTSTRAP_TEMP_DIR" ]]; then
    rm -rf "$BOOTSTRAP_TEMP_DIR"
  fi
}

trap cleanup_bootstrap EXIT

checksum_sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  echo "No SHA-256 checksum tool found (expected shasum or sha256sum)." >&2
  exit 1
}

bootstrap_d2() {
  local platform arch archive expected_sha256 cache_bin temp_dir downloaded extracted actual_sha256

  case "$(uname -s)" in
    Darwin) platform="macos" ;;
    Linux) platform="linux" ;;
    *)
      echo "Automatic D2 setup supports macOS and Linux. Set D2_BIN=/path/to/d2 on this platform." >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *)
      echo "Automatic D2 setup does not support architecture $(uname -m). Set D2_BIN=/path/to/d2." >&2
      exit 1
      ;;
  esac

  archive="d2-${EXPECTED_D2_VERSION}-${platform}-${arch}.tar.gz"
  case "${platform}-${arch}" in
    linux-amd64) expected_sha256="eb172adf59f38d1e5a70ab177591356754ffaf9bebb84e0ca8b767dfb421dad7" ;;
    linux-arm64) expected_sha256="ce3a0b985a8f91335a826c254b3a88736fd81afcdd08b58f6c749d2add6864b0" ;;
    macos-amd64) expected_sha256="b0178e8fdae72194d5a23aa6effd323378cc58ccd3b08d175ab80371c14e106f" ;;
    macos-arm64) expected_sha256="80de85f3b0ac7d9569acac0780ed65dd994ea78969b6b230c58bbb2c6113465b" ;;
  esac

  cache_bin="$CACHE_ROOT/d2/$EXPECTED_D2_VERSION/${platform}-${arch}/d2"
  if [[ -x "$cache_bin" ]] && [[ "$("$cache_bin" version 2>/dev/null)" == "$EXPECTED_D2_VERSION" ]]; then
    D2_BIN="$cache_bin"
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required for automatic D2 setup. Install D2 manually or set D2_BIN=/path/to/d2." >&2
    exit 1
  fi

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/earthly-d2.XXXXXX")"
  BOOTSTRAP_TEMP_DIR="$temp_dir"
  downloaded="$temp_dir/$archive"
  echo "D2 $EXPECTED_D2_VERSION is not installed; downloading the pinned ${platform}-${arch} renderer..." >&2
  curl --fail --location --silent --show-error \
    "https://github.com/terrastruct/d2/releases/download/$EXPECTED_D2_VERSION/$archive" \
    --output "$downloaded"

  actual_sha256="$(checksum_sha256 "$downloaded")"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    rm -rf "$temp_dir"
    echo "D2 archive checksum mismatch; refusing to execute the download." >&2
    exit 1
  fi

  tar -xzf "$downloaded" -C "$temp_dir"
  extracted="$temp_dir/d2-$EXPECTED_D2_VERSION/bin/d2"
  if [[ ! -x "$extracted" ]]; then
    rm -rf "$temp_dir"
    echo "The verified D2 archive did not contain the expected executable." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$cache_bin")"
  install -m 0755 "$extracted" "$cache_bin"
  rm -rf "$temp_dir"
  BOOTSTRAP_TEMP_DIR=""
  D2_BIN="$cache_bin"
  echo "Cached D2 at ${cache_bin#$ROOT_DIR/}." >&2
}

if [[ -n "$D2_BIN_OVERRIDE" ]]; then
  D2_BIN="$D2_BIN_OVERRIDE"
  if [[ "$("$D2_BIN" version 2>/dev/null || true)" != "$EXPECTED_D2_VERSION" ]]; then
    echo "D2_BIN must point to D2 $EXPECTED_D2_VERSION." >&2
    exit 1
  fi
elif command -v d2 >/dev/null 2>&1 && [[ "$(d2 version 2>/dev/null)" == "$EXPECTED_D2_VERSION" ]]; then
  D2_BIN="$(command -v d2)"
else
  bootstrap_d2
fi

if [[ "$("$D2_BIN" version 2>/dev/null || true)" != "$EXPECTED_D2_VERSION" ]]; then
  echo "Unable to prepare D2 $EXPECTED_D2_VERSION." >&2
  exit 1
fi

for source in "$DIAGRAM_DIR"/*.d2; do
  output="${source%.d2}.svg"
  echo "Rendering ${source#$ROOT_DIR/}"
  "$D2_BIN" --layout=elk --pad=32 "$source" "$output"
done

echo "Architecture diagrams are current."
