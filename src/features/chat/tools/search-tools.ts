/**
 * Relay entity-search AI tools: `search_entities` + `query_entities_in_area`.
 *
 * Both are thin wrappers over the src/lib/search facade (Lane 2 of
 * docs/GEO_SEARCH_REWRITE.md): the model supplies STRUCTURED params (never a
 * raw grammar string — schema validation catches mistakes and the grammar
 * cannot drift), the handler serializes through `buildSearchString` and runs
 * a one-shot NIP-50 request against the content relays.
 *
 * `query_entities_in_area` follows the query_osm_* family shape: the query
 * area comes from an explicit bbox, the user's attached geometry
 * (ToolExecutionContext.attachedGeometry — "what's in this polygon I drew"),
 * or the current map viewport.
 *
 * Results are compact and AI-shaped: naddr + type + name + summary + bbox,
 * ready for follow-up actions (zoom, load, mention) without event parsing.
 */

import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	ARTICLE_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { getBbox, getGeohash, getHashtags } from '@/lib/nostr/tags'
import {
	buildSearchString,
	type GeoRelation,
	type SearchBBox,
	searchEntityEvents,
	type SearchQuery,
	type SearchSort,
} from '@/lib/search'
import type { ToolEntry } from './registry'
import type { Tool, ToolExecutionContext } from './types'

// ── entity type vocabulary (model-facing names, not kind numbers) ──────

const ENTITY_TYPE_TO_KIND: Record<string, number> = {
	dataset: GEO_EVENT_KIND,
	group: MAP_CONTEXT_KIND,
	story: ARTICLE_KIND,
	beacon: LIVE_BEACON_KIND,
	sighting: TEMPORAL_SIGHTING_KIND,
}

const KIND_TO_ENTITY_TYPE: Record<number, string> = Object.fromEntries(
	Object.entries(ENTITY_TYPE_TO_KIND).map(([type, kind]) => [kind, type]),
)

const ENTITY_TYPES = Object.keys(ENTITY_TYPE_TO_KIND)
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const RELAY_TIMEOUT_MS = 10_000

const RELATIONS: GeoRelation[] = ['intersects', 'contains', 'within']
const SORTS: SearchSort[] = ['relevance', 'distance', 'recent', 'scale']

// ── arg parsing helpers (exported for tests) ──────────────────────────

export function parseEntityTypes(value: unknown): number[] {
	if (!Array.isArray(value) || value.length === 0) {
		return Object.values(ENTITY_TYPE_TO_KIND)
	}
	const kinds = value
		.filter((t): t is string => typeof t === 'string')
		.map((t) => ENTITY_TYPE_TO_KIND[t])
		.filter((k): k is number => typeof k === 'number')
	if (kinds.length === 0) {
		throw new Error(`entityTypes must be from: ${ENTITY_TYPES.join(', ')}`)
	}
	return kinds
}

export function parseBboxArg(value: unknown): SearchBBox {
	if (
		!Array.isArray(value) ||
		value.length !== 4 ||
		value.some((v) => typeof v !== 'number' || !Number.isFinite(v))
	) {
		throw new Error('bbox must be [west, south, east, north] numbers (WGS-84).')
	}
	return value as SearchBBox
}

export function parseStringList(value: unknown, name: string): string[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
		throw new Error(`${name} must be an array of strings.`)
	}
	return value.length > 0 ? (value as string[]) : undefined
}

function parseTime(value: unknown, name: string): number | string | undefined {
	if (value === undefined) return undefined
	if (typeof value === 'number' || typeof value === 'string') return value
	throw new Error(`${name} must be epoch seconds or 'YYYY-MM-DD'.`)
}

function parseLimit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
	return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

/** Bounding box of an attached FeatureCollection (walks all coordinates). */
export function bboxFromFeatureCollection(fc: GeoJSON.FeatureCollection): SearchBBox {
	let w = 180
	let s = 90
	let e = -180
	let n = -90
	let found = false

	const walk = (coords: unknown): void => {
		if (!Array.isArray(coords)) return
		if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
			w = Math.min(w, coords[0])
			e = Math.max(e, coords[0])
			s = Math.min(s, coords[1])
			n = Math.max(n, coords[1])
			found = true
			return
		}
		for (const c of coords) walk(c)
	}

	for (const feature of fc.features ?? []) {
		const geometry = feature.geometry as { coordinates?: unknown; geometries?: unknown } | null
		if (!geometry) continue
		walk(geometry.coordinates)
		if (Array.isArray(geometry.geometries)) {
			for (const g of geometry.geometries as Array<{ coordinates?: unknown }>) {
				walk(g?.coordinates)
			}
		}
	}

	if (!found) {
		throw new Error('Attached geometry has no coordinates to derive an area from.')
	}
	return [w, s, e, n]
}

