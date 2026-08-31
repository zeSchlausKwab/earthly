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

/**
 * Administrative `division` records are label points, not boundary geometry.
 * They remain useful for discovery, but geometry-bearing queries must not
 * expose them as editor-import candidates.
 */
export const GEO_CATALOG_ADMIN_LABEL_CATEGORY = 'administrative-label'

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

export type GeoCatalogSnapshotSpatialCoverage =
	| { scope: 'global' }
	| { scope: 'bbox'; bbox: GeoCatalogBbox }

export interface GeoCatalogSnapshotCoverage {
	spatial: GeoCatalogSnapshotSpatialCoverage
	/** Catalog kinds installed in this immutable snapshot. */
	kinds: GeoCatalogKind[]
}

export interface GeoCatalogSnapshotMetadata {
	id: string
	createdAt: string
	schemaVersion: 1
	sources: GeoCatalogSourceRelease[]
	/** Optional for legacy snapshots; new builders should always declare it. */
	coverage?: GeoCatalogSnapshotCoverage
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

export interface GeoCatalogTextRelaxationDiagnostic {
	status: 'applied'
	strategy: 'generic_suffix'
	removedTokens: string[]
	effectiveText: string
}

export type GeoCatalogTextRecoveryStep =
	| {
			strategy: 'trailing_geographic_qualifier'
			removedText: string
			inferredCountryCode: string
	  }
	| {
			strategy: 'generic_suffix'
			removedText: string
	  }
	| {
			strategy: 'spacing_variant' | 'single_character_deletion'
			from: string
			to: string
	  }

/**
 * A conservative discovery-only recovery. The effective text always exactly
 * matches a returned entry name or alias; editor geometry must still be
 * resolved through a returned stable id.
 */
export interface GeoCatalogTextRecoveryDiagnostic {
	status: 'applied'
	steps: GeoCatalogTextRecoveryStep[]
	effectiveText: string
	/** ISO filter actually applied to the recovered lookup. */
	appliedCountryCode?: string
	/** Qualifier boundary (or its intersection with the caller bbox) actually applied. */
	appliedBbox?: GeoCatalogBbox
}

/**
 * Discovery-only recovery for source records that omit an ISO country code.
 * The catalog first resolves one unambiguous level-zero boundary for the
 * caller's explicit country code, then accepts only countryless exact-name
 * matches whose bbox intersects that boundary.
 */
export interface GeoCatalogCountrylessSpatialFallbackDiagnostic {
	status: 'applied'
	countryCode: string
	boundaryId: string
	appliedBbox: GeoCatalogBbox
}

export interface GeoCatalogNearMatch {
	id: string
	name: string
	kind: GeoCatalogKind
	categories: string[]
	geometry?: Geometry
}

export interface GeoCatalogQueryDiagnostics {
	textRelaxation?: GeoCatalogTextRelaxationDiagnostic
	textRecovery?: GeoCatalogTextRecoveryDiagnostic
	countrylessSpatialFallback?: GeoCatalogCountrylessSpatialFallbackDiagnostic
	categorySuggestions?: string[]
	nearMatches?: GeoCatalogNearMatch[]
}

export type GeoCatalogSpatialCoverageStatus =
	| 'global'
	| 'inside'
	| 'partial'
	| 'outside'
	| 'unscoped'
	| 'unknown'

export type GeoCatalogKindCoverageStatus =
	| 'available'
	| 'partial'
	| 'unavailable'
	| 'unscoped'
	| 'unknown'

export type GeoCatalogZeroResultReason =
	| 'no_match_within_snapshot'
	| 'outside_snapshot'
	| 'kind_unavailable'
	| 'outside_snapshot_and_kind_unavailable'
	| 'query_location_unscoped'
	| 'coverage_unknown'

export interface GeoCatalogQueryCoverage {
	spatial: {
		status: GeoCatalogSpatialCoverageStatus
		snapshotBbox?: GeoCatalogBbox
		queryBbox?: GeoCatalogBbox
	}
	kinds: {
		status: GeoCatalogKindCoverageStatus
		available: GeoCatalogKind[]
		missing: GeoCatalogKind[]
	}
	zeroResultReason?: GeoCatalogZeroResultReason
}

export interface GeoCatalogQueryResult {
	items: GeoCatalogEntry[]
	metadata: {
		snapshot: GeoCatalogSnapshotMetadata
		coverage: GeoCatalogQueryCoverage
		query: {
			returned: number
			limit: number
			hasMore: boolean
			diagnostics?: GeoCatalogQueryDiagnostics
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
