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
import { MailboxesModel } from 'applesauce-core/models'
import { RelayPool } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts'
import { createEventLoaderForStore } from 'applesauce-loaders/loaders'
import { NostrConnectSigner } from 'applesauce-signers'
import { NostrIDB } from 'nostr-idb'
import type { Filter, NostrEvent } from 'nostr-tools'
import { firstValueFrom, race, timer, of, filter } from 'rxjs'
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
 * Routing strategy for `publish()`.
 *
 *   - 'configured' (default): publish to `config.relayUrls`.
 *   - 'outbox':    publish to the author's NIP-65 outbox relays (own events).
 *   - 'inbox':     publish to the recipient's NIP-65 inbox relays (replies, reactions).
 *
 * In development the outbox/inbox strategies are forced back to 'configured'
 * so seed scripts and local testing never broadcast to public relays.
 */
export type PublishRouting = 'configured' | 'outbox' | 'inbox'

export interface PublishOptions {
	/** Override relays explicitly. Wins over `routing`. */
	relays?: string[]
	/** Default 'configured'. */
	routing?: PublishRouting
	/** For routing='inbox', the pubkey of the recipient (e.g. dataset author). */
	target?: string
	/** Max ms to wait for NIP-65 mailboxes before falling back. Default 1500. */
	mailboxTimeoutMs?: number
}

const MAILBOX_TIMEOUT_DEFAULT = 1500

/**
 * Resolve the relays for an outbox/inbox routed publish. Returns the configured
 * fallback if the user has no NIP-65 record (or we time out waiting for one).
 */
async function resolveRoutedRelays(
	pubkey: string,
	which: 'inboxes' | 'outboxes',
	timeoutMs: number,
): Promise<string[]> {
	const mailboxes$ = eventStore
		.model(MailboxesModel, pubkey)
		.pipe(filter((m): m is { inboxes: string[]; outboxes: string[] } => Boolean(m)))
	const result = await firstValueFrom(race(mailboxes$, timer(timeoutMs).pipe(() => of(undefined))))
	const list = result?.[which]
	if (list && list.length > 0) return list
	return config.relayUrls
}

/**
 * One-stop publish: broadcast to relays, add to the local store, return the
 * relay responses. Use this in place of `event.publish()` from NDK.
 *
 * Dev safety: in development mode, outbox/inbox routing is silently downgraded
 * to `config.relayUrls` so we never leak local work to public relays.
 */
export async function publish(event: NostrEvent, options: PublishOptions = {}) {
	const { relays, routing = 'configured', target, mailboxTimeoutMs } = options

	let targetRelays: string[]
	if (relays) {
		targetRelays = relays
	} else if (config.isDevelopment || routing === 'configured') {
		targetRelays = config.relayUrls
	} else if (routing === 'outbox') {
		targetRelays = await resolveRoutedRelays(
			event.pubkey,
			'outboxes',
			mailboxTimeoutMs ?? MAILBOX_TIMEOUT_DEFAULT,
		)
	} else {
		// routing === 'inbox'
		if (!target) throw new Error("publish({ routing: 'inbox' }) requires a target pubkey")
		targetRelays = await resolveRoutedRelays(
			target,
			'inboxes',
			mailboxTimeoutMs ?? MAILBOX_TIMEOUT_DEFAULT,
		)
	}

	const responses = await pool.publish(targetRelays, event)
	eventStore.add(event)
	return responses
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		stopPersist()
	})
}
