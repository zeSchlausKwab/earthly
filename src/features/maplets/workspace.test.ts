import { describe, expect, mock, test } from 'bun:test'
import type { Feature, FeatureCollection } from 'geojson'
import { finalizeEvent, getPublicKey, type NostrEvent } from 'nostr-tools'
import { cloneMapletWorkspaceJson } from '@/lib/maplets/workspace-json'
import sample from './live-mapper/liveuamap-yemen.sample.json'
import { mapLiveuamapPayload } from './liveMapper'
import { copyMapletSnapshot } from './snapshot'
import {
	createMapletWorkspace,
	createWorkspaceSnapshot,
	MAPLET_WORKSPACE_MANIFEST,
	mergeWorkspaceLayer,
	parseWorkspaceAddress,
	parseWorkspaceEvent,
	workspaceStorageKey,
	workspaceVisibilityKey,
	type WorkspaceCollection,
	type WorkspaceDependencies,
} from './workspace'

const key = new Uint8Array(32).fill(1)
const otherKey = new Uint8Array(32).fill(2)
const owner = getPublicKey(key)
const otherOwner = getPublicKey(otherKey)
const address = `37515:${owner}:collection-one`
const point = (id: string, sourceId?: string, longitude = 10): Feature => ({
	type: 'Feature',
	id,
	geometry: { type: 'Point', coordinates: [longitude, 20] },
	properties: { name: id, ...(sourceId ? { sourceId } : {}) },
})
const fc = (...features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
function memoryStorage() {
	const values = new Map<string, string>()
	return {
		values,
		getItem: (name: string) => values.get(name) ?? null,
		setItem: (name: string, value: string) => {
			values.set(name, value)
		},
	}
}
function collection(): WorkspaceCollection {
	return {
		id: 'collection-one',
		owner,
		name: 'Conflict map',
		groups: [{ id: 'regions', name: 'Regions' }],
		layers: [
			{
				id: 'control',
				name: 'Control',
				groupId: 'regions',
				collection: fc(point('same', 'record-a')),
				recipe: { version: 1, path: ['regions'], adapter: 'liveuamap' },
				provenance: { inputHash: 'a'.repeat(64), sourceCapturedAt: null },
				updatedAt: 100,
			},
			{
				id: 'incidents',
				name: 'Incidents',
				groupId: null,
				collection: fc(point('same', 'record-b', 30)),
				updatedAt: 100,
			},
		],
	}
}
function eventFor(input = collection(), createdAt = 100, signingKey = key): NostrEvent {
	return finalizeEvent(
		{
			kind: 37515,
			content: JSON.stringify(createWorkspaceSnapshot(input)),
			tags: [['d', input.id]],
			created_at: createdAt,
		},
		signingKey,
	)
}
function harness(extra: Partial<WorkspaceDependencies> = {}) {
	let count = 0
	const storage = memoryStorage()
	const publishEvent = mock(async () => undefined)
	const signSnapshot = mock(
		async (snapshot: FeatureCollection, id: string, previous?: NostrEvent) =>
			finalizeEvent(
				{
					kind: 37515,
					tags: [['d', id]],
					content: JSON.stringify(snapshot),
					created_at: (previous?.created_at ?? 99) + 1,
				},
				key,
			),
	)
	const workspace = createMapletWorkspace({
		pubkey: owner,
		storage,
		newId: () => `id-${++count}`,
		now: () => 100,
		signSnapshot,
		publishEvent,
		...extra,
	})
	return { workspace, storage, publishEvent, signSnapshot }
}
async function draft(workspace: ReturnType<typeof createMapletWorkspace>) {
	const created = await workspace.request('createCollection', { name: 'My map' })
	const id = created.selectedCollectionId as string
	await workspace.request('saveLayer', {
		collectionId: id,
		name: 'Control',
		collection: fc(point('a', 'record-a'), point('b', 'record-b')),
		recipe: { version: 1, adapter: 'geojson', path: [] },
	})
	return id
}

describe('atomic public collection snapshots', () => {
	test('round trips stable groups and layers with namespaced IDs and no recipes', () => {
		const source = collection()
		const snapshot = createWorkspaceSnapshot(source)
		expect((snapshot as FeatureCollection & { name: string }).name).toBe(source.name)
		expect(new Set(snapshot.features.map((feature) => feature.id)).size).toBe(2)
		expect(JSON.stringify(snapshot)).not.toContain('"recipe"')
		expect(JSON.stringify(snapshot)).not.toContain('"adapter":"liveuamap"')
		const event = eventFor(source)
		const parsed = parseWorkspaceEvent(event, parseWorkspaceAddress(address))
		expect(parsed.groups).toEqual(source.groups)
		expect(parsed.layers.map((layer) => layer.collection)).toEqual(
			source.layers.map((layer) => layer.collection),
		)
		expect(parsed.layers[0]?.provenance).toEqual(source.layers[0]?.provenance)
		expect(parsed.layers[0]?.recipe).toBeUndefined()
		expect(parsed.address).toBe(address)
		expect(parsed.eventId).toBe(event.id)
		expect(parsed.dirty).toBe(false)
	})
	test('accepts exact naddr and plain address and rejects other kinds and partial authors', () => {
		const decoded = parseWorkspaceAddress(address)
		expect(parseWorkspaceAddress(`nostr:${decoded.naddr}`)).toEqual(decoded)
		expect(decoded.filter).toEqual({ kinds: [37515], authors: [owner], '#d': ['collection-one'] })
		expect(() => parseWorkspaceAddress(`37515:${owner.slice(0, 12)}:collection-one`)).toThrow()
		expect(() => parseWorkspaceAddress(`1:${owner}:collection-one`)).toThrow()
	})
	test('rejects tampered signature, other author, other d tag, and unsupported profile', () => {
		const event = eventFor()
		const expected = parseWorkspaceAddress(address)
		expect(() => parseWorkspaceEvent({ ...event, content: `${event.content} ` }, expected)).toThrow(
			'signature',
		)
		expect(() => parseWorkspaceEvent(eventFor(collection(), 101, otherKey), expected)).toThrow(
			'signature',
		)
		expect(() =>
			parseWorkspaceEvent(event, parseWorkspaceAddress(`37515:${owner}:other-id`)),
		).toThrow('signature')
		const plain = finalizeEvent(
			{
				kind: 37515,
				content: JSON.stringify(fc(point('a'))),
				tags: [['d', 'collection-one']],
				created_at: 100,
			},
			key,
		)
		expect(() => parseWorkspaceEvent(plain, expected)).toThrow('manifest')
	})
	test('rejects signed snapshots that omit or double-assign features', () => {
		const snapshot = createWorkspaceSnapshot(collection()) as FeatureCollection &
			Record<string, unknown>
		const manifest = snapshot[MAPLET_WORKSPACE_MANIFEST] as { layers: { featureIds: unknown[] }[] }
		manifest.layers[0]?.featureIds.splice(0)
		const signed = finalizeEvent(
			{
				kind: 37515,
				content: JSON.stringify(snapshot),
				tags: [['d', 'collection-one']],
				created_at: 100,
			},
			key,
		)
		expect(() => parseWorkspaceEvent(signed, parseWorkspaceAddress(address))).toThrow('unassigned')
	})
	test('rejects negative, unsafe and far-future signed timestamps', () => {
		for (const timestamp of [
			-1,
			Number.MAX_SAFE_INTEGER + 1,
			Math.floor(Date.now() / 1000) + 301,
		]) {
			expect(() =>
				parseWorkspaceEvent(eventFor(collection(), timestamp), parseWorkspaceAddress(address)),
			).toThrow('timestamp')
		}
	})
})

describe('local owner workspace', () => {
	test('every empty, loading, saved and restored state crosses strict workspace JSON', async () => {
		const { workspace, storage } = harness()
		expect(() => cloneMapletWorkspaceJson(workspace.getState())).not.toThrow()
		await workspace.request('follow', { address })
		expect(() => cloneMapletWorkspaceJson(workspace.getState())).not.toThrow()
		const id = await draft(workspace)
		await workspace.request('saveLayer', {
			collectionId: id,
			name: 'Captured source',
			collection: mapLiveuamapPayload(sample, { source: 'sample' }).featureCollection,
		})
		expect(() => cloneMapletWorkspaceJson(workspace.getState())).not.toThrow()
		expect(() =>
			cloneMapletWorkspaceJson(createMapletWorkspace({ pubkey: owner, storage }).getState()),
		).not.toThrow()
	})
	test('preserves captured-example freshness warnings for both owners and readers', async () => {
		const { workspace } = harness()
		const id = await draft(workspace)
		await workspace.request('saveLayer', {
			collectionId: id,
			name: 'Captured',
			collection: fc(point('sample')),
			provenance: { sample: true, sourceCapturedAt: null },
		})
		expect(workspace.getState().warnings.join(' ')).toContain('not a live feed')
		let receive: ((event: NostrEvent) => void) | undefined
		const reader = harness({
			pubkey: null,
			subscribeAddress: (_address, callback) => {
				receive = callback
				return () => undefined
			},
		}).workspace
		reader.start()
		await reader.request('follow', { address: `37515:${owner}:${id}` })
		const draftCollection = workspace.getState().collections[0]
		if (!draftCollection) throw new Error('Missing test draft')
		receive?.(eventFor(draftCollection))
		expect(reader.getState().warnings.join(' ')).toContain('source capture time is unknown')
		reader.stop()
	})
	test('rendering and independent editor copies retain layer acquisition provenance', async () => {
		const { workspace } = harness()
		const id = await draft(workspace)
		const layerId = workspace.getState().collections[0]?.layers[0]?.id
		const provenance = {
			inputHash: 'a'.repeat(64),
			adapter: 'geojson',
			adapterVersion: 1,
			sourceUrl: 'https://example.com/capture.json',
			sample: true,
			sourceCapturedAt: null,
		}
		await workspace.request('saveLayer', {
			collectionId: id,
			layerId,
			collection: fc(point('a')),
			provenance,
		})
		const published = await workspace.request('publish', { collectionId: id })
		const rendered = published.renderCollection
		expect(rendered.features[0]?.properties?.mapletWorkspaceSource.provenance).toEqual(provenance)
		const copied = copyMapletSnapshot(
			rendered,
			{
				instanceId: 'instance',
				title: 'Live Mapper',
				dTag: 'live-mapper',
				aggregateHash: 'b'.repeat(64),
			},
			undefined,
			() => 'new-editor-id',
		)
		expect(copied.features[0]?.id).toBe('new-editor-id')
		expect(copied.features[0]?.properties?.mapletWorkspaceSource).toMatchObject({
			address: published.collections[0]?.address,
			eventId: published.collections[0]?.eventId,
			provenance,
		})
		const copiedProperties = copied.features[0]?.properties
		if (!copiedProperties) throw new Error('Missing copied feature')
		copiedProperties.mapletWorkspaceSource.provenance.inputHash = 'changed-copy'
		expect(rendered.features[0]?.properties?.mapletWorkspaceSource.provenance.inputHash).toBe(
			provenance.inputHash,
		)
	})
	test('empty state and create/select persist across iframe remounts', async () => {
		const { workspace, storage } = harness()
		expect(workspace.getState().renderCollection.features).toHaveLength(0)
		const id = await draft(workspace)
		expect(workspace.getState().selectedCollectionId).toBe(id)
		const restored = createMapletWorkspace({ pubkey: owner, storage })
		expect(restored.getState().collections[0]?.layers[0]?.recipe).toEqual({
			version: 1,
			adapter: 'geojson',
			path: [],
		})
		expect(restored.getState().renderCollection.features).toHaveLength(2)
	})
	test('keeps drafts, follows and visibility isolated between account and anonymous sessions', async () => {
		const { workspace, storage } = harness()
		await draft(workspace)
		const anonymous = createMapletWorkspace({ pubkey: null, storage })
		expect(anonymous.getState().collections).toHaveLength(0)
		await anonymous.request('follow', { address })
		await anonymous.request('setVisibility', {
			key: workspaceVisibilityKey(address, undefined, true),
			visible: false,
		})
		const another = createMapletWorkspace({ pubkey: otherOwner, storage })
		expect(another.getState().subscriptions).toHaveLength(0)
		expect(another.getState().collections).toHaveLength(0)
		expect(
			createMapletWorkspace({ pubkey: null, storage }).getState().visibility[
				workspaceVisibilityKey(address, undefined, true)
			],
		).toBe(false)
		expect(storage.values.has(workspaceStorageKey(owner))).toBe(true)
		expect(storage.values.has(workspaceStorageKey(null))).toBe(true)
	})
	test('anonymous and other owners cannot mutate drafts', async () => {
		const { workspace, storage } = harness()
		const id = await draft(workspace)
		const anonymous = createMapletWorkspace({ pubkey: null, storage })
		await expect(anonymous.request('createCollection', { name: 'Bad' })).rejects.toThrow('Sign in')
		const another = createMapletWorkspace({ pubkey: otherOwner, storage })
		for (const action of ['renameCollection', 'saveLayer', 'removeLayer', 'publish', 'addGroup'])
			await expect(another.request(action, { collectionId: id, name: 'Bad' })).rejects.toThrow(
				'owner',
			)
	})
	test('checks active account on every request and after pending signing', async () => {
		let active: string | null = owner
		let complete: ((event: NostrEvent) => void) | undefined
		let signInput: FeatureCollection | undefined
		let signId = ''
		const { workspace, publishEvent } = harness({
			currentPubkey: () => active,
			signSnapshot: async (snapshot, id) => {
				signInput = snapshot
				signId = id
				return new Promise<NostrEvent>((resolve) => {
					complete = resolve
				})
			},
		})
		const id = await draft(workspace)
		const pending = workspace.request('publish', { collectionId: id })
		active = otherOwner
		complete?.(
			finalizeEvent(
				{ kind: 37515, tags: [['d', signId]], content: JSON.stringify(signInput), created_at: 100 },
				key,
			),
		)
		await expect(pending).rejects.toThrow('account or session changed')
		expect(publishEvent).not.toHaveBeenCalled()
		await expect(
			workspace.request('renameCollection', { collectionId: id, name: 'Wrong account' }),
		).rejects.toThrow('account or session changed')
	})
	test('aborted request and stopped iframe cannot mutate persisted state', async () => {
		const { workspace, storage } = harness()
		const signal = AbortSignal.abort()
		await expect(workspace.request('createCollection', { name: 'Bad' }, signal)).rejects.toThrow(
			'session changed',
		)
		expect(storage.values.size).toBe(0)
		workspace.stop()
		await expect(workspace.request('createCollection', { name: 'Bad' })).rejects.toThrow(
			'session changed',
		)
	})
	test('merges included source records completely while retaining other layers and sources', async () => {
		const { workspace } = harness()
		const id = await draft(workspace)
		const layerId = workspace.getState().collections[0]?.layers[0]?.id
		await workspace.request('saveLayer', {
			collectionId: id,
			layerId,
			name: 'Control',
			mode: 'replace',
			collection: fc(point('a:part1', 'a'), point('a:part2', 'a'), point('b:part1', 'b')),
		})
		await workspace.request('saveLayer', {
			collectionId: id,
			name: 'Other layer',
			collection: fc(point('z', 'z')),
		})
		await workspace.request('saveLayer', {
			collectionId: id,
			layerId,
			mode: 'merge',
			collection: fc(point('a:part1', 'a', 40)),
		})
		const layers = workspace.getState().collections[0]?.layers
		expect(layers?.[0]?.collection.features.map((feature) => feature.id)).toEqual([
			'b:part1',
			'a:part1',
		])
		expect(layers?.[1]?.collection.features.map((feature) => feature.id)).toEqual(['z'])
	})
	test('merges by feature ID when source IDs are absent and replace is explicit', () => {
		const merged = mergeWorkspaceLayer(fc(point('a'), point('b')), fc(point('a', undefined, 40)))
		expect(merged.features.map((feature) => feature.id)).toEqual(['b', 'a'])
		expect(merged.features[1]?.geometry).toEqual({ type: 'Point', coordinates: [40, 20] })
	})
	test('renders only selected collection and applies private layer/group visibility', async () => {
		const { workspace } = harness()
		const firstId = await draft(workspace)
		await workspace.request('addGroup', { collectionId: firstId, name: 'Regions' })
		const first = workspace.getState().collections[0]
		const groupId = first?.groups[0]?.id
		const layerId = first?.layers[0]?.id
		await workspace.request('moveLayer', { collectionId: firstId, layerId, groupId })
		await workspace.request('setGroupVisibility', {
			collectionId: firstId,
			groupId,
			visible: false,
		})
		expect(workspace.getState().renderCollection.features).toHaveLength(0)
		await workspace.request('setVisibility', {
			key: workspaceVisibilityKey(firstId, layerId),
			visible: true,
		})
		expect(workspace.getState().renderCollection.features).toHaveLength(2)
		await workspace.request('createCollection', { name: 'Second' })
		expect(workspace.getState().renderCollection.features).toHaveLength(0)
		await workspace.request('selectCollection', { collectionId: firstId })
		expect(workspace.getState().renderCollection.features).toHaveLength(2)
		await workspace.request('removeGroup', { collectionId: firstId, groupId })
		expect(workspace.getState().collections[0]?.layers[0]?.groupId).toBe(null)
	})
	test('rejects raw import text and clones normalized data before storage', async () => {
		const { workspace } = harness()
		const id = await draft(workspace)
		await expect(
			workspace.request('saveLayer', {
				collectionId: id,
				name: 'Unsafe',
				collection: fc(),
				recipe: { rawText: '{private raw import}' },
			}),
		).rejects.toThrow('Raw imports')
		const source = fc(point('external'))
		await workspace.request('saveLayer', {
			collectionId: id,
			name: 'Safe',
			collection: source,
			provenance: { inputHash: 'abc' },
		})
		source.features.splice(0)
		expect(workspace.getState().collections[0]?.layers[1]?.collection.features).toHaveLength(1)
	})
	test('storage quota failures do not claim local saves or lose last good state', async () => {
		const store = memoryStorage()
		let fail = false
		const { workspace } = harness({
			storage: {
				getItem: store.getItem,
				setItem: (name, value) => {
					if (fail) throw new Error('Quota')
					store.setItem(name, value)
				},
			},
		})
		const id = await draft(workspace)
		const before = store.getItem(workspaceStorageKey(owner))
		fail = true
		await expect(
			workspace.request('renameCollection', { collectionId: id, name: 'Unsaved' }),
		).rejects.toThrow('storage')
		expect(workspace.getState().collections[0]?.name).toBe('My map')
		expect(store.getItem(workspaceStorageKey(owner))).toBe(before)
	})
	test('validates render limits before writing local state', async () => {
		const { workspace, storage } = harness()
		const id = await draft(workspace)
		const before = storage.getItem(workspaceStorageKey(owner))
		const nearLimit = point('near-limit')
		nearLimit.properties = { text: 'x'.repeat(16_350) }
		await expect(
			workspace.request('saveLayer', {
				collectionId: id,
				name: 'Too many properties after provenance',
				collection: fc(nearLimit),
			}),
		).rejects.toThrow('size limit')
		expect(storage.getItem(workspaceStorageKey(owner))).toBe(before)
		expect(workspace.getState().collections[0]?.layers).toHaveLength(1)
	})
	test('corrupt or foreign-owner storage is reported without adopting foreign drafts', () => {
		const store = memoryStorage()
		store.setItem(
			workspaceStorageKey(otherOwner),
			JSON.stringify({
				version: 1,
				collections: [collection()],
				subscriptions: [],
				visibility: {},
			}),
		)
		const workspace = createMapletWorkspace({ pubkey: otherOwner, storage: store })
		expect(workspace.getState().collections).toHaveLength(0)
		expect(workspace.getState().warnings.join(' ')).toContain('another account')
	})
})

describe('explicit publication and followed live collections', () => {
	test('acknowledged publication remains truthfully published if metadata storage fills afterward', async () => {
		const store = memoryStorage()
		let fail = false
		const { workspace } = harness({
			storage: {
				getItem: store.getItem,
				setItem: (name, value) => {
					if (fail) throw new Error('Quota')
					store.setItem(name, value)
				},
			},
			publishEvent: async () => {
				fail = true
			},
		})
		const id = await draft(workspace)
		const result = await workspace.request('publish', { collectionId: id })
		expect(result.collections[0]?.eventId).toHaveLength(64)
		expect(result.warnings.join(' ')).toContain('Published successfully')
	})
	test('publishes only on explicit action and reuses the same dataset address for newer versions', async () => {
		const { workspace, publishEvent, signSnapshot } = harness()
		const id = await draft(workspace)
		expect(signSnapshot).not.toHaveBeenCalled()
		expect(publishEvent).not.toHaveBeenCalled()
		const published = await workspace.request('publish', { collectionId: id })
		const first = published.collections[0]
		expect(first?.address).toBe(`37515:${owner}:${id}`)
		expect(first?.eventId).toHaveLength(64)
		expect(published.renderCollection.features[0]?.properties?.mapletWorkspaceSource).toMatchObject(
			{ address: first?.address, eventId: first?.eventId, localDraft: false },
		)
		await workspace.request('renameCollection', { collectionId: id, name: 'Renamed' })
		expect(
			workspace.getState().renderCollection.features[0]?.properties?.mapletWorkspaceSource
				.localDraft,
		).toBe(true)
		const second = await workspace.request('publish', { collectionId: id })
		expect(second.collections[0]?.address).toBe(first?.address)
		expect(second.collections[0]?.eventId).not.toBe(first?.eventId)
		expect(signSnapshot.mock.calls[1]?.[2]?.id).toBe(first?.eventId)
	})
	test('failed relay publication leaves draft unpublished and does not claim success', async () => {
		const { workspace } = harness({
			publishEvent: async () => {
				throw new Error('No relay acknowledged publication')
			},
		})
		const id = await draft(workspace)
		await expect(workspace.request('publish', { collectionId: id })).rejects.toThrow('acknowledged')
		expect(workspace.getState().collections[0]?.eventId).toBeUndefined()
		expect(workspace.getState().collections[0]?.dirty).toBe(true)
	})
	test('signer returning different valid content cannot publish it', async () => {
		const { workspace, publishEvent } = harness({
			signSnapshot: async (_snapshot, id) =>
				eventFor({ ...collection(), id, name: 'Unreviewed content' }),
		})
		const id = await draft(workspace)
		await expect(workspace.request('publish', { collectionId: id })).rejects.toThrow(
			'different collection content',
		)
		expect(publishEvent).not.toHaveBeenCalled()
	})
	test('follows only exact author+kind+d, updates latest and preserves last good geometry on invalid update', async () => {
		let receive: ((event: NostrEvent) => void) | undefined
		const subscribe = mock(
			(
				_input: Parameters<NonNullable<WorkspaceDependencies['subscribeAddress']>>[0],
				callback: (event: NostrEvent) => void,
			) => {
				receive = callback
				return () => undefined
			},
		)
		const { workspace, storage } = harness({ pubkey: null, subscribeAddress: subscribe })
		workspace.start()
		await workspace.request('follow', { address: parseWorkspaceAddress(address).naddr })
		expect(workspace.getState().selectedCollectionId).toBe(address)
		expect(subscribe.mock.calls[0]?.[0].filter).toEqual({
			kinds: [37515],
			authors: [owner],
			'#d': ['collection-one'],
		})
		const first = eventFor()
		receive?.(first)
		expect(workspace.getState().renderCollection.features).toHaveLength(2)
		await workspace.request('setVisibility', {
			key: workspaceVisibilityKey(address, 'control', true),
			visible: false,
		})
		const modified = collection()
		const changedLayer = modified.layers[1]
		if (!changedLayer) throw new Error('Missing test layer')
		changedLayer.collection = fc(point('new', 'record-c', 70))
		const latest = eventFor(modified, 110)
		receive?.(latest)
		expect(workspace.getState().renderCollection.features).toHaveLength(1)
		expect(
			workspace.getState().renderCollection.features[0]?.properties?.mapletWorkspaceSource,
		).toMatchObject({ address, eventId: latest.id, localDraft: false })
		receive?.(first)
		expect(workspace.getState().subscriptions[0]?.collection?.eventId).toBe(latest.id)
		receive?.({ ...latest, content: 'tampered' })
		expect(workspace.getState().subscriptions[0]?.status).toBe('error')
		expect(workspace.getState().subscriptions[0]?.collection?.eventId).toBe(latest.id)
		expect(workspace.getState().renderCollection.features).toHaveLength(1)
		const restored = createMapletWorkspace({ pubkey: null, storage })
		expect(restored.getState().subscriptions[0]?.collection?.eventId).toBe(latest.id)
		expect(restored.getState().renderCollection.features).toHaveLength(1)
		workspace.stop()
	})
	test('unfollow closes live request and clears selection', async () => {
		const stop = mock(() => undefined)
		const { workspace } = harness({ pubkey: null, subscribeAddress: () => stop })
		workspace.start()
		await workspace.request('follow', { address })
		await workspace.request('unfollow', { address })
		expect(stop).toHaveBeenCalledTimes(1)
		expect(workspace.getState().selectedCollectionId).toBe(null)
		expect(workspace.getState().subscriptions).toHaveLength(0)
		workspace.stop()
	})
	test('a signed far-future update cannot poison following later valid snapshots', async () => {
		let receive: ((event: NostrEvent) => void) | undefined
		const { workspace } = harness({
			pubkey: null,
			subscribeAddress: (_address, callback) => {
				receive = callback
				return () => undefined
			},
		})
		workspace.start()
		await workspace.request('follow', { address })
		receive?.(eventFor())
		receive?.(eventFor(collection(), Math.floor(Date.now() / 1000) + 3600))
		expect(workspace.getState().subscriptions[0]?.status).toBe('error')
		const corrected = eventFor(collection(), 200)
		receive?.(corrected)
		expect(workspace.getState().subscriptions[0]?.collection?.eventId).toBe(corrected.id)
		expect(workspace.getState().subscriptions[0]?.status).toBe('ready')
		workspace.stop()
	})
})
