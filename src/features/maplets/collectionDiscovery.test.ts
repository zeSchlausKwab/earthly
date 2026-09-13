import { afterEach, describe, expect, mock, test } from 'bun:test'
import { finalizeEvent, getPublicKey, nip19, type Filter, type NostrEvent } from 'nostr-tools'
import {
	createMapletCollectionDiscovery,
	filterMapletCollections,
	MAPLET_COLLECTION_TAG,
	parseMapletCollectionSummary,
	type MapletDiscoveryDependencies,
} from './collectionDiscovery'
import {
	createWorkspaceSnapshot,
	MAPLET_WORKSPACE_MANIFEST,
	type WorkspaceCollection,
} from './workspace'

const key = new Uint8Array(32).fill(11)
const owner = getPublicKey(key)
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Expected test fixture to exist')
	return value
}
function snapshot(id = 'field-observations', name = 'Field observations') {
	const collection: WorkspaceCollection = {
		id,
		owner,
		name,
		groups: [{ id: 'lebanon', name: 'Lebanon' }],
		layers: [
			{
				id: 'stations',
				name: 'Survey stations',
				groupId: 'lebanon',
				updatedAt: 100,
				collection: {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							id: 'station-1',
							properties: { name: 'Station 1' },
							geometry: { type: 'Point', coordinates: [35, 33] },
						},
					],
				},
			},
		],
	}
	return createWorkspaceSnapshot(collection)
}
function eventFor(id = 'field-observations', createdAt = 100, name = 'Field observations') {
	return finalizeEvent(
		{
			kind: 37515,
			tags: [
				['d', id],
				['t', MAPLET_COLLECTION_TAG],
			],
			created_at: createdAt,
			content: JSON.stringify(snapshot(id, name)),
		},
		key,
	)
}
function resign(event: NostrEvent, changes: Partial<NostrEvent>) {
	return finalizeEvent({ ...event, ...changes }, key)
}
const cleanup = new Set<() => void>()
afterEach(() => {
	for (const stop of cleanup) stop()
	cleanup.clear()
})
function harness(
	hydrate: MapletDiscoveryDependencies['hydrate'] = async () => [],
	isDeleted?: MapletDiscoveryDependencies['isDeleted'],
) {
	const listeners: {
		filter: Filter
		callbacks: Parameters<MapletDiscoveryDependencies['listen']>[2]
		stop: ReturnType<typeof mock>
	}[] = []
	let localReceive: (events: NostrEvent[]) => void = () => {}
	let localRemove: (event: NostrEvent) => void = () => {}
	const add = mock((_event: NostrEvent) => {})
	const localStop = mock(() => {})
	const controller = createMapletCollectionDiscovery({
		relays: () => ['ws://127.0.0.1:3334'],
		hydrate,
		isDeleted,
		watchLocal: (_filter, receive, remove) => {
			localReceive = receive
			localRemove = remove
			return localStop
		},
		listen: (filter, _relays, callbacks) => {
			const stop = mock(() => {})
			listeners.push({ filter, callbacks, stop })
			return stop
		},
		add,
	})
	cleanup.add(controller.stop)
	controller.start()
	return {
		controller,
		listeners,
		add,
		localStop,
		local: (events: NostrEvent[]) => localReceive(events),
		remove: (event: NostrEvent) => localRemove(event),
	}
}

