#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

CARGO_INCREMENTAL=0 \
RUSTFLAGS="-C debuginfo=0 ${RUSTFLAGS:-}" \
cargo build -p earthly-ffi --release

OUT_DIR="$ROOT_DIR/apps/native/linux/lib"
mkdir -p "$OUT_DIR"
cp "$ROOT_DIR/target/release/libearthly_ffi.so" "$OUT_DIR/libearthly_ffi.so"
ls -lh "$OUT_DIR/libearthly_ffi.so"
