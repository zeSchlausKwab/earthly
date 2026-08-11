/**
 * React hooks layered on the applesauce singletons.
 *
 * These exist to keep call sites concise and to encapsulate the
 * "subscribe-then-read-from-store" pattern that applesauce uses.
 */

import { use$ } from 'applesauce-react/hooks'
import type { Filter, NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { eventStore, pool, queryCache } from './index'
import { filterList, filterRequestKey } from './filterGuards'
import { startLiveTimelineSubscription } from './liveTimeline'
import { bucketForKind, readRelaysFor } from './relay-router'

/**
 * Upper bound for waiting on relay EOSE signals. A single dead or slow relay
 * must not hold "loading" states hostage — after this, we report eose anyway
 * and let late events stream in.
 */
const EOSE_TIMEOUT_MS = 4_000

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
 *   1. Effect subscription via `pool.req` → events flow into the
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
	const filterKey = useMemo(() => filterRequestKey(filters), [filters])
	const relayKey = useMemo(
		() => (relays ?? defaultRelaysForFilters(filtersFromKey(filterKey))).join(','),
		[relays, filterKey],
	)

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined

		const activeRelays = relaysFromKey(relayKey)
		return startLiveTimelineSubscription({
			pool,
			store: eventStore,
			relays: activeRelays,
			filters: activeFilters,
		})
	}, [filterKey, relayKey])

	const events = use$(() => {
		// TimelineModel already emits a fresh array instance per change — no
		// extra copy needed for React identity checks.
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined
		return eventStore.timeline(activeFilters)
	}, [filterKey])

	return events ?? []
}

/**
 * Like `useTimeline`, but also reports whether all subscribed relays have
 * signalled EOSE. Useful for "Loading…" indicators.
 *
 * Internally uses `pool.req` to receive typed REQ messages so we can count
 * EOSE per relay; this is more involved than `subscription` which only emits
 * NostrEvents.
 *
 * `relays` defaults to the router-derived set for the filter kinds (see
 * `useTimeline`).
 */
export function useTimelineWithEose(
	filters: Filter | Filter[] | null,
	relays?: string[],
): { events: NostrEvent[]; eose: boolean } {
	const filterKey = useMemo(() => filterRequestKey(filters), [filters])
	const relayKey = useMemo(
		() => (relays ?? defaultRelaysForFilters(filtersFromKey(filterKey))).join(','),
		[relays, filterKey],
	)
	const [eose, setEose] = useState(() => filterKey === null)

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) {
			setEose(true)
			return undefined
		}

		const activeRelays = relaysFromKey(relayKey)
		if (activeRelays.length === 0) {
			setEose(true)
			return undefined
		}

		setEose(false)

		// Hydrate matching events from the IndexedDB cache so the timeline renders
		// instantly on reload; relay events stream in on top and deduplicate.
		let cancelled = false
		void queryCache(filterList(activeFilters)).then((cached) => {
			if (cancelled) return
			for (const event of cached) eventStore.add(event)
		})

		const eoseTimeout = setTimeout(() => setEose(true), EOSE_TIMEOUT_MS)

		const doneRelays = new Set<string>()
		const stopSubscription = startLiveTimelineSubscription({
			pool,
			store: eventStore,
			relays: activeRelays,
			filters: activeFilters,
			onRelayDone: (relay) => {
				doneRelays.add(relay)
				if (doneRelays.size >= activeRelays.length) {
					clearTimeout(eoseTimeout)
					setEose(true)
				}
			},
		})

		return () => {
			cancelled = true
			clearTimeout(eoseTimeout)
			stopSubscription()
		}
	}, [filterKey, relayKey])

	const events = use$(() => {
		// TimelineModel already emits a fresh array instance per change.
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined
		return eventStore.timeline(activeFilters)
	}, [filterKey])

	return { events: events ?? [], eose }
}
