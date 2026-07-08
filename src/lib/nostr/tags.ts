/**
 * Shared tag read/write seam for every Earthly entity kind (SPEC-02).
 *
 * Before this module each kind's `helpers.ts` / `factory.ts` carried its own
 * byte-near-identical copy of the bbox/`t`/`c`/`a` getters and the
 * filter-out-then-append setters. Centralising them here means a `geo-event`-shaped
 * and a `map-context`-shaped event round-trip those tags through the EXACT same
 * code path — proving no drift — and the four new Phase 8 kinds inherit the seam
 * instead of multiplying the copy-paste.
 *
 * Read getters keep the house caching discipline (`getOrComputeCachedValue` with
 * ONE shared `Symbol.for(...)` per tag NAME — not per entity kind). Write setters
 * are pure `string[][] -> string[][]` transformers the factories delegate to.
 */

import {
	createImetaTagForAttachment,
	getMediaAttachments,
	type MediaAttachment,
} from 'applesauce-common/helpers/file-metadata'
import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type NostrEvent } from 'applesauce-core/helpers/event'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { lonLatToWorldGeohash } from '@/lib/worldGeohash'

// One memo symbol per tag NAME, shared across every entity kind.
const BboxSymbol = Symbol.for('earthly-tag-bbox')
const HashtagsSymbol = Symbol.for('earthly-tag-hashtags')
const ContextRefsSymbol = Symbol.for('earthly-tag-context-refs')
const ReferencedAddrsSymbol = Symbol.for('earthly-tag-referenced-addrs')

// =====================================================================
// Read getters (pure, cached) — every kind routes through these.
// =====================================================================

/** Read the `bbox` tag as a `[w,s,e,n]` tuple. Malformed/absent ⇒ undefined. */
export function getBbox(event: NostrEvent): GeoBoundingBox | undefined {
	return getOrComputeCachedValue(event, BboxSymbol, () => {
		const raw = getTagValue(event, 'bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return undefined
		return parts as GeoBoundingBox
	})
}

/**
 * Read the `g` geohash tag. Events publish multi-precision `g` tags (one per
 * prefix, see `setGeohash`) — this returns the most precise one.
 */
export function getGeohash(event: NostrEvent): string | undefined {
	let best: string | undefined
	for (const tag of event.tags) {
		if (tag[0] === 'g' && tag[1] && (!best || tag[1].length > best.length)) {
			best = tag[1]
		}
	}
	return best
}

/** Read freeform `t` hashtags. */
export function getHashtags(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, HashtagsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

/** Read `c` context references (coordinates of attached MapContexts). */
export function getContextRefs(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, ContextRefsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'c' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)
}

/** Read `a` referenced addressable-event coordinates. */
export function getReferencedAddresses(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, ReferencedAddrsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)
}

// =====================================================================
// Write setters (pure `string[][] -> string[][]`, filter-out-then-append).
// Factories delegate to these so the write shape never drifts per kind.
// =====================================================================

/** Replace the `bbox` tag. Undefined removes it. */
export function setBbox(tags: string[][], box: GeoBoundingBox | undefined): string[][] {
	const filtered = tags.filter((t) => t[0] !== 'bbox')
	return box ? [...filtered, ['bbox', box.join(',')]] : filtered
}

/**
 * Replace the `g` geohash tags, derived from a `[lon, lat]` centroid via
 * `lonLatToWorldGeohash`. Undefined centroid removes them.
 *
 * Emits ONE TAG PER PRECISION 1..N (most precise first) so relays can answer
 * viewport queries at any zoom level with exact `#g` tag matches, and
 * filter-verifying clients (which drop events that don't literally match the
 * filter) accept the results. See docs/GEO_SEARCH_REWRITE.md §4 Lane 1.
 */
export function setGeohash(
	tags: string[][],
	centroid: [number, number] | undefined,
	precision = 6,
): string[][] {
	const filtered = tags.filter((t) => t[0] !== 'g')
	if (!centroid) return filtered
	const [lon, lat] = centroid
	if (typeof lon !== 'number' || typeof lat !== 'number') return filtered
	if (Number.isNaN(lon) || Number.isNaN(lat)) return filtered
	const clamped = Math.min(7, Math.max(5, precision))
	const full = lonLatToWorldGeohash(clamped, lon, lat)
	return [...filtered, ...geohashPrefixes(full).map((prefix) => ['g', prefix])]
}

/**
 * All prefixes of a geohash, most precise first — the multi-precision `g`
 * tag set (see `setGeohash`). Factories that compute their geohash from a
 * FeatureCollection (geo-event/geo-proposal/geo-comment) route their tag
 * writes through this so every published geo event matches viewport `#g`
 * filters at any zoom level.
 */
export function geohashPrefixes(hash: string): string[] {
	const prefixes: string[] = []
	for (let p = hash.length; p >= 1; p--) {
		prefixes.push(hash.slice(0, p))
	}
	return prefixes
}