describe('verified collection discovery', () => {
	test('summarizes signed collection geometry and names at its exact address', () => {
		const event = eventFor()
		const summary = parseMapletCollectionSummary(event)
		expect(summary).toEqual({
			address: `37515:${owner}:field-observations`,
			naddr: nip19.naddrEncode({ kind: 37515, pubkey: owner, identifier: 'field-observations' }),
			eventId: event.id,
			pubkey: owner,
			name: 'Field observations',
			groups: ['Lebanon'],
			layers: ['Survey stations'],
			featureCount: 1,
			updatedAt: 100,
		})
	})
	test('rejects spoofed tags, altered signed content, duplicate identifiers, and invalid manifests', () => {
		const event = eventFor()
		const differentManifest = JSON.parse(event.content)
		differentManifest[MAPLET_WORKSPACE_MANIFEST].id = 'someone-else'
		const unassigned = JSON.parse(event.content)
		unassigned[MAPLET_WORKSPACE_MANIFEST].layers = []
		const malformed = JSON.parse(event.content)
		malformed.features[0].geometry.coordinates = [500, 33]
		const invalid = [
			{ ...event, content: event.content.replace('Field observations', 'Forged') },
			resign(event, { content: JSON.stringify({ type: 'FeatureCollection', features: [] }) }),
			resign(event, { tags: [['d', 'field-observations']] }),
			resign(event, { tags: [...event.tags, ['d', 'field-observations']] }),
			resign(event, { content: JSON.stringify(differentManifest) }),
			resign(event, { content: JSON.stringify(unassigned) }),
			resign(event, { content: JSON.stringify(malformed) }),
			resign(event, { created_at: Math.floor(Date.now() / 1000) + 3600 }),
		]
		for (const entry of invalid) expect(parseMapletCollectionSummary(entry)).toBeNull()
	})
	test('searches collection, group, layer, npub and exact author keys', () => {
		const summary = required(parseMapletCollectionSummary(eventFor()))
		for (const search of [
			'field LEBANON',
			'survey',
			owner,
			nip19.npubEncode(owner),
			summary.naddr,
		]) {
			expect(filterMapletCollections([summary], search)).toEqual([summary])
		}
		expect(filterMapletCollections([summary], 'missing layer')).toEqual([])
	})
	test('memoizes immutable signed events but never trusts in-place content or tag changes', () => {
		const event = eventFor()
		const first = parseMapletCollectionSummary(event)
		expect(parseMapletCollectionSummary(event)).toBe(first)
		event.content = event.content.replace('Field observations', 'Changed observations')
		expect(parseMapletCollectionSummary(event)).toBeNull()
		const tagged = eventFor()
		expect(parseMapletCollectionSummary(tagged)).not.toBeNull()
		tagged.tags.push(['title', 'Forged title'])
		expect(parseMapletCollectionSummary(tagged)).toBeNull()
	})
	test('honors known store tombstones and removes collections when deletion arrives', async () => {
		const deleted = new Set<string>()
		const event = eventFor()
		const old = eventFor('already-deleted')
		deleted.add(old.id)
		const { controller, listeners, remove } = harness(
			async () => [event, old],
			(candidate) => deleted.has(candidate.id),
		)
		await Promise.resolve()
		expect(controller.getState().collections).toHaveLength(1)
		deleted.add(event.id)
		remove(event)
		expect(controller.getState().collections).toHaveLength(0)
		required(listeners[0]).callbacks.event(event, 'ws://127.0.0.1:3334')
		expect(controller.getState().collections).toHaveLength(0)
	})
	test('keeps the latest valid snapshot per exact address regardless of arrival order', () => {
		const { controller, listeners } = harness()
		const receive = required(listeners[0]).callbacks.event
		const newer = eventFor('field-observations', 200, 'Updated observations')
		receive(newer, 'ws://127.0.0.1:3334')
		receive(eventFor(), 'ws://127.0.0.1:3334')
		receive(
			{ ...newer, content: newer.content.replace('Updated', 'Forged') },
			'ws://127.0.0.1:3334',
		)
		receive(eventFor('other-collection', 150, 'Another collection'), 'ws://127.0.0.1:3334')
		expect(controller.getState().collections.map((item) => item.name)).toEqual([
			'Updated observations',
			'Another collection',
		])
	})
	test('resolves same-second replacements by the lower event ID', () => {
		const { controller, local } = harness()
		const a = eventFor('field-observations', 100, 'Version A')
		const b = eventFor('field-observations', 100, 'Version B')
		local([a, b])
		expect(controller.getState().collections[0]?.eventId).toBe(a.id < b.id ? a.id : b.id)
	})
	test('hydrates cache, reports failed relays honestly, and recovers on a later EOSE', async () => {
		const { controller, listeners } = harness(async () => [eventFor()])
		await Promise.resolve()
		required(listeners[0]).callbacks.done('ws://127.0.0.1:3334', true)
		expect(controller.getState().collections).toHaveLength(1)
		expect(controller.getState().loading).toBe(false)
		expect(controller.getState().error).toContain('could not be reached')
		required(listeners[0]).callbacks.done('ws://127.0.0.1:3334', false)
		expect(controller.getState().error).toBeNull()
	})
	test('does not ingest late cache results or relay messages after cancellation', async () => {
		let resolve!: (events: NostrEvent[]) => void
		const { controller, listeners, add, localStop } = harness(
			() =>
				new Promise((done) => {
					resolve = done
				}),
		)
		controller.stop()
		resolve([eventFor()])
		required(listeners[0]).callbacks.event(eventFor('late'), 'ws://127.0.0.1:3334')
		await Promise.resolve()
		expect(controller.getState().collections).toHaveLength(0)
		expect(add).not.toHaveBeenCalled()
		expect(localStop).toHaveBeenCalledTimes(1)
		expect(required(listeners[0]).stop).toHaveBeenCalledTimes(1)
	})
	test('grows the bounded query window without skipping timestamp ties and keeps it live', () => {
		const { controller, listeners, local } = harness()
		expect(required(listeners[0]).filter).toEqual({
			kinds: [37515],
			'#t': ['maplet-collection'],
			limit: 100,
		})
		const events = Array.from({ length: 100 }, (_, i) => eventFor(`collection-${i}`, 100))
		local(events)
		required(listeners[0]).callbacks.done('ws://127.0.0.1:3334', false)
		expect(controller.getState().hasMore).toBe(true)
		controller.loadMore()
		expect(required(listeners[1]).filter.limit).toBe(200)
		expect(required(listeners[1]).filter.until).toBeUndefined()
		expect(required(listeners[0]).stop).toHaveBeenCalledTimes(1)
		required(listeners[1]).callbacks.event(eventFor('same-second-101', 100), 'ws://127.0.0.1:3334')
		required(listeners[1]).callbacks.done('ws://127.0.0.1:3334', false)
		expect(controller.getState().collections).toHaveLength(101)
		required(listeners[1]).callbacks.event(
			eventFor('collection-0', 101, 'Live replacement'),
			'ws://127.0.0.1:3334',
		)
		expect(controller.getState().collections).toHaveLength(101)
		expect(controller.getState().collections[0]?.name).toBe('Live replacement')
	})
})
