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

On macOS the unsigned local artifacts beneath `target/release/bundle/` are development output. The
current release target is Android; macOS, iOS, Windows, and Linux distribution is deferred.

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

To build and install a debug-signed development APK on every authorized device currently visible to
ADB (USB and Wi-Fi debugging are both supported), run:

```sh
bun run tauri:android:install:dev
```

The command reads each device's primary ABI, builds only the required Tauri targets, and installs the
matching split APKs in parallel. It uses `adb install -r -t`, so an existing Earthly installation and
its local app data are retained. Devices reported by ADB as `offline` or `unauthorized` are called out
and skipped; inspect the connection state with `adb devices -l`. The native package is a debug build,
while its bundled frontend uses the live-safe `.env.production` configuration selected by Tauri's
`beforeBuildCommand`.

The Android app declares `INTERNET` because it hosts and consumes the embedded Nostr and Blossom
services. Release WebViews permit cleartext only to `127.0.0.1`/`localhost`; debug builds permit
cleartext development endpoints. Connections to another device's offline node must go through the
native peer transport rather than granting the WebView unrestricted cleartext LAN access.

The local node currently has process/foreground availability on Android. A production background
node requires a user-visible Android foreground service and the associated lifecycle and notification
work; an APK build alone does not make it continuously available in the background.

### Pairing deep links

Tauri registers `earthly://` on desktop, Android, and iOS. Pairing handoff uses one exact URL shape:

```text
earthly://pair?invitation=earthly-pair-v1%3A…
```

The QR and **Copy app link** action emit this envelope. Raw `earthly-pair-v1:` values remain valid
for paste and imported QR images. The frontend accepts only the exact `pair` host, one invitation
query value, no path/credentials/fragment, the v1 prefix, URL-safe encoding, and the native 16 KiB
input bound before passing the raw value to Rust. The URL does not grant access: the native pairing
decoder still verifies the invitation signature, expiry, nonce, advertised endpoints, requested
capabilities, peer claim, and explicit host approval.

On Windows and Linux, `tauri-plugin-single-instance` is registered first with its `deep-link`
integration so an OS-launched second process forwards the URL to the running Earthly instance. On
Android the generated activity uses `singleTask`; both launch delivery and later intents feed the
same Settings → Offline → Join a device surface.

Test an installed Android debug build with a real, URL-encoded invitation:

```sh
adb shell am start -W -a android.intent.action.VIEW \
  -d 'earthly://pair?invitation=earthly-pair-v1%3Az…' city.earthly
```

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
- accepted peers can explicitly reconcile signed Earthly map records downward with NIP-77; the
  native client persists verified originals into local LMDB and hydrates Applesauce with a bounded
  response, while profile/wallet kinds remain outside that operation;
- the embedded relay validates the exact NIP-42 relay tag and authorizes the authenticated
  installation pubkey against durable `relay-read` and `relay-write` grants. REQ, COUNT, NIP-77,
  and live subscription delivery share the read gate; an unpaired authenticated key receives no
  stored records;
- record synchronization discovers bounded SHA-256 Blossom references. Settings → Offline can
  explicitly mirror missing files in batches from the paired descriptor, with BUD-11 authorization,
  no redirect following, streaming size enforcement, hash verification, atomic local adoption, and
  durable per-peer progress;
- the read-only `earthly-blob` protocol exposes exact local hashes to the main webview with
  GET/HEAD/single-Range responses and a 64 MiB per-response cap. GeoJSON references resolve through
  it before trying their network URL, and mirror completion invalidates prior failed resolutions so
  an open map can retry without a restart;
- pairing QRs and copied links use the statically registered `earthly://pair` scheme. Launch and
  already-running delivery retain the pending URL until the existing join surface has normalized
  and consumed it; raw paste and QR-photo import remain compatible;
- the arm64 Android APK builds with the LAN interface enumerator and native HTTP pairing client;
- the equivalent browser settings surface reports that hosting an embedded node requires the native
  app and never attempts native commands;
- mirrored PMTiles archives can be header-validated through bounded native range reads, rendered as
  vector or raster sources, selected from joined-device storage, and restored after app restart;
- Android permission adapters, foreground-service lifecycle, saved regions, durable publishing,
  and release signing are pending. iOS, Windows, and Linux are outside the current release gate.
