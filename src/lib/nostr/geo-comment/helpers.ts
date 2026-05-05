/**
 * Pure helpers for kind 37517 (GeoJSON Comment Event).
 *
 * Comments use NIP-22 threading semantics (`K`/`k`, `A`/`a`, `E`/`e`, `P`/`p`)
 * with a JSON content payload that may include a GeoJSON FeatureCollection.
 */

import { bbox, centroid } from '@turf/turf'
import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import {
	getTagValue,
	type KnownEvent,
	type NostrEvent,
} from 'applesauce-core/helpers/event'
import type { FeatureCollection, Position } from 'geojson'
import { GEO_COMMENT_KIND } from '@/lib/nostr/kinds'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'

export type GeoCommentEvent = KnownEvent<typeof GEO_COMMENT_KIND>

export interface GeoCommentContent {
	text: string
	geojson?: FeatureCollection
}

export interface GeoCommentThreading {
	rootKind: string
	rootAddress?: string
	rootEventId?: string
	rootPubkey?: string
	parentKind: string
	parentAddress?: string
	parentEventId?: string
	parentPubkey?: string
}

export interface InlineReference {
	type: 'dataset' | 'collection' | 'feature'
	address: string
	featureId?: string
	startIndex: number
	endIndex: number
}

const CommentContentSymbol = Symbol.for('geo-comment-content')
const BoundingBoxSymbol = Symbol.for('geo-comment-bbox')
const InlineRefsSymbol = Symbol.for('geo-comment-inline-refs')

const NADDR_REFERENCE_PATTERN = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g

export function isGeoComment(event: NostrEvent): event is GeoCommentEvent {
	return event.kind === GEO_COMMENT_KIND && getCommentId(event) !== undefined
}

export function getCommentId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

/**
 * Parse the JSON-encoded `{ text, geojson? }` payload. Falls back to treating
 * the raw content as plain text if it isn't valid JSON (legacy comments).
 */
export function getCommentContent(event: NostrEvent): GeoCommentContent {
	return getOrComputeCachedValue(event, CommentContentSymbol, () => {
		if (!event.content) return { text: '' }
		try {
			const parsed = JSON.parse(event.content) as GeoCommentContent
			return {
				text: parsed.text ?? '',
				geojson: parsed.geojson,
			}
		} catch {
			return { text: event.content }
		}
	})
}

export function getCommentText(event: NostrEvent): string {
	return getCommentContent(event).text
}

export function getCommentGeojson(event: NostrEvent): FeatureCollection | undefined {
	return getCommentContent(event).geojson
}

export function getCommentBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getOrComputeCachedValue(event, BoundingBoxSymbol, () => {
		const raw = getTagValue(event, 'bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return undefined
		return parts as GeoBoundingBox
	})
}

export function getCommentGeohash(event: NostrEvent): string | undefined {
	return getTagValue(event, 'g')
}

/** Pull the NIP-22 threading tags as a structured object. */
export function getCommentThreading(event: NostrEvent): GeoCommentThreading {
	const find = (name: string) => event.tags.find((t) => t[0] === name)?.[1]
	return {
		rootKind: find('K') ?? '',
		rootAddress: find('A'),
		rootEventId: find('E'),
		rootPubkey: find('P'),
		parentKind: find('k') ?? '',
		parentAddress: find('a'),
		parentEventId: find('e'),
		parentPubkey: find('p'),
	}
}

export function getCommentRootAddress(event: NostrEvent): string | undefined {
	return event.tags.find((t) => t[0] === 'A')?.[1]
}

export function getCommentParentAddress(event: NostrEvent): string | undefined {
	return event.tags.find((t) => t[0] === 'a')?.[1]
}

export function getCommentParentEventId(event: NostrEvent): string | undefined {
	return event.tags.find((t) => t[0] === 'e')?.[1]
}

/** True when the parent is another comment (vs a top-level dataset/context). */
export function isCommentReply(event: NostrEvent): boolean {
	return getCommentThreading(event).parentKind === String(GEO_COMMENT_KIND)
}

/**
 * Parse `nostr:naddr1...[#featureId]` mentions from the comment text. Returns
 * positions so callers can splice in interactive UI.
 */
export function parseInlineReferences(event: NostrEvent): InlineReference[] {
	return getOrComputeCachedValue(event, InlineRefsSymbol, () => {
		const text = getCommentText(event)
		const references: InlineReference[] = []
		// reset regex state per call
		const pattern = new RegExp(NADDR_REFERENCE_PATTERN.source, 'g')
		let match = pattern.exec(text)
		while (match !== null) {
			const naddr = match[1]
			const featureId = match[3]
			if (naddr) {
				references.push({
					type: featureId ? 'feature' : 'dataset',
					address: naddr,
					featureId,
					startIndex: match.index,
					endIndex: match.index + match[0].length,
				})
			}
			match = pattern.exec(text)
		}
		return references
	})
}

// =====================================================================
// Computations on the attached FeatureCollection (used by the Factory)
// =====================================================================

/** Bounding box of the attached GeoJSON; undefined for invalid/empty geometry. */
export function computeCommentBbox(fc: FeatureCollection | undefined): GeoBoundingBox | undefined {
	if (!fc || fc.features.length === 0) return undefined
	try {
		const computed = bbox(fc) as GeoBoundingBox
		if (computed.every((value) => Number.isFinite(value))) return computed
	} catch {
		// invalid
	}
	return undefined
}

/** Centroid-based geohash of the attached GeoJSON. */
export function computeCommentGeohash(
	fc: FeatureCollection | undefined,
	precision = 6,
): string | undefined {
	if (!fc || fc.features.length === 0) return undefined
	try {
		const c = centroid(fc)
		const coords = c.geometry?.coordinates as Position | undefined
		if (coords && coords.length >= 2) {
			return encodeGeohash(coords[1] as number, coords[0] as number, precision)
		}
	} catch {
		// invalid
	}
	return undefined
}

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
