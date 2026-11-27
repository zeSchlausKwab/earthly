#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${DEVELOPER_DIR:-}" ]; then
  if [ -d "/Applications/Xcode.app/Contents/Developer" ]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
  else
    export DEVELOPER_DIR="$(xcode-select -p)"
  fi
fi
SDK_PATH="$DEVELOPER_DIR/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
XCODE_CC="$DEVELOPER_DIR/Toolchains/XcodeDefault.xctoolchain/usr/bin/cc"

CARGO_INCREMENTAL=0 \
RUSTFLAGS="-C debuginfo=0 ${RUSTFLAGS:-}" \
cargo rustc -p earthly-ffi --release --target aarch64-apple-darwin -- \
  -C "linker=$XCODE_CC" \
  -C "link-arg=-mmacosx-version-min=14.3" \
  -C "link-arg=-isysroot" \
  -C "link-arg=$SDK_PATH"

OUT_DIR="$ROOT_DIR/apps/native/macos/Frameworks"
mkdir -p "$OUT_DIR"
DYLIB="$OUT_DIR/libearthly_ffi.dylib"
cp "$ROOT_DIR/target/aarch64-apple-darwin/release/libearthly_ffi.dylib" "$DYLIB"

# Strip any linker-applied signature and set @rpath install name before fixing
# Mach-O LINKEDIT string-table alignment (required on newer macOS dyld).
codesign --remove-signature "$DYLIB" 2>/dev/null || true
install_name_tool -id "@rpath/libearthly_ffi.dylib" "$DYLIB" 2>/dev/null || true

python3 - "$DYLIB" <<'PY'
import struct, sys

path = sys.argv[1]
data = bytearray(open(path, "rb").read())
magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags, reserved = struct.unpack_from("<IIIIIIII", data, 0)
if magic != 0xFEEDFACF:
    sys.exit(f"Unexpected Mach-O magic {hex(magic)} in {path}")

off = 32
symtab_off = None
linkedit_off = None
for _ in range(ncmds):
    cmd, cmdsize = struct.unpack_from("<II", data, off)
    if cmd == 0x2:  # LC_SYMTAB
        symtab_off = off
    elif cmd == 0x19:  # LC_SEGMENT_64
        if data[off + 8 : off + 24].split(b"\x00", 1)[0] == b"__LINKEDIT":
            linkedit_off = off
    off += cmdsize

if symtab_off is not None and linkedit_off is not None:
    symoff, nsyms, stroff, strsize = struct.unpack_from("<IIII", data, symtab_off + 8)
    if stroff % 8 != 0:
        pad = 8 - (stroff % 8)
        data[stroff:stroff] = b"\x00" * pad
        new_stroff = stroff + pad
        struct.pack_into("<I", data, symtab_off + 16, new_stroff)
        vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<QQQQ", data, linkedit_off + 24)
        end_pos = new_stroff + strsize
        if end_pos < len(data):
            del data[end_pos:]
        rem = len(data) % 16
        if rem:
            data.extend(b"\x00" * (16 - rem))
            strsize += 16 - rem
            struct.pack_into("<I", data, symtab_off + 20, strsize)
        new_filesize = len(data) - fileoff
        new_vmsize = ((new_filesize + 0x3FFF) // 0x4000) * 0x4000
        struct.pack_into("<Q", data, linkedit_off + 32, max(vmsize, new_vmsize))
        struct.pack_into("<Q", data, linkedit_off + 48, new_filesize)
        open(path, "wb").write(data)
        print(f"Aligned Mach-O LINKEDIT: stroff={hex(new_stroff)} strsize={hex(strsize)} filesize={hex(new_filesize)}")
PY

codesign --force --sign - "$DYLIB"
python3 -c "import ctypes, sys; ctypes.CDLL(sys.argv[1]); print('dlopen OK:', sys.argv[1])" "$DYLIB"

APP_FRAMEWORKS="$ROOT_DIR/apps/native/build/macos/Build/Products/Release/Earthly.app/Contents/Frameworks"
if [ -d "$APP_FRAMEWORKS" ]; then
  cp "$DYLIB" "$APP_FRAMEWORKS/libearthly_ffi.dylib"
  codesign --force --sign - "$APP_FRAMEWORKS/libearthly_ffi.dylib"
fi

ls -lh "$DYLIB"
