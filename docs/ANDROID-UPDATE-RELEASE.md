# Updating the Earthly Android release

Use this runbook for every Zapstore update after `0.0.1`. Android accepts an update only when the
application id is still `city.earthly`, the APK is signed by the original release key, and
`versionCode` is greater than every previously published build.

The examples below use `0.0.2` and Android `versionCode` `1002`. Set the variables once instead of
copying placeholders such as `RUN_ID` literally:

```sh
export VERSION=0.0.2
export VERSION_CODE=1002
export TAG="v$VERSION"
```

## 1. Prepare the update branch

Start from the commit that should receive the release fix. Confirm that unrelated local work will
not enter the release:

```sh
git status --short
git fetch origin
git log --oneline --decorate -5
```

Update all release identities together:

- `package.json`: `version`;
- `src-tauri/tauri.conf.json`: `version` and a monotonically increasing
  `bundle.android.versionCode`;
- `src-tauri/Cargo.toml`: package `version`;
- `Cargo.lock`: the `earthly-desktop` package version;
- `zapstore.yaml`: `release_source` APK directory and filename;
- `CHANGELOG.md`: a dated, user-facing entry.

Do not raise `min_allowed_version_code` in `zapstore.yaml` for a routine update. Raise it only when
older releases must deliberately be refused. The Android release workflow reads the version from
`package.json`, so it does not need per-version path edits.

## 2. Validate before signing

Run the focused regression tests, the normal suites appropriate to the change, the production
frontend build, and the release metadata check. For a Private-group hotfix this is:

```sh
bun test scripts/android-release.test.ts src/lib/private-workspace \
  src/features/private-maps/privateInviteClipboard.test.ts \
  src/features/private-maps/privateInviteLink.test.ts
bun run build:production
bun run release:android:check
```

The unfiltered `bun test` command currently also collects Playwright scenarios and has unrelated
module-order/test-environment failures; it is not a reliable all-in-one release gate. The repository
also has legacy whole-project TypeScript diagnostics. A new release must not add failures in its
changed surface; use focused Bun tests, the correctly configured AI suite when relevant, Biome, and
the production build until those global baselines are clean.

## 3. Build and rehearse the same-key upgrade

Keep the original ignored `src-tauri/gen/android/keystore.properties` and backed-up keystore in
place, then build the signed candidate:

```sh
bun run release:android:build
```

This writes the verified APK, AAB, hashes, manifest, and `assetlinks.json` to
`out/android/$VERSION/`.

Install the APK over a phone that still has the Zapstore release. Do not uninstall first: a
successful replacement is the evidence that signing identity and version monotonicity are correct,
and it preserves the user's data.

```sh
export SERIAL="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"
adb -s "$SERIAL" install -r "out/android/$VERSION/earthly-$VERSION-arm64-v8a.apk"
adb -s "$SERIAL" shell dumpsys package city.earthly \
  | grep -E 'versionCode|versionName'
```

Smoke-test the fixed journey, cold restart, stored identities/drafts, Private groups, Field
sessions, App Links, QR scanning, and one NIP-46 or Lightning intent. For a focused hotfix, avoid
expanding the candidate while this smoke is green.

## 4. Merge, tag, and let CI reproduce it

Commit and push the update branch, get it reviewed, and merge it. Only tag the clean merged commit:

```sh
git switch master
git pull --ff-only origin master
git status --short
git tag -a "$TAG" -m "Earthly $VERSION"
git push origin "$TAG"
```

Tags are immutable release identities. Never move or replace a published tag; fix a bad candidate
with the next version.

The tag starts the `Android release` workflow. Capture the numeric run id from GitHub instead of
typing `RUN_ID`:

```sh
gh run list --workflow android-release.yml --branch "$TAG" --limit 3
export RUN_ID="$(gh run list --workflow android-release.yml --branch "$TAG" \
  --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
gh release view "$TAG" --web
```

If the first list is empty, wait for the tag-triggered run to appear and repeat those commands.

## 5. Verify the CI artifact and publish it to Zapstore

Download the files attached to the tag into the path used by `zapstore.yaml`, replacing any local
candidate only after CI succeeds:

```sh
rm -rf "out/android/$VERSION"
mkdir -p "out/android/$VERSION"
gh release download "$TAG" --dir "out/android/$VERSION"

(cd "out/android/$VERSION" && shasum -a 256 -c SHA256SUMS.txt)
bun run release:zapstore:check
SIGN_WITH=browser bun run release:zapstore:publish
```

If that exact version has already been published and must intentionally be replaced, use Zapstore
Publisher's overwrite mode:

```sh
SIGN_WITH=browser zsp publish --overwrite-release zapstore.yaml
```

Use `--overwrite-release` only for a deliberate replacement of the version currently referenced by
`zapstore.yaml`. A normal new version should use the standard publish command above.

The CI-generated `assetlinks.json` should retain the existing release certificate fingerprint. If
the fingerprint changes, stop: that APK cannot update existing installations.

Finally, update Earthly from Zapstore on a phone with the previous release, confirm the displayed
version and retained app data, and repeat the hotfix journey. Record the tag, GitHub run id, APK
SHA-256, Zapstore event ids, and the phone used for upgrade evidence in the release notes or issue.

## Recovery rules

- A failed build before tagging: fix the branch and rerun the manual workflow.
- A failed tag workflow before publication: fix the defect and publish the next version/tag rather
  than moving the tag.
- A published app regression: keep the signing key, increment both versions again, and ship a small
  follow-up.
- A signing mismatch during `adb install -r`: do not uninstall the user's release as a workaround;
  locate the original protected keystore and rebuild.
