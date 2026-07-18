# Earthly Android release process

For version bumps and Zapstore updates after the initial publication, follow
[`ANDROID-UPDATE-RELEASE.md`](./ANDROID-UPDATE-RELEASE.md).

Earthly `0.0.1` is distributed as a signed arm64 APK for Zapstore and a signed AAB retained for
future store distribution. The signing certificate is the update identity: every published Android
build must use the same protected key.

## One-time signing setup

Generate the release keystore outside the repository:

```sh
keytool -genkeypair -v -keystore ~/earthly-release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias earthly
```

Create the ignored file `src-tauri/gen/android/keystore.properties`:

```properties
storeFile=/absolute/path/to/earthly-release.jks
password=CHANGE_ME
keyAlias=earthly
keyPassword=CHANGE_ME
```

Back up the keystore and passwords separately. Losing the key makes it impossible to ship an update
that Android accepts over an installed release.

For GitHub Actions, add these protected repository secrets:

- `ANDROID_KEYSTORE_BASE64`: base64 encoding of the keystore file;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

Neither the keystore nor `keystore.properties` belongs in Git.

## Build and verify

Validate the public mobile configuration and aligned versions without signing material:

```sh
bun run release:android:check
```

With the ignored signing file in place, build the APK and AAB:

```sh
bun run release:android:build
```

The command verifies the APK signature, application id, version name, and version code; verifies the
AAB signature; then writes stable artifacts, checksums, and a commit-bound manifest to
`out/android/0.0.1/`. It also derives the release certificate fingerprint from the verified APK and
emits the exact `assetlinks.json` statement for `city.earthly`.

The GitHub `Android release` workflow performs the same build from protected secrets. A `v0.0.1`
tag must match all three project versions and attaches the verified files to the GitHub release.

Development builds on existing phones use Android's debug certificate. The first APK signed with
the release key cannot upgrade such an installation: uninstall the debug build once, install the
release candidate, and use that same release key for every subsequent upgrade rehearsal.

## Zapstore

Earthly uses [`zsp`](https://github.com/zapstore/zsp), pinned operationally to `v0.4.12` for this
release rehearsal. Install that version from its prebuilt releases or from source:

```sh
go install github.com/zapstore/zsp@v0.4.12
```

After the signed APK exists, validate `zapstore.yaml` without publishing:

```sh
bun run release:zapstore:check
```

Add final, privacy-reviewed phone screenshots to `zapstore.yaml` before publication. Publish only as
an explicit maintainer action, preferably with browser or NIP-46 signing instead of putting an nsec
in the shell environment:

```sh
SIGN_WITH=browser bun run release:zapstore:publish
```

The publish step uploads the APK and media to Blossom and publishes the NIP-82 application, release,
and asset events. Record the resulting event ids, APK certificate fingerprint, hashes, and relay
receipts in the release notes/runbook.

## `0.0.1` release order

1. Complete the two-phone, internet-disabled Field-session and mirrored-map journey.
2. Capture final phone screenshots with test identities and no private locations or messages.
3. Create and back up the release keystore; add the protected CI secrets.
4. Run the workflow manually, install the release candidate, and verify data-preserving upgrades
   between two builds signed by the release key.
5. Publish the generated `assetlinks.json` at
   `https://earthly.city/.well-known/assetlinks.json` with `application/json`, no redirects, deploy
   the site, and verify the domain association on Android.
6. Tag `v0.0.1`, inspect the GitHub release hashes and manifest, then publish with `zsp`.
7. Install from Zapstore on a clean phone and repeat login, map, Private-group, Field-session, QR,
   NIP-46, Lightning, restart, and diagnostics smoke tests.
