#!/usr/bin/env bash
#
# Build the earthly-wasm WebAssembly package for Bun & browser consumers.
# Outputs gitignored artifacts to src/lib/wasm/pkg/ using wasm-pack --target web.
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="$ROOT_DIR/crates/earthly-wasm"
OUT_DIR="$ROOT_DIR/src/lib/wasm/pkg"

if ! command -v wasm-pack >/dev/null 2>&1; then
	echo "❌ wasm-pack is required but was not found on PATH." >&2
	echo "   Install it with: cargo install wasm-pack (or brew install wasm-pack)" >&2
	exit 1
fi

export CARGO_INCREMENTAL="${CARGO_INCREMENTAL:-0}"
export RUSTFLAGS="${RUSTFLAGS:--C debuginfo=0}"

mkdir -p "$OUT_DIR"

echo "🦀 Building earthly-wasm into $OUT_DIR (target=web)..."
wasm-pack build "$CRATE_DIR" \
	--target web \
	--no-opt \
	--out-dir "$OUT_DIR" \
	--out-name earthly_wasm \
	"$@"

echo "✅ Built earthly-wasm package at $OUT_DIR"
