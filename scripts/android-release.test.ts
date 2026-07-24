import { describe, expect, test } from 'bun:test'
import {
	parsePublicReleaseEnvironment,
	androidReleaseBuildEnvironment,
	parseApkCertificateFingerprint,
	androidAssetLinksStatement,
	releaseArtifactNames,
	validateZapstoreReleaseSource,
	validateReleaseVersions,
} from './android-release'

const publicEnvironment = `
# Public only
RELAY_URL=wss://relay.earthly.city
EXTRA_READ_RELAYS=
BLOSSOM_SERVER=https://blossom.earthly.city
MAPNOLIA_TRUSTED_PUBKEYS=${'a'.repeat(64)}
SERVER_PUBKEY=${'b'.repeat(64)}
CORDN_SERVER_PUBKEY=${'c'.repeat(64)}
`

describe('Android release tooling', () => {
	test('declares required device capabilities without permitting Android backups', async () => {
		const manifest = await Bun.file(
			new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url),
		).text()
		const permissions = Array.from(
			manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"\s*\/>/gu),
			(match) => match[1],
		)

		for (const permission of [
			'android.permission.INTERNET',
			'android.permission.ACCESS_NETWORK_STATE',
			'android.permission.ACCESS_COARSE_LOCATION',
			'android.permission.ACCESS_FINE_LOCATION',
		]) {
			expect(permissions.filter((candidate) => candidate === permission)).toHaveLength(1)
		}

		const applicationDeclaration = manifest.match(/<application\b[^>]*>/u)?.[0]
		expect(applicationDeclaration).toBeDefined()
		expect(applicationDeclaration).toContain('android:allowBackup="false"')
		expect(applicationDeclaration).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')
		expect(applicationDeclaration).toContain('android:fullBackupContent="@xml/backup_rules"')

		const backupDomains = [
			'root',
			'file',
			'database',
			'sharedpref',
			'external',
			'device_root',
			'device_file',
			'device_database',
			'device_sharedpref',
		]
		const legacyBackupRules = await Bun.file(
			new URL('../src-tauri/gen/android/app/src/main/res/xml/backup_rules.xml', import.meta.url),
		).text()
		const dataExtractionRules = await Bun.file(
			new URL('../src-tauri/gen/android/app/src/main/res/xml/data_extraction_rules.xml', import.meta.url),
		).text()

		for (const domain of backupDomains) {
			const exclusion = `<exclude domain="${domain}" path="." />`
			expect(legacyBackupRules.split(exclusion)).toHaveLength(2)
			expect(dataExtractionRules.split(exclusion)).toHaveLength(3)
		}
		expect(dataExtractionRules).toContain('<cloud-backup>')
		expect(dataExtractionRules).toContain('<device-transfer>')
	})

	test('accepts only the public Android build environment', () => {
		expect(parsePublicReleaseEnvironment(publicEnvironment)).toEqual({
			RELAY_URL: 'wss://relay.earthly.city',
			EXTRA_READ_RELAYS: '',
			BLOSSOM_SERVER: 'https://blossom.earthly.city',
			MAPNOLIA_TRUSTED_PUBKEYS: 'a'.repeat(64),
			SERVER_PUBKEY: 'b'.repeat(64),
			CORDN_SERVER_PUBKEY: 'c'.repeat(64),
		})
		expect(() =>
			parsePublicReleaseEnvironment(`${publicEnvironment}\nSERVER_KEY=${'d'.repeat(64)}`),
		).toThrow('not an allowed public Android environment value')
		expect(() =>
			parsePublicReleaseEnvironment(publicEnvironment.replace('wss://relay.earthly.city', 'ws://localhost:3334')),
		).toThrow('must contain only secure public wss:// relay URLs')
		expect(() =>
			parsePublicReleaseEnvironment(publicEnvironment.replace('https://blossom.earthly.city', 'http://localhost:3544')),
		).toThrow('BLOSSOM_SERVER must use https://')
	})

	test('marks the validated environment as authoritative for Cargo and the frontend build', () => {
		const environment = androidReleaseBuildEnvironment(publicEnvironment)

		expect(environment.MAPNOLIA_TRUSTED_PUBKEYS).toBe('a'.repeat(64))
		expect(environment.EARTHLY_PUBLIC_ENV_PRELOADED).toBe('1')
	})

	test('requires aligned versions and a matching release tag', () => {
		const versions = {
			packageVersion: '0.0.1',
			tauriVersion: '0.0.1',
			cargoVersion: '0.0.1',
			versionCode: 1001,
		}
		expect(validateReleaseVersions(versions, 'v0.0.1')).toEqual([])
		expect(validateReleaseVersions({ ...versions, cargoVersion: '0.1.0' }, 'v0.0.2')).toEqual([
			'package.json and src-tauri/Cargo.toml versions differ',
			'Git tag v0.0.2 does not match version 0.0.1',
		])
	})

	test('uses stable Zapstore-friendly artifact names', () => {
		expect(
			releaseArtifactNames({
				packageName: 'city.earthly',
				versionName: '0.0.1',
				versionCode: 1001,
			}),
		).toEqual({
			apk: 'earthly-0.0.1-arm64-v8a.apk',
			aab: 'earthly-0.0.1-arm64-v8a.aab',
		})
	})

	test('keeps Zapstore and CI artifact paths aligned with the current version', async () => {
		const metadata = {
			packageName: 'city.earthly',
			versionName: '0.0.2',
			versionCode: 1002,
		}
		expect(
			validateZapstoreReleaseSource(
				'release_source: ./out/android/0.0.2/earthly-0.0.2-arm64-v8a.apk\n',
				metadata,
			),
		).toEqual([])
		expect(
			validateZapstoreReleaseSource(
				'release_source: ./out/android/0.0.1/earthly-0.0.1-arm64-v8a.apk\n',
				metadata,
			),
		).toEqual([
			'zapstore.yaml release_source must be ./out/android/0.0.2/earthly-0.0.2-arm64-v8a.apk, got ./out/android/0.0.1/earthly-0.0.1-arm64-v8a.apk',
		])

		const workflow = await Bun.file(
			new URL('../.github/workflows/android-release.yml', import.meta.url),
		).text()
		expect(workflow).toContain('earthly-android-${{ env.EARTHLY_VERSION }}')
		expect(workflow).toContain('out/android/${{ env.EARTHLY_VERSION }}/')
		expect(workflow).toContain(`VERSION="$(bun -p 'require("./package.json").version')"`)
		expect(workflow).toContain('test -n "$VERSION"')
		expect(workflow).toContain('fail_on_unmatched_files: true')
		expect(workflow).toContain('earthly-android-arm64-v8a.apk')
		expect(workflow).not.toContain('out/android/0.0.1')
	})

	test('derives the exact Android website association from the signed APK', () => {
		const fingerprint = parseApkCertificateFingerprint(
			`Signer #1 certificate SHA-256 digest: ${'ab'.repeat(32)}`,
		)
		expect(fingerprint).toBe(Array.from({ length: 32 }, () => 'AB').join(':'))
		expect(androidAssetLinksStatement('city.earthly', fingerprint)).toEqual([
			{
				relation: ['delegate_permission/common.handle_all_urls'],
				target: {
					namespace: 'android_app',
					package_name: 'city.earthly',
					sha256_cert_fingerprints: [fingerprint],
				},
			},
		])
	})
})
