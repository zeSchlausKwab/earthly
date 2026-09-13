import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { Feature, FeatureCollection } from 'geojson'
import { nip19, validateEvent, verifyEvent, type Filter, type NostrEvent } from 'nostr-tools'
import { MAPLET_LIMITS, validateMapletCollection } from '@/lib/maplets/collection'
import { boundedJson, isRecord } from '@/lib/maplets/config'
import { cloneMapletWorkspaceJson } from '@/lib/maplets/workspace-json'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

export const MAPLET_WORKSPACE_MANIFEST = 'earthly:maplet-collection'
const MAX_STORAGE_CHARS = 12 * 1024 * 1024
const MAX_STATE_BYTES = 10 * 1024 * 1024
const MAX_COLLECTIONS = 20
const MAX_LAYERS = 100
const MAX_GROUPS = 32

export interface WorkspaceGroup {
	id: string
	name: string
}
export interface WorkspaceLayer {
	id: string
	name: string
	groupId: string | null
	collection: FeatureCollection
	recipe?: Record<string, unknown>
	provenance?: Record<string, unknown>
	updatedAt: number
}
export interface WorkspaceCollection {
	id: string
	owner: string
	name: string
	groups: WorkspaceGroup[]
	layers: WorkspaceLayer[]
	eventId?: string
	address?: string
	naddr?: string
	/** Locally edited geometry can differ from the last published event. */
	dirty?: boolean
}
export interface WorkspaceSubscription {
	address: string
	naddr: string
	status: 'loading' | 'ready' | 'error'
	collection?: WorkspaceCollection
	error?: string
}
export interface MapletWorkspaceState {
	pubkey: string | null
	collections: WorkspaceCollection[]
	selectedCollectionId: string | null
	subscriptions: WorkspaceSubscription[]
	visibility: Record<string, boolean>
	renderCollection: FeatureCollection
	warnings: string[]
	error?: string
}
interface SavedWorkspace {
	version: 1
	collections: WorkspaceCollection[]
	selectedCollectionId: string | null
	subscriptions: { address: string; event?: NostrEvent }[]
	visibility: Record<string, boolean>
	publishedEvents: Record<string, NostrEvent>
}
export interface WorkspaceAddress {
	address: string
	naddr: string
	pubkey: string
	identifier: string
	filter: Filter
}
export interface WorkspaceDependencies {
	pubkey: string | null
	currentPubkey?: () => string | null
	storage: Pick<Storage, 'getItem' | 'setItem'>
	newId?: () => string
	now?: () => number
	signSnapshot?: (
		collection: FeatureCollection,
		id: string,
		previous: NostrEvent | undefined,
		signal: AbortSignal,
	) => Promise<NostrEvent>
	publishEvent?: (event: NostrEvent, signal: AbortSignal) => Promise<unknown>
	subscribeAddress?: (
		address: WorkspaceAddress,
		onEvent: (event: NostrEvent) => void,
		onError: (message: string) => void,
	) => () => void
}

