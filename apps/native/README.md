# Earthly Native App (Flutter + Rust) — Phase 0 Spike

Unified Flutter application (Android first, iOS-ready, Desktop macOS/Linux/Windows) backed by Earthly's Rust workspace crates via `flutter_rust_bridge` and GPU-texture MapLibre (`maplibre: ^0.4.0`).

Architecture reference: [`docs/NATIVE-REWRITE-ARCHITECTURE.md`](../../docs/NATIVE-REWRITE-ARCHITECTURE.md).

## What Is Implemented in Phase 0

- **Rust FFI Bridge** ([`crates/earthly-ffi`](../../crates/earthly-ffi/src/api/spike.rs)) generated via `flutter_rust_bridge_codegen` into `lib/src/rust/`:
  - `start_local_node` / `local_node_status` / `shutdown_local_node` (`earthly-local-node`)
  - `inspect_pmtiles_header` / `ingest_local_pmtiles` (`earthly-spatial` PMTiles v3 parser + embedded Blossom storage)
  - `outbox_summary` (`earthly-storage` SQLite publish outbox)
- **GPU Map Canvas & Mobile Precision Drawing Prototype**:
  - `maplibre: ^0.4.0` Texture-based MapLibre Native canvas with synchronous `toLngLat` / `toScreenLocation` projection.
  - **Zero-lock dual-gesture drawing**: 1-finger press & drag places vertices with `-48dp` thumb clearance while 2 fingers pan/zoom/rotate MapLibre seamlessly; 2-finger tap undoes the last vertex; draggable vertices & ghost midpoints.
  - **Crosshair ("Map-Under-Pin") mode**: one-handed field alternative panning the map under a centered reticle.
  - **Zero-cost GPU Loupe** (`RawMagnifier` at 2.2×): smart edge-flip, magnetic vertex snap with haptic click, and live distance/bearing telemetry collar—no second MapLibre instance.

## Development Commands

Regenerate Rust ↔ Dart FFI bindings after editing `crates/earthly-ffi/src/api/`:

```sh
cd apps/native
flutter_rust_bridge_codegen generate
```

Run Dart static analysis & Flutter tests:

```sh
cd apps/native
flutter analyze
flutter test
```

Run Rust FFI + workspace tests:

```sh
cargo test -p earthly-ffi -p earthly-storage -p earthly-spatial -p earthly-local-node
cargo check -p earthly-spatial --target wasm32-unknown-unknown
```

## Platform Tooling Notes (from `flutter doctor`)

- **Android**: Install Android SDK `cmdline-tools` and run `flutter doctor --android-licenses`, then plug in an Android device or start an emulator and run `flutter run -d android`.
- **macOS / iOS**: Install full Xcode + CocoaPods (`sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer && brew install cocoapods`) to run `flutter run -d macos`.
