# Earthly native development

Earthly's Tauri application uses the existing Bun-built frontend and a Rust workspace containing
the native shell plus reusable local-node code.

## Repository boundary

- `src-tauri/` owns Tauri configuration and operating-system lifecycle integration.
- `crates/earthly-local-node/` owns transport-neutral relay, Blossom, pairing, policy, and storage
  code. It must not depend on Tauri.
- `src/` remains the shared React application. Native imports will be isolated behind
  `src/platform/` adapters as those capabilities are added.

The workspace-root `Cargo.lock` is authoritative for native builds.

## Prerequisites

- Bun 1.3 or newer;
- Rust stable with Cargo;
- macOS desktop: Xcode Command Line Tools;
- iOS: full Xcode installation and the required Rust targets;
- Android: Android Studio/SDK, NDK, platform tools, and the required Rust targets.

Run `bunx tauri info` for a local toolchain report. Missing mobile toolchains do not prevent a
desktop build.

## Commands

Install dependencies once:

```sh
bun install --frozen-lockfile
```

Check the shared web application and Rust workspace:

```sh
bun run build
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Start Earthly in a native development window:

```sh
bun run tauri:dev
```

Create a production application and installer for the current desktop platform:

```sh
bun run tauri:build
```

On macOS the unsigned local artifacts are written beneath
`target/release/bundle/macos/` and `target/release/bundle/dmg/`. Signing, notarization, mobile
projects, and release CI are later Phase 1/Phase 12 deliverables; local output is not a release
artifact.

## Frontend build behavior

`tauri:frontend` starts only the Bun frontend server on port 3000. It deliberately does not run
Earthly's existing `dev-clean` stack because the embedded relay and Blossom services belong to the
native process. Browser development can continue using the existing development stack while Tauri
development uses the embedded services.

The native capability file currently grants only Tauri core defaults to the main window. Add
permissions narrowly alongside the adapter that needs them; do not add shell or broad filesystem
access as a convenience.

## Current status

As of 2026-07-14:

- the web production build passes;
- the Rust workspace passes unit and network integration tests;
- the native process starts persistent relay and Blossom listeners on loopback and reports their
  versioned descriptor through `local_node_status`;
- independent clients have verified relay publish/query and Blossom upload/range/read across node
  restarts, with persistent node identity, event/blob data, and peer grants;
- the macOS application and DMG, including the embedded node, build successfully on Apple silicon;
- full Xcode is not installed in the current environment, so iOS initialization is pending;
- Android toolchain initialization and physical-device verification are pending.
