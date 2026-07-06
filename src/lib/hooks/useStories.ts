/**
 * Reactive subscription to Story / Article events (kind 37520), surfaced as
 * applesauce `Article` casts (the browse seam for Plan 03).
 *
 * A thin wrapper around `useTimelineWithEose` + `castEvent` mirroring `useGroups`.
 * The EventStore handles deduplication and replaceable-event semantics, so the
 * returned timeline holds the latest version per `(kind, pubkey, d)`. Events are
 * filtered through `isArticle` BEFORE casting: the `Article` cast ctor THROWS on a
 * non-conforming kind-37520 event (legacy/malformed, no current `modelVersion`), so
 * casting unfiltered would crash the whole timeline. Filtering first is the SPEC-03
 * defensive skip (drop legacy/forged, never throw — T-10-02).
 */

import { castEvent } from 'applesauce-core/casts'
import type { Filter } from 'nostr-tools'
import { useMemo } from 'react'
import { eventStore } from '@/lib/nostr'
import { Article, isArticle } from '@/lib/nostr/article'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'

/** Subscribe to Story / Article events (kind 37520). */
export function useStories(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
	const filters = additionalFilters.map((filter) => ({
		...filter,
		kinds: [ARTICLE_KIND],
	}))

	const { events, eose } = useTimelineWithEose(filters)

	const stories = useMemo(
		() => events.filter(isArticle).map((event) => castEvent(event, Article, eventStore)),
		[events],
	)

	return { events: stories, eose }
}