/**
 * Replace freeform `t` hashtags.
 *
 * TAX-01 disjointness: a value already governed by a controlled `l` label MUST
 * NOT also be encoded as a freeform `t` hashtag (no double-encoding). Such values
 * are stripped from the incoming set so the two lanes never overlap.
 */
export function setHashtags(tags: string[][], values: string[]): string[][] {
	const governed = labelValuesIn(tags)
	const allowed = values.filter((value) => !governed.has(value))
	return [...tags.filter((t) => t[0] !== 't'), ...allowed.map((value) => ['t', value])]
}

/** Replace `c` context references. */
export function setContextRefs(tags: string[][], values: string[]): string[][] {
	return [
		...tags.filter((t) => t[0] !== 'c'),
		...values.filter(Boolean).map((value) => ['c', value]),
	]
}

/** Replace `a` referenced addresses. */
export function setReferencedAddresses(tags: string[][], values: string[]): string[][] {
	return [
		...tags.filter((t) => t[0] !== 'a'),
		...values.filter(Boolean).map((value) => ['a', value]),
	]
}

/**
 * Replace the `schema-hash` tag (the canonical hash of a Group's contribution
 * schema). Undefined/empty removes it. Mirrors `setReferencedAddresses`'s
 * filter-out-then-append shape so the Group factory delegates here instead of
 * inlining the write (no per-kind drift).
 */
export function setSchemaHash(tags: string[][], value: string | undefined): string[][] {
	const filtered = tags.filter((t) => t[0] !== 'schema-hash')
	return value ? [...filtered, ['schema-hash', value]] : filtered
}

// =====================================================================
// NIP-32 controlled-vocabulary labels (TAX-01)
// =====================================================================

/** Flat Earthly label namespace (D-06) for the `L`/`l` pair. */
export const EARTHLY_LABEL_NAMESPACE = 'earthly'

/** Starter controlled vocabulary for feature categories (D-07). */
export const FEATURE_CATEGORY_VOCAB = [
	'natural',
	'infrastructure',
	'amenity',
	'route',
	'boundary',
] as const

/** The `earthly`-namespaced `l` label values currently present on a tag array. */
function labelValuesIn(tags: string[][]): Set<string> {
	return new Set(
		tags
			.filter((t) => t[0] === 'l' && t[2] === EARTHLY_LABEL_NAMESPACE && typeof t[1] === 'string')
			.map((t) => t[1] as string),
	)
}

/**
 * Replace the NIP-32 `L`/`l` label pair (TAX-01).
 *
 * Emits exactly one `['L','earthly']` namespace marker plus one
 * `['l', value, 'earthly']` per value, after stripping any existing `L`/`l`. An
 * empty set strips all labels. Enforces `t`/`l` disjointness: a value that already
 * lives in the freeform `t` lane cannot be promoted to a controlled `l` label
 * (the caller must drop it from `t` first) — this throws rather than silently
 * double-encoding.
 */
export function setLabels(tags: string[][], values: string[]): string[][] {
	const existingHashtags = new Set(
		tags.filter((t) => t[0] === 't' && typeof t[1] === 'string').map((t) => t[1] as string),
	)
	for (const value of values) {
		if (existingHashtags.has(value)) {
			throw new Error(
				`Label "${value}" is already a freeform t hashtag — t/l disjointness violated (TAX-01)`,
			)
		}
	}
	const cleaned = tags.filter((t) => t[0] !== 'L' && t[0] !== 'l')
	if (values.length === 0) return cleaned
	return [
		...cleaned,
		['L', EARTHLY_LABEL_NAMESPACE],
		...values.map((value) => ['l', value, EARTHLY_LABEL_NAMESPACE]),
	]
}

/** Read back only `earthly`-namespaced `l` label values. */
export function getLabels(event: NostrEvent): string[] {
	return event.tags
		.filter((t) => t[0] === 'l' && t[2] === EARTHLY_LABEL_NAMESPACE && typeof t[1] === 'string')
		.map((t) => t[1] as string)
}

// =====================================================================
// NIP-92 `imeta` media attachments (SPEC §7.3)
// =====================================================================

/**
 * Read `imeta` media attachments in tag order. **The first attachment is the
 * primary image** (SPEC §7.3) — reordering tags is how a publisher changes the
 * primary. Delegates to the official applesauce parser; entries without a
 * `url` field are dropped (unrenderable).
 */
export function getImages(event: NostrEvent): MediaAttachment[] {
	return getMediaAttachments(event).filter((attachment) => Boolean(attachment.url))
}

/** The primary image (first `imeta` tag), if any. */
export function getPrimaryImage(event: NostrEvent): MediaAttachment | undefined {
	return getImages(event)[0]
}

/**
 * Replace the `imeta` tag set. Order is meaningful (first = primary). An empty
 * array strips all attachments; entries without a `url` are refused.
 */
export function setImages(tags: string[][], attachments: MediaAttachment[]): string[][] {
	for (const attachment of attachments) {
		if (!attachment.url) throw new Error('setImages: every media attachment needs a url')
	}
	return [
		...tags.filter((t) => t[0] !== 'imeta'),
		...attachments.map((attachment) => createImetaTagForAttachment(attachment)),
	]
}
