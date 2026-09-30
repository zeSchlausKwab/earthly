import type { Filter, NostrEvent } from 'nostr-tools'
import { eventStore, pool, queryCache, readRelaysFor } from '@/lib/nostr'
import { parseMapletManifest, type MapletManifest } from './artifact'

/** Long tag names are inspected locally; #t is the portable relay discovery index. */
export const MAPLET_DISCOVERY_FILTER: Filter = { kinds: [35129], '#t': ['maplet'], limit: 100 }

export function subscribeDiscoverableMaplets(options: {
	onMaplet: (manifest: MapletManifest) => void
	onError?: (error: Error) => void
	relays?: string[]
}): () => void {
	let stopped = false
	const latest = new Map<string, NostrEvent>()
	const accept = (event: NostrEvent) => {
		if (
			stopped ||
			event.kind !== 35129 ||
			!event.tags.some((tag) => tag[0] === 't' && tag[1] === 'maplet')
		)
			return
		try {
			const manifest = parseMapletManifest(event)
			const previous = latest.get(manifest.id)
			if (
				previous &&
				(previous.created_at > event.created_at ||
					(previous.created_at === event.created_at && previous.id <= event.id))
			)
				return
			latest.set(manifest.id, event)
			eventStore.add(manifest.event)
			options.onMaplet(manifest)
		} catch {
			/* Untrusted catalog entries cannot interrupt other publishers. */
		}
	}
	for (const event of eventStore.getByFilters([MAPLET_DISCOVERY_FILTER])) accept(event)
	void queryCache([MAPLET_DISCOVERY_FILTER])
		.then((events) => {
			for (const event of events) accept(event)
		})
		.catch(() => undefined)
	const subscription = pool
		.subscription(options.relays ?? readRelaysFor('discovery'), MAPLET_DISCOVERY_FILTER)
		.subscribe({
			next: accept,
			error: (error) => {
				if (!stopped)
					options.onError?.(error instanceof Error ? error : new Error('Maplet discovery failed'))
			},
		})
	return () => {
		stopped = true
		subscription.unsubscribe()
		latest.clear()
	}
}
