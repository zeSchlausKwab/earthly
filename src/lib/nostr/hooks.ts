/**
 * React hooks layered on the applesauce singletons.
 *
 * These exist to keep call sites concise and to encapsulate the
 * "subscribe-then-read-from-store" pattern that applesauce uses.
 */

import { mapEventsToStore } from 'applesauce-core'
import { use$ } from 'applesauce-react/hooks'
import type { GroupReqMessage } from 'applesauce-relay'
import type { Filter, NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { filter as rxFilter, map, tap } from 'rxjs'
import { config } from '@/config'
import { eventStore, pool } from './index'

type EventMessage = Extract<GroupReqMessage, { type: 'EVENT' }>
type RelayDoneMessage = Extract<GroupReqMessage, { type: 'EOSE' | 'ERROR' | 'CLOSED' }>

function isEventMessage(message: GroupReqMessage): message is EventMessage {
	return message.type === 'EVENT'
}

function isRelayDoneMessage(message: GroupReqMessage): message is RelayDoneMessage {
	return message.type === 'EOSE' || message.type === 'ERROR' || message.type === 'CLOSED'
}

function filtersFromKey(filterKey: string | null): Filter | Filter[] | null {
	return filterKey ? (JSON.parse(filterKey) as Filter | Filter[]) : null
}

function relaysFromKey(relayKey: string): string[] {
	return relayKey ? relayKey.split(',').filter(Boolean) : []
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

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) return undefined

		const activeRelays = relaysFromKey(relayKey)
		const subscription = pool
			.req(activeRelays, activeFilters)
			.pipe(
				rxFilter(isEventMessage),
				map((message) => message.event),
				mapEventsToStore(eventStore),
			)
			.subscribe()

		return () => subscription.unsubscribe()
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
	const [eose, setEose] = useState(false)

	useEffect(() => {
		const activeFilters = filtersFromKey(filterKey)
		if (!activeFilters) {
			setEose(false)
			return undefined
		}

		const activeRelays = relaysFromKey(relayKey)
		if (activeRelays.length === 0) {
			setEose(true)
			return undefined
		}

		setEose(false)

		const doneRelays = new Set<string>()
		const subscription = pool
			.req(activeRelays, activeFilters)
			.pipe(
				tap((message) => {
					if (!isRelayDoneMessage(message)) return
					doneRelays.add(message.from)
					if (doneRelays.size >= activeRelays.length) setEose(true)
				}),
				rxFilter(isEventMessage),
				map((message) => message.event),
				mapEventsToStore(eventStore),
			)
			.subscribe()

		return () => subscription.unsubscribe()
	}, [filterKey, relayKey])

	const events = use$(() => {
		if (!filters) return undefined
		return eventStore.timeline(filters).pipe(map((evts) => [...evts]))
	}, [filterKey])

	return { events: events ?? [], eose }
}
