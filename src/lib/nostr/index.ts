/**
 * Applesauce singletons for Earthly.
 *
 * One place owns the EventStore, RelayPool, AccountManager, and IDB cache.
 * Every other module imports from here — no other file constructs these.
 *
 * Usage:
 *   import { eventStore, pool, accounts, publish } from '@/lib/nostr'
 */

import { persistEventsToCache } from 'applesauce-core/helpers'
import { isEventPointer } from 'applesauce-core/helpers/pointers'
import { MailboxesModel } from 'applesauce-core/models'
import { RelayPool, type Relay } from 'applesauce-relay'
import { AccountManager } from 'applesauce-accounts'
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts'
import { createUnifiedEventLoader, type UnifiedEventLoader } from 'applesauce-loaders/loaders'
import { NostrConnectSigner } from 'applesauce-signers'
import { NostrIDB, openDB } from 'nostr-idb'
import type { Filter, NostrEvent } from 'nostr-tools'
import type { IAccount } from 'applesauce-accounts'
import { EMPTY, filter, firstValueFrom, NEVER, of, race, timeout, TimeoutError, timer } from 'rxjs'
import {
	getPublishOutboxService,
	getSavedRegionService,
	notifyPublishOutboxChanged,
} from '@/platform/registry'
import type { OutboxItem, OutboxRelayResult, PublishOutboxService } from '@/platform/contracts'

// Bun HMR bundler tree-shaking bug: rxjs/index.js re-exports some values via
// source files that Bun's HMR runtime can stub without populating. Referencing
// them at module scope forces Bun to track the real bindings used inside
// applesauce packages.
void EMPTY
void NEVER
void timeout
void TimeoutError
import { config } from '@/config'
import {
	applyVerifiedDeletionToCache,
	type DeletionEventCache,
	filterDeletedCacheWrites,
	verifiedDeletionEvent,
} from './deletionCache'
import { eventStore, isEventDeleted } from './store'
import { cacheQueryableFilters } from './filterGuards'
import { LIVE_BEACON_KIND } from './kinds'
import { invalidateCachedMapLayerSetForDeletion } from './map-layer-set/cache'
import { failedRelayResults, pendingOutboxRelays, requiredPublishRelays } from './publishOutbox'
import {
	bucketForKind,
	guardedWebSocketCtor,
	readRelays$,
	shouldCollapseWritesToLocal,
} from './relay-router'

// The single EventStore singleton, constructed in ./store so service modules can
// import it without going through (or being defeated by a test mock of) this barrel.
export { eventStore, isEventDeleted } from './store'

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
// Phase 9 Group / Topic (kind 37518, slimmed) Factory+Cast. The slimmed
// successor to map-context/; its helper names are uniquely `getGroup*`-prefixed
// so the wildcard re-export never collides with the other kinds. The
// map-context/ module stays importable from its own path until Plans 03–06
// repoint all ~34 consumer import sites.
export * from './group'

// Stage-isolation seam (see ./relay-router.ts + docs/RELAY_STAGES.md).
export * from './relay-router'

/**
 * Connection pool — owns websocket lifecycles per relay URL.
 * The guarded WebSocket ctor is the dev backstop: sockets to relays outside
 * the router allowlist never open, no matter which code path asked.
 */
export const pool = new RelayPool({ WebSocket: guardedWebSocketCtor() })

// Dev-only debug handles: inspect open relay connections and the effective
// relay config from the console to verify stage isolation (docs/RELAY_STAGES.md).
if (config.isDevelopment && typeof window !== 'undefined') {
	const w = window as unknown as Record<string, unknown>
	w.__earthlyPool = pool
	w.__earthlyEventStore = eventStore
	w.__earthlyRelayConfig = {
		readRelays: config.readRelays,
		writeRelays: config.writeRelays,
	}
}

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

/**
 * NIP-42: answer relay AUTH challenges with the active signer.
 *
 * Without this, relays that require AUTH silently reject publishes and
 * subscriptions (the settings UI showed the auth badges but nothing ever
 * answered). Policy: authenticate to any relay the pool talks to — the relay
 * router already constrains which relays that can be — whenever a challenge
 * is pending and an account is active. Re-runs on account switch so a login
 * answers challenges that arrived while logged out.
 */
