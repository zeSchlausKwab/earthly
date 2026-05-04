/**
 * Applesauce singletons for Earthly.
 *
 * One place owns the EventStore, RelayPool, AccountManager, and IDB cache.
 * Every other module imports from here — no other file constructs these.
 *
 * Usage:
 *   import { eventStore, pool, accounts, publish } from '@/lib/nostr'
 */

import { EventStore } from 'applesauce-core'
import { persistEventsToCache } from 'applesauce-core/helpers'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts'
import { createEventLoaderForStore } from 'applesauce-loaders/loaders'
import { NostrConnectSigner } from 'applesauce-signers'
import { NostrIDB } from 'nostr-idb'
import type { Filter, NostrEvent } from 'nostr-tools'
import { config } from '@/config'

/** Reactive event database. Single instance for the whole app. */
export const eventStore = new EventStore()

/** Connection pool — owns websocket lifecycles per relay URL. */
export const pool = new RelayPool()

/** Multi-account signer manager. Common account types are registered eagerly. */
export const accounts = new AccountManager()
registerCommonAccountTypes(accounts)

/** IndexedDB-backed event cache. Replaces the Dexie adapter. */
const cache = new NostrIDB(undefined, {
	cacheIndexes: 2000,
	maxEvents: 20_000,
})

/**
 * Resolves once the cache has finished its async startup.
 * Loaders defer their first read until this resolves.
 */
export const cacheReady = cache.start().catch((err) => {
	console.error('[nostr] NostrIDB failed to start, continuing without persistent cache', err)
})

/** Pipe newly-added events into the cache in batches. Cleanup on HMR. */
const stopPersist = persistEventsToCache(eventStore, async (events: NostrEvent[]) => {
	await cacheReady
	await Promise.allSettled(events.map((event) => cache.add(event)))
})

/**
 * Cache request used by event loaders. Returns events that match the filters.
 * Awaits cache start so callers don't race the initial open.
 */
async function cacheRequest(filters: Filter[]): Promise<NostrEvent[]> {
	await cacheReady
	return cache.query(filters)
}

/**
 * Wires up on-demand event loading: when something subscribes to an event/address
 * that isn't in the store, we pull from cache then from relays. The result is
 * added to the store automatically and stored back into the cache via persistEventsToCache.
 */
createEventLoaderForStore(eventStore, pool, {
	cacheRequest,
	lookupRelays: config.relayUrls,
	extraRelays: config.relayUrls,
})

/**
 * NIP-46 Nostr Connect needs a relay transport. Sharing the pool means
 * bunker traffic uses the same connections as everything else.
 */
NostrConnectSigner.pool = pool

/**
 * One-stop publish: broadcast to relays, add to the local store, return the
 * relay responses. Use this in place of `event.publish()` from NDK.
 */
export async function publish(event: NostrEvent, relays: string[] = config.relayUrls) {
	const responses = await pool.publish(relays, event)
	eventStore.add(event)
	return responses
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		stopPersist()
	})
}
