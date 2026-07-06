/**
 * Wave-0 Nyquist baseline — pins the TemporalSighting (kind 37522) scaffold contract.
 *
 * SPEC-02 (Phase 8, GREEN): per-kind guard + factory + cast, routing tag reads
 * through `tags.ts`.
 *   - isTemporalSighting() accepts a well-formed 37522 (has `d` tag + `modelVersion`
 *     content), rejects a wrong-kind event.
 *   - TemporalSightingFactory.create() emits a `d` tag + `modelVersion` content.
 *   - the TemporalSighting cast exposes `dTag` and round-trips tags.
 *
 * Phase 11 extension (RED): pins the net-new geometry-on-content seam + lifecycle
 * derivation BEFORE Plans 02–04 implement them (SIGHT-01/02).
 *   - publishSighting (Plan 02 lifecycle, NOT-YET-EXISTING) derives `bbox` + `g`
 *     tags from a Point `content.geometry` — turf-derived discovery tags.
 *   - a round-trip: castEvent(signed, TemporalSighting).sighting.geometry deep-equals
 *     the input Point (SIGHT-01 — the content `geometry` field is also not-yet-existing).
 *   - getTemporalSightingContent on a geometry-LESS 37522 returns geometry:undefined
 *     and does NOT throw (defensive parse; current seed events carry no geometry).
 *   - TemporalSightingFactory.create().contextReferences([coord]) emits a `c` tag (SIGHT-02).
 *   - TemporalSightingFactory.modify(existing) preserves the original `d` tag (no fork).
 *
 * Symbol names per RESEARCH Pattern 1: `isTemporalSighting` / `TemporalSightingFactory`
 * / `TemporalSighting` / `publishSighting` (Plan 02) / `getTemporalSightingContent`.
 * RED-BASELINE: the `geometry` content field + `publishSighting` lifecycle do not
 * exist yet (land in Plans 02/04). The five new cases below MUST fail now.
 */

import { describe, expect, mock, test } from 'bun:test'
import { bbox } from '@turf/turf'
import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import type { Point } from 'geojson'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	TEMPORAL_SIGHTING_KIND,
	TemporalSighting,
	TemporalSightingFactory,
	getTemporalSightingContent,
	isTemporalSighting,
} from '@/lib/nostr/temporal-sighting'

// Stub the relay publish so the lifecycle service never hits the network (mirrors
// story/lifecycle.test.ts — import the lifecycle AFTER the module mock so it binds
// the stubbed `publish`).
const publishSpy = mock(async (_event: NostrEvent) => {})
mock.module('@/lib/nostr', () => ({ publish: publishSpy }))

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

/** Bare sign-function (EntityFactory + lifecycle contract) — deterministic id/pubkey/sig. */
async function bareSign(e: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}): Promise<NostrEvent> {
	return {
		...e,
		created_at: e.created_at ?? 1_700_000_000,
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	} as NostrEvent
}

/** A Point geometry for the Donaukanal sighting fixture (lon, lat). */
const SIGHTING_POINT: Point = { type: 'Point', coordinates: [16.3738, 48.2082] }

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

// ── Phase 11 RED extension — geometry seam + lifecycle derivation (SIGHT-01/02) ──

describe('temporal-sighting — Phase 11 geometry derivation (SIGHT-01)', () => {
	// publishSighting is the Plan-02 lifecycle entry; NOT-YET-EXISTING ⇒ import RED.
	let publishSighting: typeof import('@/lib/nostr/temporal-sighting').publishSighting

	test('publishing a Point sighting derives bbox + g tags from content.geometry', async () => {
		const mod = await import('@/lib/nostr/temporal-sighting')
		publishSighting = mod.publishSighting
		const signed = await publishSighting({ content: { geometry: SIGHTING_POINT } }, bareSign)

		// bbox of a Point is [lon, lat, lon, lat] — the lifecycle must derive it via turf.
		const expectedBbox = bbox(SIGHTING_POINT).join(',')
		const bboxTag = signed.tags.find((t) => t[0] === 'bbox')?.[1]
		expect(bboxTag).toBe(expectedBbox)

		// a geohash `g` tag derived from the geometry centroid is present + non-empty.
		const gTag = signed.tags.find((t) => t[0] === 'g')?.[1]
		expect(typeof gTag).toBe('string')
		expect((gTag ?? '').length).toBeGreaterThan(0)
	})

	test('round-trips: castEvent(signed).sighting.geometry deep-equals the input Point', async () => {
		const mod = await import('@/lib/nostr/temporal-sighting')
		publishSighting = mod.publishSighting
		const signed = await publishSighting({ content: { geometry: SIGHTING_POINT } }, bareSign)

		const cast = castEvent(signed, TemporalSighting, undefined as never)
		expect(cast.sighting.geometry).toEqual(SIGHTING_POINT)
	})
})

describe('temporal-sighting — defensive geometry-absent parse', () => {
	test('a 37522 with no geometry in content ⇒ geometry: undefined, no throw', () => {
		// makeSightingEvent() content has no `geometry` key (current seed shape).
		const content = getTemporalSightingContent(makeSightingEvent())
		expect(content.geometry).toBeUndefined()
	})
})

describe('temporal-sighting — c-attach + lineage (SIGHT-02 / SPEC §17.1)', () => {
	test('contextReferences([coord]) emits a c tag with that coordinate', async () => {
		const coord = `37518:${'b'.repeat(64)}:topic-dtag`
		const tpl = await TemporalSightingFactory.create().contextReferences([coord]).sign(bareSign)
		const cTag = tpl.tags.find((t) => t[0] === 'c')?.[1]
		expect(cTag).toBe(coord)
	})

	test('modify(existing) preserves the original d tag (no lineage fork)', async () => {
		const existing = makeSightingEvent() // d = 'sighting-1'
		const tpl = await TemporalSightingFactory.modify(existing)
			.sighting({ title: 'Updated' })
			.sign(bareSign)
		expect(tpl.tags.find((t) => t[0] === 'd')?.[1]).toBe('sighting-1')
	})

	// CR-01 regression: editing a Group-attached Sighting must NOT drop its `c` tags.
	// The editor pre-fills `contextRefs` from the cast's `contextReferences`, then
	// re-passes them through editSighting → contextReferences(refs). This pins the
	// read-back→re-emit round-trip so a future edit cannot silently wipe attachments.
	test('cast.contextReferences round-trips back through editSighting (CR-01)', async () => {
		const coordA = `37518:${'b'.repeat(64)}:topic-alpha`
		const coordB = `37518:${'b'.repeat(64)}:topic-beta`
		// A published Sighting attached to two Groups (two `c` tags).
		const attached: NostrEvent = {
			...makeSightingEvent(),
			tags: [
				['d', 'sighting-1'],
				['c', coordA],
				['c', coordB],
			],
		}

		// The editor reads existing refs via the cast getter (tags-only, store-free).
		const cast = new TemporalSighting(attached, undefined as never)
		expect(cast.contextReferences).toEqual([coordA, coordB])

		// Re-passing those refs through the edit path must preserve both `c` tags.
		const edited = await TemporalSightingFactory.modify(attached)
			.sighting({ title: 'Updated' })
			.contextReferences(cast.contextReferences)
			.sign(bareSign)
		const cTags = edited.tags.filter((t) => t[0] === 'c').map((t) => t[1])
		expect(cTags).toEqual([coordA, coordB])
	})
})
