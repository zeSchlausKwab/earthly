import { describe, expect, test } from 'bun:test'
import { formatExpiryCountdown, formatObservationRange } from './SightingViewPanel'

// Pure presentation helpers for the Sighting read view (SIGHT-03 / SIGHT-04,
// Phase 11 Plan 04). The view panel itself is a React component; these helpers
// carry the observation-time + expiry-countdown copy the UI-SPEC pins, so they
// are unit-tested directly (no DOM).

const DAY = 86_400

describe('formatObservationRange', () => {
	test('renders an "Observed" row for a start with no end', () => {
		const row = formatObservationRange(1_700_000_000, undefined)
		expect(row.observed).toBeTruthy()
		expect(row.until).toBeNull()
	})

	test('renders both "Observed" and "Until" rows for a start+end range', () => {
		const row = formatObservationRange(1_700_000_000, 1_700_086_400)
		expect(row.observed).toBeTruthy()
		expect(row.until).toBeTruthy()
	})

	test('renders nothing when there is no observation time at all', () => {
		const row = formatObservationRange(undefined, undefined)
		expect(row.observed).toBeNull()
		expect(row.until).toBeNull()
	})
})

describe('formatExpiryCountdown', () => {
	test('returns null when the sighting never expires', () => {
		expect(formatExpiryCountdown(undefined, 1_700_000_000)).toBeNull()
	})

	test('returns "Fades soon" within 24h of expiry', () => {
		const now = 1_700_000_000
		expect(formatExpiryCountdown(now + 3600, now)).toBe('Fades soon')
	})

	test('returns "Fades in N days" for a multi-day window', () => {
		const now = 1_700_000_000
		expect(formatExpiryCountdown(now + 6 * DAY, now)).toBe('Fades in 6 days')
	})

	test('singularises a one-day window', () => {
		const now = 1_700_000_000
		expect(formatExpiryCountdown(now + 1 * DAY + 100, now)).toBe('Fades in 1 day')
	})

	test('returns null once the expiry is in the past', () => {
		const now = 1_700_000_000
		expect(formatExpiryCountdown(now - 10, now)).toBeNull()
	})
})
