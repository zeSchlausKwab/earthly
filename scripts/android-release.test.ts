import { describe, expect, test } from 'bun:test'
import {
	parsePublicReleaseEnvironment,
	releaseArtifactNames,
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
})
