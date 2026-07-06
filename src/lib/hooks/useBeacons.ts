/**
 * Reactive subscription to Live Beacon events (kind 37521), surfaced as applesauce
 * `LiveBeacon` casts (the browse/live-map seam for Plans 03/04).
 *
 * A thin wrapper around `useTimelineWithEose` + `castEvent` mirroring `useSightings`,
 * with three Beacon-specific divergences:
 *   1. the discovery filter defaults to `{ '#t': ['live'] }` so only PUBLIC beacons
 *      surface (a link-only beacon omits `t:'live'` and is never matched — P-6 /
 *      T-12-02-LINKONLY);
 *   2. a finer 15s expiry tick (Sighting uses 60s) so the 120s staleness step flips
 *      live→stale→removed within ~15s of the threshold without a new event;
 *   3. `dropExpired` applied inside the `useMemo` (BEACON-03 at the subscription read
 *      path — Pitfall P-1). Relay NIP-40 GC is advisory and never trusted; the client
 *      drops expired beacons itself against `unixNow()` (epoch seconds, UTC — never
 *      `Date.now()` ms).
 *
 * Events are filtered through `isLiveBeacon` BEFORE casting and BEFORE the expiry
 * drop: the `LiveBeacon` cast ctor THROWS on a non-conforming kind-37521 event
 * (legacy/forged, no current `modelVersion`), so casting an unfiltered timeline
 * would crash the whole map/list (T-12-02-FORGED, Pitfall P-2). The filter is the
 * SPEC-03 defensive skip (drop legacy/forged, never throw).
 */

import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { unixNow } from 'applesauce-core/helpers/time'
import type { Filter } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { eventStore } from '@/lib/nostr'
import { dropExpired } from '@/lib/nostr/expiry'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { isLiveBeacon, LiveBeacon } from '@/lib/nostr/live-beacon'

// Re-export the derivation + cadence constants from where the data layer defines
// them so consumers (the map layer in Plan 04, the tests) can import them from the
// hook seam (12-01 flagged: BEACON_STALE_THRESHOLD_S exported from where useBeacons
// lives).
export {
	BEACON_DISTANCE_FLOOR_M,
	BEACON_HEARTBEAT_MS,
	BEACON_STALE_FACTOR,
	BEACON_STALE_THRESHOLD_S,
	beaconState,
	type BeaconState,
} from '@/lib/nostr/live-beacon'

/**
 * Finer (~15s) wall-clock tick than Sighting's 60s: `dropExpired` reads the tick as
 * `now`, but the expiry memo would only re-run when `events` changes, so a beacon
 * that expires (or crosses the 120s staleness step) while the tab stays mounted
 * would linger until a reload/new event. A 15s tick keeps the live→stale→removed
 * transition within ~15s of the threshold.
 */
const EXPIRY_TICK_MS = 15_000

function useExpiryClock(): number {
	const [tick, setTick] = useState(() => unixNow())
	useEffect(() => {
		const id = setInterval(() => setTick(unixNow()), EXPIRY_TICK_MS)
		return () => clearInterval(id)
	}, [])
	return tick
}

/**
 * Pure read-path selector: filter-before-cast (P-2) THEN drop expired (P-1) THEN
 * cast, at an EXPLICIT epoch-seconds `now`. Shared by `useBeacons` and the OG/map
 * read paths so the defensive ordering is written once.
 */
export function selectVisibleBeacons(events: NostrEvent[], now: number): LiveBeacon[] {
	return dropExpired(events.filter(isLiveBeacon), now).map((event) =>
		castEvent(event, LiveBeacon, eventStore),
	)
}

/**
 * Subscribe to Live Beacon events (kind 37521), defaulting to the `#t:['live']`
 * discovery filter so only public beacons surface; expired beacons are dropped at
 * the read path and re-derived on a 15s tick.
 */
export function useBeacons(additionalFilters: Omit<Filter, 'kinds'>[] = [{ '#t': ['live'] }]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [LIVE_BEACON_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)
	// A finer ticking "now" (epoch seconds, ~15s granularity) so the expiry drop +
	// staleness re-evaluate as wall-clock advances even when no new event arrives.
	// Using the tick AS the `now` makes it a genuine memo dependency.
	const now = useExpiryClock()

	const beacons = useMemo(() => selectVisibleBeacons(events, now), [events, now])

	return { events: beacons, eose }
}
