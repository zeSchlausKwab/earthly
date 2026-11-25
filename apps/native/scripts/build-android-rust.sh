#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SDK_ROOT="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
NDK_DIR="${ANDROID_NDK_HOME:-$SDK_ROOT/ndk/28.2.13676358}"
NDK_BIN="$(ls -d "$NDK_DIR"/toolchains/llvm/prebuilt/*/bin | head -n 1)"

if [[ ! -x "$NDK_BIN/aarch64-linux-android26-clang" ]]; then
  echo "Android NDK clang not found under $NDK_DIR" >&2
  exit 1
fi

export CC_aarch64_linux_android="$NDK_BIN/aarch64-linux-android26-clang"
export CXX_aarch64_linux_android="$NDK_BIN/aarch64-linux-android26-clang++"
export AR_aarch64_linux_android="$NDK_BIN/llvm-ar"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_BIN/aarch64-linux-android26-clang"
export CARGO_TARGET_AARCH64_LINUX_ANDROID_AR="$NDK_BIN/llvm-ar"
# Required for Android 15+ (16 KB ELF page alignment, e.g. Pixel 10 / API 37).
export RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384 ${RUSTFLAGS:-}"

cd "$REPO_ROOT"
cargo build -p earthly-ffi --target aarch64-linux-android --release

OUT_DIR="$REPO_ROOT/apps/native/android/app/src/main/jniLibs/arm64-v8a"
mkdir -p "$OUT_DIR"
cp "$REPO_ROOT/target/aarch64-linux-android/release/libearthly_ffi.so" "$OUT_DIR/libearthly_ffi.so"
ls -lh "$OUT_DIR/libearthly_ffi.so"
