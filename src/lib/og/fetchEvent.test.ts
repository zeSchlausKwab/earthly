import { describe, expect, test } from 'bun:test'
import { isOGEventExpired, readOGExpirationSeconds } from './fetchEvent'

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

	// IN-02: strict `Number(raw)` parse — a trailing-garbage tag is NaN, not a
	// finite past timestamp, so it never expires (matches the documented contract;
	// the old `parseInt` accepted '1700000000garbage' as a finite past value).
	test('a trailing-garbage expiration tag never expires (IN-02 strict parse)', () => {
		const now = 1_700_000_000
		expect(isOGEventExpired({ tags: [['expiration', `${now - 10}garbage`]] }, now)).toBe(false)
	})
})

describe('readOGExpirationSeconds', () => {
	test('returns the epoch-seconds value for a numeric tag', () => {
		expect(readOGExpirationSeconds({ tags: [['expiration', '1700000000']] })).toBe(1_700_000_000)
	})

	test('returns null when there is no expiration tag', () => {
		expect(readOGExpirationSeconds({ tags: [['d', 'abc']] })).toBeNull()
	})

	test('returns null for a trailing-garbage tag (strict parse)', () => {
		expect(readOGExpirationSeconds({ tags: [['expiration', '1700000000garbage']] })).toBeNull()
	})
})
