/**
 * Seed-script relay/signer compat layer.
 *
 * Provides the small slice of the legacy `@nostr-dev-kit/ndk` API the seed
 * scripts still rely on (`NDK`, `NDKEvent`, `NDKPrivateKeySigner`, etc.) but
 * implemented entirely on top of `applesauce-relay` and `nostr-tools`.
 *
 * DEPRECATED: the unified seeder (`scripts/seed.ts` + `src/lib/seeder/`) is
 * applesauce-native and does NOT use this shim. Its only remaining consumers
 * are the archived scripts in `scripts/seed-legacy/`; this directory gets
 * deleted together with them after one release.
 *
 * Behavior:
 *   - `NDK` carries an explicit relay-url list and a lazy `RelayPool` from
 *     `applesauce-relay`. `connect()` is a no-op (the pool dials on demand).
 *   - `NDKEvent` is a writable event template that signs via nostr-tools
 *     `finalizeEvent` and publishes through the pool.
 *   - `NDKPrivateKeySigner` holds a hex secret key and exposes the same
 *     `blockUntilReady` / `user()` / `sign(event)` shape NDK has.
 *   - `registerEventClass` is a no-op — the class registry in NDK was used to
 *     auto-cast events on subscription, which we never relied on for seeding.
 *
 * Limitations: this is the *minimum* surface area the seed scripts touch. If
 * a script reaches for an NDK method that isn't here, add it explicitly
 * rather than papering over with `any`.
 */

import { RelayPool } from 'applesauce-relay'
import type { Filter } from 'nostr-tools'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils.js'
import { firstValueFrom, toArray } from 'rxjs'

export interface NDKConstructorOptions {
	explicitRelayUrls: string[]
	enableOutboxModel?: boolean
	signer?: NDKSigner
}

/** Stand-in for NDK's `Relay`. The applesauce pool owns reconnection. */
export interface NDKRelay {
	url: string
	connectivity: { connectionStats: { attempts: number } }
	disconnect(): void
}

/** Stand-in for NDK's `Pool`. Iterating yields nothing — applesauce manages relays internally. */
export interface NDKPool {
	relays: { values(): IterableIterator<NDKRelay> }
}

/**
 * Minimal NDK stand-in. Wraps a `RelayPool` and a relay-list so the
 * `event.publish()` happy path keeps working. Also exposes the no-op
 * `pool.relays.values()` / `connect()` surface that NDK retry helpers poke at.
 */
export default class NDK {
	explicitRelayUrls: string[]
	signer?: NDKSigner
	/** applesauce pool used for actual publish/request work. */
	readonly applesaucePool: RelayPool
	/** NDK-shaped wrapper exposed as `.pool`. */
	pool: NDKPool

	constructor(opts: NDKConstructorOptions) {
		this.explicitRelayUrls = opts.explicitRelayUrls ?? []
		this.signer = opts.signer
		this.applesaucePool = new RelayPool()
		this.pool = {
			relays: {
				// We never expose the underlying applesauce relays — let consumers
				// iterate an empty list. Their disconnect/reconnect logic becomes a
				// no-op, which is safe since applesauce handles reconnects on demand.
				*values() {},
			},
		}
	}

	/** No-op: the pool connects lazily when a publish/request actually fires. */
	async connect(): Promise<void> {
		return
	}

	/**
	 * Query the configured relays for events matching `filter` and return them
	 * as a Set (NDK's `fetchEvents` shape). Uses applesauce-relay's `pool.request`
	 * which auto-completes on EOSE.
	 */
	async fetchEvents(filter: Filter | Filter[]): Promise<Set<NDKEvent>> {
		const filters = Array.isArray(filter) ? filter : [filter]
		const events = await firstValueFrom(
			this.applesaucePool.request(this.explicitRelayUrls, filters).pipe(toArray()),
		)
		return new Set(events.map((event) => new NDKEvent(this, event)))
	}
}

export type NDKTag = string[]

export interface NDKUserProfile {
	name?: string
	displayName?: string
	about?: string
	picture?: string
	banner?: string
	website?: string
	nip05?: string
	lud06?: string
	lud16?: string
	[key: string]: unknown
}

export interface NDKUser {
	pubkey: string
}

export interface NDKSigner {
	pubkey: string
	blockUntilReady(): Promise<void>
	user(): Promise<NDKUser>
	sign(event: EventTemplate): Promise<string>
	rawSign?(event: EventTemplate): Promise<NostrEvent>
}

/**
 * Nostr-tools-backed implementation of NDK's private-key signer interface.
 *
 * Also satisfies applesauce's `EventSigner` shape (`getPublicKey()` /
 * `signEvent(template)`) so it can be passed straight to applesauce factories'
 * `.sign(signer)` calls in seed scripts.
 */
export class NDKPrivateKeySigner implements NDKSigner {
	readonly secretKey: Uint8Array
	readonly pubkey: string

	constructor(secret: string | Uint8Array) {
		this.secretKey = typeof secret === 'string' ? hexToBytes(secret) : secret
		this.pubkey = getPublicKey(this.secretKey)
	}

	// ── NDK API ────────────────────────────────────────────────────────────

