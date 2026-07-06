/**
 * Relay router — the single source of truth for which relays each subsystem
 * may read from and write to, per stage (dev/prod).
 *
 * Why this exists: nostr stages can't be separated by a simple env switch.
 * The rules Earthly enforces (see docs/RELAY_STAGES.md):
 *
 *   - Prod: all buckets use the configured relay sets.
 *   - Dev: CONTENT entities (datasets, comments, groups, stories, beacons,
 *     sightings, proposals, reactions, zaps…) talk ONLY to the local dev relay.
 *     PROFILE (kind 0/3/10002) and WALLET (NIP-60/61) data may still be read
 *     from public relays. DISCOVERY (ContextVM RPC, entity search) follows
 *     content rules.
 *   - Dev flags (persisted in localStorage) can opt in to public reads
 *     (debugging) or public writes (authoring). Defaults: both OFF.
 *
 * Applesauce does implicit relay work (relay hints in tags/pointers, mailbox
 * lookups) that can silently open sockets to relays we never configured. Two
 * mechanisms make this watertight:
 *
 *   1. Loaders are created with `followRelayHints: false` and bucket-routed
 *      relay observables (see src/lib/nostr/index.ts).
 *   2. A dev-only pool guard (guardedWebSocketCtor) refuses socket opens to
 *      any relay outside the allowlist — the backstop for anything applesauce
 *      (or future code) tries implicitly.
 */

import { BehaviorSubject, map, type Observable } from 'rxjs'
import { config } from '@/config'

export type RelayBucket = 'content' | 'profile' | 'wallet' | 'discovery'

/** Dev-only escape hatches. Ignored entirely in production. */
export interface DevRelayFlags {
	/** Allow CONTENT/DISCOVERY reads from public relays (debugging). */
	allowPublicReads: boolean
	/** Allow publishes to public relays (authoring from dev). */
	allowPublicWrites: boolean
}

const FLAGS_STORAGE_KEY = 'earthly:dev-relay-flags'
const DEFAULT_FLAGS: DevRelayFlags = { allowPublicReads: false, allowPublicWrites: false }

function loadFlags(): DevRelayFlags {
	if (typeof localStorage === 'undefined') return DEFAULT_FLAGS
	try {
		const raw = localStorage.getItem(FLAGS_STORAGE_KEY)
		if (!raw) return DEFAULT_FLAGS
		const parsed = JSON.parse(raw) as Partial<DevRelayFlags>
		return {
			allowPublicReads: Boolean(parsed.allowPublicReads),
			allowPublicWrites: Boolean(parsed.allowPublicWrites),
		}
	} catch {
		return DEFAULT_FLAGS
	}
}

/** Live dev-flag state. Subscribe for UI; loaders derive their relay sets from it. */
export const devRelayFlags$ = new BehaviorSubject<DevRelayFlags>(loadFlags())

export function getDevRelayFlags(): DevRelayFlags {
	return devRelayFlags$.value
}

export function setDevRelayFlags(updates: Partial<DevRelayFlags>): void {
	const next = { ...devRelayFlags$.value, ...updates }
	devRelayFlags$.next(next)
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(next))
		} catch {
			// Persistence is best-effort; the in-memory flags still apply.
		}
	}
}

/** Profile-plane kinds: identity and relay lists. Public reads allowed in dev. */
const PROFILE_KINDS = new Set([0, 3, 10002, 10065])

/**
 * Wallet-plane kinds (NIP-60/61): wallet 17375, tokens 7375, history 7376,
 * quotes 7374, nutzap info 10019, nutzaps 9321. NIP-44-encrypted per user;
 * public reads allowed in dev so a real wallet keeps working.
 */
const WALLET_KINDS = new Set([17375, 7375, 7376, 7374, 10019, 9321])

/**
 * Classify an event kind into a relay bucket. Anything not explicitly
 * profile/wallet is CONTENT — the safe default, since content is the bucket
 * that must never leave the local relay in dev.
 */
export function bucketForKind(kind: number): RelayBucket {
	if (PROFILE_KINDS.has(kind)) return 'profile'
	if (WALLET_KINDS.has(kind)) return 'wallet'
	return 'content'
}

/**
 * Pure core so tests can exercise the routing table without the config
 * singleton (whose dev defaults depend on `location`).
 */
export function resolveReadRelays(args: {
	bucket: RelayBucket
	isDevelopment: boolean
	flags: DevRelayFlags
	readRelays: string[]
	writeRelays: string[]
}): string[] {
	const { bucket, isDevelopment, flags, readRelays, writeRelays } = args
	if (!isDevelopment) return readRelays
	// Dev: profile + wallet may read broadly; content + discovery stay local
	// unless the debugging flag is set.
	if (bucket === 'profile' || bucket === 'wallet') return readRelays
	return flags.allowPublicReads ? readRelays : writeRelays
}

/** The relay set the given bucket may READ from right now. */
export function readRelaysFor(bucket: RelayBucket): string[] {
	return resolveReadRelays({
		bucket,
		isDevelopment: config.isDevelopment,
		flags: devRelayFlags$.value,
		readRelays: config.readRelays,
		writeRelays: config.writeRelays,
	})
}