export function workspaceStorageKey(pubkey: string | null): string {
	return `earthly:maplet-workspace:v1:${pubkey ?? 'anonymous'}`
}
export function workspaceVisibilityKey(
	collectionId: string,
	layerId?: string,
	followed = false,
): string {
	return `${followed ? 'subscription' : 'collection'}:${collectionId}${layerId ? `:layer:${layerId}` : ''}`
}
export function emptyMapletWorkspace(pubkey: string | null): MapletWorkspaceState {
	return {
		pubkey,
		collections: [],
		selectedCollectionId: null,
		subscriptions: [],
		visibility: {},
		renderCollection: { type: 'FeatureCollection', features: [] },
		warnings: [],
	}
}
function text(input: unknown, label = 'Name', max = 120): string {
	if (typeof input !== 'string' || !input.trim() || input.length > max)
		throw new Error(`${label} must be between 1 and ${max} characters`)
	return input.trim()
}
function id(input: unknown): string {
	const value = text(input, 'ID', 80)
	if (!/^[a-zA-Z0-9_.-]+$/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value))
		throw new Error('Invalid workspace ID')
	return value
}
function metadata(input: unknown): Record<string, unknown> | undefined {
	if (input === undefined) return undefined
	if (!isRecord(input)) throw new Error('Recipe and provenance must be JSON objects')
	const clean = boundedJson(input, 64 * 1024, 8) as Record<string, unknown>
	const forbidden = new Set([
		'raw',
		'rawText',
		'rawPayload',
		'rawData',
		'sourceText',
		'sourcePayload',
		'fileContent',
		'cookies',
		'authorization',
	])
	function inspect(item: unknown) {
		if (Array.isArray(item)) item.forEach(inspect)
		else if (isRecord(item))
			for (const [key, value] of Object.entries(item)) {
				if (forbidden.has(key))
					throw new Error('Raw imports and credentials must stay in the Maplet session')
				inspect(value)
			}
	}
	inspect(clean)
	return clean
}
function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}
function featureId(layerId: string, sourceId: string | number): string {
	return `${layerId}:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(sourceId))))}`
}
export function parseWorkspaceAddress(input: unknown): WorkspaceAddress {
	const value = text(input, 'Collection address', 2048).replace(/^nostr:/, '')
	let pubkey: string
	let identifier: string
	if (value.startsWith('naddr1')) {
		const decoded = nip19.decode(value)
		if (decoded.type !== 'naddr' || decoded.data.kind !== GEO_EVENT_KIND)
			throw new Error('Expected a kind 37515 collection address')
		pubkey = decoded.data.pubkey
		identifier = decoded.data.identifier
	} else {
		const match = /^37515:([0-9a-f]{64}):(.+)$/.exec(value)
		if (!match?.[1] || !match[2])
			throw new Error('Enter an exact naddr or 37515:author:identifier address')
		pubkey = match[1]
		identifier = match[2]
	}
	id(identifier)
	const address = `${GEO_EVENT_KIND}:${pubkey}:${identifier}`
	return {
		address,
		pubkey,
		identifier,
		naddr: nip19.naddrEncode({ kind: GEO_EVENT_KIND, pubkey, identifier }),
		filter: { kinds: [GEO_EVENT_KIND], authors: [pubkey], '#d': [identifier] },
	}
}

function normalizeCollection(input: unknown, expectedOwner: string): WorkspaceCollection {
	if (!isRecord(input) || input.owner !== expectedOwner)
		throw new Error('Collection belongs to another account')
	if (
		!Array.isArray(input.groups) ||
		input.groups.length > MAX_GROUPS ||
		!Array.isArray(input.layers) ||
		input.layers.length > MAX_LAYERS
	)
		throw new Error('Collection group or layer limit exceeded')
	const groups: WorkspaceGroup[] = input.groups.map((group) => {
		if (!isRecord(group)) throw new Error('Invalid group')
		return { id: id(group.id), name: text(group.name) }
	})
	if (new Set(groups.map((group) => group.id)).size !== groups.length)
		throw new Error('Duplicate group ID')
	const layers: WorkspaceLayer[] = input.layers.map((layer) => {
		if (!isRecord(layer)) throw new Error('Invalid layer')
		const groupId = layer.groupId == null ? null : id(layer.groupId)
		if (groupId && !groups.some((group) => group.id === groupId))
			throw new Error('Unknown layer group')
		if (
			typeof layer.updatedAt !== 'number' ||
			!Number.isFinite(layer.updatedAt) ||
			layer.updatedAt < 0
		)
			throw new Error('Invalid layer timestamp')
		return {
			id: id(layer.id),
			name: text(layer.name),
			groupId,
			collection: validateMapletCollection(layer.collection),
			recipe: metadata(layer.recipe),
			provenance: metadata(layer.provenance),
			updatedAt: layer.updatedAt,
		}
	})
	if (new Set(layers.map((layer) => layer.id)).size !== layers.length)
		throw new Error('Duplicate layer ID')
	const result: WorkspaceCollection = {
		id: id(input.id),
		owner: expectedOwner,
		name: text(input.name),
		groups,
		layers,
		dirty: input.dirty !== false,
	}
	if (typeof input.eventId === 'string' && /^[0-9a-f]{64}$/.test(input.eventId))
		result.eventId = input.eventId
	if (input.address !== undefined) {
		const address = parseWorkspaceAddress(input.address)
		if (address.pubkey !== expectedOwner || address.identifier !== result.id)
			throw new Error('Collection address does not match owner')
		result.address = address.address
		result.naddr = address.naddr
	}
	// Apply the shared budget to the entire collection, not each layer independently.
	validateMapletCollection({
		type: 'FeatureCollection',
		features: layers.flatMap((layer) =>
			layer.collection.features.map((feature) => ({
				...feature,
				id: featureId(layer.id, feature.id ?? ''),
			})),
		),
	})
	return result
}

