# Earthly Android E2E suite

This suite runs deterministic tests inside an Android emulator. It complements the browser-focused `ai-suite`: the browser suite explores and audits Earthly quickly, while this suite verifies Android-only integration such as App Links, WebView accessibility, lifecycle behavior, intents, and embedded offline services.

The tests use Android UI Automator against labels that users can see. No AI model is involved at runtime.

## Commands

```sh
bun run e2e:android:list
bun run e2e:android:emulator
bun run e2e:android:smoke
```

`e2e:android:smoke` starts the configured AVD if necessary, removes the previous disposable emulator
install, builds and installs the current development app, installs the test APK, and runs the smoke
scenario. Removing the old package gives Android enough staging room for Earthly's large debug APK.
Set `EARTHLY_ANDROID_AVD` or pass `--avd NAME` to use another AVD.

Useful development variants:

```sh
bun run e2e:android:smoke -- --no-build
bun run e2e:android:smoke -- --serial emulator-5554
bun run e2e:android:emulator -- --headless
```

The default path refuses physical phones. A deliberate physical run requires `--serial DEVICE --allow-physical`; the runner never clears data on a physical target.

## First scenario

`smoke.workspace-app-links` opens Field sessions, Private groups, and Local drafts as consecutive
Android App Links in one Activity. It verifies each panel becomes visible, stays visible through
several refresh periods, and does not show Earthly's runtime error overlay. The warm transitions
protect against retained cold-launch URLs stealing a newer route, while the stability window
protects against the store/subscription loops that previously made the collaboration panels blink.

The scenario is read-only. It does not author records or point a mutating flow at a public relay. Failure diagnostics are written to the ignored `android-suite/artifacts/` directory: instrumentation output, Logcat, the accessibility hierarchy, and a screenshot.

## Coverage roadmap

Add scenarios in this order:

1. Drawing and editing: panning lock, cancel, save, inspect, and process recreation.
2. Android intents: Amber/NIP-46, invite links, Lightning invoices, and QR scanning with test doubles.
3. Offline map packages: import once, reopen without network, and range reads from the device.
4. Two-emulator Field sessions: discovery, handshake, child publish, host fan-out, reconnect, and deduplication.
5. Long-running stability and memory checks.

The two-emulator Field-session scenario needs Android Emulator 36.5 or newer for direct shared virtual Wi-Fi between emulator instances. Until that runtime is installed, keep network-protocol tests below the UI layer and use the current emulator for single-device journeys.
