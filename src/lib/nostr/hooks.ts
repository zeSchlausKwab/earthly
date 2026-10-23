/**
 * React hooks layered on the applesauce singletons.
 *
 * These exist to keep call sites concise and to encapsulate the
 * "subscribe-then-read-from-store" pattern that applesauce uses.
 */

import { use$, useActiveAccount } from 'applesauce-react/hooks'
import type { Filter, NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { eventStore, pool, queryCache, relayAuthOptions, relayLiveness } from './index'
import { filterRequestKey } from './filterGuards'
import { startLiveTimelineSubscription } from './liveTimeline'
import { createSharedTimelines, EMPTY_TIMELINE_STATUS, type TimelineStatus } from './sharedTimeline'
import { bucketForKind, readRelaysFor } from './relay-router'

/** Shared cache hydration and live transport with explicit completeness. */
const subscribeTimeline = createSharedTimelines({
	start: (options) =>
		startLiveTimelineSubscription({
			...options,
			pool,
			store: eventStore,
			liveness: relayLiveness,
			auth: relayAuthOptions,
		}),
	hydrate: (filters) => queryCache(filters),
	add: (event) => eventStore.add(event),
})

function filtersFromKey(filterKey: string | null): Filter | Filter[] | null {
	return filterKey ? (JSON.parse(filterKey) as Filter | Filter[]) : null
}

function relaysFromKey(relayKey: string): string[] {
	return relayKey ? relayKey.split(',').filter(Boolean) : []
}

/**
 * Default relay set for a subscription, derived from the filter kinds via the
 * relay router. Filters without kinds are treated as content — the bucket
 * that stays on the local relay in dev. Evaluated when the filters change;
 * flipping a dev relay flag applies to newly-mounted subscriptions.
 */
function defaultRelaysForFilters(filters: Filter | Filter[] | null): string[] {
	if (!filters) return readRelaysFor('content')
	const kinds = (Array.isArray(filters) ? filters : [filters]).flatMap((f) => f.kinds ?? [])
	const buckets =
		kinds.length > 0 ? new Set(kinds.map(bucketForKind)) : new Set(['content'] as const)
	const relays = [...buckets].flatMap((bucket) => readRelaysFor(bucket))
	return relays.filter((url, index) => relays.indexOf(url) === index)
}

/**
 * Subscribe to a filter on the relay pool, ingest events into the EventStore,
 * and return the live timeline matching that filter.
 *
 * Two-stage flow:
 *   1. Effect subscription via `high-level relay subscriptions` → events flow into the
 *      EventStore (deduplicated, replaceable handling automatic).
 *   2. Reactive read via `eventStore.timeline` → component re-renders on
 *      additions, replacements, or deletions.
 *
 * Pass `null` filters to skip the subscription entirely (useful for guards
 * like "wait for an address before subscribing").
 *
 * `relays` defaults to the router-derived set for the filter kinds: content
 * subscriptions stay on the local relay in dev while profile/wallet kinds may
 * read from public relays (see relay-router.ts).
 */
export function useTimeline(filters: Filter | Filter[] | null, relays?: string[]): NostrEvent[] {
	const account = useActiveAccount()
	const filterKey = useMemo(() => filterRequestKey(filters), [filters])
	const relayKey = useMemo(
		() => (relays ?? defaultRelaysForFilters(filtersFromKey(filterKey))).join(','),
		[relays, filterKey],
	)

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined

		const activeRelays = relaysFromKey(relayKey)
		return subscribeTimeline(activeFilters, activeRelays, undefined, account?.id)
	}, [filterKey, relayKey, account?.id])

	const events = use$(() => {
		// TimelineModel already emits a fresh array instance per change — no
		// extra copy needed for React identity checks.
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined
		return eventStore.timeline(activeFilters)
	}, [filterKey])

	return events ?? []
}

/** Read events and explicit load status. `eose` is retained as the legacy
 * presentation-settled flag. Use status.complete for synchronization gates. */
export function useTimelineWithEose(
	filters: Filter | Filter[] | null,
	relays?: string[],
): { events: NostrEvent[]; eose: boolean; status: TimelineStatus } {
	const account = useActiveAccount()
	const filterKey = useMemo(() => filterRequestKey(filters), [filters])
	const relayKey = useMemo(
		() => (relays ?? defaultRelaysForFilters(filtersFromKey(filterKey))).join(','),
		[relays, filterKey],
	)
	const stateKey = JSON.stringify([filterKey, relayKey, account?.id])
	const [snapshot, setSnapshot] = useState<{ key: string; status: TimelineStatus }>()
	const status = !filterKey
		? EMPTY_TIMELINE_STATUS
		: snapshot?.key === stateKey
			? snapshot.status
			: {
					state: 'loading' as const,
					cache: 'loading' as const,
					relays: {},
					settled: false,
					complete: false,
				}

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) {
			return undefined
		}

		const activeRelays = relaysFromKey(relayKey)
		return subscribeTimeline(
			activeFilters,
			activeRelays,
			(status) => setSnapshot({ key: stateKey, status }),
			account?.id,
		)
	}, [filterKey, relayKey, stateKey, account?.id])

	const events = use$(() => {
		// TimelineModel already emits a fresh array instance per change.
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined
		return eventStore.timeline(activeFilters)
	}, [filterKey])

	return { events: events ?? [], eose: status.settled, status }
}

if (import.meta.hot) import.meta.hot.dispose(() => subscribeTimeline.stop())
