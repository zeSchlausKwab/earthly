import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { tap } from 'rxjs'
import { eventStore, isEventDeleted, pool, queryCache, readRelaysFor } from '@/lib/nostr'
import { startLiveTimelineSubscription } from '@/lib/nostr/liveTimeline'
import { createMapletCollectionDiscovery } from './collectionDiscovery'

/** Public collection discovery is host-owned and respects Earthly's relay routing. */
export function useMapletCollectionDiscovery(enabled = true) {
	const controller = useMemo(
		() =>
			createMapletCollectionDiscovery({
				relays: () => [...new Set([...readRelaysFor('discovery'), ...readRelaysFor('content')])],
				hydrate: (filter) => queryCache([filter]),
				isDeleted: isEventDeleted,
				watchLocal: (filter, receive, remove) => {
					const subscription = eventStore.timeline(filter).subscribe(receive)
					const removals = eventStore.remove$.subscribe((event) => {
						if (isEventDeleted(event)) remove(event)
					})
					return () => {
						subscription.unsubscribe()
						removals.unsubscribe()
					}
				},
				add: (event) => {
					eventStore.add(event)
				},
				listen: (filter, relays, callbacks) =>
					startLiveTimelineSubscription({
						filters: filter,
						relays,
						pool: {
							req: (...args) =>
								pool.req(...args).pipe(
									tap({
										next: (message) => {
											if (message.type === 'EVENT') callbacks.event(message.event, message.from)
											else if (message.type === 'EOSE') callbacks.done(message.from, false)
											else if (message.type === 'ERROR' || message.type === 'CLOSED')
												callbacks.done(message.from, true)
										},
										error: () => callbacks.error(),
									}),
								),
						},
						// Only the controller's fully verified events may enter the shared store.
						store: { add: () => null },
					}),
			}),
		[],
	)
	const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
	useEffect(() => {
		if (enabled) controller.start()
		return controller.stop
	}, [controller, enabled])
	return { ...state, refresh: controller.refresh, loadMore: controller.loadMore }
}