/** Resolve the query area for query_entities_in_area. */
export function resolveArea(
	args: Record<string, unknown>,
	context?: ToolExecutionContext,
): SearchBBox {
	if (args.bbox !== undefined) return parseBboxArg(args.bbox)

	if (context?.attachedGeometry) {
		return bboxFromFeatureCollection(context.attachedGeometry)
	}

	const { editor, currentBbox } = useEditorStore.getState()
	const viewport = editor?.getMapBounds() ?? currentBbox
	if (viewport) return viewport as SearchBBox

	throw new Error(
		'No area available: pass bbox, attach a geometry, or open the map so the viewport can be used.',
	)
}

// ── result shaping ─────────────────────────────────────────────────────

interface CompactEntityResult {
	naddr: string | null
	type: string
	name: string
	summary?: string
	bbox?: [number, number, number, number]
	geohash?: string
	hashtags?: string[]
	author: string
	createdAt: number
}

export function compactEntity(event: NostrEvent): CompactEntityResult {
	const type = KIND_TO_ENTITY_TYPE[event.kind] ?? String(event.kind)
	const dTag = event.tags.find((t) => t[0] === 'd')?.[1]

	let content: Record<string, unknown> = {}
	try {
		content = JSON.parse(event.content) as Record<string, unknown>
	} catch {
		// tags still carry enough to render a result
	}

	const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
	const name =
		str(content.name) ??
		str(content.title) ??
		str(content.label) ??
		dTag ??
		`${type} ${event.id.slice(0, 8)}`
	const summary = str(content.summary) ?? str(content.description)

	let naddr: string | null = null
	if (dTag) {
		try {
			naddr = nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier: dTag })
		} catch {
			naddr = null
		}
	}

	const hashtags = getHashtags(event)
	return {
		naddr,
		type,
		name,
		...(summary ? { summary } : {}),
		...(getBbox(event) ? { bbox: getBbox(event) } : {}),
		...(getGeohash(event) ? { geohash: getGeohash(event) } : {}),
		...(hashtags.length > 0 ? { hashtags } : {}),
		author: event.pubkey,
		createdAt: event.created_at,
	}
}

// ── relay query ────────────────────────────────────────────────────────

async function runSearch(query: SearchQuery, kinds: number[], limit: number) {
	const search = buildSearchString(query)
	if (!search) {
		throw new Error('Empty query: provide text or a spatial/temporal constraint.')
	}

	// searchEntityEvents dedupes and drops expired events (SPEC §10).
	const events = await searchEntityEvents(query, {
		kinds,
		limit,
		timeoutMs: RELAY_TIMEOUT_MS,
	}).catch((err: unknown) => {
		throw new Error(`Relay search failed or timed out: ${String(err)}`)
	})

	const results = events.map(compactEntity)
	return {
		ok: true,
		count: results.length,
		results,
		search, // the serialized grammar, for transparency/debugging
	}
}

// ── schemas ────────────────────────────────────────────────────────────

const entityTypesProperty = {
	type: 'array',
	items: { type: 'string', enum: ENTITY_TYPES },
	description:
		"Entity types to search. Default: all. 'dataset' = GeoJSON datasets, 'group' = curated topics, 'story' = long-form geo articles, 'beacon' = live presence markers, 'sighting' = time-bounded observations.",
}

const timeProperties = {
	startAfter: {
		type: ['number', 'string'],
		description:
			"Only sightings whose NIP-52 start is at/after this time (epoch seconds or 'YYYY-MM-DD').",
	},
	startBefore: {
		type: ['number', 'string'],
		description:
			"Only sightings whose NIP-52 start is at/before this time (epoch seconds or 'YYYY-MM-DD').",
	},
}

