import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { useNDK } from '@nostr-dev-kit/react'
import { castEvent } from 'applesauce-core/casts'
import { useEffect, useMemo, useState } from 'react'
import { eventStore } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
import { NDKMapContextEvent } from '../ndk/NDKMapContextEvent'

function castGeoDataset(event: { id: string; kind: number; tags: string[][]; pubkey: string; content: string; created_at: number; sig: string }) {
	return castEvent(event as Parameters<typeof castEvent>[0], GeoDataset, eventStore)
}

/**
 * Subscribe to GeoJSON dataset events (kind 37515) and surface them as
 * `GeoDataset` casts.
 */
export function useStations(additionalFilters: Omit<NDKFilter, 'kinds'>[] = [{}]) {
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

export function useMapContexts(additionalFilters: Omit<NDKFilter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: NDKMapContextEvent.kinds,
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const contexts = useMemo(() => {
		const result: NDKMapContextEvent[] = []
		for (const event of events) {
			// Until kind 37518 is migrated to applesauce, wrap the raw event
			// in the legacy NDKMapContextEvent class. The class methods that
			// touch NDK (publish, sign) still work via the ndk-bridge.
			const wrapped = NDKMapContextEvent.from(event as never)
			result.push(wrapped)
		}
		return result
	}, [events])

	return {
		events: contexts,
		eose,
	}
}

/**
 * A hook for searching geo events with proper subscription management.
 * Handles dynamic search queries by restarting subscriptions when the search
 * changes. Still uses the legacy NDK pool because NIP-50 search via applesauce
 * relays is layered on the same protocol; that migration happens in Step 3.3.
 */
export function useSearchStations(filter: NDKFilter, searchQuery: string) {
	const { ndk } = useNDK()
	const [events, setEvents] = useState<GeoDataset[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		if (!ndk) return

		setEvents([])
		setEose(false)

		// biome-ignore lint/suspicious/noExplicitAny: legacy NDK subscription path; will be replaced in Step 3.3
		const sub = ndk.subscribe(filter as any, { closeOnEose: false })
		const eventMap = new Map<string, GeoDataset>()

		// biome-ignore lint/suspicious/noExplicitAny: NDK provides untyped event payloads
		sub.on('event', (event: any) => {
			const cast = castGeoDataset(event.rawEvent ? event.rawEvent() : event)
			if (!eventMap.has(cast.id)) {
				eventMap.set(cast.id, cast)
				setEvents(Array.from(eventMap.values()))
			}
		})

		sub.on('eose', () => {
			console.log('✅ EOSE - Total datasets:', eventMap.size)
			setEose(true)
		})

		return () => {
			sub.stop()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ndk, searchQuery])

	return {
		events,
		eose,
	}
}

/**
 * Unified observer for geo dataset events with flexible client-side filtering.
 * Same caveat as `useSearchStations` regarding the NDK pool — Step 3.3 swap.
 */
export function useStationsObserver(
	filterWithoutKinds: Omit<NDKFilter, 'kinds'> = { limit: 50 },
	clientSideFilters?: {
		hashtags?: string[]
		relayHints?: string[]
		collectionIds?: string[]
	},
) {
	const { ndk } = useNDK()
	const [allEvents, setAllEvents] = useState<GeoDataset[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		if (!ndk) return

		const filter = {
			...filterWithoutKinds,
			kinds: [GEO_EVENT_KIND],
		}

		setAllEvents([])
		setEose(false)

		// biome-ignore lint/suspicious/noExplicitAny: legacy NDK subscription path; will be replaced in Step 3.3
		const sub = ndk.subscribe(filter as any, { closeOnEose: false })
		const eventMap = new Map<string, GeoDataset>()

		// biome-ignore lint/suspicious/noExplicitAny: NDK provides untyped event payloads
		sub.on('event', (event: any) => {
			const cast = castGeoDataset(event.rawEvent ? event.rawEvent() : event)
			if (!eventMap.has(cast.id)) {
				eventMap.set(cast.id, cast)
				setAllEvents(Array.from(eventMap.values()))
			}
		})

		sub.on('eose', () => {
			console.log('✅ EOSE - Total:', eventMap.size)
			setEose(true)
		})

		return () => {
			sub.stop()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ndk, JSON.stringify(filterWithoutKinds)])

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
