import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { accounts, eventStore, pool, publish, queryCache, readRelaysFor } from '@/lib/nostr'
import { GeoDatasetFactory } from '@/lib/nostr/geo-event/factory'
import type { GeoDatasetEvent } from '@/lib/nostr/geo-event/helpers'
import { startLiveTimelineSubscription } from '@/lib/nostr/liveTimeline'
import { createMapletWorkspace, parseWorkspaceEvent } from './workspace'

/** Only Earthly's trusted Live Mapper is granted this broker, never arbitrary discovered code. */
export function useMapletWorkspace({ instanceId }: { instanceId: string }) {
	const account = useActiveAccount()
	const pubkey = account?.pubkey ?? null
	// biome-ignore lint/correctness/useExhaustiveDependencies: Each iframe instance owns a separately cancellable workspace session.
	const controller = useMemo(
		() =>
			createMapletWorkspace({
				pubkey,
				currentPubkey: () => accounts.active?.pubkey ?? null,
				storage: {
					getItem: (key) => localStorage.getItem(key),
					setItem: (key, value) => localStorage.setItem(key, value),
				},
				signSnapshot: async (collection, id, previous, signal) => {
					signal.throwIfAborted()
					const signer = accounts.signer
					if (!signer || accounts.active?.pubkey !== pubkey)
						throw new Error('Sign in to publish this collection')
					const factory = previous
						? GeoDatasetFactory.update(previous as GeoDatasetEvent, collection)
						: GeoDatasetFactory.create(collection)
					const event = await factory
						.modifyPublicTags((tags) => [
							...tags.filter((tag) => tag[0] !== 'd'),
							['d', id],
							['t', 'maplet-collection'],
						])
						.withDerivedMetadata()
						.sign(signer)
					signal.throwIfAborted()
					if (accounts.active?.pubkey !== pubkey)
						throw new Error('Account changed while signing collection')
					return event
				},
				publishEvent: async (event, signal) => {
					signal.throwIfAborted()
					if (accounts.active?.pubkey !== pubkey)
						throw new Error('Account changed before publication')
					// Uses Earthly's existing relay acknowledgement / durable native outbox semantics.
					return publish(event, {
						routing: 'outbox',
						signal,
						beforeCommit: () => {
							if (accounts.active?.pubkey !== pubkey)
								throw new Error('Account changed before publication')
						},
					})
				},
				subscribeAddress: (address, onEvent, onError) => {
					let active = true
					let received = false
					const filter = address.filter
					const accept = (event: Parameters<typeof onEvent>[0]) => {
						if (!active) return
						try {
							parseWorkspaceEvent(event, address)
							received = true
							onEvent(event)
						} catch (error) {
							onError(error instanceof Error ? error.message : 'Invalid collection update')
						}
					}
					// Hydrate before/beside the durable exact-address live REQ. Every path is verified.
					const local = eventStore.timeline(filter).subscribe((events) => {
						for (const event of events) accept(event)
					})
					void queryCache([filter])
						.then((events) => {
							for (const event of events) accept(event)
						})
						.catch(() => {
							if (active && !received)
								onError('The local collection cache is unavailable; waiting for relays')
						})
					const relays = readRelaysFor('content')
					const completed = new Set<string>()
					const stop = startLiveTimelineSubscription({
						pool,
						relays,
						filters: filter,
						store: {
							add: (event) => {
								if (!active) return null
								try {
									parseWorkspaceEvent(event, address)
								} catch (error) {
									onError(error instanceof Error ? error.message : 'Invalid collection update')
									return null
								}
								accept(event)
								return eventStore.add(event)
							},
						},
						onRelayDone: (relay) => {
							completed.add(relay)
							if (active && !received && completed.size >= relays.length)
								onError(
									'No valid collection snapshot was found on the configured relays; waiting for updates',
								)
						},
					})
					const timeout = setTimeout(() => {
						if (active && !received)
							onError('Still waiting for a valid collection snapshot from the configured relays')
					}, 15_000)
					return () => {
						active = false
						clearTimeout(timeout)
						local.unsubscribe()
						stop()
					}
				},
			}),
		[pubkey, instanceId],
	)
	const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
	useEffect(() => {
		controller.start()
		return controller.stop
	}, [controller])
	return { pubkey, state, request: controller.request }
}
