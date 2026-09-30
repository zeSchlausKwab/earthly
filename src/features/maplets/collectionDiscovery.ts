import { nip19, type Filter, type NostrEvent } from 'nostr-tools'
import { MAPLET_LIMITS } from '@/lib/maplets/collection'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { parseWorkspaceAddress, parseWorkspaceEvent } from './workspace'

export const MAPLET_COLLECTION_TAG = 'maplet-collection'
export const MAPLET_DISCOVERY_PAGE_SIZE = 100
export const MAPLET_DISCOVERY_LIMIT = 500

export interface MapletCollectionSummary {
	address: string
	naddr: string
	eventId: string
	pubkey: string
	name: string
	groups: string[]
	layers: string[]
	featureCount: number
	/** Nostr timestamp, in seconds. */
	updatedAt: number
}

const summaryCache = new WeakMap<
	NostrEvent,
	{
		id: string
		pubkey: string
		kind: number
		createdAt: number
		content: string
		sig: string
		tags: string
		summary: MapletCollectionSummary
	}
>()

function matchesCollectionFilter(event: NostrEvent): boolean {
	return (
		Boolean(event) &&
		event.kind === GEO_EVENT_KIND &&
		Array.isArray(event.tags) &&
		event.tags.some(
			(tag) => Array.isArray(tag) && tag[0] === 't' && tag[1] === MAPLET_COLLECTION_TAG,
		)
	)
}

/** A discovery tag alone never grants a dataset collection/follow controls. */
export function parseMapletCollectionSummary(event: NostrEvent): MapletCollectionSummary | null {
	try {
		if (
			!matchesCollectionFilter(event) ||
			typeof event.content !== 'string' ||
			event.content.length > MAPLET_LIMITS.bytes ||
			!Array.isArray(event.tags) ||
			event.tags.length > 10_000
		)
			return null
		const tags = JSON.stringify(event.tags)
		const cached = summaryCache.get(event)
		if (
			cached &&
			cached.id === event.id &&
			cached.pubkey === event.pubkey &&
			cached.kind === event.kind &&
			cached.createdAt === event.created_at &&
			cached.content === event.content &&
			cached.sig === event.sig &&
			cached.tags === tags
		)
			return cached.summary
		const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
		const address = parseWorkspaceAddress(`${GEO_EVENT_KIND}:${event.pubkey}:${identifier ?? ''}`)
		const collection = parseWorkspaceEvent(event, address)
		const summary = {
			address: address.address,
			naddr: address.naddr,
			eventId: event.id,
			pubkey: event.pubkey,
			name: collection.name,
			groups: collection.groups.map((group) => group.name),
			layers: collection.layers.map((layer) => layer.name),
			featureCount: collection.layers.reduce(
				(count, layer) => count + layer.collection.features.length,
				0,
			),
			updatedAt: event.created_at,
		}
		// Content strings are immutable; retaining this reference avoids copying a
		// 5 MiB snapshot for every card render. Check all signed fields before reuse.
		summaryCache.set(event, {
			id: event.id,
			pubkey: event.pubkey,
			kind: event.kind,
			createdAt: event.created_at,
			content: event.content,
			sig: event.sig,
			tags,
			summary,
		})
		return summary
	} catch {
		return null
	}
}

export function compareMapletCollections(
	a: MapletCollectionSummary,
	b: MapletCollectionSummary,
): number {
	return b.updatedAt - a.updatedAt || a.eventId.localeCompare(b.eventId)
}

/** Search the verified names, full author key, npub, or shared collection address. */
export function filterMapletCollections(
	collections: MapletCollectionSummary[],
	search: string,
): MapletCollectionSummary[] {
	const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
	if (!terms.length) return collections
	return collections.filter((collection) => {
		const haystack = [
			collection.name,
			...collection.groups,
			...collection.layers,
			collection.pubkey,
			nip19.npubEncode(collection.pubkey),
			collection.address,
			collection.naddr,
		]
			.join(' ')
			.toLocaleLowerCase()
		return terms.every((term) => haystack.includes(term))
	})
}

export interface MapletCollectionDiscoveryState {
	collections: MapletCollectionSummary[]
	loading: boolean
	error: string | null
	hasMore: boolean
}

export interface MapletDiscoveryDependencies {
	relays(): string[]
	hydrate(filter: Filter): Promise<NostrEvent[]>
	watchLocal(
		filter: Filter,
		receive: (events: NostrEvent[]) => void,
		remove: (event: NostrEvent) => void,
	): () => void
	isDeleted?(event: NostrEvent): boolean
	/** Transport reports EOSE separately from ERROR/CLOSED and stays live after EOSE. */
	listen(
		filter: Filter,
		relays: string[],
		callbacks: {
			event(event: NostrEvent, relay: string): void
			done(relay: string, failed: boolean): void
			error(): void
		},
	): () => void
	add(event: NostrEvent): void
}

