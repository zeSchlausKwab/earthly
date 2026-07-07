/**
 * Earthly search facade — the one home for querying the relay's geo search.
 *
 * - grammar: typed SearchQuery → NIP-50 extension string (Lane 2)
 * - viewport: geohash cell cover for plain #g filters (Lane 1)
 * - capability: relay feature detection + graceful degradation
 *
 * Design: docs/GEO_SEARCH_REWRITE.md. Golden vectors:
 * spec/search-grammar-vectors.json (shared with relay/earthlysearch).
 */

export {
	capabilityUrl,
	clearCapabilityCache,
	fetchSearchCapability,
	supportsSearchExtensions,
} from './capability'
export { searchEntityEvents } from './execute'
export { buildSearchString, hasExtensions, stripExtensions } from './grammar'
export type {
	GeoRelation,
	SearchBBox,
	SearchCapability,
	SearchPoint,
	SearchQuery,
	SearchSort,
} from './types'
export { SEARCH_GRAMMAR_VERSION } from './types'
export { coverBboxWithGeohashes, MAX_GEOHASH_PRECISION, precisionForZoom } from './viewport'
