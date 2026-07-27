import { describe, expect, test } from 'bun:test'
import { bucketForKind, isRelayAllowedWith, resolveReadRelays } from './relay-router'

const LOCAL = ['ws://localhost:3334']
const PUBLIC = ['ws://localhost:3334', 'wss://relay.earthly.city']
const OFF = { allowPublicReads: false, allowPublicWrites: false }

describe('bucketForKind', () => {
	test('profile-plane kinds route to profile', () => {
		for (const kind of [0, 3, 10002, 10065]) expect(bucketForKind(kind)).toBe('profile')
	})

	test('NIP-60/61 wallet kinds route to wallet', () => {
		for (const kind of [17375, 7375, 7376, 7374, 10019, 9321]) {
			expect(bucketForKind(kind)).toBe('wallet')
		}
	})

	test('entity, social, and unknown kinds default to content', () => {
		for (const kind of [37515, 37516, 37517, 37518, 37520, 37521, 37522, 34444, 1, 7, 9735, 1630]) {
			expect(bucketForKind(kind)).toBe('content')
		}
	})
})

describe('resolveReadRelays', () => {
	const base = { readRelays: PUBLIC, writeRelays: LOCAL }

	test('prod: every bucket reads broadly', () => {
		for (const bucket of ['content', 'profile', 'wallet', 'zap', 'discovery'] as const) {
			expect(resolveReadRelays({ bucket, isDevelopment: false, flags: OFF, ...base })).toEqual(
				PUBLIC,
			)
		}
	})

	test('dev: content and discovery stay on local relay by default', () => {
		for (const bucket of ['content', 'discovery'] as const) {
			expect(resolveReadRelays({ bucket, isDevelopment: true, flags: OFF, ...base })).toEqual(LOCAL)
		}
	})

	test('dev: profile, wallet, and active zap workflows may read from public relays', () => {
		for (const bucket of ['profile', 'wallet', 'zap'] as const) {
			expect(resolveReadRelays({ bucket, isDevelopment: true, flags: OFF, ...base })).toEqual(
				PUBLIC,
			)
		}
	})

	test('dev: allowPublicReads opens content reads to public relays', () => {
		expect(
			resolveReadRelays({
				bucket: 'content',
				isDevelopment: true,
				flags: { ...OFF, allowPublicReads: true },
				...base,
			}),
		).toEqual(PUBLIC)
	})
})

describe('isRelayAllowedWith', () => {
	const allowlist = new Set(['ws://localhost:3334', 'wss://relay.earthly.city'])

	test('prod: everything allowed (guard is dev-only)', () => {
		expect(
			isRelayAllowedWith({
				url: 'wss://nos.lol',
				isDevelopment: false,
				flags: OFF,
				allowlist,
				dynamic: new Set(),
			}),
		).toBe(true)
	})

	test('dev: configured relays allowed, arbitrary relays blocked', () => {
		const args = { isDevelopment: true, flags: OFF, allowlist, dynamic: new Set<string>() }
		expect(isRelayAllowedWith({ ...args, url: 'ws://localhost:3334' })).toBe(true)
		// Normalization: trailing slash must not defeat the allowlist.
		expect(isRelayAllowedWith({ ...args, url: 'ws://localhost:3334/' })).toBe(true)
		expect(isRelayAllowedWith({ ...args, url: 'wss://nos.lol' })).toBe(false)
	})

	test('dev: dynamically vouched relays (wallet, NIP-46) allowed', () => {
		expect(
			isRelayAllowedWith({
				url: 'wss://relay.damus.io',
				isDevelopment: true,
				flags: OFF,
				allowlist,
				dynamic: new Set(['wss://relay.damus.io']),
			}),
		).toBe(true)
	})

	test('dev: either escape-hatch flag disables the guard', () => {
		const args = {
			url: 'wss://nos.lol',
			isDevelopment: true,
			allowlist,
			dynamic: new Set<string>(),
		}
		expect(isRelayAllowedWith({ ...args, flags: { ...OFF, allowPublicReads: true } })).toBe(true)
		expect(isRelayAllowedWith({ ...args, flags: { ...OFF, allowPublicWrites: true } })).toBe(true)
	})
})
