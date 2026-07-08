/**
 * Typed query model for the Earthly relay search extension grammar.
 *
 * The grammar (docs/GEO_SEARCH_REWRITE.md §4) rides inside the NIP-50
 * `search` filter field as `key:value` tokens. This module is the ONLY place
 * that serializes it — app code never string-concatenates search tokens.
 * Serialization is pinned against the Go parser by the golden vectors in
 * spec/search-grammar-vectors.json.
 */

export const SEARCH_GRAMMAR_VERSION = 1

export type GeoRelation = 'intersects' | 'contains' | 'within'
export type SearchSort = 'relevance' | 'distance' | 'recent' | 'scale'

/** [west, south, east, north] in WGS-84. */
export type SearchBBox = [number, number, number, number]

/** [lon, lat] in WGS-84. */
export type SearchPoint = [number, number]

export interface SearchQuery {
	/** Free text — matched against titles, feature names, summaries, bodies. */
	text?: string
	/** Query shape: bounding box. Takes precedence over `point` as the shape. */
	bbox?: SearchBBox
	/** Query shape: single point (e.g. rel:'contains' = "what am I standing in"). */
	point?: SearchPoint
	/** Relation of the INDEXED geometry to the query shape. Default 'intersects'. */
	rel?: GeoRelation
	/** Proximity origin as a geohash (distance sort / radius filter). */
	near?: string
	/** Hard distance cutoff around `near`/`point`, in kilometers. */
	radiusKm?: number
	/** NIP-32 controlled labels (earthly namespace). AND semantics. */
	labels?: string[]
	/** Freeform t hashtags. AND semantics. */
	hashtags?: string[]
	/** Entity coordinates (kind:pubkey:d) the result must reference. */
	refs?: string[]
	/** NIP-52 temporal range on Sighting `start` — epoch seconds or 'YYYY-MM-DD'. */
	startAfter?: number | string
	startBefore?: number | string
	/** Result order. Default 'relevance' (NIP-50 semantics). */
	sort?: SearchSort
}

/** The capability document served by the relay at GET /earthly-search. */
export interface SearchCapability {
	version: number
	extensions: string[]
	documents?: number
}
