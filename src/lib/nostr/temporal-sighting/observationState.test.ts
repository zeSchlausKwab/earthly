/**
 * Wave-0 Nyquist baseline — pins the observation-state classifier (D-06, net-new).
 *
 * `classifyObservationState(start?, end?, now)` derives a Sighting's observation
 * state purely from its NIP-52 time bounds against a fixed `now` (epoch seconds,
 * UTC). It drives the map paint (LayerManager), the browse-row cue chip, and the
 * view-panel time row, so it must be deterministic and pure.
 *
 *   - 'live'     = now ∈ [start, end]  (or start ≤ now and no `end`, within freshness)
 *   - 'upcoming' = start > now
 *   - 'past'     = end < now  (or start < now past the freshness window with no end)
 *
 * RED-BASELINE: `classifyObservationState` lands in Plan 02 (the @/lib/nostr/
 * temporal-sighting barrel does not export it yet). The cases below MUST fail now.
 */

import { describe, expect, test } from 'bun:test'
import { classifyObservationState } from '@/lib/nostr/temporal-sighting'

/** Fixed UTC clock: 2026-06-25T00:00:00Z in epoch seconds. */
const NOW = Math.floor(Date.UTC(2026, 5, 25, 0, 0, 0) / 1000)
const HOUR = 3600
const DAY = 86_400

describe('classifyObservationState — live / upcoming / past (D-06)', () => {
	test("now within [start, end] ⇒ 'live'", () => {
		expect(classifyObservationState(NOW - HOUR, NOW + HOUR, NOW)).toBe('live')
	})

	test("start ≤ now and no end (within freshness) ⇒ 'live'", () => {
		// Started an hour ago, open-ended, recent ⇒ still considered happening now.
		expect(classifyObservationState(NOW - HOUR, undefined, NOW)).toBe('live')
	})

	test("start in the future ⇒ 'upcoming'", () => {
		expect(classifyObservationState(NOW + DAY, NOW + DAY + HOUR, NOW)).toBe('upcoming')
	})

	test("end strictly before now ⇒ 'past'", () => {
		expect(classifyObservationState(NOW - 2 * HOUR, NOW - HOUR, NOW)).toBe('past')
	})

	test('no start (undefined) ⇒ default (not upcoming, not throwing)', () => {
		// A Sighting with no observation time should classify without throwing; the
		// implementation must return a defined state (live or past), never 'upcoming'.
		const state = classifyObservationState(undefined, undefined, NOW)
		expect(['live', 'past']).toContain(state)
	})
})
