import { describe, expect, test } from 'bun:test'
import { isOGEventExpired } from './fetchEvent'

// SIGHT-03 / Pitfall P-1: the server-side OG fetch is a SEPARATE read path (raw
// WebSocket REQ, no cast, no subscription filter). It MUST independently check
// the NIP-40 `expiration` tag and refuse to render an expired sighting into a
// social card. `isOGEventExpired` is the pure predicate that gate; tested here
// against a fixed clock (epoch seconds, never Date.now() ms).

function tagsWith(expiration?: number): string[][] {
	const tags: string[][] = [['d', 'abc']]
	if (expiration !== undefined) tags.push(['expiration', String(expiration)])
	return tags
}

describe('isOGEventExpired', () => {
	test('an event with no expiration tag never expires', () => {
		expect(isOGEventExpired({ tags: tagsWith(undefined) }, 1_700_000_000)).toBe(false)
	})

	test('an event whose expiration is in the past is expired', () => {
		const now = 1_700_000_000
		expect(isOGEventExpired({ tags: tagsWith(now - 10) }, now)).toBe(true)
	})

	test('an event whose expiration is in the future is not expired', () => {
		const now = 1_700_000_000
		expect(isOGEventExpired({ tags: tagsWith(now + 10) }, now)).toBe(false)
	})

	test('an expiration exactly equal to now is not yet expired', () => {
		const now = 1_700_000_000
		expect(isOGEventExpired({ tags: tagsWith(now) }, now)).toBe(false)
	})

	test('a malformed (non-numeric) expiration tag never expires (defensive)', () => {
		expect(isOGEventExpired({ tags: [['expiration', 'soon']] }, 1_700_000_000)).toBe(false)
	})
})
