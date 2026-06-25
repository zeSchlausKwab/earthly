/**
 * Wave-0 Nyquist baseline — pins the shared NIP-40 expiry filter (`expiry.ts`).
 *
 * SPEC-05: clients drop expired events on read regardless of relay GC.
 *   - isExpired(event) ⇒ true  when `expiration` tag < now (epoch seconds)
 *   - isExpired(event) ⇒ false for a future expiration, and for no `expiration` tag
 *   - dropExpired([...]) removes only the expired entries
 * Asserted against a FIXED UTC epoch-seconds clock so the predicate is deterministic.
 *
 * RED-BASELINE: `@/lib/nostr/expiry` does not exist yet (lands in Plan 03).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { dropExpired, isExpired } from '@/lib/nostr/expiry'

/** Fixed UTC clock: 2026-06-25T00:00:00Z in epoch seconds. */
const NOW = Math.floor(Date.UTC(2026, 5, 25, 0, 0, 0) / 1000)
const PAST = NOW - 3600
const FUTURE = NOW + 3600

function makeEvent(id: string, expiration?: number): NostrEvent {
	const tags: string[][] = [['d', id]]
	if (expiration !== undefined) tags.push(['expiration', String(expiration)])
	return {
		id: id.padEnd(64, '0'),
		pubkey: 'b'.repeat(64),
		created_at: NOW - 100,
		kind: 37521,
		tags,
		content: '',
		sig: 'c'.repeat(128),
	}
}

const expiredEvent = makeEvent('expired', PAST)
const futureEvent = makeEvent('future', FUTURE)
const noExpiryEvent = makeEvent('forever')

describe('expiry.ts — SPEC-05 isExpired against a fixed UTC clock', () => {
	test('expiration < now ⇒ true', () => {
		expect(isExpired(expiredEvent, NOW)).toBe(true)
	})

	test('future expiration ⇒ false', () => {
		expect(isExpired(futureEvent, NOW)).toBe(false)
	})

	test('no expiration tag ⇒ false', () => {
		expect(isExpired(noExpiryEvent, NOW)).toBe(false)
	})
})

describe('expiry.ts — SPEC-05 dropExpired', () => {
	test('removes only the expired entries', () => {
		const kept = dropExpired([expiredEvent, futureEvent, noExpiryEvent], NOW)
		expect(kept).toEqual([futureEvent, noExpiryEvent])
	})
})
