import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { useNDK, useSubscribe, wrapEvent } from '@nostr-dev-kit/react'
import { useEffect, useMemo, useState } from 'react'
import { NDKGeoEvent } from '../ndk/NDKGeoEvent'
import { NDKMapContextEvent } from '../ndk/NDKMapContextEvent'

/**
 * Subscribe to GeoJSON dataset events (kind 37515) and wrap them into our custom NDKGeoEvent class.
 *
 * @param additionalFilters - Optional additional NDK filters to apply (limit, authors, etc.)
 * @returns Object containing the geo events array and end-of-stream status
 */
export function useStations(additionalFilters: Omit<NDKFilter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: NDKGeoEvent.kinds,
	}))

	const { events, eose } = useSubscribe(filters)
	const geoEvents = useMemo(() => {
		const latestByCoordinate = new Map<string, NDKGeoEvent>()

		for (const event of events) {
			const maybeWrapped = wrapEvent(event)
			if (maybeWrapped instanceof Promise) continue
			const wrapped =
				maybeWrapped instanceof NDKGeoEvent ? maybeWrapped : NDKGeoEvent.from(maybeWrapped)

			const datasetId = wrapped.datasetId ?? wrapped.dTag
			const coordinate =
				datasetId && wrapped.pubkey
					? `${wrapped.kind ?? NDKGeoEvent.kinds[0]}:${wrapped.pubkey}:${datasetId}`
					: `${wrapped.kind ?? NDKGeoEvent.kinds[0]}:${wrapped.pubkey ?? ''}:${
							wrapped.id ?? wrapped.created_at ?? ''
						}`

			const existing = latestByCoordinate.get(coordinate)
			if (!existing) {
				latestByCoordinate.set(coordinate, wrapped)
				continue
			}

			const existingCreatedAt = existing.created_at ?? 0
			const wrappedCreatedAt = wrapped.created_at ?? 0
			if (wrappedCreatedAt > existingCreatedAt) {
				latestByCoordinate.set(coordinate, wrapped)
				continue
			}

			if (wrappedCreatedAt === existingCreatedAt) {
				const existingId = existing.id ?? ''
				const wrappedId = wrapped.id ?? ''
				if (wrappedId > existingId) {
					latestByCoordinate.set(coordinate, wrapped)
				}
			}
		}

		return Array.from(latestByCoordinate.values()).sort((a, b) => {
			const createdDiff = (b.created_at ?? 0) - (a.created_at ?? 0)
			if (createdDiff !== 0) return createdDiff
			return (b.id ?? '').localeCompare(a.id ?? '')
		})
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

	const { events, eose } = useSubscribe(filters)
	const contexts = useMemo(() => {
		const latestByCoordinate = new Map<string, NDKMapContextEvent>()

		for (const event of events) {
			const maybeWrapped = wrapEvent(event)
			if (maybeWrapped instanceof Promise) continue
			const wrapped =
				maybeWrapped instanceof NDKMapContextEvent
					? maybeWrapped
					: NDKMapContextEvent.from(maybeWrapped)

			const contextId = wrapped.contextId ?? wrapped.dTag
			const coordinate =
				contextId && wrapped.pubkey
					? `${wrapped.kind ?? NDKMapContextEvent.kinds[0]}:${wrapped.pubkey}:${contextId}`
					: `${wrapped.kind ?? NDKMapContextEvent.kinds[0]}:${wrapped.pubkey ?? ''}:${
							wrapped.id ?? wrapped.created_at ?? ''
						}`

			const existing = latestByCoordinate.get(coordinate)
			if (!existing) {
				latestByCoordinate.set(coordinate, wrapped)
				continue
			}

			const existingCreatedAt = existing.created_at ?? 0
			const wrappedCreatedAt = wrapped.created_at ?? 0
			if (wrappedCreatedAt > existingCreatedAt) {
				latestByCoordinate.set(coordinate, wrapped)
				continue
			}

			if (wrappedCreatedAt === existingCreatedAt) {
				const existingId = existing.id ?? ''
				const wrappedId = wrapped.id ?? ''
				if (wrappedId > existingId) {
					latestByCoordinate.set(coordinate, wrapped)
				}
			}
		}

		return Array.from(latestByCoordinate.values())
	}, [events])

	return {
		events: contexts,
		eose,
	}
}

/**
 * A hook for searching geo events with proper subscription management.
 * Handles dynamic search queries by restarting subscriptions when the search changes.
 *
 * @param filter - NDK filter (should include kinds, limit, and optional search)
 * @param searchQuery - The search query string to track for re-subscription
 * @returns Object containing the NDKGeoEvent array and end-of-stream status
 */
export function useSearchStations(filter: NDKFilter, searchQuery: string) {
	const { ndk } = useNDK()
	const [events, setEvents] = useState<NDKGeoEvent[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		if (!ndk) return

		setEvents([])
		setEose(false)

		const sub = ndk.subscribe(filter as any, { closeOnEose: false })
		const eventMap = new Map<string, NDKGeoEvent>()

		sub.on('event', (event: any) => {
			const station = NDKGeoEvent.from(event)
			if (!eventMap.has(station.id)) {
				eventMap.set(station.id, station)
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
	}, [ndk, searchQuery])

	return {
		events,
		eose,
	}
}

/**
 * A unified hook for geo events with flexible filtering.
 * Uses manual subscription management for reliable NIP-50 search support.
 * Automatically restarts subscription when the filter changes.
 *
 * This is the recommended hook for search-enabled station views.
 *
 * @param filterWithoutKinds - NDK filter without kinds (kinds is hardcoded to station kind 31237)
 * @param clientSideFilters - Optional client-side filters for hashtags, relay hints and collections
 * @returns Object containing the NDKGeoEvent array and EOSE status
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
	const [allEvents, setAllEvents] = useState<NDKGeoEvent[]>([])
	const [eose, setEose] = useState(false)

	useEffect(() => {
		if (!ndk) return

		// Build complete filter with hardcoded geo dataset kinds
		const filter: NDKFilter = {
			...filterWithoutKinds,
			kinds: NDKGeoEvent.kinds,
		}

		// Reset state
		setAllEvents([])
		setEose(false)

		const sub = ndk.subscribe(filter, { closeOnEose: false })
		const eventMap = new Map<string, NDKGeoEvent>()

		sub.on('event', (event: any) => {
			const station = NDKGeoEvent.from(event)
			if (!eventMap.has(station.id)) {
				eventMap.set(station.id, station)
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
	}, [ndk, JSON.stringify(filterWithoutKinds)]) // Stringify to detect deep changes

	// Apply client-side filters
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
	}, [allEvents, JSON.stringify(clientSideFilters)])

	return {
		events: filteredEvents,
		eose,
	}
}