const searchEntitiesSchema: Tool = {
	type: 'function',
	function: {
		name: 'search_entities',
		description:
			'Search Earthly entities (datasets, groups, stories, beacons, sightings) on the relay by text and facets. Matches titles, feature names inside datasets, summaries, and body text. Optionally constrain by area, labels, hashtags, or time range. Returns compact results with naddr references.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Free-text search (names, feature names, descriptions).',
				},
				entityTypes: entityTypesProperty,
				bbox: {
					type: 'array',
					items: { type: 'number' },
					description:
						'Optional [west, south, east, north] bounding box (WGS-84) to constrain results spatially.',
				},
				labels: {
					type: 'array',
					items: { type: 'string' },
					description:
						'NIP-32 controlled category labels (earthly vocabulary: natural, infrastructure, amenity, route, boundary). AND semantics.',
				},
				hashtags: {
					type: 'array',
					items: { type: 'string' },
					description: 'Freeform hashtags the entity must carry. AND semantics.',
				},
				...timeProperties,
				sort: {
					type: 'string',
					enum: SORTS,
					description: "Result order. Default 'relevance'.",
				},
				limit: {
					type: 'number',
					description: `Max results, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`,
				},
			},
			required: ['query'],
		},
	},
}

const queryEntitiesInAreaSchema: Tool = {
	type: 'function',
	function: {
		name: 'query_entities_in_area',
		description:
			"Find Earthly entities (datasets, groups, stories, beacons, sightings) in a geographic area. The area is: an explicit bbox if given; otherwise the user's attached geometry (when they attached/drew one); otherwise the current map viewport. Use relation 'intersects' for everything touching the area, 'within' for entities entirely inside it, 'contains' for entities whose geometry covers the whole area. Supports time-range filtering for sightings. Returns compact results with naddr references.",
		parameters: {
			type: 'object',
			properties: {
				bbox: {
					type: 'array',
					items: { type: 'number' },
					description:
						'Optional explicit [west, south, east, north] area (WGS-84). Omit to use attached geometry or the current viewport.',
				},
				relation: {
					type: 'string',
					enum: RELATIONS,
					description: "Spatial relation of entity geometry to the area. Default 'intersects'.",
				},
				entityTypes: entityTypesProperty,
				query: {
					type: 'string',
					description: 'Optional free-text filter on top of the spatial constraint.',
				},
				...timeProperties,
				limit: {
					type: 'number',
					description: `Max results, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`,
				},
			},
			required: [],
		},
	},
}

// ── registration ───────────────────────────────────────────────────────

export function registerSearchTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'search_entities',
		kind: 'host-builtin',
		schema: searchEntitiesSchema,
		handler: async (args) => {
			const text = typeof args.query === 'string' ? args.query.trim() : ''
			if (!text) {
				throw new Error('query must be a non-empty string.')
			}

			const query: SearchQuery = { text }
			if (args.bbox !== undefined) query.bbox = parseBboxArg(args.bbox)
			query.labels = parseStringList(args.labels, 'labels')
			query.hashtags = parseStringList(args.hashtags, 'hashtags')
			query.startAfter = parseTime(args.startAfter, 'startAfter')
			query.startBefore = parseTime(args.startBefore, 'startBefore')
			if (typeof args.sort === 'string' && (SORTS as string[]).includes(args.sort)) {
				query.sort = args.sort as SearchSort
			}

			return runSearch(query, parseEntityTypes(args.entityTypes), parseLimit(args.limit))
		},
	})

	register({
		name: 'query_entities_in_area',
		kind: 'host-builtin',
		schema: queryEntitiesInAreaSchema,
		handler: async (args, context) => {
			const query: SearchQuery = { bbox: resolveArea(args, context) }

			if (typeof args.relation === 'string') {
				if (!(RELATIONS as string[]).includes(args.relation)) {
					throw new Error(`relation must be one of: ${RELATIONS.join(', ')}`)
				}
				query.rel = args.relation as GeoRelation
			}
			if (typeof args.query === 'string' && args.query.trim()) {
				query.text = args.query.trim()
			}
			query.startAfter = parseTime(args.startAfter, 'startAfter')
			query.startBefore = parseTime(args.startBefore, 'startBefore')

			return runSearch(query, parseEntityTypes(args.entityTypes), parseLimit(args.limit))
		},
	})
}
