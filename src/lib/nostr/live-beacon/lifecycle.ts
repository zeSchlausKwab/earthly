/**
 * Live Beacon lifecycle service (kind 37521) — the single source-of-truth publish
 * path.
 *
 * A thin, testable wrapper over `LiveBeaconFactory` (Phase 8) that, on EVERY
 * publish, re-derives the lossy queryable `bbox` + `g` discovery tags from the
 * precise `content.geometry` via turf (BEACON-01 / D-09 — geometry is the single
 * source of truth; the tags never drift), keeps the NIP-40 `expiration`, and —
 * for a PUBLIC beacon ONLY — emits the `t:'live'` discovery marker (D-10).
 * `updateBeacon` preserves the session `d`-tag on every heartbeat
 * (parameterized-replaceable, no lineage fork).
 *
 * Mirrors `temporal-sighting/lifecycle.ts` with three deliberate divergences:
 *   1. a `visibility: 'public' | 'link-only'` branch that, for link-only, OMITS
 *      the `t:'live'` marker AND the `g`/`bbox` geo tags (Pitfall P-6 /
 *      T-12-02-LINKONLY — a link-only beacon must never surface in a
 *      `{ kinds:[37521], '#t':['live'] }` discovery scan);
 *   2. `publish(signed, { routing: 'configured' })` NOT `'outbox'` — a throwaway
 *      per-session key has no NIP-65 mailbox, so outbox routing would time out
 *      1.5s per heartbeat (D-05);
 *   3. a `status:'live'|'ended'` discriminator on content; `stopBeacon` publishes
 *      one final `status:'ended'` event keeping the SAME `d` + expiration (D-04).
 *
 * The bbox/centroid turf calls are wrapped in try/catch returning undefined on
 * invalid geometry (mirrors `geo-event/helpers.ts`), so a malformed/oversized
 * geometry degrades to "no discovery tags" rather than throwing.
 *
 * The service does NOT cast — callers cast the returned signed event via
 * `castEvent(signed, LiveBeacon, eventStore)`.
 */

import { bbox, centroid } from '@turf/turf'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { EventStoreSymbol } from 'applesauce-core/helpers/event'
import { publish } from '@/lib/nostr'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
// Import the store DIRECTLY (not via the barrel) so the lifecycle can attach the
// signed event to the reactive store — and remain castable — even when a test
// mocks `@/lib/nostr` down to just `publish`.
import { eventStore } from '@/lib/nostr/store'
import { LiveBeaconFactory } from './factory'
import { getExpirationTimestamp } from 'applesauce-core/helpers/expiration'
import { getLiveBeaconContent, type LiveBeaconContent, type LiveBeaconEvent } from './helpers'

/**
 * Stamp the freshly-signed event with our EventStore as its parent so the caller
 * can `castEvent(signed, LiveBeacon)` (store-free) immediately. `publish()` also
 * runs `eventStore.add` in production (which stamps this same reference after
 * signature verification); doing it here makes the returned event self-castable
 * regardless of the relay round-trip and independent of `publish` being mocked.
 */
function attachStore<T extends NostrEvent>(event: T): T {
	if (!Reflect.get(event, EventStoreSymbol)) {
		Reflect.set(event, EventStoreSymbol, eventStore)
	}
	return event
}

/** Beacon discovery posture (D-10). */
export type BeaconVisibility = 'public' | 'link-only'

/** Options for a beacon publish/heartbeat. */
export interface BeaconUpdateOptions {
	/** The beacon content (geometry + status). */
	content: Partial<LiveBeaconContent>
	/**
	 * NIP-40 expiry timestamp (epoch seconds, UTC) at which the beacon should fade
	 * from the map. Undefined ⇒ never expires.
	 */
	expiration?: number
	/**
	 * PUBLIC ⇒ emit the `t:'live'` discovery marker + `g`/`bbox` geo tags.
	 * LINK-ONLY ⇒ omit ALL of them (Pitfall P-6).
	 */
	visibility: BeaconVisibility
	/**
	 * The existing beacon event to heartbeat — preserves its `d`-tag lineage (no
	 * fork). Absent ⇒ a NEW beacon (fresh `d`).
	 */
	existing?: NostrEvent
}

/**
 * Derive the `bbox` discovery tuple from a content geometry. Returns undefined on
 * absent/invalid geometry (mirrors `computeBboxFor`).
 */
function deriveBbox(content: Partial<LiveBeaconContent>): GeoBoundingBox | undefined {
	if (!content.geometry) return undefined
	try {
		const computed = bbox(content.geometry) as GeoBoundingBox
		if (computed.every((value) => Number.isFinite(value))) return computed
	} catch {
		// invalid/oversized geometry — degrade to no bbox
	}
	return undefined
}

/**
 * Derive the `[lon, lat]` centroid from a content geometry for the `g` geohash tag.
 * Returns undefined on absent/invalid geometry (mirrors `computeGeohashFor`).
 */
function deriveCentroid(content: Partial<LiveBeaconContent>): [number, number] | undefined {
	if (!content.geometry) return undefined
	try {
		const coords = centroid(content.geometry).geometry.coordinates
		const lon = coords?.[0]
		const lat = coords?.[1]
		if (typeof lon === 'number' && typeof lat === 'number') return [lon, lat]
	} catch {
		// invalid/oversized geometry — degrade to no geohash
	}
	return undefined
}

/**
 * Publish (or heartbeat) a beacon. Public beacons derive `bbox`/`g` from
 * `content.geometry` AND emit `t:'live'`; link-only beacons omit ALL discovery
 * tags (D-10 / Pitfall P-6). When `options.existing` is provided, the `d`-tag
 * lineage is preserved (the modify path — a heartbeat, no fork). Returns the
 * signed event; the caller casts it.
 */
export async function updateBeacon(
	options: BeaconUpdateOptions,
	signer: SignerLike,
): Promise<NostrEvent> {
	const { content, expiration, visibility, existing } = options
	const isPublic = visibility === 'public'

	const factory = existing
		? LiveBeaconFactory.modify(existing as LiveBeaconEvent)
		: LiveBeaconFactory.create(content)

	const signed = await factory
		.beacon(content)
		.bbox(isPublic ? deriveBbox(content) : undefined)
		.geohash(isPublic ? deriveCentroid(content) : undefined)
		.hashtags(isPublic ? ['live'] : [])
		.expiration(expiration)
		// Throwaway per-session key has no NIP-65 mailbox — route to configured
		// relays, NOT outbox (D-05). Outbox would time out 1.5s per heartbeat.
		.sign(signer)

	await publish(signed, { routing: 'configured' })
	return attachStore(signed)
}

/**
 * Publish ONE final terminal beacon with `content.status: 'ended'`, the SAME `d`,
 * and the existing NIP-40 expiration retained (D-04) — viewers see "ended" until
 * expiry rather than a silent disappearance. Re-derives visibility from the
 * existing event (a public beacon ends public; a link-only beacon ends link-only).
 */
export async function stopBeacon(
	existingEvent: NostrEvent,
	signer: SignerLike,
): Promise<NostrEvent> {
	const previous = getLiveBeaconContent(existingEvent)
	const wasPublic = existingEvent.tags.some((t) => t[0] === 't' && t[1] === 'live')

	return updateBeacon(
		{
			existing: existingEvent,
			content: { geometry: previous.geometry, status: 'ended' },
			expiration: getExpirationTimestamp(existingEvent),
			visibility: wasPublic ? 'public' : 'link-only',
		},
		signer,
	)
}