function setupNip42AuthResponder() {
	const answered = new Map<string, string>()

	const answerChallenge = (relay: Relay) => {
		const challenge = relay.challenge
		const signer = accounts.signer
		if (!challenge || !signer) return
		if (answered.get(relay.url) === challenge) return
		answered.set(relay.url, challenge)
		relay
			.authenticate(signer)
			.catch((err) => console.warn(`[nostr] NIP-42 auth failed for ${relay.url}`, err))
	}

	const watchRelay = (relay: Relay) => {
		relay.challenge$.subscribe(() => answerChallenge(relay))
	}

	for (const relay of pool.relays.values()) watchRelay(relay)
	pool.add$.subscribe(watchRelay)
	// A login should answer challenges that arrived while logged out.
	accounts.active$.subscribe(() => {
		for (const relay of pool.relays.values()) answerChallenge(relay)
	})
}

setupNip42AuthResponder()

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

interface FlushableNostrIDB {
	flush(): Promise<void>
	flushDeletionWrites(): Promise<void>
	writeInterval?: ReturnType<typeof setTimeout>
}

function createCache(db: ConstructorParameters<typeof NostrIDB>[0]) {
	const idb = new NostrIDB(db, { cacheIndexes: 2000, maxEvents: 20_000 })
	const flushable = idb as unknown as FlushableNostrIDB
	const flush = flushable.flush.bind(idb)
	let flushTail = Promise.resolve()

	const runFlush = (reportFailure: boolean) => {
		const operation = flushTail.then(async () => {
			// The upstream private flush schedules its next cycle. Cancel the prior one
			// before a manual deletion flush so repeated tombstones cannot multiply timers.
			if (flushable.writeInterval) {
				clearTimeout(flushable.writeInterval)
				flushable.writeInterval = undefined
			}
			try {
				await flush()
			} catch (err) {
				logCacheError('flush', err)
				disableCache(idb)
				if (reportFailure) throw err
			}
		})
		// Keep subsequent scheduled/manual cycles usable without hiding this caller's error.
		flushTail = operation.catch(() => undefined)
		return operation
	}

	flushable.flush = () => runFlush(false)
	flushable.flushDeletionWrites = () => runFlush(true)

	return idb
}

