import { use$ } from 'applesauce-react/hooks'
import type { Filter } from 'nostr-tools'
import { useEffect } from 'react'
import { eventStore } from '@/lib/nostr'
import { filterRequestKey } from '@/lib/nostr/filterGuards'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { catalogWindows, useCatalogWindow } from '@/lib/nostr/catalogWindow'

/** Bound only the broad discovery request, never the local read or targeted refs. */
export function useCatalogTimeline(kind: number, additionalFilters: Omit<Filter, 'kinds'>[] | null) {
	const window = useCatalogWindow(kind)
	const broad = additionalFilters?.length === 1 && Object.keys(additionalFilters[0]!).length === 0
	const filters = additionalFilters?.map(filter => ({ ...filter, kinds: [kind] })) ?? null
	const requestFilters = broad && window.limit !== null ? [{ kinds: [kind], limit: window.limit }] : filters
	const { events: requested, eose } = useTimelineWithEose(requestFilters)
	const key = filterRequestKey(filters)
	// Targeted deep links and earlier pages remain visible even outside the latest window.
	const events = use$(() => key ? eventStore.timeline(JSON.parse(key) as Filter[]) : undefined, [key])
	useEffect(() => {
		if (broad) catalogWindows.settled(kind, window.limit, requested.length, eose)
	}, [broad, kind, window.limit, requested.length, eose])
	return { events: events ?? [], eose }
}
