import { describe, expect, test } from 'bun:test'
import { deriveVisibleEntitiesFromStack } from './GeoEditorView'
import type { MapStackEntry, MapStackEntryType } from './store/types'

// Phase 13 (SPEC §3.2): the stack-derived render gate for sightings/beacons.
// `deriveVisibleEntitiesFromStack` is the PURE derivation both
// `visibleSightingsFromStack` and `visibleBeaconsFromStack` call — so these
// assertions pin the aggregate / individual / isolation / empty-stack behaviors
// without a live React tree. We test the sighting instantiation (individualType
// 'sighting', layerType 'sighting-layer'); the beacon path is byte-identical with
// the two type strings swapped, so one set of tests covers the shared logic.

interface Entity {
	key: string
}
const resolveKey = (e: Entity) => e.key

// Minimal MapStackEntry fixtures — only the fields the derivation reads
// (entityType, entityKey, visible, isolated).
function entry(
	entityType: MapStackEntryType,
	entityKey: string,
	opts: { visible?: boolean; isolated?: boolean } = {},
): MapStackEntry {
	return {
		id: `${entityType}:${entityKey}`,
		entityType,
		entityKey,
		title: entityKey,
		source: 'manual',
		visible: opts.visible ?? true,
		pinned: false,
		isolated: opts.isolated ?? false,
		exclusions: [],
		addedAt: 0,
	}
}

/** Build the {entries, order} shape from an ordered list of entries. */
function stack(entries: MapStackEntry[]): {
	entries: Record<string, MapStackEntry>
	order: string[]
} {
	const map: Record<string, MapStackEntry> = {}
	const order: string[] = []
	for (const e of entries) {
		map[e.id] = e
		order.push(e.id)
	}
	return { entries: map, order }
}

const derive = (subscription: Entity[], entries: MapStackEntry[]) => {
	const { entries: map, order } = stack(entries)
	return deriveVisibleEntitiesFromStack(
		subscription,
		map,
		order,
		'sighting',
		'sighting-layer',
		resolveKey,
	)
}

describe('deriveVisibleEntitiesFromStack — Phase 13 render gate (SPEC §3.2)', () => {
	const a: Entity = { key: 'a' }
	const b: Entity = { key: 'b' }
	const c: Entity = { key: 'c' }
	const subscription = [a, b, c]

	// Behavior 1: aggregate layer visible → the FULL subscription set (today's
	// always-on behavior, now gated by the layer entry).
	test('aggregate layer visible → full subscription set', () => {
		const result = derive(subscription, [entry('sighting-layer', 'all')])
		expect(result).toEqual([a, b, c])
	})

	// Behavior 2: empty stack (no layer, no individual entries) → [] — the
	// "on the stack = visible" invariant made honest.
	test('empty stack → [] (invariant made honest)', () => {
		expect(derive(subscription, [])).toEqual([])
	})

	// Behavior 3: an individual entry, aggregate layer OFF → ONLY that entity.
	test('individual entry, no layer → only the matching entity', () => {
		const result = derive(subscription, [entry('sighting', 'b')])
		expect(result).toEqual([b])
	})

	// Behavior 4a: an isolated individual entry → ONLY that entity, aggregate
	// suppressed even though the layer entry is present and visible.
	test('isolated individual entry → solo (aggregate suppressed)', () => {
		const result = derive(subscription, [
			entry('sighting-layer', 'all'),
			entry('sighting', 'c', { isolated: true }),
		])
		expect(result).toEqual([c])
	})

	// Behavior 4b: an isolated entry of ANY OTHER type (dataset/context/the other
	// kind) → [] (this kind's aggregate + individuals all suppressed under
	// isolation, SPEC §3.2).
	test('isolated dataset entry → [] (this kind suppressed under any isolation)', () => {
		const result = derive(subscription, [
			entry('sighting-layer', 'all'),
			entry('dataset', 'x', { isolated: true }),
		])
		expect(result).toEqual([])
	})

	// Behavior 5: aggregate ON + the same entity ALSO individually pinned →
	// appears ONCE (union de-dup by key; D-04, no distinct marker).
	test('aggregate + individual pin of same entity → single (union de-dup)', () => {
		const result = derive(subscription, [entry('sighting-layer', 'all'), entry('sighting', 'a')])
		expect(result).toEqual([a, b, c])
		expect(result.filter((e) => e.key === 'a')).toHaveLength(1)
	})

	// Extra: individual pins with NO layer union together (order preserved).
	test('multiple individual pins, no layer → union of matched entities', () => {
		const result = derive(subscription, [entry('sighting', 'a'), entry('sighting', 'c')])
		expect(result).toEqual([a, c])
	})

	// Extra: a hidden (visible:false) layer entry does NOT seed the set.
	test('hidden layer entry → [] (visible:false gates the layer off)', () => {
		const result = derive(subscription, [entry('sighting-layer', 'all', { visible: false })])
		expect(result).toEqual([])
	})

	// Extra: an individual pin that resolves to no subscription entity is dropped
	// (an expired/absent entity cannot be forced onto the map by a stale entry).
	test('individual pin with no matching subscription entity → dropped', () => {
		const result = derive(subscription, [entry('sighting', 'zzz')])
		expect(result).toEqual([])
	})
})