/** Atomic kind 37515 snapshot. Import recipes never enter public content. */
export function createWorkspaceSnapshot(input: WorkspaceCollection): FeatureCollection {
	const collection = normalizeCollection(input, input.owner)
	const features: Feature[] = []
	const layers = collection.layers.map((layer) => {
		const featureIds = layer.collection.features.map((feature) => {
			const originalId = feature.id ?? ''
			const publishedId = featureId(layer.id, originalId)
			features.push({ ...clone(feature), id: publishedId })
			return [publishedId, originalId]
		})
		return {
			id: layer.id,
			name: layer.name,
			groupId: layer.groupId,
			featureIds,
			provenance: layer.provenance,
			updatedAt: layer.updatedAt,
		}
	})
	const output: FeatureCollection & Record<string, unknown> = {
		...validateMapletCollection({ type: 'FeatureCollection', features }),
		name: collection.name,
		[MAPLET_WORKSPACE_MANIFEST]: {
			version: 1,
			id: collection.id,
			name: collection.name,
			groups: collection.groups,
			layers,
		},
	}
	if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAPLET_LIMITS.bytes)
		throw new Error('Published collection exceeds the 5 MiB limit')
	return output
}

/** Verify a fresh copy so nostr-tools' verification symbol cannot be supplied by a caller. */
export function parseWorkspaceEvent(
	input: NostrEvent,
	expected: WorkspaceAddress,
): WorkspaceCollection {
	const event = clone(input)
	if (
		!Number.isSafeInteger(event.created_at) ||
		event.created_at < 0 ||
		event.created_at > Math.floor(Date.now() / 1000) + 300
	)
		throw new Error('Collection event timestamp is invalid or more than five minutes in the future')
	if (
		!validateEvent(event) ||
		!verifyEvent(event) ||
		event.kind !== GEO_EVENT_KIND ||
		event.pubkey !== expected.pubkey ||
		event.tags.filter((tag) => tag[0] === 'd').length !== 1 ||
		event.tags.find((tag) => tag[0] === 'd')?.[1] !== expected.identifier
	)
		throw new Error('Collection event signature or address is invalid')
	if (new TextEncoder().encode(event.content).byteLength > MAPLET_LIMITS.bytes)
		throw new Error('Collection event exceeds the 5 MiB limit')
	const content: unknown = JSON.parse(event.content)
	if (!isRecord(content)) throw new Error('Invalid collection content')
	const manifest = content[MAPLET_WORKSPACE_MANIFEST]
	if (
		!isRecord(manifest) ||
		manifest.version !== 1 ||
		manifest.id !== expected.identifier ||
		!Array.isArray(manifest.layers)
	)
		throw new Error('This dataset does not contain a supported Maplet collection manifest')
	const fc = validateMapletCollection(content)
	const features = new Map(fc.features.map((feature) => [String(feature.id), feature]))
	const consumed = new Set<string>()
	const layers = manifest.layers.map((layer) => {
		if (!isRecord(layer) || !Array.isArray(layer.featureIds))
			throw new Error('Invalid collection layer manifest')
		const layerId = id(layer.id)
		const layerFeatures = layer.featureIds.map((entry) => {
			if (
				!Array.isArray(entry) ||
				entry.length !== 2 ||
				typeof entry[0] !== 'string' ||
				(typeof entry[1] !== 'string' && typeof entry[1] !== 'number') ||
				featureId(layerId, entry[1]) !== entry[0]
			)
				throw new Error('Invalid collection feature reference')
			const feature = features.get(entry[0])
			if (!feature || consumed.has(entry[0]))
				throw new Error('Missing or duplicate collection feature reference')
			consumed.add(entry[0])
			return { ...feature, id: entry[1] }
		})
		return {
			id: layerId,
			name: layer.name,
			groupId: layer.groupId,
			provenance: layer.provenance,
			updatedAt: layer.updatedAt,
			collection: { type: 'FeatureCollection', features: layerFeatures },
		}
	})
	if (consumed.size !== features.size) throw new Error('Collection contains unassigned features')
	return normalizeCollection(
		{
			id: manifest.id,
			owner: event.pubkey,
			name: manifest.name,
			groups: manifest.groups,
			layers,
			eventId: event.id,
			address: expected.address,
			dirty: false,
		},
		event.pubkey,
	)
}

