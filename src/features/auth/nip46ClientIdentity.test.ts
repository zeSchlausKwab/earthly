import { describe, expect, test } from 'bun:test'
import type { Platform } from '@/config/platform'
import { getNip46ClientName } from './nip46ClientIdentity'

describe('NIP-46 client identity', () => {
	const cases: Array<[Platform, string]> = [
		['web', 'Earthly City (Web)'],
		['android', 'Earthly City (Android)'],
		['ios', 'Earthly City (iOS)'],
		['macos', 'Earthly City (macOS)'],
		['windows', 'Earthly City (Windows)'],
		['linux', 'Earthly City (Linux)'],
	]

	for (const [platform, expected] of cases) {
		test(`names the ${platform} client`, () => {
			expect(getNip46ClientName(platform)).toBe(expected)
		})
	}
})
