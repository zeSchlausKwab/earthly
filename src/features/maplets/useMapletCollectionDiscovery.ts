import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
	eventStore,
	isEventDeleted,
	pool,
	queryCache,
	readRelaysFor,
	relayAuthOptions,
	relayLiveness,
} from '@/lib/nostr'
import { startLiveTimelineSubscription } from '@/lib/nostr/liveTimeline'
import { createMapletCollectionDiscovery } from './collectionDiscovery'

/** Public collection discovery is host-owned and respects Earthly's relay routing. */
export function useMapletCollectionDiscovery(enabled = true) {
	const account = useActiveAccount()
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
						pool,
						liveness: relayLiveness,
						auth: () => relayAuthOptions(account?.pubkey),
						onEvent: callbacks.event,
						onRelayState: (url, outcome) => {
							if (outcome.state === 'ready') callbacks.done(url, false)
							else if (outcome.state === 'failed' || outcome.state === 'skipped')
								callbacks.done(url, true)
						},
						// Only the controller's fully verified events may enter the shared store.
						store: { add: () => null },
					}),
			}),
		[account],
	)
	const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
	useEffect(() => {
		if (enabled) controller.start()
		return controller.stop
	}, [controller, enabled])
	return { ...state, refresh: controller.refresh, loadMore: controller.loadMore }
}