function deletionCacheFor(idb: NostrIDB): DeletionEventCache {
	const flushable = idb as unknown as FlushableNostrIDB
	return {
		add: (event) => idb.add(event),
		query: (filters) => idb.query(filters),
		deleteEvent: (eventId) => idb.deleteEvent(eventId),
		deleteReplaceable: (pubkey, kind, identifier) =>
			idb.deleteReplaceable(pubkey, kind, identifier),
		flush: () => flushable.flushDeletionWrites(),
	}
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

/**
 * Apply a signature-checked NIP-09 event to the in-memory store and durable browser cache.
 * Applesauce intentionally keeps deletion state outside insert$, so kind 5 needs this explicit
 * path to prevent cached targets from reappearing after a cold restart.
 */
export type DeletionIngestResult = 'applied' | 'invalid' | 'cache-error'

export async function ingestDeletionEvent(
	event: NostrEvent,
	options: { retainNative?: boolean } = {},
): Promise<DeletionIngestResult> {
	const verified = verifiedDeletionEvent(event)
	if (!verified) return 'invalid'
	// A durability failure must never keep an otherwise valid deletion visible in
	// the current process. Apply it first, then report persistence health to gates.
	eventStore.add(verified)
	invalidateCachedMapLayerSetForDeletion(verified, config.trustedMapnoliaPubkeys)
	if (options.retainNative !== false) {
		try {
			const savedRegions = await getSavedRegionService()
			await savedRegions.retainDeletions([verified])
		} catch (error) {
			logCacheError('native deletion retention', error)
			return 'cache-error'
		}
	}

	await cacheReady
	const activeCache = cache
	if (!activeCache) return 'applied'
	try {
		await applyVerifiedDeletionToCache(deletionCacheFor(activeCache), verified)
	} catch (error) {
		logCacheError('deletion write', error)
		return 'cache-error'
	}
	return 'applied'
}

/** Pipe newly-added events into the cache in batches. Cleanup on HMR. */
const stopPersist = hasIndexedDB
	? persistEventsToCache(eventStore, async (events: NostrEvent[]) => {
			await cacheReady
			const activeCache = cache
			if (!activeCache) return

			// A target can enter this helper's five-second buffer before its deletion arrives.
			// Re-check at write time so that late tombstone cannot be undone by the buffer.
			const persistable = filterDeletedCacheWrites(events, isEventDeleted)
			const results = await Promise.allSettled(persistable.map((event) => activeCache.add(event)))
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
	const queryableFilters = cacheQueryableFilters(filters)
	if (queryableFilters.length === 0) return []

	try {
		return await cache.query(queryableFilters)
	} catch (err) {
		logCacheError('query', err)
		return []
	}
}

/**
 * Strict cache read for safety gates. Unlike normal UI hydration, callers must
 * distinguish a genuinely empty result from unavailable or failed IndexedDB.
 */
export async function queryCacheStrict(filters: Filter[]): Promise<NostrEvent[]> {
	await cacheReady
	if (!cache) throw new Error('The local Nostr cache is unavailable')
	const queryableFilters = cacheQueryableFilters(filters)
	if (queryableFilters.length === 0) return []
	return cache.query(queryableFilters)
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
 * Bucket-routed (see relay-router.ts): address pointers carry their kind, so
 * profile/wallet lookups may reach public relays in dev while content lookups
 * stay on the local relay. `followRelayHints: false` on both loaders — relay
 * hints embedded in tags/pointers must never open implicit sockets; the
 * router's relay sets are the only read paths.
 */
const contentLoader = createUnifiedEventLoader(pool, {
	eventStore,
	cacheRequest,
	followRelayHints: false,
	lookupRelays: readRelays$('content'),
	extraRelays: readRelays$('content'),
})
const socialLoader = createUnifiedEventLoader(pool, {
	eventStore,
	cacheRequest,
	followRelayHints: false,
	lookupRelays: readRelays$('profile'),
	extraRelays: readRelays$('profile'),
})
const routedLoader: UnifiedEventLoader = Object.assign(
	(pointer: Parameters<UnifiedEventLoader>[0]) => {
		// Event pointers (plain ids) carry no kind — treat as content, the
		// bucket that must never leave the local relay in dev.
		if (isEventPointer(pointer)) return contentLoader(pointer)
		return bucketForKind(pointer.kind) === 'content'
			? contentLoader(pointer)
			: socialLoader(pointer)
	},
	{
		stop: () => {
			contentLoader.stop()
			socialLoader.stop()
		},
		[Symbol.dispose]: () => {
			contentLoader.stop()
			socialLoader.stop()
		},
	},
)
eventStore.eventLoader = routedLoader

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
 *   - 'inbox':     publish to the recipient's NIP-65 inbox relays.
 *   - 'reply':     publish to the author's outboxes ∪ the recipient's inboxes —
 *                  the correct NIP-65 shape for comments/reactions/zap requests,
 *                  so the recipient actually discovers them.
 *
 * In development, outbox/inbox/reply routing is silently downgraded to
 * `config.writeRelays` (= local relay) so we never broadcast to public relays
 * even if the user's NIP-65 record points to public ones (unless the
 * allowPublicWrites dev flag is on — see relay-router.ts).
 */
export type PublishRouting = 'configured' | 'outbox' | 'inbox' | 'reply'

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
 * Routed publishes ALWAYS include the configured write relays as a baseline.
 *
 * The app's content model reads entity kinds from the configured relays
 * (relay-router 'content' bucket) — NIP-65 routing is an additional
 * notification/discovery channel, not a replacement home. Without the
 * baseline, an event routed purely to a counterparty's personal mailboxes is
 * invisible to every reader on the app relay: the proposer sees their own
 * proposal (local eventStore) while the dataset owner's Proposals tab —
 * subscribed on the app relay — never receives it.
 */
function withConfiguredBaseline(routed: string[]): string[] {
	return [...new Set([...config.writeRelays, ...routed])]
}

function relayResults(
	responses: Array<{ from: string; ok: boolean; message?: string }>,
): OutboxRelayResult[] {
	return responses.map((response) => ({
		relayUrl: response.from,
		ok: response.ok,
		...(response.message ? { message: response.message } : {}),
	}))
}

async function deliverOutboxItem(service: PublishOutboxService, item: OutboxItem): Promise<void> {
	const targetRelays = pendingOutboxRelays(item)
	if (targetRelays.length === 0) return
	const event = JSON.parse(item.eventJson) as NostrEvent
	if (event.kind === 5) await ingestDeletionEvent(event)
	else eventStore.add(event)
	try {
		const responses = await pool.publish(targetRelays, event)
		await service.recordResults(item.id, relayResults(responses))
		notifyPublishOutboxChanged()
	} catch (error) {
		await service.recordResults(item.id, failedRelayResults(targetRelays, error))
		notifyPublishOutboxChanged()
	}
}

let outboxFlushPromise: Promise<void> | null = null
let outboxReplayStarted = false

/** Replay due native publishes without ever requesting or persisting a signing key. */
export function flushPublishOutbox(): Promise<void> {
	outboxFlushPromise ??= getPublishOutboxService()
		.then(async (service) => {
			if (!service) return
			const due = await service.flush()
			if (due.length > 0) notifyPublishOutboxChanged()
			for (const item of due) await deliverOutboxItem(service, item)
		})
		.catch((error) => console.warn('[nostr] native outbox replay failed', error))
		.finally(() => {
			outboxFlushPromise = null
		})
	return outboxFlushPromise
}

/** Start the Android resume/online replay hooks once. */
export function startPublishOutbox(): Promise<void> {
	if (!outboxReplayStarted && typeof window !== 'undefined') {
		outboxReplayStarted = true
		window.addEventListener('online', () => void flushPublishOutbox())
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void flushPublishOutbox()
		})
	}
	return flushPublishOutbox()
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
	} else if (shouldCollapseWritesToLocal() || routing === 'configured') {
		// In dev, ALL routing modes collapse to writeRelays. This is the dev-leak
		// safety net: even if a user's NIP-65 mailboxes point at public relays,
		// we never write to them in dev — unless the allowPublicWrites dev flag
		// (relay-router) is explicitly enabled for authoring.
		targetRelays = config.writeRelays
	} else if (routing === 'outbox') {
		const outboxes = await resolveRoutedRelays(
			event.pubkey,
			'outboxes',
			mailboxTimeoutMs ?? MAILBOX_TIMEOUT_DEFAULT,
		)
		targetRelays = withConfiguredBaseline(outboxes)
	} else if (routing === 'reply') {
		if (!target) throw new Error("publish({ routing: 'reply' }) requires a target pubkey")
		const timeoutMs = mailboxTimeoutMs ?? MAILBOX_TIMEOUT_DEFAULT
		const [outboxes, inboxes] = await Promise.all([
			resolveRoutedRelays(event.pubkey, 'outboxes', timeoutMs),
			resolveRoutedRelays(target, 'inboxes', timeoutMs),
		])
		targetRelays = withConfiguredBaseline([...outboxes, ...inboxes])
	} else {
		// routing === 'inbox'
		if (!target) throw new Error("publish({ routing: 'inbox' }) requires a target pubkey")
		const inboxes = await resolveRoutedRelays(
			target,
			'inboxes',
			mailboxTimeoutMs ?? MAILBOX_TIMEOUT_DEFAULT,
		)
		targetRelays = withConfiguredBaseline(inboxes)
	}

	const outbox = event.kind === LIVE_BEACON_KIND ? null : await getPublishOutboxService()
	const durableRouting: PublishRouting = relays ? 'configured' : routing
	const queued = outbox
		? await outbox.enqueue({
				version: 1,
				eventJson: JSON.stringify(event),
				routing: durableRouting,
				...(target && !relays && (routing === 'inbox' || routing === 'reply')
					? { targetPubkey: target }
					: {}),
				relayUrls: targetRelays,
				requiredRelayUrls: relays
					? targetRelays
					: requiredPublishRelays(targetRelays, config.writeRelays),
			})
		: null
	if (queued) notifyPublishOutboxChanged()
	if (event.kind === 5) await ingestDeletionEvent(event)
	else eventStore.add(event)
	const deliveryRelays = queued ? pendingOutboxRelays(queued) : targetRelays
	if (deliveryRelays.length === 0) return []
	// Normal native authoring succeeds once the immutable signed event is durable.
	// Delivery continues in the background and survives process death. Explicit
	// relay-management publishes remain synchronous because that UI displays each
	// relay's immediate response.
	if (outbox && queued && !relays) {
		void deliverOutboxItem(outbox, queued).catch((error) =>
			console.warn('[nostr] initial native outbox delivery failed', error),
		)
		return []
	}
	try {
		const responses = await pool.publish(deliveryRelays, event)
		if (outbox && queued) {
			await outbox.recordResults(queued.id, relayResults(responses))
			notifyPublishOutboxChanged()
		}
		return responses
	} catch (error) {
		if (outbox && queued) {
			await outbox.recordResults(queued.id, failedRelayResults(deliveryRelays, error))
			notifyPublishOutboxChanged()
		}
		throw error
	}
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