function newer(candidate: NostrEvent, current?: NostrEvent): boolean {
	return (
		!current ||
		candidate.created_at > current.created_at ||
		(candidate.created_at === current.created_at && candidate.id < current.id)
	)
}
function sourceRecord(feature: Feature): string | null {
	const value = feature.properties?.sourceId
	return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}
export function mergeWorkspaceLayer(
	previous: FeatureCollection,
	incoming: FeatureCollection,
): FeatureCollection {
	const clean = validateMapletCollection(incoming)
	const includedSources = new Set(
		clean.features.map(sourceRecord).filter((value): value is string => value !== null),
	)
	const includedIds = new Set(clean.features.map((feature) => String(feature.id)))
	return validateMapletCollection({
		type: 'FeatureCollection',
		features: [
			...previous.features.filter(
				(feature) =>
					!includedIds.has(String(feature.id)) &&
					!(sourceRecord(feature) !== null && includedSources.has(sourceRecord(feature) as string)),
			),
			...clean.features,
		],
	})
}

/** Account-scoped persistence and authority; no Nostr singletons in this testable core. */
export function createMapletWorkspace(deps: WorkspaceDependencies) {
	const pubkey = deps.pubkey
	const listeners = new Set<() => void>()
	const subscriptions = new Map<string, () => void>()
	const publishing = new Set<string>()
	let lifecycle = new AbortController()
	let started = false
	let saved: SavedWorkspace = {
		version: 1,
		collections: [],
		selectedCollectionId: null,
		subscriptions: [],
		visibility: {},
		publishedEvents: {},
	}
	let state = emptyMapletWorkspace(pubkey)
	const newId = deps.newId ?? (() => crypto.randomUUID())
	const now = deps.now ?? Date.now
	const errors = new Map<string, string>()
	let storageWarning: string | undefined

	function assertActive(signal?: AbortSignal) {
		if (
			lifecycle.signal.aborted ||
			signal?.aborted ||
			(deps.currentPubkey && deps.currentPubkey() !== pubkey)
		)
			throw new Error('Maplet workspace account or session changed; retry in the active account')
	}
	function ownerCollection(data: SavedWorkspace, collectionId: unknown): WorkspaceCollection {
		if (!pubkey) throw new Error('Sign in to create or edit a collection')
		const collection = data.collections.find((item) => item.id === collectionId)
		if (!collection || collection.owner !== pubkey)
			throw new Error('Only the collection owner can edit this local draft')
		if (publishing.has(collection.id))
			throw new Error('Wait for this collection to finish publishing')
		return collection
	}
	function buildState(data: SavedWorkspace): MapletWorkspaceState {
		const followed: WorkspaceSubscription[] = data.subscriptions.map((item) => {
			const address = parseWorkspaceAddress(item.address)
			const collection = item.event ? parseWorkspaceEvent(item.event, address) : undefined
			const error = errors.get(item.address)
			return {
				address: item.address,
				naddr: address.naddr,
				status: error ? 'error' : collection ? 'ready' : 'loading',
				collection,
				error,
			}
		})
		const local = data.collections.find((collection) => collection.id === data.selectedCollectionId)
		const subscription = followed.find((item) => item.address === data.selectedCollectionId)
		const selected = local ?? subscription?.collection
		const selectedId = local?.id ?? subscription?.address
		const render: FeatureCollection = { type: 'FeatureCollection', features: [] }
		if (
			selected &&
			selectedId &&
			data.visibility[workspaceVisibilityKey(selectedId, undefined, !!subscription)] !== false
		) {
			for (const layer of selected.layers) {
				if (data.visibility[workspaceVisibilityKey(selectedId, layer.id, !!subscription)] === false)
					continue
				render.features.push(
					...layer.collection.features.map((feature) => ({
						...clone(feature),
						id: featureId(layer.id, feature.id ?? ''),
						properties: {
							...feature.properties,
							mapletWorkspaceSource: {
								collectionId: selected.id,
								layerId: layer.id,
								featureId: feature.id,
								owner: selected.owner,
								...(layer.provenance ? { provenance: clone(layer.provenance) } : {}),
								...(selected.address
									? {
											address: selected.address,
											eventId: selected.eventId,
											localDraft: !!local && selected.dirty !== false,
										}
									: { localDraft: true }),
							},
						},
					})),
				)
			}
		}
		const nextState: MapletWorkspaceState = {
			pubkey,
			collections: clone(data.collections),
			selectedCollectionId: data.selectedCollectionId,
			subscriptions: followed,
			visibility: { ...data.visibility },
			renderCollection: validateMapletCollection(render),
			warnings: [
				...(storageWarning ? [storageWarning] : []),
				...(selected?.layers.some((layer) => layer.provenance?.sample === true)
					? ['Captured example data: source capture time is unknown; this is not a live feed.']
					: []),
				...Array.from(errors)
					.filter(([address]) => data.subscriptions.some((item) => item.address === address))
					.map(([address, message]) => `${address}: ${message}`),
			],
		}
		const json = JSON.stringify(nextState)
		if (new TextEncoder().encode(json).byteLength > MAX_STATE_BYTES)
			throw new Error('Workspace exceeds the 10 MiB session limit; remove unused local layers')
		// Omit optional undefined fields before crossing the runtime's strict JSON boundary.
		return cloneMapletWorkspaceJson(JSON.parse(json)) as MapletWorkspaceState
	}
	function rebuild() {
		state = buildState(saved)
		for (const listener of listeners) listener()
	}
	function persist(next: SavedWorkspace, signal?: AbortSignal) {
		assertActive(signal)
		// Validate the rendered result before committing either storage or memory.
		const nextState = buildState(next)
		const json = JSON.stringify(next)
		if (json.length > MAX_STORAGE_CHARS)
			throw new Error('Maplet workspace storage limit exceeded; remove unused local layers')
		try {
			deps.storage.setItem(workspaceStorageKey(pubkey), json)
		} catch {
			throw new Error('Could not save Maplet workspace: browser storage is full or unavailable')
		}
		saved = next
		storageWarning = undefined
		state = nextState
		for (const listener of listeners) listener()
	}
	function connect(addressText: string) {
		if (!started || subscriptions.has(addressText) || !deps.subscribeAddress) return
		const address = parseWorkspaceAddress(addressText)
		// Mark before subscribe, because EventStore hydration can synchronously emit.
		subscriptions.set(addressText, () => undefined)
		const stop = deps.subscribeAddress(
			address,
			(event) => {
				try {
					assertActive()
					const current = saved.subscriptions.find((item) => item.address === addressText)
					if (!current) return
					parseWorkspaceEvent(event, address)
					if (!newer(event, current.event)) {
						if (event.id === current.event?.id && errors.delete(addressText)) rebuild()
						return
					}
					const next = clone(saved)
					const target = next.subscriptions.find((item) => item.address === addressText)
					if (!target) return
					target.event = clone(event)
					errors.delete(addressText)
					persist(next)
				} catch (error) {
					if (lifecycle.signal.aborted || (deps.currentPubkey?.() !== pubkey && deps.currentPubkey))
						return
					errors.set(
						addressText,
						error instanceof Error ? error.message : 'Could not update collection',
					)
					rebuild()
				}
			},
			(message) => {
				if (
					lifecycle.signal.aborted ||
					(deps.currentPubkey && deps.currentPubkey() !== pubkey) ||
					!saved.subscriptions.some((item) => item.address === addressText)
				)
					return
				errors.set(addressText, message)
				rebuild()
			},
		)
		subscriptions.set(addressText, stop)
	}

	try {
		const json = deps.storage.getItem(workspaceStorageKey(pubkey))
		if (json) {
			if (json.length > MAX_STORAGE_CHARS) throw new Error('Saved workspace exceeds storage limit')
			const data: unknown = JSON.parse(json)
			if (
				!isRecord(data) ||
				data.version !== 1 ||
				!Array.isArray(data.collections) ||
				data.collections.length > MAX_COLLECTIONS ||
				!Array.isArray(data.subscriptions) ||
				data.subscriptions.length > MAX_COLLECTIONS
			)
				throw new Error('Invalid saved workspace')
			const collections = data.collections.map((item) => normalizeCollection(item, pubkey ?? ''))
			if (
				(!pubkey && collections.length) ||
				new Set(collections.map((item) => item.id)).size !== collections.length
			)
				throw new Error('Invalid saved ownership or duplicate collection')
			const restoredSubscriptions = data.subscriptions.map((item) => {
				if (!isRecord(item)) throw new Error('Invalid saved subscription')
				const address = parseWorkspaceAddress(item.address)
				if (item.event) parseWorkspaceEvent(item.event as NostrEvent, address)
				return {
					address: address.address,
					...(item.event ? { event: item.event as NostrEvent } : {}),
				}
			})
			const publishedEvents: Record<string, NostrEvent> = {}
			if (pubkey && isRecord(data.publishedEvents))
				for (const collection of collections) {
					const event = data.publishedEvents[collection.id] as NostrEvent | undefined
					if (event) {
						parseWorkspaceEvent(
							event,
							parseWorkspaceAddress(`${GEO_EVENT_KIND}:${pubkey}:${collection.id}`),
						)
						publishedEvents[collection.id] = event
					}
				}
			const visibility = boundedJson(data.visibility ?? {}) as Record<string, unknown>
			if (
				!isRecord(visibility) ||
				Object.values(visibility).some((value) => typeof value !== 'boolean')
			)
				throw new Error('Invalid saved visibility')
			const selected =
				typeof data.selectedCollectionId === 'string' &&
				(collections.some((item) => item.id === data.selectedCollectionId) ||
					restoredSubscriptions.some((item) => item.address === data.selectedCollectionId))
					? data.selectedCollectionId
					: null
			saved = {
				version: 1,
				collections,
				subscriptions: restoredSubscriptions,
				selectedCollectionId: selected,
				visibility: visibility as Record<string, boolean>,
				publishedEvents,
			}
			buildState(saved)
		}
	} catch (error) {
		saved = {
			version: 1,
			collections: [],
			selectedCollectionId: null,
			subscriptions: [],
			visibility: {},
			publishedEvents: {},
		}
		storageWarning = `Saved workspace could not be loaded: ${error instanceof Error ? error.message : 'invalid data'}`
	}
	rebuild()

	async function request(
		action: string,
		payload: unknown = {},
		signal?: AbortSignal,
	): Promise<MapletWorkspaceState> {
		assertActive(signal)
		if (!isRecord(payload)) throw new Error('Workspace request must be an object')
		if (action === 'state') return clone(state)
		if (action === 'publish') {
			const collection = ownerCollection(saved, payload.collectionId)
			if (!deps.signSnapshot || !deps.publishEvent) throw new Error('Publishing is unavailable')
			const snapshot = createWorkspaceSnapshot(collection)
			const address = parseWorkspaceAddress(`${GEO_EVENT_KIND}:${pubkey}:${collection.id}`)
			const combinedSignal = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal
			publishing.add(collection.id)
			try {
				const event = await deps.signSnapshot(
					snapshot,
					collection.id,
					saved.publishedEvents[collection.id],
					combinedSignal,
				)
				assertActive(combinedSignal)
				parseWorkspaceEvent(event, address)
				if (event.content !== JSON.stringify(snapshot))
					throw new Error('Signer returned different collection content')
				if (!newer(event, saved.publishedEvents[collection.id]))
					throw new Error('Signed collection version must be newer than its previous publication')
				await deps.publishEvent(event, combinedSignal)
				assertActive(combinedSignal)
				const next = clone(saved)
				const target = next.collections.find((item) => item.id === collection.id)
				if (!target || target.owner !== pubkey)
					throw new Error('Collection owner changed during publication')
				Object.assign(target, {
					eventId: event.id,
					address: address.address,
					naddr: address.naddr,
					dirty: false,
				})
				next.publishedEvents[collection.id] = clone(event)
				try {
					persist(next, combinedSignal)
				} catch (error) {
					// The relay already acknowledged. Report that fact even if local storage fails.
					assertActive(combinedSignal)
					saved = next
					storageWarning = `Published successfully, but local publication metadata could not be saved: ${error instanceof Error ? error.message : 'storage error'}`
					rebuild()
				}
				return clone(state)
			} finally {
				publishing.delete(collection.id)
			}
		}
		const next = clone(saved)
		switch (action) {
			case 'createCollection': {
				if (!pubkey) throw new Error('Sign in to create a collection')
				if (next.collections.length >= MAX_COLLECTIONS) throw new Error('Collection limit exceeded')
				const collection: WorkspaceCollection = {
					id: id(newId()),
					owner: pubkey,
					name: text(payload.name),
					groups: [],
					layers: [],
					dirty: true,
				}
				next.collections.push(collection)
				next.selectedCollectionId = collection.id
				break
			}
			case 'selectCollection': {
				if (
					!next.collections.some((item) => item.id === payload.collectionId) &&
					!next.subscriptions.some((item) => item.address === payload.collectionId)
				)
					throw new Error('Unknown collection')
				next.selectedCollectionId = String(payload.collectionId)
				break
			}
			case 'follow': {
				const address = parseWorkspaceAddress(payload.address)
				if (!next.subscriptions.some((item) => item.address === address.address)) {
					if (next.subscriptions.length >= MAX_COLLECTIONS)
						throw new Error('Followed collection limit exceeded')
					next.subscriptions.push({ address: address.address })
				}
				next.selectedCollectionId = address.address
				break
			}
			case 'unfollow': {
				const address = parseWorkspaceAddress(payload.address).address
				next.subscriptions = next.subscriptions.filter((item) => item.address !== address)
				if (next.selectedCollectionId === address) next.selectedCollectionId = null
				for (const key of Object.keys(next.visibility))
					if (
						key === workspaceVisibilityKey(address, undefined, true) ||
						key.startsWith(`${workspaceVisibilityKey(address, undefined, true)}:layer:`)
					)
						delete next.visibility[key]
				break
			}
			case 'setVisibility': {
				if (typeof payload.visible !== 'boolean' || typeof payload.key !== 'string')
					throw new Error('Invalid visibility preference')
				const valid = new Set<string>()
				for (const collection of next.collections) {
					valid.add(workspaceVisibilityKey(collection.id))
					for (const layer of collection.layers)
						valid.add(workspaceVisibilityKey(collection.id, layer.id))
				}
				for (const item of state.subscriptions) {
					valid.add(workspaceVisibilityKey(item.address, undefined, true))
					for (const layer of item.collection?.layers ?? [])
						valid.add(workspaceVisibilityKey(item.address, layer.id, true))
				}
				if (!valid.has(payload.key)) throw new Error('Unknown collection or layer visibility key')
				next.visibility[payload.key] = payload.visible
				break
			}
			case 'setGroupVisibility': {
				if (typeof payload.visible !== 'boolean') throw new Error('Invalid visibility preference')
				const local = next.collections.find((item) => item.id === payload.collectionId)
				const followed = state.subscriptions.find((item) => item.address === payload.collectionId)
				const collection = local ?? followed?.collection
				if (!collection?.groups.some((group) => group.id === payload.groupId))
					throw new Error('Unknown group')
				for (const layer of collection.layers)
					if (layer.groupId === payload.groupId)
						next.visibility[
							workspaceVisibilityKey(String(payload.collectionId), layer.id, !!followed)
						] = payload.visible
				break
			}
			case 'renameCollection':
			case 'addGroup':
			case 'renameGroup':
			case 'removeGroup':
			case 'saveLayer':
			case 'renameLayer':
			case 'moveLayer':
			case 'removeLayer': {
				const collection = ownerCollection(next, payload.collectionId)
				if (action === 'renameCollection') collection.name = text(payload.name)
				else if (action === 'addGroup') {
					if (collection.groups.length >= MAX_GROUPS) throw new Error('Group limit exceeded')
					collection.groups.push({ id: id(newId()), name: text(payload.name) })
				} else if (action === 'renameGroup' || action === 'removeGroup') {
					const group = collection.groups.find((item) => item.id === payload.groupId)
					if (!group) throw new Error('Unknown group')
					if (action === 'renameGroup') group.name = text(payload.name)
					else {
						collection.groups = collection.groups.filter((item) => item.id !== group.id)
						for (const layer of collection.layers)
							if (layer.groupId === group.id) layer.groupId = null
					}
				} else if (action === 'saveLayer') {
					if (payload.mode !== undefined && payload.mode !== 'replace' && payload.mode !== 'merge')
						throw new Error('Layer save mode must be replace or merge')
					const existing =
						payload.layerId === undefined
							? undefined
							: collection.layers.find((item) => item.id === payload.layerId)
					if (payload.layerId !== undefined && !existing) throw new Error('Unknown layer')
					if (!existing && collection.layers.length >= MAX_LAYERS)
						throw new Error('Layer limit exceeded')
					const incoming = validateMapletCollection(payload.collection)
					const layer: WorkspaceLayer = {
						id: existing?.id ?? id(newId()),
						name: text(payload.name ?? existing?.name),
						groupId:
							payload.groupId === undefined
								? (existing?.groupId ?? null)
								: payload.groupId === null
									? null
									: id(payload.groupId),
						collection:
							existing && payload.mode === 'merge'
								? mergeWorkspaceLayer(existing.collection, incoming)
								: incoming,
						recipe: payload.recipe === undefined ? existing?.recipe : metadata(payload.recipe),
						provenance:
							payload.provenance === undefined
								? existing?.provenance
								: metadata(payload.provenance),
						updatedAt: now(),
					}
					if (existing)
						collection.layers = collection.layers.map((item) =>
							item.id === existing.id ? layer : item,
						)
					else collection.layers.push(layer)
				} else {
					const layer = collection.layers.find((item) => item.id === payload.layerId)
					if (!layer) throw new Error('Unknown layer')
					if (action === 'renameLayer') layer.name = text(payload.name)
					if (action === 'moveLayer')
						layer.groupId = payload.groupId === null ? null : id(payload.groupId)
					if (action === 'removeLayer') {
						collection.layers = collection.layers.filter((item) => item.id !== layer.id)
						delete next.visibility[workspaceVisibilityKey(collection.id, layer.id)]
					}
				}
				collection.dirty = true
				next.collections = next.collections.map((item) =>
					item.id === collection.id ? normalizeCollection(collection, pubkey as string) : item,
				)
				break
			}
			default:
				throw new Error(`Unsupported workspace action: ${action}`)
		}
		persist(next, signal)
		for (const [address, stop] of subscriptions)
			if (!saved.subscriptions.some((item) => item.address === address)) {
				stop()
				subscriptions.delete(address)
				errors.delete(address)
			}
		for (const item of saved.subscriptions) connect(item.address)
		return clone(state)
	}
	return {
		getState: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		request,
		start: () => {
			if (lifecycle.signal.aborted) lifecycle = new AbortController()
			started = true
			for (const item of saved.subscriptions) connect(item.address)
		},
		stop: () => {
			started = false
			lifecycle.abort()
			for (const stop of subscriptions.values()) stop()
			subscriptions.clear()
		},
	}
}
