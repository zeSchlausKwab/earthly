/**
 * Wave-0 Nyquist baseline — pins the TemporalSighting (kind 37522) scaffold contract.
 *
 * SPEC-02: per-kind guard + factory + cast, routing tag reads through `tags.ts`.
 *   - isTemporalSighting() accepts a well-formed 37522 (has `d` tag + `modelVersion`
 *     content), rejects a wrong-kind event.
 *   - TemporalSightingFactory.create() emits a `d` tag + `modelVersion` content.
 *   - the TemporalSighting cast exposes `dTag` and round-trips tags.
 *
 * Symbol names per RESEARCH Pattern 1: `isTemporalSighting` / `TemporalSightingFactory`
 * / `TemporalSighting`.
 * RED-BASELINE: `@/lib/nostr/temporal-sighting` does not exist yet (lands in Plan 04).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	TEMPORAL_SIGHTING_KIND,
	TemporalSighting,
	TemporalSightingFactory,
	isTemporalSighting,
} from '@/lib/nostr/temporal-sighting'

function makeSightingEvent(): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind: TEMPORAL_SIGHTING_KIND,
		tags: [['d', 'sighting-1']],
		content: JSON.stringify({ modelVersion: MODEL_VERSION, what: 'a fox' }),
		sig: 'c'.repeat(128),
	}
}

function makeWrongKindEvent(): NostrEvent {
	return { ...makeSightingEvent(), kind: 1 }
}

describe('temporal-sighting — SPEC-02 isTemporalSighting guard', () => {
	test('accepts a well-formed 37522 event', () => {
		expect(isTemporalSighting(makeSightingEvent())).toBe(true)
	})

	test('rejects a wrong-kind event', () => {
		expect(isTemporalSighting(makeWrongKindEvent())).toBe(false)
	})
})

describe('temporal-sighting — SPEC-02 TemporalSightingFactory.create()', () => {
	test('emits a d tag and modelVersion content', async () => {
		const tpl = await TemporalSightingFactory.create().sign(async (e) => ({
			...e,
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
		}))
		expect(tpl.tags.some((t) => t[0] === 'd' && !!t[1])).toBe(true)
		expect(JSON.parse(tpl.content).modelVersion).toBe(MODEL_VERSION)
	})
})

describe('temporal-sighting — SPEC-02 TemporalSighting cast', () => {
	test('exposes dTag and round-trips tags', () => {
		const sighting = new TemporalSighting(makeSightingEvent(), undefined as never)
		expect(sighting.dTag).toBe('sighting-1')
	})
})
