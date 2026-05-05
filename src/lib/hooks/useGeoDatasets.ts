/**
 * Reactive subscriptions to GeoJSON dataset events (kind 37515) and Map
 * Context events (kind 37518), surfaced as applesauce casts.
 *
 * Both hooks are thin wrappers around `useTimelineWithEose` + `castEvent` that
 * apply the right kind and adapt to the Earthly cast classes.
 */

import { castEvent } from 'applesauce-core/casts'
import type { Filter } from 'nostr-tools'
import { useMemo } from 'react'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { eventStore } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { MapContext } from '@/lib/nostr/map-context'

/**
 * Subscribe to GeoJSON dataset events (kind 37515).
 *
 * The EventStore handles deduplication and replaceable-event semantics, so
 * the returned timeline contains the latest version per `(kind, pubkey, d)`.
 */
export function useGeoDatasets(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [GEO_EVENT_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const datasets = useMemo(
		() => events.map((event) => castEvent(event, GeoDataset, eventStore)),
		[events],
	)

	return { events: datasets, eose }
}

/** Subscribe to Map Context events (kind 37518). */
export function useMapContexts(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [MAP_CONTEXT_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const contexts = useMemo(
		() => events.map((event) => castEvent(event, MapContext, eventStore)),
		[events],
	)

	return { events: contexts, eose }
}
