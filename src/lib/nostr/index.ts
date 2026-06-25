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
import { NostrIDB, openDB } from 'nostr-idb'
import type { Filter, NostrEvent } from 'nostr-tools'
import type { IAccount } from 'applesauce-accounts'
import { EMPTY, filter, firstValueFrom, NEVER, of, race, timeout, TimeoutError, timer } from 'rxjs'

// Bun HMR bundler tree-shaking bug: rxjs/index.js re-exports some values via
// source files that Bun's HMR runtime can stub without populating. Referencing
// them at module scope forces Bun to track the real bindings used inside
// applesauce packages.
void EMPTY
void NEVER
void timeout
void TimeoutError
import { config } from '@/config'

// Shared tag read/write seam (SPEC-02) — re-exported for ergonomic access.
export * from './tags'
// In-content model-version discriminator (SPEC-03) + NIP-40 expiry filter (SPEC-05).
export * from './modelVersion'
export * from './expiry'
// Phase 8 per-kind Factory+Cast scaffolds (37520/37521/37522). Each consumes the
// shared tags.ts seam and gates its guard on modelVersion. Helper names are
// uniquely prefixed per kind, so the wildcard re-exports never collide.
export * from './article'
export * from './live-beacon'
export * from './temporal-sighting'

/** Reactive event database. Single instance for the whole app. */
export const eventStore = new EventStore()

/** Connection pool — owns websocket lifecycles per relay URL. */
export const pool = new RelayPool()

/**
 * Earthly-specific account metadata stored alongside each saved account.
 *
 *   - `ephemeral: true` means "don't persist this account across reloads".
 *     Used when the user unchecks "Stay logged in".
 */
export interface EarthlyAccountMetadata {
	ephemeral?: boolean
}

/** Multi-account signer manager. Common account types are registered eagerly. */
export const accounts = new AccountManager<EarthlyAccountMetadata>()
registerCommonAccountTypes(accounts)

const ACCOUNTS_STORAGE_KEY = 'earthly:accounts'
const ACTIVE_ACCOUNT_STORAGE_KEY = 'earthly:active-account'

/**
 * Restore saved accounts on boot. Failures are logged but don't block boot —
 * a corrupted entry shouldn't prevent the rest of the app from loading.
 */
function restoreAccounts() {
	if (typeof localStorage === 'undefined') return
	try {
		const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
		if (raw) accounts.fromJSON(JSON.parse(raw), true)
		const activeId = localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
		if (activeId) {
			const found = accounts.getAccount(activeId)
			if (found) accounts.setActive(found)
		}
	} catch (err) {
		console.error('[nostr] failed to restore accounts from localStorage', err)
	}
}

restoreAccounts()

// Persist on every change. BehaviorSubjects emit immediately so the first save
// is essentially a no-op when storage is already in sync. Ephemeral accounts
// (rememberMe=false) are filtered out so they only live in memory.
accounts.accounts$.subscribe(() => {
	if (typeof localStorage === 'undefined') return
	try {
		const persisted = accounts.toJSON(true).filter((acc) => !acc.metadata?.ephemeral)
		localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(persisted))
	} catch (err) {
		console.error('[nostr] failed to persist accounts', err)
	}
})

accounts.active$.subscribe((account) => {
	if (typeof localStorage === 'undefined') return
	if (account) localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, account.id)
	else localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY)
})

/**
 * IndexedDB-backed event cache. Only instantiated in browsers — seed scripts
 * (which import this module via NDK class wrappers) run in Bun where
 * `indexedDB` doesn't exist.
 */
const hasIndexedDB = typeof indexedDB !== 'undefined'
let cache: NostrIDB | null = null

function getErrorName(error: unknown) {
	return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
}

function getErrorMessage(error: unknown) {
	return typeof error === 'object' && error !== null && 'message' in error
		? String(error.message)
		: String(error)
}

function isClosingDatabaseError(error: unknown) {
	return getErrorName(error) === 'InvalidStateError' && /closing/i.test(getErrorMessage(error))
}

function logCacheError(action: string, error: unknown) {
	if (isClosingDatabaseError(error)) {
		console.warn(
			`[nostr] IndexedDB cache ${action} skipped because the database connection is closing`,
		)
		return
	}
	console.error(`[nostr] NostrIDB ${action} failed`, error)
}

function closeCacheDb(idb: NostrIDB) {
	const db = (idb as unknown as { db?: { close?: () => void } | null }).db
	try {
		db?.close?.()
	} catch (err) {
		logCacheError('close', err)
	}
}

function disableCache(idb: NostrIDB) {
	if (cache === idb) cache = null
	void idb
		.stop()
		.catch((err) => logCacheError('stop', err))
		.finally(() => closeCacheDb(idb))
}

function createCache(db: ConstructorParameters<typeof NostrIDB>[0]) {
	const idb = new NostrIDB(db, { cacheIndexes: 2000, maxEvents: 20_000 })
	const flushable = idb as unknown as { flush: () => Promise<void> }
	const flush = flushable.flush.bind(idb)

	flushable.flush = async () => {
		try {
			await flush()
		} catch (err) {
			logCacheError('flush', err)
			disableCache(idb)
		}
	}

	return idb
}