	async blockUntilReady(): Promise<void> {
		return
	}

	async user(): Promise<NDKUser> {
		return { pubkey: this.pubkey }
	}

	/** NDK shape: sign and return only the resulting `sig`. */
	async sign(event: EventTemplate): Promise<string> {
		const signed = finalizeEvent(event, this.secretKey)
		return signed.sig
	}

	async rawSign(event: EventTemplate): Promise<NostrEvent> {
		return finalizeEvent(event, this.secretKey)
	}

	// ── applesauce `EventSigner` API ───────────────────────────────────────

	getPublicKey(): string {
		return this.pubkey
	}

	signEvent(draft: EventTemplate): NostrEvent {
		return finalizeEvent(draft, this.secretKey)
	}
}

/**
 * NDKEvent stand-in. Mutable event template; `sign()` populates `id`/`sig`/
 * `pubkey`/`created_at`, and `publish()` broadcasts to the parent NDK
 * instance's `explicitRelayUrls`.
 */
export class NDKEvent {
	ndk?: NDK
	kind?: number
	content: string = ''
	tags: NDKTag[] = []
	created_at?: number
	pubkey?: string
	id?: string
	sig?: string

	constructor(ndk?: NDK, raw?: Partial<NostrEvent>) {
		this.ndk = ndk
		if (raw) {
			if (raw.kind !== undefined) this.kind = raw.kind
			if (raw.content !== undefined) this.content = raw.content
			if (raw.tags) this.tags = raw.tags.map((t) => [...t])
			if (raw.created_at !== undefined) this.created_at = raw.created_at
			if (raw.pubkey !== undefined) this.pubkey = raw.pubkey
			if (raw.id !== undefined) this.id = raw.id
			if (raw.sig !== undefined) this.sig = raw.sig
		}
	}

	/** The `d` tag value (used for replaceable events). */
	get dTag(): string | undefined {
		return this.tagValue('d')
	}

	set dTag(value: string | undefined) {
		this.removeTag('d')
		if (value !== undefined) this.tags.push(['d', value])
	}

	/** First value of the named tag, or undefined. */
	tagValue(name: string): string | undefined {
		return this.tags.find((t) => t[0] === name)?.[1]
	}

	/** Drop every tag with the given name. */
	removeTag(name: string): void {
		this.tags = this.tags.filter((t) => t[0] !== name)
	}

	/** Sign the event with a private-key signer. Populates id/sig/pubkey/created_at. */
	async sign(signer?: NDKSigner): Promise<string> {
		if (!signer) throw new Error('NDKEvent.sign() requires a signer')
		if (this.kind === undefined) throw new Error('NDKEvent.sign() requires a kind')

		const template: EventTemplate = {
			kind: this.kind,
			content: this.content,
			tags: this.tags,
			created_at: this.created_at ?? Math.floor(Date.now() / 1000),
		}

		// Prefer rawSign (nostr-tools finalizeEvent) so we get id/sig/pubkey in one call.
		if (signer.rawSign) {
			const signed = await signer.rawSign(template)
			this.id = signed.id
			this.sig = signed.sig
			this.pubkey = signed.pubkey
			this.created_at = signed.created_at
			return signed.sig
		}

		const sig = await signer.sign(template)
		this.sig = sig
		this.created_at = template.created_at
		this.pubkey = (await signer.user()).pubkey
		// Without rawSign the id is unknown — most seed call sites read .id only
		// after sign() and these only run with private-key signers, so the path
		// above covers them. Leave .id unset rather than fabricate.
		return sig
	}

	/**
	 * Broadcast the signed event to the parent NDK's relays.
	 *
	 * Extra args are accepted but ignored — NDK's API was `publish(relaySet?, timeoutMs?)`.
	 * The applesauce pool handles its own timeouts/retries; we just pass through.
	 */
	async publish(_relaySet?: unknown, _timeoutMs?: number): Promise<void> {
		if (!this.id || !this.sig || !this.pubkey || this.created_at === undefined) {
			throw new Error('NDKEvent.publish() called on an unsigned event')
		}
		if (!this.ndk) throw new Error('NDKEvent.publish() needs an NDK instance')
		const relays = this.ndk.explicitRelayUrls
		if (!relays || relays.length === 0) {
			throw new Error('NDKEvent.publish() needs at least one relay')
		}
		await this.ndk.applesaucePool.publish(relays, this.rawEvent())
	}

	/** Project the event into a plain nostr-tools NostrEvent. */
	rawEvent(): NostrEvent {
		if (this.kind === undefined) throw new Error('rawEvent() needs a kind')
		return {
			id: this.id ?? '',
			kind: this.kind,
			content: this.content,
			tags: this.tags,
			created_at: this.created_at ?? Math.floor(Date.now() / 1000),
			pubkey: this.pubkey ?? '',
			sig: this.sig ?? '',
		}
	}
}

/** NDK's class-registry for auto-casting events on subscription — unused here. */
export function registerEventClass(_cls: unknown): void {
	return
}

/** Subset of NDKKind enum referenced by the seed scripts. */
export const NDKKind = {
	EventDeletion: 5,
} as const
