import type { Filter } from 'nostr-tools'
import { castEvent } from 'applesauce-core/casts'
import { useEffect, useMemo, useState } from 'react'
import { config } from '@/config'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/ndk/kinds'
import { eventStore, pool } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { MapContext } from '@/lib/nostr/map-context'

function castGeoDataset(event: Parameters<typeof castEvent>[0]) {
	return castEvent(event, GeoDataset, eventStore)
}

/**
 * Subscribe to GeoJSON dataset events (kind 37515) and surface them as
 * `GeoDataset` casts.
 */
export function useStations(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [GEO_EVENT_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const geoEvents = useMemo(() => {
		// EventStore already deduplicates and applies replaceable-event semantics,
		// so the timeline only contains the latest version per (kind:pubkey:d).
		return events.map((event) => castGeoDataset(event))
	}, [events])

	return {
		events: geoEvents,
		eose,
	}
}

export function useMapContexts(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [MAP_CONTEXT_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const contexts = useMemo(() => {
		return events.map((event) => castEvent(event, MapContext, eventStore))
	}, [events])

	return {
		events: contexts,
		eose,
	}
}

/**
 * Search-enabled stations hook. NIP-50: relays with `search` capability filter
 * server-side. Subscriptions go to `config.readRelays` (broader than write).
 */
export function useSearchStations(filter: Filter & { search?: string }, searchQuery: string) {
	const [events, setEvents] = useState<GeoDataset[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		setEvents([])
		setEose(false)

		const eventMap = new Map<string, GeoDataset>()
		const sub = pool
			.request(config.readRelays, filter)
			.subscribe({
				next: (event) => {
					const cast = castGeoDataset(event)
					if (!eventMap.has(cast.id)) {
						eventMap.set(cast.id, cast)
						setEvents(Array.from(eventMap.values()))
					}
				},
				complete: () => setEose(true),
				error: (err) => console.error('[useSearchStations] error', err),
			})

		return () => sub.unsubscribe()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchQuery])

	return { events, eose }
}

/**
 * Unified observer for geo dataset events with flexible client-side filtering.
 * Reads from `config.readRelays`; writes (if any) still go through `publish()`
 * with dev-safety routing.
 */
export function useStationsObserver(
	filterWithoutKinds: Omit<Filter, 'kinds'> = { limit: 50 },
	clientSideFilters?: {
		hashtags?: string[]
		relayHints?: string[]
		collectionIds?: string[]
	},
) {
	const [allEvents, setAllEvents] = useState<GeoDataset[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		const filter = {
			...filterWithoutKinds,
			kinds: [GEO_EVENT_KIND],
		}

		setAllEvents([])
		setEose(false)

		const eventMap = new Map<string, GeoDataset>()
		const sub = pool
			.request(config.readRelays, filter)
			.subscribe({
				next: (event) => {
					const cast = castGeoDataset(event)
					if (!eventMap.has(cast.id)) {
						eventMap.set(cast.id, cast)
						setAllEvents(Array.from(eventMap.values()))
					}
				},
				complete: () => setEose(true),
				error: (err) => console.error('[useStationsObserver] error', err),
			})

		return () => sub.unsubscribe()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [JSON.stringify(filterWithoutKinds)])

	const filteredEvents = useMemo(() => {
		if (!clientSideFilters) return allEvents
		const { hashtags, relayHints, collectionIds } = clientSideFilters
		return allEvents.filter((event) => {
			if (hashtags && hashtags.length > 0) {
				const eventTags = event.hashtags.map((tag) => tag.toLowerCase())
				const matchesHashtag = hashtags.some((needle) => eventTags.includes(needle.toLowerCase()))
				if (!matchesHashtag) return false
			}
			if (relayHints && relayHints.length > 0) {
				const eventRelays = event.relayHints.map((relay) => relay.toLowerCase())
				const matchesRelay = relayHints.some((needle) => eventRelays.includes(needle.toLowerCase()))
				if (!matchesRelay) return false
			}
			if (collectionIds && collectionIds.length > 0) {
				const references = event.collectionReferences.map((ref) => ref.toLowerCase())
				const matchesCollection = collectionIds.some((needle) =>
					references.includes(needle.toLowerCase()),
				)
				if (!matchesCollection) return false
			}
			return true
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [allEvents, JSON.stringify(clientSideFilters)])

	return {
		events: filteredEvents,
		eose,
	}
}
