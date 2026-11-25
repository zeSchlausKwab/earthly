#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
SDK_PATH="$DEVELOPER_DIR/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
XCODE_CC="$DEVELOPER_DIR/Toolchains/XcodeDefault.xctoolchain/usr/bin/cc"

cargo rustc -p earthly-ffi --release --target aarch64-apple-darwin -- \
  -C "linker=$XCODE_CC" \
  -C "link-arg=-mmacosx-version-min=14.3" \
  -C "link-arg=-isysroot" \
  -C "link-arg=$SDK_PATH"

OUT_DIR="$ROOT_DIR/apps/native/macos/Frameworks"
mkdir -p "$OUT_DIR"
cp "$ROOT_DIR/target/aarch64-apple-darwin/release/libearthly_ffi.dylib" "$OUT_DIR/libearthly_ffi.dylib"

APP_FRAMEWORKS="$ROOT_DIR/apps/native/build/macos/Build/Products/Release/earthly_native.app/Contents/Frameworks"
if [ -d "$APP_FRAMEWORKS" ]; then
  cp "$OUT_DIR/libearthly_ffi.dylib" "$APP_FRAMEWORKS/libearthly_ffi.dylib"
fi

ls -lh "$OUT_DIR/libearthly_ffi.dylib"
