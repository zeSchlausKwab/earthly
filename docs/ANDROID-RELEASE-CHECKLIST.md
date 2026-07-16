# Earthly Android release checklist

Status date: 2026-07-16

Current release target: `0.0.1`

Release boundary: Android only; macOS is a development host. iOS, Windows, and Linux are deferred.

## Readiness estimate

- Private Android alpha: approximately 85% complete.
- Public Android release: approximately 55% complete.
- Embedded-node and offline-sharing foundation: approximately 95% complete.

The percentages describe release risk, not source-code volume. The Tauri shell is no longer the
uncertain part; offline product behavior, Android lifecycle, recovery, signing, and operations are.

## Private alpha gate

- [x] Shared React application boots inside Tauri on Android.
- [x] Reproducible arm64 debug APK builds and installs on physical hardware.
- [x] Embedded persistent Nostr relay and Blossom service.
- [x] Explicit LAN exposure, signed pairing, approval, revocation, and deep links.
- [x] Pull reconciliation of signed Earthly records and verified referenced blobs.
- [x] First-class Field-session routes and responsive workspace with host/join, signed QR invites,
      approvals, participant writes, nearby chat, device revocation, and explicit delivery policy.
- [x] Nearby dataset authoring/editing, optional note geometry, Field-session geometry overview,
      and Map Stack projection without automatically resurrecting removed datasets.
- [ ] Physical two-phone Field-session UAT with internet disabled: host, approve, bidirectional chat,
      draw/edit/inspect geometry, verify peer reconciliation, revoke, reconnect, and restart both
      apps.
- [x] Local content-addressed range protocol used by the PMTiles client.
- [x] Mirrored raster and vector PMTiles can become the restart-persistent offline basemap.
- [ ] Two-device UAT of a mirrored PMTiles map with internet disabled and both apps restarted.
- [x] Saved-region catalog with coverage planning, size, progress, cancellation, resume, and
      manifest removal controls.
- [x] Saved-region integrity repair, saved-region-owned reference-counted blob cleanup, and
      low-space download preflight.
- [ ] Android low-storage/write-failure recovery UAT. Preflight, write-failure classification, and
      user-facing cleanup/smaller-area/resume guidance are implemented; physical evidence remains.
- [x] Crash-safe SQLite signed-event outbox with immutable events and per-relay acknowledgements.
- [ ] Suspend/resume and low-storage recovery tests on supported Android versions.
- [x] Timed, user-visible foreground service for background local-node availability.
- [x] Nearby polling pauses while hidden and refreshes immediately on foreground/network return.
- [ ] Physical-device interop for NIP-46 signer and Lightning-wallet intents.
- [x] Redacted diagnostics export suitable for alpha support, using the Android share sheet and a
      copy/download fallback without identities, endpoints, content, hashes, or map locations.

## Public release gate

- [x] Final application id (`city.earthly`), product name, adaptive icons, and release version policy:
      user-visible `0.0.1`, Android `versionCode` 1001, monotonically increasing thereafter.
- [ ] Zapstore listing copy, screenshots, feature graphic, category, and support links.
- [ ] Protected release keystore and CI-based AAB signing; no signing material in the repository.
- [ ] Verified `https://earthly.city` Android App Links and deployed `assetlinks.json` for the
      final release-signing certificate.
- [ ] Release AAB build, install, upgrade, data-retention, and uninstall tests.
- [ ] Physical Android process-death UAT for the retained native delivery ledger. This validates
      ordinary public publishing durability; it does not gate the `0.0.1` Field-session model.
- [ ] Automated Rust, browser, Android build, and physical-device smoke gates.
- [ ] Storage migrations and upgrade fixtures for every shipped Android schema.
- [ ] Android permission, notification, battery, metered-network, and disk-pressure UX.
- [ ] Privacy disclosure, data export/delete behavior, and support policy.
- [ ] Checksums, SBOM, provenance, staged rollout, rollback, and incident runbook.
- [ ] Accessibility, safe-area, keyboard, rotation, and representative MapLibre device matrix.

Publication preparation checkpoint: the repository now contains public-only Android build
configuration, protected-keystore Gradle wiring, a tag/version consistency check, deterministic
signed arm64 APK/AAB packaging, signature and manifest verification, checksums, a GitHub release
workflow, `0.0.1` release notes, and a `zsp` configuration that resolves to `city.earthly`. A
disposable certificate proved the complete build locally and was then removed. The unchecked gates
still require the real backed-up release key and CI secrets, privacy-reviewed screenshots, release-
key upgrade evidence, and the explicit Zapstore publication action.

## Execution order

1. Run the Field-session host/join/chat/revoke proof on two physical Android devices with internet
   disabled.
2. Run the saved-region and mirrored-PMTiles offline proof on two physical Android devices.
3. Complete physical low-storage/write-failure evidence without manufacturing disk pressure on a
   user's primary device.
4. Add protected AAB signing and release CI, then run upgrade and staged-release rehearsals.

The general "author anything offline, then decide later whether to publish globally" journey is
explicitly shelved for `0.0.1`. The native outbox machinery remains, but it is not being presented
as the Field-session model. Field-session map authoring is explicitly nearby-only; deliberate
promotion to public Nostr will be planned after the first release.

Physical lifecycle evidence covers Android 10/API 29 and a radio-disabled force-stop/relaunch on
Android 16/API 36. The current `0.0.1` (`versionCode` 1001) upgrade and cold launch pass on a Pixel
10 Pro XL without clearing its app data. Active foreground-service resume, notification-permission
denial, and storage-pressure behavior still need representative matrix coverage before public
release. The Pixel currently has ample free storage, so Earthly will not fill it merely to produce
an artificial low-space failure; deterministic boundary tests cover that behavior until an
appropriate disposable or naturally constrained device is available.

Work that is intentionally not on this release path: iOS initialization and signing, Windows/Linux
build closure, desktop installers/updaters, and native platform-protected MLS key storage.
