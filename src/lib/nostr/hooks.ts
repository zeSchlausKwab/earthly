/**
 * React hooks layered on the applesauce singletons.
 *
 * These exist to keep call sites concise and to encapsulate the
 * "subscribe-then-read-from-store" pattern that applesauce uses.
 */

import { mapEventsToStore } from 'applesauce-core'
import { use$ } from 'applesauce-react/hooks'
import type { Filter, NostrEvent } from 'nostr-tools'
import { useMemo } from 'react'
import { filter as rxFilter, map, scan } from 'rxjs'
import { config } from '@/config'
import { eventStore, pool } from './index'

/**
 * Subscribe to a filter on the relay pool, ingest events into the EventStore,
 * and return the live timeline matching that filter.
 *
 * Two-stage flow:
 *   1. Side-effect subscription via `pool.subscription` → events flow into the
 *      EventStore (deduplicated, replaceable handling automatic).
 *   2. Reactive read via `eventStore.timeline` → component re-renders on
 *      additions, replacements, or deletions.
 *
 * Pass `null` filters to skip the subscription entirely (useful for guards
 * like "wait for an address before subscribing").
 *
 * `relays` defaults to `config.readRelays` — broader than write relays, so dev
 * can fetch public profiles via EXTRA_READ_RELAYS without ever publishing
 * to those relays.
 */
export function useTimeline(
	filters: Filter | Filter[] | null,
	relays: string[] = config.readRelays,
): NostrEvent[] {
	const filterKey = useMemo(() => (filters ? JSON.stringify(filters) : null), [filters])
	const relayKey = useMemo(() => relays.join(','), [relays])

	use$(() => {
		if (!filters) return undefined
		return pool.subscription(relays, filters).pipe(mapEventsToStore(eventStore))
	}, [filterKey, relayKey])

	const events = use$(() => {
		if (!filters) return undefined
		return eventStore.timeline(filters).pipe(map((events) => [...events]))
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
 * `relays` defaults to `config.readRelays`.
 */
export function useTimelineWithEose(
	filters: Filter | Filter[] | null,
	relays: string[] = config.readRelays,
): { events: NostrEvent[]; eose: boolean } {
	const filterKey = useMemo(() => (filters ? JSON.stringify(filters) : null), [filters])
	const relayKey = useMemo(() => relays.join(','), [relays])

	const eose =
		use$(() => {
			if (!filters) return undefined
			const relayCount = relays.length
			// Count how many distinct relays have sent EOSE; emit true once all have.
			return pool.req(relays, filters).pipe(
				rxFilter(
					(msg): msg is { type: 'EOSE'; from: string; id: string } =>
						typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'EOSE',
				),
				scan((seen, msg) => seen.add(msg.from), new Set<string>()),
				map((seen) => seen.size >= relayCount),
				rxFilter(Boolean),
			)
		}, [filterKey, relayKey]) ?? false

	use$(() => {
		if (!filters) return undefined
		return pool.subscription(relays, filters).pipe(mapEventsToStore(eventStore))
	}, [filterKey, relayKey])

	const events = use$(() => {
		if (!filters) return undefined
		return eventStore.timeline(filters).pipe(map((evts) => [...evts]))
	}, [filterKey])

	return { events: events ?? [], eose }
}
