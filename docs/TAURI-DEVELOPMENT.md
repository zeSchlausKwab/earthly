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

## Android

Android builds use Tauri's generated Gradle host in `src-tauri/gen/android`. The checked-in project
targets Android SDK 36 with a minimum SDK of 24. Use Android Studio's bundled JDK so Gradle and the
Android Gradle plugin run on a supported Java version:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | tail -1)"
export ANDROID_NDK_HOME="$NDK_HOME"
```

Initialize the generated host only when it is absent, then build an APK for an emulator or device:

```sh
bun run tauri:android:init
bun run tauri:android:build --debug --target aarch64
```

For an x86_64 emulator, replace `aarch64` with `x86_64`. The APK is emitted below
`src-tauri/gen/android/app/build/outputs/apk/`. Build outputs, generated Rust/JNI links, machine-local
SDK paths, and signing files remain ignored.

The Android app declares `INTERNET` because it hosts and consumes the embedded Nostr and Blossom
services. Release WebViews permit cleartext only to `127.0.0.1`/`localhost`; debug builds permit
cleartext development endpoints. Connections to another device's offline node must go through the
native peer transport rather than granting the WebView unrestricted cleartext LAN access.

The local node currently has process/foreground availability on Android. A production background
node requires a user-visible Android foreground service and the associated lifecycle and notification
work; an APK build alone does not make it continuously available in the background.

## Pairing reference apps

Two small Rust reference apps exercise the transport-neutral handshake without Tauri or a companion
service. The host example intentionally auto-approves the first valid pending claim so the demo is
non-interactive; production Earthly must show the peer and requested capabilities to the user before
calling the same approval API.

Run the host in one terminal with a fresh data directory and optional invitation handoff file:

```sh
demo_dir="$(mktemp -d)"
cargo run -p earthly-local-node --example pairing_host -- "$demo_dir" /tmp/earthly-invite
```

To prove a direct LAN bearer, pass the host device's private or link-local address as the third
argument. The signed descriptor will contain that address, and unsafe public or wildcard addresses
are rejected:

```sh
cargo run -p earthly-local-node --example pairing_host -- \
  "$demo_dir" /tmp/earthly-invite 192.168.1.20
```

Run the independent client in another terminal. The `@file` form stands in for QR/deep-link/copy
handoff; the encoded `earthly-pair-v1:` value can be passed directly instead:

```sh
cargo run -p earthly-local-node --example pairing_client -- @/tmp/earthly-invite
```

A successful run proves two distinct signed identities, pending-before-approval state, one-use
invitation consumption, persisted capability grants, a Nostr relay write, a Blossom upload, and a
Blossom byte-range read. It does not select the offline discovery or radio transport.

## Frontend build behavior

`tauri:frontend` starts only the Bun frontend server on port 3000. It deliberately does not run
Earthly's existing `dev-clean` stack because the embedded relay and Blossom services belong to the
native process. Browser development can continue using the existing development stack while Tauri
development uses the embedded services.

The native capability file grants Tauri core defaults, platform identification, and the explicit
`local-node-admin` command set to the main window. Continue adding permissions narrowly alongside
the adapter that needs them; do not add shell or broad filesystem access as a convenience.

## Current status

As of 2026-07-15:

- the web production build passes;
- the Rust workspace passes unit and network integration tests;
- the native process starts persistent relay and Blossom listeners on loopback and reports their
  versioned descriptor through `local_node_status`;
- independent clients have verified relay publish/query and Blossom upload/range/read across node
  restarts, with persistent node identity, event/blob data, and peer grants;
- independent host/client processes complete the signed, approval-gated pairing flow and then use
  their narrow grant for relay and Blossom protocol proofs;
- the macOS application and DMG, including the embedded node, build successfully on Apple silicon;
- arm64 and x86_64 Android debug APKs build successfully, and the arm64 app runs on both an API 36.1
  emulator and a physical Pixel with independently reachable embedded relay and Blossom listeners;
- Settings → Offline uses the official Tauri command bridge and runtime-validated DTOs to show node
  status, create pairing invitations, approve or reject requests, list grants, and revoke peers;
- the host can switch from loopback to a selected private IPv4 interface for a bounded 15-minute
  serving session; a peer can scan a QR image or paste an invitation, submit its installation-signed
  claim, poll approval, and retain the joined node across restart;
- the arm64 Android APK builds with the LAN interface enumerator and native HTTP pairing client;
- the equivalent browser settings surface reports that hosting an embedded node requires the native
  app and never attempts native commands;
- full Xcode is not installed in the current environment, so iOS initialization is pending;
- deep-link import, future Android/iOS local-network permission adapters, Android foreground-service
  lifecycle, and release signing are pending.