/**
 * Resolves once the cache has finished its async startup.
 * Loaders defer their first read until this resolves. In non-browser
 * environments this is a resolved no-op.
 */
export const cacheReady = hasIndexedDB
	? openDB()
			.then((db) => {
				cache = createCache(db)
			})
			.catch((err) => {
				cache = null
				logCacheError('startup', err)
			})
	: Promise.resolve()

/** Pipe newly-added events into the cache in batches. Cleanup on HMR. */
const stopPersist = hasIndexedDB
	? persistEventsToCache(eventStore, async (events: NostrEvent[]) => {
			await cacheReady
			if (!cache) return

			const results = await Promise.allSettled(events.map((event) => cache?.add(event)))
			for (const result of results) {
				if (result.status === 'rejected') logCacheError('write', result.reason)
			}
		})
	: () => {}

/**
 * Cache request used by event loaders. Returns events that match the filters.
 * Awaits cache start so callers don't race the initial open.
 */
async function cacheRequest(filters: Filter[]): Promise<NostrEvent[]> {
	await cacheReady
	if (!cache) return []

	try {
		return await cache.query(filters)
	} catch (err) {
		logCacheError('query', err)
		return []
	}
}

/**
 * Query the IndexedDB event cache directly. Returns matching cached events
 * (empty array when the cache is unavailable). Use to hydrate the EventStore
 * instantly on mount while relay subscriptions catch up in the background.
 */
export async function queryCache(filters: Filter[]): Promise<NostrEvent[]> {
	return cacheRequest(filters)
}

/**
 * Wires up on-demand event loading: when something subscribes to an event/address
 * that isn't in the store, we pull from cache then from relays. The result is
 * added to the store automatically and stored back into the cache via persistEventsToCache.
 *
 * Loaders read broadly (`config.readRelays`) so profile and metadata lookups
 * can hit public relays in dev when EXTRA_READ_RELAYS is set, without ever
 * publishing there.
 */
createEventLoaderForStore(eventStore, pool, {
	cacheRequest,
	lookupRelays: config.readRelays,
	extraRelays: config.readRelays,
})

/**
 * NIP-46 Nostr Connect needs a relay transport. Sharing the pool means
 * bunker traffic uses the same connections as everything else.
 */
NostrConnectSigner.pool = pool

/**
 * Routing strategy for `publish()`.
 *
 *   - 'configured' (default): publish to `config.writeRelays`.
 *   - 'outbox':    publish to the author's NIP-65 outbox relays (own events).
 *   - 'inbox':     publish to the recipient's NIP-65 inbox relays (replies, reactions).
 *
 * In development, outbox/inbox routing is silently downgraded to
 * `config.writeRelays` (= local relay) so we never broadcast to public relays
 * even if the user's NIP-65 record points to public ones.
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
	const result = await firstValueFrom(
		race(
			mailboxes$,
			timer(timeoutMs).pipe(() => of(undefined)),
		),
	)
	const list = result?.[which]
	if (list && list.length > 0) return list
	return config.writeRelays
}

/**
 * One-stop publish: broadcast to relays, add to the local store, return the
 * relay responses. Use this in place of `event.publish()` from NDK.
 *
 * Dev safety: in development mode, outbox/inbox routing is silently downgraded
 * to `config.writeRelays` (= the local relay) so we never leak local work to
 * public relays — even when `EXTRA_READ_RELAYS` opens up read-side discovery.
 */
export async function publish(event: NostrEvent, options: PublishOptions = {}) {
	const { relays, routing = 'configured', target, mailboxTimeoutMs } = options

	let targetRelays: string[]
	if (relays) {
		targetRelays = relays
	} else if (config.isDevelopment || routing === 'configured') {
		// In dev, ALL routing modes collapse to writeRelays. This is the dev-leak
		// safety net: even if a user's NIP-65 mailboxes point at public relays,
		// we never write to them in dev.
		targetRelays = config.writeRelays
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

/**
 * Add an account to the manager, set it active, and configure persistence.
 *
 * If an account with the same pubkey already exists it is replaced — this
 * keeps "log in again with the same key" idempotent rather than producing
 * duplicate sidebar entries.
 */
// IAccount uses three generics that don't unify cleanly across the various
// concrete account classes (NostrConnectAccount, ExtensionAccount, etc.).
// We only care that it walks and quacks like an account, so accept the loose
// shape and let the manager validate at runtime.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
type AnyAccount = IAccount<any, any, any>

export function loginWithAccount(account: AnyAccount, options: { remember?: boolean } = {}) {
	const { remember = true } = options

	// Replace any prior account for the same pubkey to avoid duplicates.
	for (const existing of accounts.getAccountsForPubkey(account.pubkey)) {
		accounts.removeAccount(existing)
	}

	account.metadata = { ...(account.metadata ?? {}), ephemeral: !remember }
	accounts.addAccount(account)
	accounts.setActive(account)
}

/** Log out the active account. Removes it entirely (forgets persisted data). */
export function logoutActive() {
	const active = accounts.active
	if (!active) return
	accounts.removeAccount(active)
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		stopPersist()
		const activeCache = cache
		cache = null
		if (activeCache) disableCache(activeCache)
	})
}
