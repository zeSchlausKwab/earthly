import { describe, expect, test } from 'bun:test'
import { deriveVisibleEntitiesFromStack, shouldSweepStackEntry } from './GeoEditorView'
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

// Plan 13-06 (UAT test 5b — kill the add-to-stack phantom). An out-of-discovery
// entity (own/link-only/faded-from-live beacon) is ABSENT from the discovery
// `subscriptionSet` but present in the WIDENED `individualLookupSet` (the Task-1
// added-entity cache unioned on top of discovery ∪ routed). It must render via its
// INDIVIDUAL pin, yet must NEVER leak into the aggregate `*-layer` (privacy:
// T-13-06-01 / T-13-03-GPSREGRESS — the aggregate seeds ONLY from subscriptionSet).
describe('deriveVisibleEntitiesFromStack — out-of-discovery individual (13-06)', () => {
	const a: Entity = { key: 'a' }
	const b: Entity = { key: 'b' }
	// `out` is the added out-of-discovery entity: NOT in the discovery subscription,
	// only reachable via the widened individual-lookup superset.
	const out: Entity = { key: 'out' }
	const discovery = [a, b]
	const widened = [a, b, out] // discovery ∪ cached-added

	const deriveWide = (entries: MapStackEntry[]) => {
		const { entries: map, order } = stack(entries)
		return deriveVisibleEntitiesFromStack(
			discovery, // subscriptionSet — discovery ONLY (aggregate seed)
			map,
			order,
			'beacon',
			'beacon-layer',
			resolveKey,
			widened, // individualLookupSet — discovery ∪ added
		)
	}

	// (i) An individual entry whose key resolves ONLY from the widened superset IS
	// returned in the union branch (the phantom is killed — it renders).
	test('individual out-of-discovery pin resolves from the widened superset', () => {
		const result = deriveWide([entry('beacon', 'out')])
		expect(result).toEqual([out])
	})

	// The out-of-discovery entity also renders alongside a discovery individual.
	test('out-of-discovery pin unions with a discovery individual pin', () => {
		const result = deriveWide([entry('beacon', 'a'), entry('beacon', 'out')])
		expect(result).toEqual([a, out])
	})

	// (ii) PRIVACY: with ONLY the aggregate `beacon-layer` visible and NO individual
	// entry, the out-of-discovery entity is NOT returned — the aggregate seeds only
	// from discovery (subscriptionSet), never from the widened superset.
	test('aggregate layer alone does NOT surface the out-of-discovery entity (no leak)', () => {
		const result = deriveWide([entry('beacon-layer', 'all')])
		expect(result).toEqual([a, b])
		expect(result.find((e) => e.key === 'out')).toBeUndefined()
	})

	// Isolation of the out-of-discovery entity resolves solo from the widened set.
	test('isolated out-of-discovery pin renders solo', () => {
		const result = deriveWide([
			entry('beacon-layer', 'all'),
			entry('beacon', 'out', { isolated: true }),
		])
		expect(result).toEqual([out])
	})
})

// Plan 13-06 Task 2 — the sweep decision is a pure predicate. A user-added entry
// that resolved (via the cache) and is NOT NIP-40 expired must be KEPT; only a
// genuinely expired entity (or an aggregate-less unresolvable) is swept. STALE
// (beaconState 120s) is NOT expiry and must not sweep.
describe('shouldSweepStackEntry — sweep-honesty predicate (13-06 Task 2)', () => {
	// resolved + not expired ⇒ keep (the out-of-discovery add survives).
	test('resolved + not expired ⇒ keep (false)', () => {
		expect(shouldSweepStackEntry({ resolved: true, expired: false })).toBe(false)
	})
	// resolved + expired ⇒ evict (D-02 honesty — a genuinely ended entity is removed).
	test('resolved + expired ⇒ evict (true)', () => {
		expect(shouldSweepStackEntry({ resolved: true, expired: true })).toBe(true)
	})
	// unresolvable (absent even from the widened cache) ⇒ evict (nothing to render).
	test('unresolvable ⇒ evict (true)', () => {
		expect(shouldSweepStackEntry({ resolved: false, expired: false })).toBe(true)
	})
})
