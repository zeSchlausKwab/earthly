import { castEvent } from 'applesauce-core/casts'
import { nip19, type Filter } from 'nostr-tools'
import { useMemo } from 'react'
import { eventStore } from '@/lib/nostr'
import { Article, isArticle } from '@/lib/nostr/article'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { isRelayAllowed, readRelaysFor } from '@/lib/nostr/relay-router'

export interface StoryAddress {
	readonly naddr: string
	readonly pubkey: string
	readonly identifier: string
	readonly relays: readonly string[]
}

/** Decode only an exact kind-37520 address. Invalid and wrong-kind links fail closed. */
export function decodeStoryAddress(naddr: string | undefined): StoryAddress | null {
	if (!naddr) return null
	try {
		const decoded = nip19.decode(naddr)
		if (decoded.type !== 'naddr' || decoded.data.kind !== ARTICLE_KIND) return null
		const relays = (decoded.data.relays ?? []).filter(
			(relay, index, values) =>
				(relay.startsWith('wss://') || relay.startsWith('ws://')) &&
				values.indexOf(relay) === index,
		)
		return Object.freeze({
			naddr,
			pubkey: decoded.data.pubkey,
			identifier: decoded.data.identifier,
			relays: Object.freeze(relays),
		})
	} catch {
		return null
	}
}

function latestStory(events: readonly Article[]): Article | null {
	let latest: Article | null = null
	for (const story of events) {
		if (
			!latest ||
			story.created_at > latest.created_at ||
			(story.created_at === latest.created_at && story.event.id > latest.event.id)
		) {
			latest = story
		}
	}
	return latest
}

/**
 * Relay hints are accelerators, never the only place a canonical Story is read.
 * The configured content relays remain present, and the development guard is
 * applied before a hinted relay reaches the pool.
 */
export function resolveStoryReaderRelays(
	address: Pick<StoryAddress, 'relays'> | null,
	contentRelays: readonly string[],
	allowRelay: (relay: string) => boolean = () => true,
): string[] {
	const relays = [...(address?.relays ?? []), ...contentRelays].filter(allowRelay)
	return relays.filter((relay, index) => relays.indexOf(relay) === index)
}

/** Exact-address Story subscription used only by the canonical editorial reader. */
export function useStoryReader(naddr: string | undefined) {
	const address = useMemo(() => decodeStoryAddress(naddr), [naddr])
	const filter = useMemo<Filter | null>(
		() =>
			address
				? {
						kinds: [ARTICLE_KIND],
						authors: [address.pubkey],
						'#d': [address.identifier],
					}
				: null,
		[address],
	)
	const relays = useMemo(
		() => resolveStoryReaderRelays(address, readRelaysFor('content'), isRelayAllowed),
		[address],
	)
	const { events, eose } = useTimelineWithEose(filter, relays)
	const story = useMemo(
		() =>
			latestStory(events.filter(isArticle).map((event) => castEvent(event, Article, eventStore))),
		[events],
	)

	return Object.freeze({
		address,
		story,
		loading: Boolean(address) && !eose && !story,
		notFound: Boolean(address) && eose && !story,
		invalidAddress: !address,
	})
}
