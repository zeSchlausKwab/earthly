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
import { useMemo } from 'react'
import { eventStore } from '@/lib/nostr'
import { dropExpired } from '@/lib/nostr/expiry'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { TEMPORAL_SIGHTING_KIND } from '@/lib/nostr/kinds'
import { isTemporalSighting, TemporalSighting } from '@/lib/nostr/temporal-sighting'

/** Subscribe to Temporal Sighting events (kind 37522), dropping expired ones. */
export function useSightings(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [TEMPORAL_SIGHTING_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const sightings = useMemo(
		() =>
			// filter-before-cast (P-2) THEN drop expired (SIGHT-03, P-1) THEN cast.
			dropExpired(events.filter(isTemporalSighting), unixNow()).map((event) =>
				castEvent(event, TemporalSighting, eventStore),
			),
		[events],
	)

	return { events: sightings, eose }
}