/** Observable variant for applesauce loaders (they accept Observable<string[]>). */
export function readRelays$(bucket: RelayBucket): Observable<string[]> {
	return devRelayFlags$.pipe(map(() => readRelaysFor(bucket)))
}

/**
 * Whether `publish()` must collapse outbox/inbox routing to the local write
 * set. True in dev unless the authoring flag is on.
 */
export function shouldCollapseWritesToLocal(): boolean {
	return config.isDevelopment && !devRelayFlags$.value.allowPublicWrites
}

// ---------------------------------------------------------------------------
// Pool guard (dev backstop)
// ---------------------------------------------------------------------------

function normalizeRelayUrl(url: string): string {
	try {
		const u = new URL(url)
		u.hash = ''
		u.search = ''
		const normalized = u.toString()
		return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
	} catch {
		return url
	}
}

/**
 * Relays beyond the configured sets that code has *explicitly* vouched for —
 * e.g. the user's own NIP-60 wallet relays (user-approved dev exception: the
 * wallet ActionRunner publishes to the wallet's real relays even in dev, so
 * local-only publishing doesn't fork real wallet state).
 */
const dynamicAllowed = new Set<string>()

/** Vouch for extra relay URLs (wallet relays, user-entered relays, …). */
export function allowRelays(urls: string[]): void {
	for (const url of urls) dynamicAllowed.add(normalizeRelayUrl(url))
}

function baseAllowlist(): Set<string> {
	// readRelays is a superset of writeRelays, but union anyway for safety.
	return new Set([...config.readRelays, ...config.writeRelays].map(normalizeRelayUrl))
}

/** Pure core, exported for tests. */
export function isRelayAllowedWith(args: {
	url: string
	isDevelopment: boolean
	flags: DevRelayFlags
	allowlist: Set<string>
	dynamic: Set<string>
}): boolean {
	const { url, isDevelopment, flags, allowlist, dynamic } = args
	if (!isDevelopment) return true
	// Either escape hatch disables the guard: the user has explicitly chosen
	// to talk to public relays from dev.
	if (flags.allowPublicReads || flags.allowPublicWrites) return true
	const normalized = normalizeRelayUrl(url)
	return allowlist.has(normalized) || dynamic.has(normalized)
}

/** Should the pool be allowed to open a socket to this relay right now? */
export function isRelayAllowed(url: string): boolean {
	return isRelayAllowedWith({
		url,
		isDevelopment: config.isDevelopment,
		flags: devRelayFlags$.value,
		allowlist: baseAllowlist(),
		dynamic: dynamicAllowed,
	})
}

const warnedBlockedUrls = new Set<string>()

/**
 * A WebSocket constructor for the RelayPool that refuses connections to
 * non-allowlisted relays in dev. Blocked sockets close immediately with code
 * 4000; applesauce treats the relay as unreachable and moves on.
 *
 * This is deliberately the LAST line of defense — loaders and publish routing
 * should never even ask for a disallowed relay. If you see the console error,
 * something upstream is leaking; fix the routing, don't just allowlist.
 */
export function guardedWebSocketCtor(): typeof WebSocket {
	if (typeof WebSocket === 'undefined') return WebSocket

	return new Proxy(WebSocket, {
		construct(target, [url, protocols]: [string | URL, string | string[] | undefined]) {
			const urlString = String(url)
			if (isRelayAllowed(urlString)) {
				return new target(url as string, protocols)
			}
			if (!warnedBlockedUrls.has(urlString)) {
				warnedBlockedUrls.add(urlString)
				console.error(
					`[relay-router] BLOCKED dev socket to non-allowlisted relay: ${urlString}. ` +
						'Content stays on the local relay in dev. Enable the dev relay flags ' +
						'(settings → relays) to opt in, or route this call through relay-router.',
				)
			}
			// A never-connecting socket: report closed on the next tick.
			const fake = {
				url: urlString,
				readyState: 3, // CLOSED
				bufferedAmount: 0,
				extensions: '',
				protocol: '',
				binaryType: 'blob' as BinaryType,
				onopen: null as ((ev: Event) => void) | null,
				onclose: null as ((ev: CloseEvent) => void) | null,
				onerror: null as ((ev: Event) => void) | null,
				onmessage: null as ((ev: MessageEvent) => void) | null,
				close() {},
				send() {},
				addEventListener(type: string, listener: (ev: unknown) => void) {
					if (type === 'close' || type === 'error') {
						queueMicrotask(() =>
							listener(
								type === 'close'
									? new CloseEvent('close', { code: 4000, reason: 'blocked by relay-router' })
									: new Event('error'),
							),
						)
					}
				},
				removeEventListener() {},
				dispatchEvent() {
					return false
				},
			}
			queueMicrotask(() => {
				fake.onerror?.(new Event('error'))
				fake.onclose?.(new CloseEvent('close', { code: 4000, reason: 'blocked by relay-router' }))
			})
			return fake as unknown as WebSocket
		},
	}) as typeof WebSocket
}
