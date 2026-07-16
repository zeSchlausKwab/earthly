# Earthly Android release checklist

Status date: 2026-07-16

Current version: `0.1.0`

Release boundary: Android only; macOS is a development host. iOS, Windows, and Linux are deferred.

## Readiness estimate

- Private Android alpha: approximately 75% complete.
- Public Android release: approximately 50% complete.
- Embedded-node and offline-sharing foundation: approximately 80% complete.

The percentages describe release risk, not source-code volume. The Tauri shell is no longer the
uncertain part; offline product behavior, Android lifecycle, recovery, signing, and operations are.

## Private alpha gate

- [x] Shared React application boots inside Tauri on Android.
- [x] Reproducible arm64 debug APK builds and installs on physical hardware.
- [x] Embedded persistent Nostr relay and Blossom service.
- [x] Explicit LAN exposure, signed pairing, approval, revocation, and deep links.
- [x] Pull reconciliation of signed Earthly records and verified referenced blobs.
- [x] Local content-addressed range protocol used by the PMTiles client.
- [x] Mirrored raster and vector PMTiles can become the restart-persistent offline basemap.
- [ ] Two-device UAT of a mirrored PMTiles map with internet disabled and both apps restarted.
- [ ] Saved-region catalog with progress, size, repair, and removal controls.
- [x] Crash-safe SQLite signed-event outbox with immutable events and per-relay acknowledgements.
- [ ] Physical Android process-death UAT for offline create/edit and later authenticated delivery.
- [ ] Suspend/resume and low-storage recovery tests on supported Android versions.
- [x] Timed, user-visible foreground service for background local-node availability.
- [ ] Physical-device interop for NIP-46 signer and Lightning-wallet intents.
- [ ] Redacted diagnostics export suitable for alpha support.

## Public release gate

- [ ] Final application id, product name, icons, versionCode/versionName policy, and store listing.
- [ ] Protected release keystore and CI-based AAB signing; no signing material in the repository.
- [ ] Verified `https://earthly.city` Android App Links and deployed `assetlinks.json` for the
      final release-signing certificate.
- [ ] Release AAB build, install, upgrade, data-retention, and uninstall tests.
- [ ] Automated Rust, browser, Android build, and physical-device smoke gates.
- [ ] Storage migrations and upgrade fixtures for every shipped Android schema.
- [ ] Android permission, notification, battery, metered-network, and disk-pressure UX.
- [ ] Privacy disclosure, data export/delete behavior, and support policy.
- [ ] Checksums, SBOM, provenance, staged rollout, rollback, and incident runbook.
- [ ] Accessibility, safe-area, keyboard, rotation, and representative MapLibre device matrix.

## Execution order

1. Finish the mirrored-PMTiles offline proof on two physical Android devices.
2. Prove the durable native publish outbox across offline authoring and Android process death.
3. Close saved-region management, recovery, diagnostics, and storage-pressure behavior.
4. Add protected AAB signing and release CI, then run upgrade and staged-release rehearsals.

Physical lifecycle evidence currently covers Android 10/API 29. Notification-permission denial and
foreground-service restrictions still need matrix coverage on Android 13–16 before public release.

Work that is intentionally not on this release path: iOS initialization and signing, Windows/Linux
build closure, desktop installers/updaters, and native platform-protected MLS key storage.
