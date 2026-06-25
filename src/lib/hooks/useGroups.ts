/**
 * Reactive subscription to Group / Topic events (kind 37518, slimmed),
 * surfaced as applesauce `Group` casts.
 *
 * A thin wrapper around `useTimelineWithEose` + `castEvent` mirroring
 * `useMapContexts` (`useGeoDatasets.ts`). The EventStore handles deduplication
 * and replaceable-event semantics, so the returned timeline contains the latest
 * version per `(kind, pubkey, d)`. The `isGroup` gate in the `Group` cast ctor
 * drops legacy 37518 events that lack the current `modelVersion`.
 */

import { castEvent } from 'applesauce-core/casts'
import type { Filter } from 'nostr-tools'
import { useMemo } from 'react'
import { eventStore } from '@/lib/nostr'
import { Group } from '@/lib/nostr/group'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'

/** Subscribe to Group / Topic events (kind 37518). */
export function useGroups(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [MAP_CONTEXT_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const groups = useMemo(() => events.map((event) => castEvent(event, Group, eventStore)), [events])

	return { events: groups, eose }
}

/**
 * Subscribe to the foreign (`c`) contribution lane of a Group: datasets
 * (kind 37515) that self-attached via a `c` tag pointing at `groupCoordinate`.
 *
 * Pass `null` (or an absent coordinate) to skip the subscription — the
 * `null`-to-skip pattern fires only once a coordinate exists, without violating
 * rules-of-hooks. Plan 06 consumes this for the two-lane view; the per-event
 * signature/kind/mute validation (GROUP-08) is applied by the consumer.
 */
export function useGroupAttachments(groupCoordinate: string | null | undefined) {
	const filters = groupCoordinate ? [{ '#c': [groupCoordinate], kinds: [GEO_EVENT_KIND] }] : null

	const { events, eose } = useTimelineWithEose(filters)

	return { events, eose }
}
