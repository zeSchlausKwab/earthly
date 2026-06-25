/**
 * Pure helpers for kind 37515 (GeoJSON Data Event).
 *
 * Both the Cast (read-side) and the Factory (write-side) use these. Keeping
 * the parsing logic in plain functions means we never have to materialise a
 * class instance just to read a tag.
 */

import { bbox, centroid } from '@turf/turf'
import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import type { FeatureCollection, Position } from 'geojson'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { normalizeGeoJsonToFeatureCollection } from '@/lib/geo/normalizeGeoJSON'
import {
	getBbox,
	getContextRefs,
	getGeohash as getGeohashShared,
	getHashtags as getHashtagsShared,
} from '@/lib/nostr/tags'

export type GeoDatasetEvent = KnownEvent<typeof GEO_EVENT_KIND>
export type GeoBoundingBox = [number, number, number, number]

export interface GeoBlobReference {
	scope: 'collection' | 'feature'
	featureId?: string
	url: string
	sha256?: string
	size?: number
	mimeType?: string
}

const DEFAULT_COLLECTION: FeatureCollection = {
	type: 'FeatureCollection',
	features: [],
}

const FeatureCollectionSymbol = Symbol.for('geo-dataset-feature-collection')
const CollectionRefsSymbol = Symbol.for('geo-dataset-collection-refs')
const RelayHintsSymbol = Symbol.for('geo-dataset-relay-hints')
const BlobRefsSymbol = Symbol.for('geo-dataset-blob-refs')

/** Whether the event is a kind 37515 GeoJSON Data Event with the required `d` tag. */
export function isGeoDataset(event: NostrEvent): event is GeoDatasetEvent {
	return event.kind === GEO_EVENT_KIND && getDatasetId(event) !== undefined
}

export function getDatasetId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

export function getFeatureCollection(event: NostrEvent): FeatureCollection {
	return getOrComputeCachedValue(event, FeatureCollectionSymbol, () => {
		if (!event.content) return DEFAULT_COLLECTION
		try {
			return normalizeGeoJsonToFeatureCollection(JSON.parse(event.content))
		} catch {
			return DEFAULT_COLLECTION
		}
	})
}

export function getBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	// Delegates to the shared tags.ts seam (SPEC-02) — no copy-pasted body here.
	return getBbox(event)
}

export function getGeohash(event: NostrEvent): string | undefined {
	return getGeohashShared(event)
}

export function getCoordinateReferenceSystem(event: NostrEvent): string | undefined {
	return getTagValue(event, 'crs')
}

export function getChecksum(event: NostrEvent): string | undefined {
	return getTagValue(event, 'checksum')
}

export function getDatasetSize(event: NostrEvent): number | undefined {
	const raw = getTagValue(event, 'size')
	if (!raw) return undefined
	const parsed = Number.parseInt(raw, 10)
	return Number.isNaN(parsed) ? undefined : parsed
}

export function getVersion(event: NostrEvent): string | undefined {
	return getTagValue(event, 'v')
}

export function getHashtags(event: NostrEvent): string[] {
	return getHashtagsShared(event)
}

export function getCollectionReferences(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, CollectionRefsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'collection' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

export function getContextReferences(event: NostrEvent): string[] {
	return getContextRefs(event)
}

export function getRelayHints(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, RelayHintsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

/**
 * External blob references for oversized FeatureCollections or individual features.
 * Tags follow `["blob","collection|feature:<id>","<url>","sha256=...","size=...","mime=..."]`.
 */
export function getBlobReferences(event: NostrEvent): GeoBlobReference[] {
	return getOrComputeCachedValue(event, BlobRefsSymbol, () =>
		event.tags
			.filter(
				(tag) => tag[0] === 'blob' && typeof tag[1] === 'string' && typeof tag[2] === 'string',
			)
			.map((tag) => {
				const scope = tag[1] as string
				const url = tag[2] as string
				const reference: GeoBlobReference = {
					scope: scope.startsWith('feature:') ? 'feature' : 'collection',
					url,
				}
				if (reference.scope === 'feature') {
					reference.featureId = scope.slice('feature:'.length)
				}
				for (const entry of tag.slice(3)) {
					const [key, value] = entry.split('=')
					if (!value) continue
					if (key === 'sha256') reference.sha256 = value
					else if (key === 'size') {
						const parsed = Number.parseInt(value, 10)
						if (!Number.isNaN(parsed)) reference.size = parsed
					} else if (key === 'mime') reference.mimeType = value
				}
				return reference
			}),
	)
}

// =====================================================================
// Computations on FeatureCollection (used by the Factory when building events)
// =====================================================================

/** Bounding box for a feature collection. Returns undefined for invalid geometry. */
export function computeBboxFor(fc: FeatureCollection): GeoBoundingBox | undefined {
	try {
		const computed = bbox(fc) as GeoBoundingBox
		if (computed.every((value) => Number.isFinite(value))) return computed
	} catch {
		// invalid geometry
	}
	return undefined
}

/** Geohash of the centroid of a feature collection at the given precision. */
export function computeGeohashFor(fc: FeatureCollection, precision = 6): string | undefined {
	try {
		const c = centroid(fc)
		const coords = c.geometry?.coordinates as Position | undefined
		const lon = coords?.[0]
		const lat = coords?.[1]
		if (typeof lat === 'number' && typeof lon === 'number') {
			return encodeGeohash(lat, lon, precision)
		}
	} catch {
		// invalid geometry
	}
	return undefined
}

/** SHA-256 hex digest of a UTF-8 string. */
export async function computeChecksum(content: string): Promise<string | undefined> {
	if (!globalThis.crypto?.subtle) return undefined
	const data = new TextEncoder().encode(content)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/** Geohash encoder — bit interleaving from lat/lon. */
function encodeGeohash(lat: number, lon: number, precision = 6): string {
	const base32 = '0123456789bcdefghjkmnpqrstuvwxyz'
	let geohash = ''
	let even = true
	const latRange: [number, number] = [-90, 90]
	const lonRange: [number, number] = [-180, 180]

	while (geohash.length < precision) {
		let ch = 0
		for (let bit = 0; bit < 5; bit++) {
			if (even) {
				const mid = (lonRange[0] + lonRange[1]) / 2
				if (lon >= mid) {
					ch |= 1 << (4 - bit)
					lonRange[0] = mid
				} else {
					lonRange[1] = mid
				}
			} else {
				const mid = (latRange[0] + latRange[1]) / 2
				if (lat >= mid) {
					ch |= 1 << (4 - bit)
					latRange[0] = mid
				} else {
					latRange[1] = mid
				}
			}
			even = !even
		}
		geohash += base32[ch]
	}

	return geohash
}

// =====================================================================
// Tag helpers used by the Factory
// =====================================================================

/** Build a `blob` tag for a single GeoBlobReference. */
export function blobReferenceToTag(ref: GeoBlobReference): string[] | null {
	if (!ref.url) return null
	const scope = ref.scope === 'feature' ? `feature:${ref.featureId ?? ''}` : 'collection'
	const tag: string[] = ['blob', scope, ref.url]
	if (ref.sha256) tag.push(`sha256=${ref.sha256}`)
	if (typeof ref.size === 'number' && Number.isFinite(ref.size)) {
		tag.push(`size=${ref.size}`)
	}
	if (ref.mimeType) tag.push(`mime=${ref.mimeType}`)
	return tag
}

/** Predicate: drop any tag whose first element is in `names`. */
export function withoutTags(names: string[]) {
	const exclude = new Set(names)
	return (tags: string[][]) => tags.filter((tag) => !exclude.has(tag[0] ?? ''))
}
