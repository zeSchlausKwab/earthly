import type { Geometry } from 'geojson'

export const GEO_CATALOG_KINDS = [
	'admin',
	'locality',
	'place',
	'road',
	'rail',
	'waterway',
	'infrastructure',
] as const

export type GeoCatalogKind = (typeof GEO_CATALOG_KINDS)[number]

export type GeoCatalogBbox = [west: number, south: number, east: number, north: number]

export interface GeoCatalogPoint {
	longitude: number
	latitude: number
}

export type GeoCatalogJsonValue =
	| string
	| number
	| boolean
	| null
	| GeoCatalogJsonValue[]
	| { [key: string]: GeoCatalogJsonValue }

/** A license, attribution page, or NOTICE that must travel with a source release. */
export interface GeoCatalogSourceDocument {
	name: string
	url: string
	/** Full text when the upstream terms require the document itself to be preserved. */
	content?: string
}

export interface GeoCatalogSourceRelease {
	name: string
	release: string
	attribution?: string
	attributionUrl?: string
	license?: string
	documents?: GeoCatalogSourceDocument[]
}

export interface GeoCatalogSourceReference {
	name: string
	release: string
	recordId?: string
}

export interface GeoCatalogSnapshotMetadata {
	id: string
	createdAt: string
	schemaVersion: 1
	sources: GeoCatalogSourceRelease[]
}

/**
 * A source-neutral catalog entry. The source reference records provenance, but
 * callers never need to understand a source's native schema or identifiers.
 */
export interface GeoCatalogEntry {
	id: string
	kind: GeoCatalogKind
	name: string
	aliases: string[]
	/** Normalized, exact-match classifications such as `hospital` or `village`. */
	categories: string[]
	countryCode?: string
	/** Source-neutral hierarchy depth: 0 is a country, 1 is its first subdivision. */
	adminLevel?: number
	bbox: GeoCatalogBbox
	center: GeoCatalogPoint
	importance: number
	source: GeoCatalogSourceReference
	properties: Record<string, GeoCatalogJsonValue>
	geometry?: Geometry
}

/**
 * All supplied filter groups use AND semantics. Values within `ids`, `kinds`,
 * `categories`, and `adminLevels` use OR semantics. `near` measures distance
 * from an entry's representative point and must be paired with `radiusMeters`.
 */
export interface GeoCatalogQueryRequest {
	text?: string
	ids?: readonly string[]
	kinds?: readonly GeoCatalogKind[]
	categories?: readonly string[]
	adminLevels?: readonly number[]
	countryCode?: string
	bbox?: GeoCatalogBbox
	near?: GeoCatalogPoint
	radiusMeters?: number
	limit?: number
	includeGeometry?: boolean
}

export interface GeoCatalogQueryResult {
	items: GeoCatalogEntry[]
	metadata: {
		snapshot: GeoCatalogSnapshotMetadata
		query: {
			returned: number
			limit: number
			hasMore: boolean
		}
	}
}

/** The complete external Interface of the GeoCatalog Module. */
export interface GeoCatalog {
	query(request: GeoCatalogQueryRequest): Promise<GeoCatalogQueryResult>
}

export type GeoCatalogErrorCode =
	| 'invalid_request'
	| 'snapshot_unavailable'
	| 'snapshot_invalid'
	| 'query_failed'

export class GeoCatalogError extends Error {
	readonly code: GeoCatalogErrorCode
	readonly retryable: boolean

	constructor(code: GeoCatalogErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'GeoCatalogError'
		this.code = code
		this.retryable = false
	}
}
