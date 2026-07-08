import type { SearchQuery } from './types'

/**
 * Serialize a SearchQuery to the extended NIP-50 search string.
 *
 * Canonical token order (pinned by spec/search-grammar-vectors.json):
 * text, bbox, point, rel, near, radius, label*, tag*, ref*, start-after,
 * start-before, sort. Defaults (rel:intersects, sort:relevance) are omitted.
 *
 * Foreign relays see unknown tokens as ignorable NIP-50 extensions; use
 * `stripExtensions` when the target relay is known not to support them.
 */
export function buildSearchString(query: SearchQuery): string {
	const tokens: string[] = []

	const text = query.text?.trim()
	if (text) tokens.push(text)

	if (query.bbox) {
		validateBbox(query.bbox)
		tokens.push(`bbox:${query.bbox.join(',')}`)
	}

	if (query.point) {
		const [lon, lat] = query.point
		if (!isValidLonLat(lon, lat)) {
			throw new Error(`invalid point: ${query.point.join(',')}`)
		}
		tokens.push(`point:${lon},${lat}`)
	}

	if (query.rel && query.rel !== 'intersects') {
		tokens.push(`rel:${query.rel}`)
	}

	if (query.near) {
		if (!isValidGeohash(query.near)) {
			throw new Error(`invalid geohash for near: ${query.near}`)
		}
		tokens.push(`near:${query.near.toLowerCase()}`)
	}

	if (query.radiusKm !== undefined && query.radiusKm > 0) {
		if (!query.near && !query.point) {
			throw new Error('radiusKm requires near or point')
		}
		tokens.push(`radius:${formatRadius(query.radiusKm)}`)
	}

	for (const label of query.labels ?? []) {
		tokens.push(`label:${requireTokenSafe(label, 'label')}`)
	}
	for (const hashtag of query.hashtags ?? []) {
		tokens.push(`tag:${requireTokenSafe(hashtag, 'hashtag')}`)
	}
	for (const ref of query.refs ?? []) {
		tokens.push(`ref:${requireTokenSafe(ref, 'ref')}`)
	}

	if (query.startAfter !== undefined) {
		tokens.push(`start-after:${formatTime(query.startAfter)}`)
	}
	if (query.startBefore !== undefined) {
		tokens.push(`start-before:${formatTime(query.startBefore)}`)
	}

	if (query.sort && query.sort !== 'relevance') {
		if (query.sort === 'distance' && !query.near && !query.point) {
			throw new Error('sort:distance requires near or point')
		}
		tokens.push(`sort:${query.sort}`)
	}

	return tokens.join(' ')
}

/**
 * Reduce a query to plain NIP-50 text for relays without the Earthly
 * extension (feature-detect via fetchSearchCapability).
 */
export function stripExtensions(query: SearchQuery): string {
	return query.text?.trim() ?? ''
}

/** True when the query has any constraint beyond free text. */
export function hasExtensions(query: SearchQuery): boolean {
	return buildSearchString(query) !== (query.text?.trim() ?? '')
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

function isValidGeohash(value: string): boolean {
	if (value.length < 1 || value.length > 9) return false
	return [...value.toLowerCase()].every((c) => GEOHASH_BASE32.includes(c))
}

function isValidLonLat(lon: number, lat: number): boolean {
	return (
		Number.isFinite(lon) &&
		Number.isFinite(lat) &&
		lon >= -180 &&
		lon <= 180 &&
		lat >= -90 &&
		lat <= 90
	)
}

function validateBbox(bbox: [number, number, number, number]): void {
	const [w, s, e, n] = bbox
	if (!isValidLonLat(w, s) || !isValidLonLat(e, n) || w > e || s > n) {
		throw new Error(`invalid bbox: ${bbox.join(',')}`)
	}
}

function formatRadius(km: number): string {
	if (km < 1) return `${Math.round(km * 1000)}m`
	return `${km}km`
}

function formatTime(value: number | string): string {
	if (typeof value === 'number') {
		if (!Number.isInteger(value) || value <= 0) {
			throw new Error(`invalid epoch time: ${value}`)
		}
		return String(value)
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`invalid date (want YYYY-MM-DD or epoch seconds): ${value}`)
	}
	return value
}

/** Grammar values must not contain whitespace (they are space-delimited tokens). */
function requireTokenSafe(value: string, kind: string): string {
	if (!value || /\s/.test(value)) {
		throw new Error(`invalid ${kind} value: ${JSON.stringify(value)}`)
	}
	return value
}
