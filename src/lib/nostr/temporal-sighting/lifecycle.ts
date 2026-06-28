/**
 * Temporal Sighting lifecycle service (kind 37522) — the single source-of-truth
 * publish path.
 *
 * A thin, testable wrapper over `TemporalSightingFactory` (Phase 8) that, on EVERY
 * publish, re-derives the lossy queryable `bbox` + `g` discovery tags from the
 * precise `content.geometry` via turf (SIGHT-01 / D-02 — geometry is the single
 * source of truth; the tags never drift). It also writes the NIP-40 `expiration`
 * (INDEPENDENT of the observation `end` — Pitfall P-4) and the `c` context
 * references (SIGHT-02). `editSighting` preserves the `d`-tag lineage on edit
 * (parameterized-replaceable, no fork).
 *
 * Mirrors `story/lifecycle.ts`, substituting the Story `a`-from-body re-derive
 * with the bbox/g-from-geometry re-derive. The bbox/centroid turf calls are
 * wrapped in try/catch returning undefined on invalid geometry — exactly as
 * `geo-event/helpers.ts` `computeBboxFor`/`computeGeohashFor` — so a malformed or
 * oversized geometry degrades to "no discovery tags" rather than throwing
 * (T-11-02-03).
 *
 * The service does NOT cast — callers cast the returned signed event via
 * `castEvent(signed, TemporalSighting, eventStore)`.
 */

import { bbox, centroid } from '@turf/turf'
import { DeleteFactory } from 'applesauce-core/factories'
import type { EventSigner } from 'applesauce-core/factories/types'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { EventStoreSymbol } from 'applesauce-core/helpers/event'
import { publish } from '@/lib/nostr'
import type { SignerLike } from '@/lib/nostr/entityFactory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
// Import the store DIRECTLY (not via the barrel) so the lifecycle can attach the
// signed event to the reactive store — and remain castable — even when a test
// mocks `@/lib/nostr` down to just `publish`.
import { eventStore } from '@/lib/nostr/store'

/**
 * Stamp the freshly-signed event with our EventStore as its parent so the caller
 * can `castEvent(signed, TemporalSighting)` (store-free) immediately. `publish()`
 * also runs `eventStore.add` in production (which stamps this same reference after
 * signature verification); doing it here makes the returned event self-castable
 * regardless of the relay round-trip and independent of `publish` being mocked.
 */
function attachStore<T extends NostrEvent>(event: T): T {
	if (!Reflect.get(event, EventStoreSymbol)) {
		Reflect.set(event, EventStoreSymbol, eventStore)
	}
	return event
}
import { TemporalSightingFactory } from './factory'
import { getTemporalSightingId, type TemporalSightingContent } from './helpers'

/** Options for a Sighting publish/edit. */
export interface SightingPublishOptions {
	/** The Sighting content (title/description/start/end/geometry). */
	content: Partial<TemporalSightingContent>
	/**
	 * NIP-40 expiry timestamp (epoch seconds, UTC) at which the Sighting should
	 * fade from the map. INDEPENDENT of the observation `end` (Pitfall P-4).
	 * Undefined ⇒ never expires.
	 */
	expiration?: number
	/** `c` context-reference coordinates of Groups this Sighting attaches to (SIGHT-02). */
	groupCoords?: string[]
}

/**
 * Derive the `bbox` discovery tuple from a content geometry. Returns undefined on
 * absent/invalid geometry (mirrors `computeBboxFor`).
 */
function deriveBbox(content: Partial<TemporalSightingContent>): GeoBoundingBox | undefined {
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
function deriveCentroid(content: Partial<TemporalSightingContent>): [number, number] | undefined {
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
 * Publish a NEW Sighting (new `d`-tag). `bbox` + `g` are derived from
 * `content.geometry` (SIGHT-01). Returns the signed event; the caller casts it.
 */
export async function publishSighting(
	options: SightingPublishOptions,
	signer: SignerLike,
): Promise<NostrEvent> {
	const { content, expiration, groupCoords } = options

	const signed = await TemporalSightingFactory.create(content)
		.bbox(deriveBbox(content))
		.geohash(deriveCentroid(content))
		.expiration(expiration)
		.contextReferences(groupCoords ?? [])
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	return attachStore(signed)
}

/**
 * Edit an EXISTING Sighting, preserving its `d`-tag lineage (parameterized-
 * replaceable, no fork). `bbox` + `g` are destructively re-derived from the new
 * `content.geometry` every publish.
 */
export async function editSighting(
	existingEvent: NostrEvent,
	options: SightingPublishOptions,
	signer: SignerLike,
): Promise<NostrEvent> {
	const { content, expiration, groupCoords } = options

	const signed = await TemporalSightingFactory.modify(existingEvent)
		.sighting(content)
		.bbox(deriveBbox(content))
		.geohash(deriveCentroid(content))
		.expiration(expiration)
		.contextReferences(groupCoords ?? [])
		.sign(signer)

	await publish(signed, { routing: 'outbox' })
	return attachStore(signed)
}

/** Publish a NIP-09 deletion event for a Sighting the active account owns. */
export async function deleteSighting(
	sighting: NostrEvent,
	signer: EventSigner,
	reason?: string,
): Promise<void> {
	if (!getTemporalSightingId(sighting)) {
		throw new Error('Sighting is missing a d tag and cannot be deleted.')
	}
	const event = await DeleteFactory.fromEvents([sighting], reason).sign(signer)
	await publish(event as NostrEvent, { routing: 'outbox' })
}
