import type { NDKFilter } from '@nostr-dev-kit/ndk';
import { useNDK, useSubscribe, wrapEvent } from '@nostr-dev-kit/react';
import { useEffect, useMemo, useState } from 'react';
import { NDKGeoCollectionEvent } from '../ndk/NDKGeoCollectionEvent';
import { NDKGeoEvent } from '../ndk/NDKGeoEvent';

/**
 * Subscribe to GeoJSON dataset events (kind 31991) and wrap them into our custom NDKGeoEvent class.
 *
 * @param additionalFilters - Optional additional NDK filters to apply (limit, authors, etc.)
 * @returns Object containing the geo events array and end-of-stream status
 */
export function useStations(additionalFilters: Omit<NDKFilter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: NDKGeoEvent.kinds
	}));

	const { events, eose } = useSubscribe(filters);
	const geoEvents = events.map((event) => wrapEvent(event) as NDKGeoEvent);

	return {
		events: geoEvents,
		eose
	};
}

export function useGeoCollections(additionalFilters: Omit<NDKFilter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: NDKGeoCollectionEvent.kinds
	}));

	const { events, eose } = useSubscribe(filters);
	const collections = events.map((event) => wrapEvent(event) as NDKGeoCollectionEvent);

	return {
		events: collections,
		eose
	};
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
	const { ndk } = useNDK();
	const [events, setEvents] = useState<NDKGeoEvent[]>([]);
	const [eose, setEose] = useState(false);

	useEffect(() => {
		if (!ndk) return;

		setEvents([]);
		setEose(false);

		const sub = ndk.subscribe(filter as any, { closeOnEose: false });
		const eventMap = new Map<string, NDKGeoEvent>();

		sub.on('event', (event: any) => {
			const station = NDKGeoEvent.from(event);
			if (!eventMap.has(station.id)) {
				eventMap.set(station.id, station);
				setEvents(Array.from(eventMap.values()));
			}
		});

		sub.on('eose', () => {
			console.log('✅ EOSE - Total datasets:', eventMap.size);
			setEose(true);
		});

		return () => {
			sub.stop();
		};
	}, [ndk, searchQuery]);

	return {
		events,
		eose
	};
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
		hashtags?: string[];
		relayHints?: string[];
		collectionIds?: string[];
	}
) {
	const { ndk } = useNDK();
	const [allEvents, setAllEvents] = useState<NDKGeoEvent[]>([]);
	const [eose, setEose] = useState(false);

	useEffect(() => {
		if (!ndk) return;

		// Build complete filter with hardcoded geo dataset kinds
		const filter: NDKFilter = {
			...filterWithoutKinds,
			kinds: NDKGeoEvent.kinds
		};

		// Reset state
		setAllEvents([]);
		setEose(false);

		const sub = ndk.subscribe(filter, { closeOnEose: false });
		const eventMap = new Map<string, NDKGeoEvent>();

		sub.on('event', (event: any) => {
			const station = NDKGeoEvent.from(event);
			if (!eventMap.has(station.id)) {
				eventMap.set(station.id, station);
				setAllEvents(Array.from(eventMap.values()));
			}
		});

		sub.on('eose', () => {
			console.log('✅ EOSE - Total:', eventMap.size);
			setEose(true);
		});

		return () => {
			sub.stop();
		};
	}, [ndk, JSON.stringify(filterWithoutKinds)]); // Stringify to detect deep changes

	// Apply client-side filters
	const filteredEvents = useMemo(() => {
		if (!clientSideFilters) return allEvents;

		const { hashtags, relayHints, collectionIds } = clientSideFilters;

		return allEvents.filter((event) => {
			if (hashtags && hashtags.length > 0) {
				const eventTags = event.hashtags.map((tag) => tag.toLowerCase());
				const matchesHashtag = hashtags.some((needle) => eventTags.includes(needle.toLowerCase()));
				if (!matchesHashtag) return false;
			}

			if (relayHints && relayHints.length > 0) {
				const eventRelays = event.relayHints.map((relay) => relay.toLowerCase());
				const matchesRelay = relayHints.some((needle) => eventRelays.includes(needle.toLowerCase()));
				if (!matchesRelay) return false;
			}

			if (collectionIds && collectionIds.length > 0) {
				const references = event.collectionReferences.map((ref) => ref.toLowerCase());
				const matchesCollection = collectionIds.some((needle) => references.includes(needle.toLowerCase()));
				if (!matchesCollection) return false;
			}

			return true;
		});
	}, [allEvents, JSON.stringify(clientSideFilters)]);

	return {
		events: filteredEvents,
		eose
	};
}
