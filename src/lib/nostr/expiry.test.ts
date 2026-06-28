/**
 * Wave-0 Nyquist baseline — pins the shared NIP-40 expiry filter (`expiry.ts`).
 *
 * SPEC-05: clients drop expired events on read regardless of relay GC.
 *   - isExpired(event) ⇒ true  when `expiration` tag < now (epoch seconds)
 *   - isExpired(event) ⇒ false for a future expiration, and for no `expiration` tag
 *   - dropExpired([...]) removes only the expired entries
 * Asserted against a FIXED UTC epoch-seconds clock so the predicate is deterministic.
 *
 * Phase 11 extension (SIGHT-03, T-11-01-DOC): a Sighting-shaped (kind 37522) block
 * pins the per-read-path expiry invariant at a fixed UTC `now` — expired drops,
 * non-expired + no-expiration survive. The comparison is epoch-SECONDS, never
 * `Date.now()` ms; this catches a units regression in Plans 02–04. These assert
 * shipped seams (expiry.ts is GREEN), so this block PASSES and pins the contract.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
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

// ── Phase 11 — per-read-path Sighting (kind 37522) expiry coverage (SIGHT-03) ──

/** A kind-37522 Temporal Sighting with an optional NIP-40 `expiration` (epoch s). */
function makeSighting(id: string, expiration?: number): NostrEvent {
	const tags: string[][] = [['d', id]]
	if (expiration !== undefined) tags.push(['expiration', String(expiration)])
	return {
		id: id.padEnd(64, '0'),
		pubkey: 'b'.repeat(64),
		created_at: NOW - 100,
		kind: TEMPORAL_SIGHTING_KIND,
		tags,
		content: '',
		sig: 'c'.repeat(128),
	}
}

const expiredSighting = makeSighting('stale-sighting', PAST)
const liveSighting = makeSighting('live-sighting', FUTURE)
const eternalSighting = makeSighting('no-expiry-sighting')

describe('expiry.ts — SIGHT-03 dropExpired over 37522 sightings at a fixed UTC clock', () => {
	test('drops a Sighting whose expiration is strictly before now', () => {
		expect(isExpired(expiredSighting, NOW)).toBe(true)
	})

	test('keeps a Sighting whose expiration is after now and one with no expiration', () => {
		const kept = dropExpired([expiredSighting, liveSighting, eternalSighting], NOW)
		expect(kept).toEqual([liveSighting, eternalSighting])
	})

	test('the fixed clock is epoch SECONDS, not Date.now() ms (units guard)', () => {
		// PAST is ~1.77e9 (seconds). Date.now() would be ~1.78e12 (ms); guard that the
		// fixture and the comparison both live in the seconds domain.
		expect(PAST).toBeLessThan(1e11)
		expect(NOW).toBeLessThan(1e11)
	})
})