/** Bounded catalog state independent of React, the browser, and native transports. */
export function createMapletCollectionDiscovery(deps: MapletDiscoveryDependencies) {
	const listeners = new Set<() => void>()
	const entries = new Map<string, MapletCollectionSummary>()
	let state: MapletCollectionDiscoveryState = {
		collections: [],
		loading: false,
		error: null,
		hasMore: false,
	}
	let requested = MAPLET_DISCOVERY_PAGE_SIZE
	let generation = 0
	let active = false
	let cancel = () => {}

	function notify(patch: Partial<MapletCollectionDiscoveryState>) {
		state = { ...state, ...patch }
		for (const listener of listeners) listener()
	}
	function accept(event: NostrEvent): boolean {
		if (
			!matchesCollectionFilter(event) ||
			deps.isDeleted?.(event) ||
			typeof event.content !== 'string' ||
			event.content.length > MAPLET_LIMITS.bytes
		)
			return false
		const summary = parseMapletCollectionSummary(event)
		if (!summary) return false
		const current = entries.get(summary.address)
		if (current && compareMapletCollections(summary, current) >= 0) return true
		entries.set(summary.address, summary)
		const collections = [...entries.values()]
			.sort(compareMapletCollections)
			.slice(0, MAPLET_DISCOVERY_LIMIT)
		const retained = new Set(collections.map((item) => item.address))
		for (const address of entries.keys()) if (!retained.has(address)) entries.delete(address)
		notify({ collections })
		return true
	}

	function open() {
		cancel()
		const session = ++generation
		const isActive = () => active && session === generation
		const relays = [...new Set(deps.relays())]
		const filter: Filter = {
			kinds: [GEO_EVENT_KIND],
			'#t': [MAPLET_COLLECTION_TAG],
			limit: requested,
		}
		const completed = new Set<string>()
		const failed = new Set<string>()
		const received = new Map<string, Set<string>>()
		let cacheFailed = false
		let expired = false
		let cacheCount = 0
		notify({
			loading: relays.length > 0,
			error: relays.length ? null : 'No discovery relays are configured.',
			hasMore: false,
		})
		const update = () => {
			if (!isActive()) return
			const pending = relays.some((relay) => !completed.has(relay))
			let error: string | null = null
			if (!relays.length) error = 'No discovery relays are configured.'
			else if (failed.size === relays.length)
				error =
					'The configured relays could not be reached. Showing any cached collections; retry discovery when connected.'
			else if (failed.size)
				error =
					'Some configured relays could not be reached. The collection list may be incomplete.'
			else if (expired && pending)
				error =
					'Some relays have not finished responding. Showing available collections and continuing to listen.'
			else if (cacheFailed)
				error = 'The local cache is unavailable. Collections are being read from relays.'
			notify({
				loading: pending && !expired,
				error,
				hasMore:
					requested < MAPLET_DISCOVERY_LIMIT &&
					(cacheCount >= requested || [...received.values()].some((ids) => ids.size >= requested)),
			})
		}
		const local = deps.watchLocal(
			filter,
			(events) => {
				if (!isActive()) return
				cacheCount = Math.max(cacheCount, events.length)
				for (const event of events) accept(event)
				update()
			},
			(event) => {
				if (!isActive()) return
				for (const [address, entry] of entries)
					if (entry.eventId === event.id) entries.delete(address)
				notify({ collections: [...entries.values()].sort(compareMapletCollections) })
			},
		)
		void deps
			.hydrate(filter)
			.then((events) => {
				if (!isActive()) return
				cacheCount = Math.max(cacheCount, events.length)
				for (const event of events) if (accept(event)) deps.add(event)
				update()
			})
			.catch(() => {
				cacheFailed = true
				update()
			})
		const live = relays.length
			? deps.listen(filter, relays, {
					event(event, relay) {
						if (!isActive() || !matchesCollectionFilter(event)) return
						let ids = received.get(relay)
						if (!ids) {
							ids = new Set()
							received.set(relay, ids)
						}
						if (ids.size < requested) ids.add(event.id)
						if (accept(event)) deps.add(event)
						update()
					},
					done(relay, didFail) {
						if (!isActive()) return
						completed.add(relay)
						if (didFail) failed.add(relay)
						else failed.delete(relay)
						update()
					},
					error() {
						if (!isActive()) return
						for (const relay of relays) {
							completed.add(relay)
							failed.add(relay)
						}
						update()
					},
				})
			: () => {}
		const timeout = setTimeout(() => {
			expired = true
			update()
		}, 15_000)
		cancel = () => {
			clearTimeout(timeout)
			local()
			live()
		}
	}

	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		start() {
			if (!active) {
				active = true
				open()
			}
		},
		stop() {
			active = false
			++generation
			cancel()
			notify({ loading: false })
		},
		refresh() {
			if (active) open()
		},
		// Growing a bounded recent window avoids skipping collections that share
		// the same timestamp at a pagination boundary (Nostr `until` is inclusive).
		loadMore() {
			if (!active || state.loading || !state.hasMore) return
			requested = Math.min(requested + MAPLET_DISCOVERY_PAGE_SIZE, MAPLET_DISCOVERY_LIMIT)
			open()
		},
	}
}
