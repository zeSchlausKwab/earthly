/**
 * Reactive subscription to Temporal Sighting events (kind 37522), surfaced as
 * applesauce `TemporalSighting` casts (the browse seam for Plans 03/04).
 *
 * A thin wrapper around `useTimelineWithEose` + `castEvent` mirroring `useStories`,
 * with the one Sighting-specific addition: `dropExpired` applied inside the
 * `useMemo` (SIGHT-03 at the subscription read path — Pitfall P-1). Relay NIP-40 GC
 * is advisory and never trusted; the client drops expired Sightings itself, against
 * `unixNow()` (epoch seconds, UTC — never `Date.now()` ms).
 *
 * Events are filtered through `isTemporalSighting` BEFORE casting and BEFORE the
 * expiry drop: the `TemporalSighting` cast ctor THROWS on a non-conforming
 * kind-37522 event (legacy/forged, no current `modelVersion`), so casting an
 * unfiltered timeline would crash the whole map/list (T-11-02-01, Pitfall P-2). The
 * filter is the SPEC-03 defensive skip (drop legacy/forged, never throw).
 */

import { castEvent } from 'applesauce-core/casts'
import { unixNow } from 'applesauce-core/helpers/time'
import type { Filter } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { eventStore } from '@/lib/nostr'
import { dropExpired } from '@/lib/nostr/expiry'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import { isTemporalSighting, TemporalSighting } from '@/lib/nostr/temporal-sighting'

/**
 * Coarse (~60s) wall-clock tick. WR-04: `dropExpired` reads `unixNow()` but the
 * expiry memo would only re-run when `events` changes, so a Sighting that expires
 * while the tab stays mounted (no new relay event) would linger past its NIP-40
 * `expiration` until a reload/new event. Re-rendering on a ~60s timer makes the
 * expiry re-evaluate as time passes. 60s granularity is well under the coarsest
 * "Fades soon" countdown bucket and keeps the leak window bounded without churn.
 */
const EXPIRY_TICK_MS = 60_000

function useExpiryClock(): number {
	const [tick, setTick] = useState(() => unixNow())
	useEffect(() => {
		const id = setInterval(() => setTick(unixNow()), EXPIRY_TICK_MS)
		return () => clearInterval(id)
	}, [])
	return tick
}

/** Subscribe to Temporal Sighting events (kind 37522), dropping expired ones. */
export function useSightings(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [TEMPORAL_SIGHTING_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)
	// WR-04: a coarse ticking "now" (epoch seconds, ~60s granularity) so the expiry
	// drop re-evaluates as wall-clock advances even when no new event arrives. Using
	// the tick AS the `now` passed to dropExpired makes it a genuine memo dependency.
	const now = useExpiryClock()

	const sightings = useMemo(
		() =>
			// filter-before-cast (P-2) THEN drop expired (SIGHT-03, P-1) THEN cast.
			dropExpired(events.filter(isTemporalSighting), now).map((event) =>
				castEvent(event, TemporalSighting, eventStore),
			),
		[events, now],
	)

	return { events: sightings, eose }
}
