/**
 * Wave-0 Nyquist baseline — pins the shared tag-helper contract (`tags.ts`).
 *
 * SPEC-02: every kind's tag reads/writes route through ONE shared module, so a
 * `geo-event`-shaped and a `map-context`-shaped event round-trip bbox/`t`/`c`/`a`
 * identically via the same helpers.
 * TAX-01: the NIP-32 `L`/`l` paired-emit helper lives here — `setLabels` emits a
 * single `["L","earthly"]` namespace marker plus one `["l", value, "earthly"]` per
 * value, strips all `L`/`l` on an empty set, reads back only `earthly`-namespaced
 * values, round-trips stably, and flags `t`/`l` disjointness violations.
 *
 * RED-BASELINE: `@/lib/nostr/tags` does not exist yet (lands in Plan 02/03). These
 * imports fail to resolve — that is the intended Nyquist sampling baseline.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import {
	EARTHLY_LABEL_NAMESPACE,
	FEATURE_CATEGORY_VOCAB,
	getBbox,
	getContextRefs,
	getGeohash,
	getHashtags,
	getLabels,
	getReferencedAddresses,
	setBbox,
	setContextRefs,
	setHashtags,
	setLabels,
	setReferencedAddresses,
} from '@/lib/nostr/tags'

function makeEvent(kind: number, tags: string[][]): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind,
		tags,
		content: '',
		sig: 'c'.repeat(128),
	}
}

describe('tags.ts — SPEC-02 shared-helper round-trips', () => {
	test('bbox/t/c/a round-trip identically through the shared setters/getters', () => {
		const bbox: [number, number, number, number] = [-1, -2, 3, 4]
		const hashtags = ['nature', 'route']
		const contextRefs = ['37518:abc:ctx-1']
		const addresses = ['37515:def:ds-1']

		let tags: string[][] = []
		tags = setBbox(tags, bbox)
		tags = setHashtags(tags, hashtags)
		tags = setContextRefs(tags, contextRefs)
		tags = setReferencedAddresses(tags, addresses)

		const event = makeEvent(37520, tags)
		expect(getBbox(event)).toEqual(bbox)
		expect(getHashtags(event)).toEqual(hashtags)
		expect(getContextRefs(event)).toEqual(contextRefs)
		expect(getReferencedAddresses(event)).toEqual(addresses)
	})

	test('getHashtags returns equal arrays for geo-event-shaped and map-context-shaped events', () => {
		const tTags = [
			['t', 'nature'],
			['t', 'route'],
		]
		const geoEvent = makeEvent(37515, [['d', 'geo-1'], ...tTags])
		const mapContextEvent = makeEvent(37518, [['d', 'ctx-1'], ...tTags])
		expect(getHashtags(geoEvent)).toEqual(getHashtags(mapContextEvent))
	})

	test('getGeohash routes through the shared helper', () => {
		const event = makeEvent(37515, [['g', 'u4pruyd']])
		expect(getGeohash(event)).toBe('u4pruyd')
	})
})

describe('tags.ts — TAX-01 NIP-32 L/l pairing + vocab + disjointness', () => {
	test('setLabels emits one ["L","earthly"] plus one ["l", value, "earthly"] per value', () => {
		const tags = setLabels([], ['natural', 'route'])
		const namespaceMarkers = tags.filter((t) => t[0] === 'L' && t[1] === EARTHLY_LABEL_NAMESPACE)
		const labels = tags.filter((t) => t[0] === 'l')
		expect(namespaceMarkers).toHaveLength(1)
		expect(labels).toHaveLength(2)
		expect(labels).toContainEqual(['l', 'natural', EARTHLY_LABEL_NAMESPACE])
		expect(labels).toContainEqual(['l', 'route', EARTHLY_LABEL_NAMESPACE])
	})

	test('setLabels with an empty set strips all L/l tags', () => {
		const seeded = setLabels([], ['natural'])
		const cleared = setLabels(seeded, [])
		expect(cleared.some((t) => t[0] === 'L' || t[0] === 'l')).toBe(false)
	})

	test('getLabels reads back only earthly-namespaced l values', () => {
		const tags = [
			['L', EARTHLY_LABEL_NAMESPACE],
			['l', 'natural', EARTHLY_LABEL_NAMESPACE],
			['l', 'other', 'some.foreign.namespace'],
		]
		const event = makeEvent(37520, tags)
		expect(getLabels(event)).toEqual(['natural'])
	})

	test('label round-trip is stable', () => {
		const values = ['natural', 'route']
		const tags = setLabels([], values)
		const event = makeEvent(37520, tags)
		expect(getLabels(event).slice().sort()).toEqual(values.slice().sort())
	})

	test('a t value equal to an l value is flagged (t/l disjointness)', () => {
		// A category value MUST NOT live in both the freeform `t` lane and the
		// controlled `l` lane — setLabels rejects (or the helper flags) the overlap.
		const tags = setHashtags([], ['natural'])
		expect(() => setLabels(tags, ['natural'])).toThrow()
	})

	test('FEATURE_CATEGORY_VOCAB is the controlled label vocabulary', () => {
		expect(Array.isArray(FEATURE_CATEGORY_VOCAB)).toBe(true)
		expect(FEATURE_CATEGORY_VOCAB.length).toBeGreaterThan(0)
	})
})
