import { Client } from '@modelcontextprotocol/sdk/client'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
	NostrClientTransport,
	type NostrTransportOptions,
	PrivateKeySigner,
	ApplesauceRelayPool,
} from '@contextvm/sdk'
import { config } from '@/config'
import { readRelaysFor } from '@/lib/nostr/relay-router'
import { getContextVmSessionPrivateKey } from './clientIdentity'

export interface SearchLocationInput {
	/**
	 * The location query (e.g., "New York City")
	 */
	query: string
	/**
	 * Maximum number of results (default: 10, max: 50)
	 */
	limit?: number
}

export interface SearchLocationOutput {
	result: {
		query: string
		count: number
		results: {
			placeId: number
			displayName: string
			osmType: ('node' | 'way' | 'relation') | null
			osmId: number | null
			coordinates: {
				lat: number
				lon: number
			}
			/**
			 * Bounding box in [west, south, east, north] order
			 */
			boundingbox:
				| []
				| [number]
				| [number, number]
				| [number, number, number]
				| [number, number, number, number]
				| null
			type: string
			class: string
			importance?: number
			address?: {
				[k: string]: string
			}
			extratags?: {
				[k: string]: string
			}
			geojson?: unknown
		}[]
	}
}

export interface ReverseLookupInput {
	/**
	 * Latitude coordinate in WGS84
	 */
	lat: number
	/**
	 * Longitude coordinate in WGS84
	 */
	lon: number
	/**
	 * Level of detail required (0-18, default 18)
	 */
	zoom?: number
}

export interface ReverseLookupOutput {
	result: {
		coordinates: {
			lat: number
			lon: number
		}
		zoom: number
		result: {
			placeId: number
			displayName: string
			osmType: ('node' | 'way' | 'relation') | null
			osmId: number | null
			coordinates: {
				lat: number
				lon: number
			}
			/**
			 * Bounding box in [west, south, east, north] order
			 */
			boundingbox:
				| []
				| [number]
				| [number, number]
				| [number, number, number]
				| [number, number, number, number]
				| null
			type: string
			class: string
			importance?: number
			address?: {
				[k: string]: string
			}
			extratags?: {
				[k: string]: string
			}
			geojson?: unknown
		} | null
	}
}

export interface QueryOsmByIdInput {
	/**
	 * OSM element type
	 */
	osmType: 'node' | 'way' | 'relation'
	/**
	 * OSM element ID
	 */
	osmId: number
}

export interface QueryOsmByIdOutput {
	result: {
		feature: unknown
		osmType: 'node' | 'way' | 'relation'
		osmId: number
	}
}

export interface QueryOsmNearbyInput {
	/**
	 * Latitude coordinate
	 */
	lat: number
	/**
	 * Longitude coordinate
	 */
	lon: number
	/**
	 * Search radius in meters (1-5000)
	 */
	radius?: number
	/**
	 * OSM tag filters
	 */
	filters?: {
		[k: string]: string | [string, ...string[]]
	}
	/**
	 * Alternative filter groups combined with OR semantics. Each object is an AND group; the array is matched as OR.
	 *
	 * @minItems 1
	 */
	filterSets?: [
		{
			[k: string]: string | [string, ...string[]]
		},
		...{
			[k: string]: string | [string, ...string[]]
		}[],
	]
	/**
	 * Maximum results to return
	 */
	limit?: number
	/**
	 * Include relation features (administrative boundaries, routes). Default false.
	 */
	includeRelations?: boolean
}

export interface QueryOsmNearbyOutput {
	result: {
		/**
		 * Array of GeoJSON Features
		 */
		features: unknown[]
		/**
		 * Number of features returned
		 */
		count: number
	}
}

export interface QueryOsmBboxInput {
	/**
	 * Western longitude
	 */
	west: number
	/**
	 * Southern latitude
	 */
	south: number
	/**
	 * Eastern longitude
	 */
	east: number
	/**
	 * Northern latitude
	 */
	north: number
	/**
	 * OSM tag filters
	 */
	filters?: {
		[k: string]: string | [string, ...string[]]
	}
	/**
	 * Alternative filter groups combined with OR semantics. Each object is an AND group; the array is matched as OR.
	 *
	 * @minItems 1
	 */
	filterSets?: [
		{
			[k: string]: string | [string, ...string[]]
		},
		...{
			[k: string]: string | [string, ...string[]]
		}[],
	]
	/**
	 * Maximum results to return
	 */
	limit?: number
	/**
	 * Include relation features (administrative boundaries, routes). Default false.
	 */
	includeRelations?: boolean
}

export interface QueryOsmBboxOutput {
	result: {
		/**
		 * Array of GeoJSON Features
		 */
		features: unknown[]
		/**
		 * Number of features returned
		 */
		count: number
	}
}

export interface ResolveOsmEntityInput {
	/**
	 * Entity name, e.g. 'Vienna' or 'Germany'.
	 */
	query: string
	/**
	 * Maximum candidate results (default 5).
	 */
	limit?: number
	/**
	 * Prefer results with this OSM type (relation recommended for boundaries).
	 */
	preferredOsmType?: 'node' | 'way' | 'relation'
	/**
	 * Optional administrative level filter (2=country, 4=state, etc).
	 */
	adminLevel?: number
	/**
	 * Optional ISO alpha-2 country code to constrain results (e.g., 'AT').
	 */
	countryCode?: string
}

export interface ResolveOsmEntityOutput {
	result: {
		query: string
		count: number
		candidates: {
			placeId: number
			displayName: string
			osmType: ('node' | 'way' | 'relation') | null
			osmId: number | null
			class: string
			type: string
			importance?: number
			coordinates: {
				lat: number
				lon: number
			}
			boundingbox:
				| []
				| [number]
				| [number, number]
				| [number, number, number]
				| [number, number, number, number]
				| null
			extratags?: {
				[k: string]: string
			}
		}[]
	}
}

export interface GetOsmRelationGeometryInput {
	/**
	 * OSM relation ID.
	 */
	relationId: number
	/**
	 * Optional coordinate precision (decimals) for output simplification.
	 */
	coordinatePrecision?: number
	/**
	 * Optional cap for vertices per ring/path.
	 */
	maxPointsPerRing?: number
}

export interface GetOsmRelationGeometryOutput {
	result: {
		relationId: number
		feature: unknown
		tags?: {
			[k: string]: string
		}
		transport?: {
			[k: string]: unknown
		}
	}
}

export interface GetCountryBoundaryInput {
	/**
	 * ISO alpha-2 country code (recommended).
	 */
	countryCode?: string
	/**
	 * Fallback country name if countryCode is unavailable.
	 */
	name?: string
	/**
	 * Boundary admin level (default 2).
	 */
	adminLevel?: number
	coordinatePrecision?: number
	maxPointsPerRing?: number
}

export interface GetCountryBoundaryOutput {
	result: {
		query: string
		relationId: number
		candidateCount: number
		feature: unknown
		tags?: {
			[k: string]: string
		}
		transport?: {
			[k: string]: unknown
		}
	}
}

export interface ValhallaRouteInput {
	/**
	 * Route waypoints in traversal order.
	 *
	 * @minItems 2
	 * @maxItems 25
	 */
	locations: [
		{
			lat: number
			lon: number
		},
		{
			lat: number
			lon: number
		},
		...{
			lat: number
			lon: number
		}[],
	]
	/**
	 * Valhalla costing profile (default auto).
	 */
	profile?: 'auto' | 'bicycle' | 'pedestrian' | 'bus' | 'truck'
	/**
	 * Narrative units (default kilometers).
	 */
	units?: 'kilometers' | 'miles'
	/**
	 * Optional Valhalla base URL override.
	 */
	baseUrl?: string
}

export interface ValhallaRouteOutput {
	result: {
		feature: unknown
		summary: {
			lengthKm: number
			durationMin: number
			profile: string
		}
	}
}

export interface ValhallaIsochroneInput {
	/**
	 * Center point for isochrone computation.
	 */
	location: {
		lat: number
		lon: number
	}
	/**
	 * Isochrone minute contours, e.g. [10, 20, 30].
	 *
	 * @minItems 1
	 * @maxItems 6
	 */
	contoursMinutes?:
		| [number]
		| [number, number]
		| [number, number, number]
		| [number, number, number, number]
		| [number, number, number, number, number]
		| [number, number, number, number, number, number]
	/**
	 * Valhalla costing profile (default auto).
	 */
	profile?: 'auto' | 'bicycle' | 'pedestrian'
	/**
	 * Return polygons instead of lines (default true).
	 */
	polygons?: boolean
	/**
	 * Optional Valhalla base URL override.
	 */
	baseUrl?: string
}

export interface ValhallaIsochroneOutput {
	result: {
		/**
		 * GeoJSON FeatureCollection containing contour features.
		 */
		featureCollection: {
			[k: string]: unknown
		}
		count: number
		profile: string
		contoursMinutes: number[]
	}
}

export interface CreateMapExtractInput {
	/**
	 * Western longitude of bounding box
	 */
	west: number
	/**
	 * Southern latitude of bounding box
	 */
	south: number
	/**
	 * Eastern longitude of bounding box
	 */
	east: number
	/**
	 * Northern latitude of bounding box
	 */
	north: number
	/**
	 * Maximum zoom level (0-16, default 14)
	 */
	maxZoom?: number
	/**
	 * Blossom server URL for upload
	 */
	blossomServer: string
}

export interface CreateMapExtractOutput {
	result: {
		/**
		 * Unique ID to reference this extraction
		 */
		requestId: string
		/**
		 * SHA-256 hash of the extracted PMTiles file
		 */
		sha256: string
		/**
		 * Size of the extracted file in bytes
		 */
		fileSizeBytes: number
		/**
		 * Area of the bounding box in square kilometers
		 */
		areaSqKm: number
		/**
		 * Unsigned Blossom auth event (kind 24242) for client to sign
		 */
		unsignedEvent: {
			kind: number
			created_at: number
			tags: string[][]
			content: string
		}
	}
}

export interface CreateMapUploadInput {
	/**
	 * Request ID from create_map_extract
	 */
	requestId: string
	/**
	 * Signed Blossom auth event from client
	 */
	signedEvent: {
		id: string
		pubkey: string
		kind: number
		created_at: number
		tags: string[][]
		content: string
		sig: string
	}
}

export interface CreateMapUploadOutput {
	result: {
		/**
		 * URL of the uploaded PMTiles file
		 */
		blobUrl: string
		/**
		 * SHA-256 hash of the uploaded file
		 */
		sha256: string
	}
}

export interface WebSearchInput {
	/**
	 * Search query string
	 */
	query: string
	/**
	 * Maximum number of results to return (default: 5, max: 20)
	 */
	limit?: number
	/**
	 * SearXNG search categories, comma-separated (e.g., "general", "science", "it"). Wikipedia and Wikidata are always searched. Default: "general"
	 */
	categories?: string
	/**
	 * Language code for results (e.g., "en", "de"). Default: "en"
	 */
	language?: string
}

export interface WebSearchOutput {
	result: {
		query: string
		count: number
		/**
		 * Whether every configured search provider answered successfully
		 */
		coverage: 'complete' | 'partial' | 'unavailable'
		providers: {
			name: string
			status: 'ok' | 'error' | 'unavailable'
			count: number
			error?: string
		}[]
		results: {
			title: string
			url: string
			/**
			 * Snippet/summary from the search engine
			 */
			content: string
			/**
			 * Search engine that returned this result
			 */
			engine: string
		}[]
	}
}

export interface FetchUrlInput {
	/**
	 * The URL to fetch and extract content from
	 */
	url: string
	/**
	 * Maximum character length of extracted text content (default: 10000)
	 */
	maxLength?: number
}

export interface FetchUrlOutput {
	result: {
		url: string
		title: string | null
		siteName: string | null
		description: string | null
		/**
		 * Extracted readable text content
		 */
		textContent: string
		/**
		 * Length of full extracted text before truncation
		 */
		textLength: number
		truncated: boolean
		/**
		 * ISO 8601 timestamp of fetch
		 */
		fetchedAt: string
	}
}

export interface WikipediaLookupInput {
	/**
	 * Full-text Wikipedia search query (e.g., "Roman ruins Carinthia"). Query takes precedence over title and coordinates.
	 */
	query?: string
	/**
	 * Exact Wikipedia article title (e.g., "Mount Everest"). Either query, title, or lat+lon is required.
	 */
	title?: string
	/**
	 * Latitude for geographic article search. Must be paired with lon.
	 */
	lat?: number
	/**
	 * Longitude for geographic article search. Must be paired with lat.
	 */
	lon?: number
	/**
	 * Search radius in meters for geo lookup (default: 1000, max: 10000)
	 */
	radius?: number
	/**
	 * Max articles to return for geo search (default: 5, max: 10)
	 */
	limit?: number
	/**
	 * Wikipedia language code (default: "en"). Examples: "en", "de", "fr", "ja"
	 */
	language?: string
}

export interface WikipediaLookupOutput {
	result: {
		mode: 'search' | 'title' | 'geosearch'
		/**
		 * The title or coordinate query used
		 */
		query: string
		count: number
		articles: {
			title: string
			pageId: number
			url: string
			/**
			 * Plain text extract/summary of the article
			 */
			extract: string
			/**
			 * Geographic coordinates if available
			 */
			coordinates: {
				lat: number
				lon: number
			} | null
			/**
			 * Short Wikidata description
			 */
			description: string | null
		}[]
	}
}

export interface WikipediaExtractInput {
	/**
	 * A wikipedia.org article URL. Either url or title is required.
	 */
	url?: string
	/**
	 * Exact Wikipedia article title. Either title or url is required.
	 */
	title?: string
	/**
	 * Wikipedia language code when title is used (default: "en").
	 */
	language?: string
	/**
	 * "article" reads bounded article prose; "section" reads one bounded section; "outline" lists sections and table shapes; "table" returns rows from tableIndex. Default: "outline".
	 */
	mode?: 'outline' | 'article' | 'section' | 'table'
	/**
	 * Revision ID returned by a previous prose page. Pass it on continuations so textOffset addresses the same article revision.
	 */
	revisionId?: number
	/**
	 * MediaWiki section index from outline mode (for example "2" or "2.1").
	 */
	sectionIndex?: string
	/**
	 * Exact section title when sectionIndex is unavailable. Must identify one section.
	 */
	sectionTitle?: string
	/**
	 * Zero-based character offset in article or section mode (default: 0).
	 */
	textOffset?: number
	/**
	 * Maximum characters returned in article or section mode (default: 12000, max: 30000).
	 */
	textLimit?: number
	/**
	 * Zero-based table index. Required in table mode.
	 */
	tableIndex?: number
	/**
	 * Zero-based data-row offset in table mode (default: 0).
	 */
	rowOffset?: number
	/**
	 * Maximum rows returned in table mode (default: 50, max: 200).
	 */
	rowLimit?: number
}

export interface WikipediaExtractOutput {
	result: {
		mode: 'outline' | 'article' | 'section' | 'table'
		source: {
			title: string
			url: string
			pageId: number | null
			revisionId: number | null
			language: string
			/**
			 * ISO 8601 retrieval timestamp
			 */
			retrievedAt: string
		}
		lead?: string
		sections: {
			index: string
			level: number
			title: string
			anchor: string
		}[]
		tables: {
			index: number
			sectionIndex: string | null
			sectionTitle: string | null
			caption: string | null
			headers: string[]
			rowCount: number
			sampleRows?: {
				[k: string]: string
			}[]
			rows?: {
				sourceRow: number
				cells: {
					[k: string]: string
				}
			}[]
		}[]
		prose?: {
			scope: 'article' | 'section'
			section: {
				index: string
				level: number
				title: string
				anchor: string
			} | null
			text: string
		}
		textPagination?: {
			/**
			 * "complete" is the only status where this response contains all requested prose; "more" has a next page; "final_page" still omits earlier text.
			 */
			status: 'complete' | 'more' | 'final_page'
			offset: number
			returnedCharacters: number
			totalCharacters: number
			hasPrevious: boolean
			hasNext: boolean
			nextOffset: number | null
			/**
			 * Revision to pass back on every continuation so character offsets remain stable
			 */
			revisionId: number | null
			/**
			 * Explicit model-facing statement of prose coverage and next action
			 */
			message: string
		}
		table?: {
			index: number
			sectionIndex: string | null
			sectionTitle: string | null
			caption: string | null
			headers: string[]
			rowCount: number
			sampleRows?: {
				[k: string]: string
			}[]
			rows?: {
				sourceRow: number
				cells: {
					[k: string]: string
				}
			}[]
		}
		offset?: number
		returnedRows?: number
		totalRows?: number
		truncated?: boolean
		pagination?: {
			/**
			 * "complete" is the only status where this response contains the full table; "more" has a next page; "final_page" still omits earlier rows.
			 */
			status: 'complete' | 'more' | 'final_page'
			offset: number
			returnedRows: number
			totalRows: number
			hasPrevious: boolean
			hasNext: boolean
			nextOffset: number | null
			/**
			 * Explicit model-facing statement of table coverage and next action
			 */
			message: string
		}
	}
}

export type EarthlyGeoServer = {
	SearchLocation: (query: string, limit?: number) => Promise<SearchLocationOutput>
	ReverseLookup: (lat: number, lon: number, zoom?: number) => Promise<ReverseLookupOutput>
	QueryOsmById: (osmType: string, osmId: number) => Promise<QueryOsmByIdOutput>
	QueryOsmNearby: (
		lat: number,
		lon: number,
		radius?: number,
		filters?: object,
		filterSets?: object[],
		limit?: number,
		includeRelations?: boolean,
	) => Promise<QueryOsmNearbyOutput>
	QueryOsmBbox: (
		west: number,
		south: number,
		east: number,
		north: number,
		filters?: object,
		filterSets?: object[],
		limit?: number,
		includeRelations?: boolean,
	) => Promise<QueryOsmBboxOutput>
	ResolveOsmEntity: (
		query: string,
		limit?: number,
		preferredOsmType?: string,
		adminLevel?: number,
		countryCode?: string,
	) => Promise<ResolveOsmEntityOutput>
	GetOsmRelationGeometry: (
		relationId: number,
		coordinatePrecision?: number,
		maxPointsPerRing?: number,
	) => Promise<GetOsmRelationGeometryOutput>
	GetCountryBoundary: (
		countryCode?: string,
		name?: string,
		adminLevel?: number,
		coordinatePrecision?: number,
		maxPointsPerRing?: number,
	) => Promise<GetCountryBoundaryOutput>
	ValhallaRoute: (
		locations: object[],
		profile?: string,
		units?: string,
		baseUrl?: string,
	) => Promise<ValhallaRouteOutput>
	ValhallaIsochrone: (
		location: object,
		contoursMinutes?: number[],
		profile?: string,
		polygons?: boolean,
		baseUrl?: string,
	) => Promise<ValhallaIsochroneOutput>
	CreateMapExtract: (
		west: number,
		south: number,
		east: number,
		north: number,
		maxZoom: number | undefined,
		blossomServer: string,
	) => Promise<CreateMapExtractOutput>
	CreateMapUpload: (requestId: string, signedEvent: object) => Promise<CreateMapUploadOutput>
	WebSearch: (
		query: string,
		limit?: number,
		categories?: string,
		language?: string,
	) => Promise<WebSearchOutput>
	FetchUrl: (url: string, maxLength?: number) => Promise<FetchUrlOutput>
	WikipediaLookup: (
		query?: string,
		title?: string,
		lat?: number,
		lon?: number,
		radius?: number,
		limit?: number,
		language?: string,
	) => Promise<WikipediaLookupOutput>
	WikipediaExtract: (
		url?: string,
		title?: string,
		language?: string,
		mode?: string,
		revisionId?: number,
		sectionIndex?: string,
		sectionTitle?: string,
		textOffset?: number,
		textLimit?: number,
		tableIndex?: number,
		rowOffset?: number,
		rowLimit?: number,
	) => Promise<WikipediaExtractOutput>
}

export class EarthlyGeoServerClient implements EarthlyGeoServer {
	static readonly SERVER_PUBKEY = 'ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc'
	static readonly DEFAULT_RELAYS = ['wss://relay.earthly.city', 'wss://relay2.contextvm.org']
	private client: Client
	private transport: Transport
	private connectionPromise: Promise<void>

	constructor(
		options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {},
	) {
		this.client = new Client({
			name: 'EarthlyGeoServerClient',
			version: '0.2.1',
		})

		// Explicit credentials support tests and standalone consumers. Earthly itself uses a fresh,
		// process-local transport identity instead of shipping a shared private key in its bundle.
		const resolvedPrivateKey = options.privateKey || getContextVmSessionPrivateKey()

		// Use options.signer if provided, otherwise create from resolved private key
		const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey)
		// Route through the app's discovery bucket. DEFAULT_RELAYS is only for standalone consumers
		// that construct this generated client without Earthly's runtime configuration.
		const routedRelays = readRelaysFor('discovery')
		const relays =
			options.relays ||
			(routedRelays.length > 0 ? routedRelays : EarthlyGeoServerClient.DEFAULT_RELAYS)
		// Use options.relayHandler if provided, otherwise create from relays
		const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays)
		const serverPubkey = options.serverPubkey || config.serverPubkey
		const { privateKey: _, ...rest } = options

		this.transport = new NostrClientTransport({
			serverPubkey: serverPubkey || EarthlyGeoServerClient.SERVER_PUBKEY,
			signer,
			relayHandler,
			isStateless: true,
			// CEP-22 oversized transfer support is explicit so generated-client refreshes cannot
			// silently remove the geometry/tool-result transport policy.
			oversizedTransfer: { enabled: true },
			...rest,
		})

		this.connectionPromise = this.client.connect(this.transport)
		this.connectionPromise.catch((error) => {
			console.error(`Failed to connect to server: ${error}`)
		})
	}

	async disconnect(): Promise<void> {
		await this.transport.close()
	}

	async listTools(): Promise<Awaited<ReturnType<Client['listTools']>>> {
		await this.connectionPromise
		return this.client.listTools()
	}

	async callRemoteTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
		return this.call<T>(name, args)
	}

	private async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
		await this.connectionPromise
		const result = await this.client.callTool({
			name,
			arguments: { ...args },
		})
		if (result.isError) {
			const structured = result.structuredContent as Record<string, unknown> | undefined
			const errorText =
				(structured && typeof structured.error === 'string' && structured.error) ||
				(Array.isArray(result.content)
					? result.content
							.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
							.map((block) => block.text)
							.join('\n')
					: 'Unknown error')
			throw new Error(errorText)
		}
		if (result.structuredContent !== undefined) {
			return result.structuredContent as T
		}
		if (Array.isArray(result.content)) {
			const textBlock = result.content.find(
				(block): block is { type: 'text'; text: string } => block.type === 'text',
			)
			if (textBlock) return JSON.parse(textBlock.text) as T
		}
		throw new Error(`MCP tool "${name}" returned no usable content`)
	}

	/**
	 * Search for locations using OpenStreetMap Nominatim API. Returns coordinates, bounding boxes, and geojson outlines.
	 * @param {string} query The location query (e.g., "New York City")
	 * @param {number} limit [optional] Maximum number of results (default: 10, max: 50)
	 * @returns {Promise<SearchLocationOutput>} The result of the search_location operation
	 */
	async SearchLocation(query: string, limit?: number): Promise<SearchLocationOutput> {
		return this.call('search_location', { query, limit })
	}

	/**
	 * Reverse geocode coordinates using OpenStreetMap Nominatim API. Returns address information for a point.
	 * @param {number} lat Latitude coordinate in WGS84
	 * @param {number} lon Longitude coordinate in WGS84
	 * @param {number} zoom [optional] Level of detail required (0-18, default 18)
	 * @returns {Promise<ReverseLookupOutput>} The result of the reverse_lookup operation
	 */
	async ReverseLookup(lat: number, lon: number, zoom?: number): Promise<ReverseLookupOutput> {
		return this.call('reverse_lookup', { lat, lon, zoom })
	}

	/**
	 * Query a single OpenStreetMap element by type and ID. Returns full geometry as GeoJSON.
	 * @param {string} osmType OSM element type
	 * @param {number} osmId OSM element ID
	 * @returns {Promise<QueryOsmByIdOutput>} The result of the query_osm_by_id operation
	 */
	async QueryOsmById(osmType: string, osmId: number): Promise<QueryOsmByIdOutput> {
		return this.call('query_osm_by_id', { osmType, osmId })
	}

	/**
	 * Query OpenStreetMap elements near a point. Supports filtering by OSM tags. Returns GeoJSON features.
	 * @param {number} lat Latitude coordinate
	 * @param {number} lon Longitude coordinate
	 * @param {number} radius [optional] Search radius in meters (1-5000)
	 * @param {object} filters [optional] OSM tag filters
	 * @param {object[]} filterSets [optional] Alternative filter groups combined with OR semantics. Each object is an AND group; the array is matched as OR.
	 * @param {number} limit [optional] Maximum results to return
	 * @param {boolean} includeRelations [optional] Include relation features (administrative boundaries, routes). Default false.
	 * @returns {Promise<QueryOsmNearbyOutput>} The result of the query_osm_nearby operation
	 */
	async QueryOsmNearby(
		lat: number,
		lon: number,
		radius?: number,
		filters?: object,
		filterSetsOrLimit?: object[] | number,
		limitOrIncludeRelations?: number | boolean,
		includeRelations?: boolean,
	): Promise<QueryOsmNearbyOutput> {
		const filterSets = Array.isArray(filterSetsOrLimit) ? filterSetsOrLimit : undefined
		const limit =
			typeof filterSetsOrLimit === 'number'
				? filterSetsOrLimit
				: typeof limitOrIncludeRelations === 'number'
					? limitOrIncludeRelations
					: undefined
		const normalizedIncludeRelations =
			typeof includeRelations === 'boolean'
				? includeRelations
				: typeof limitOrIncludeRelations === 'boolean'
					? limitOrIncludeRelations
					: undefined
		return this.call('query_osm_nearby', {
			lat,
			lon,
			radius,
			filters,
			filterSets,
			limit,
			includeRelations: normalizedIncludeRelations,
		})
	}

	/**
	 * Query OpenStreetMap elements within a bounding box. Supports filtering by OSM tags. Returns GeoJSON features.
	 * @param {number} west Western longitude
	 * @param {number} south Southern latitude
	 * @param {number} east Eastern longitude
	 * @param {number} north Northern latitude
	 * @param {object} filters [optional] OSM tag filters
	 * @param {object[]} filterSets [optional] Alternative filter groups combined with OR semantics. Each object is an AND group; the array is matched as OR.
	 * @param {number} limit [optional] Maximum results to return
	 * @param {boolean} includeRelations [optional] Include relation features (administrative boundaries, routes). Default false.
	 * @returns {Promise<QueryOsmBboxOutput>} The result of the query_osm_bbox operation
	 */
	async QueryOsmBbox(
		west: number,
		south: number,
		east: number,
		north: number,
		filters?: object,
		filterSetsOrLimit?: object[] | number,
		limitOrIncludeRelations?: number | boolean,
		includeRelations?: boolean,
	): Promise<QueryOsmBboxOutput> {
		const filterSets = Array.isArray(filterSetsOrLimit) ? filterSetsOrLimit : undefined
		const limit =
			typeof filterSetsOrLimit === 'number'
				? filterSetsOrLimit
				: typeof limitOrIncludeRelations === 'number'
					? limitOrIncludeRelations
					: undefined
		const normalizedIncludeRelations =
			typeof includeRelations === 'boolean'
				? includeRelations
				: typeof limitOrIncludeRelations === 'boolean'
					? limitOrIncludeRelations
					: undefined
		return this.call('query_osm_bbox', {
			west,
			south,
			east,
			north,
			filters,
			filterSets,
			limit,
			includeRelations: normalizedIncludeRelations,
		})
	}

	/**
	 * Resolve a place/entity name to concrete OSM ids (relation/way/node) using Nominatim. Useful before boundary imports.
	 * @param {string} query Entity name, e.g. 'Vienna' or 'Germany'.
	 * @param {number} limit [optional] Maximum candidate results (default 5).
	 * @param {string} preferredOsmType [optional] Prefer results with this OSM type (relation recommended for boundaries).
	 * @param {number} adminLevel [optional] Optional administrative level filter (2=country, 4=state, etc).
	 * @param {string} countryCode [optional] Optional ISO alpha-2 country code to constrain results (e.g., 'AT').
	 * @returns {Promise<ResolveOsmEntityOutput>} The result of the resolve_osm_entity operation
	 */
	async ResolveOsmEntity(
		query: string,
		limit?: number,
		preferredOsmType?: string,
		adminLevel?: number,
		countryCode?: string,
	): Promise<ResolveOsmEntityOutput> {
		return this.call('resolve_osm_entity', {
			query,
			limit,
			preferredOsmType,
			adminLevel,
			countryCode,
		})
	}

	/**
	 * Fetch and assemble OSM relation geometry (especially boundaries) into clean GeoJSON.
	 * @param {number} relationId OSM relation ID.
	 * @param {number} coordinatePrecision [optional] Optional coordinate precision (decimals) for output simplification.
	 * @param {number} maxPointsPerRing [optional] Optional cap for vertices per ring/path.
	 * @returns {Promise<GetOsmRelationGeometryOutput>} The result of the get_osm_relation_geometry operation
	 */
	async GetOsmRelationGeometry(
		relationId: number,
		coordinatePrecision?: number,
		maxPointsPerRing?: number,
	): Promise<GetOsmRelationGeometryOutput> {
		return this.call('get_osm_relation_geometry', {
			relationId,
			coordinatePrecision,
			maxPointsPerRing,
		})
	}

	/**
	 * Resolve and fetch a country administrative boundary relation (admin_level=2 by default).
	 * @param {string} countryCode [optional] ISO alpha-2 country code (recommended).
	 * @param {string} name [optional] Fallback country name if countryCode is unavailable.
	 * @param {number} adminLevel [optional] Boundary admin level (default 2).
	 * @param {number} coordinatePrecision [optional] The coordinate precision parameter
	 * @param {number} maxPointsPerRing [optional] The max points per ring parameter
	 * @returns {Promise<GetCountryBoundaryOutput>} The result of the get_country_boundary operation
	 */
	async GetCountryBoundary(
		countryCode?: string,
		name?: string,
		adminLevel?: number,
		coordinatePrecision?: number,
		maxPointsPerRing?: number,
	): Promise<GetCountryBoundaryOutput> {
		return this.call('get_country_boundary', {
			countryCode,
			name,
			adminLevel,
			coordinatePrecision,
			maxPointsPerRing,
		})
	}

	/**
	 * Compute a route between waypoints using Valhalla and return GeoJSON line geometry.
	 * @param {object[]} locations Route waypoints in traversal order.
	 * @param {string} profile [optional] Valhalla costing profile (default auto).
	 * @param {string} units [optional] Narrative units (default kilometers).
	 * @param {string} baseUrl [optional] Optional Valhalla base URL override.
	 * @returns {Promise<ValhallaRouteOutput>} The result of the valhalla_route operation
	 */
	async ValhallaRoute(
		locations: object[],
		profile?: string,
		units?: string,
		baseUrl?: string,
	): Promise<ValhallaRouteOutput> {
		return this.call('valhalla_route', { locations, profile, units, baseUrl })
	}

	/**
	 * Compute isochrone contours around a location using Valhalla.
	 * @param {object} location Center point for isochrone computation.
	 * @param {number[]} contoursMinutes [optional] Isochrone minute contours, e.g. [10, 20, 30].
	 * @param {string} profile [optional] Valhalla costing profile (default auto).
	 * @param {boolean} polygons [optional] Return polygons instead of lines (default true).
	 * @param {string} baseUrl [optional] Optional Valhalla base URL override.
	 * @returns {Promise<ValhallaIsochroneOutput>} The result of the valhalla_isochrone operation
	 */
	async ValhallaIsochrone(
		location: object,
		contoursMinutes?: number[],
		profile?: string,
		polygons?: boolean,
		baseUrl?: string,
	): Promise<ValhallaIsochroneOutput> {
		return this.call('valhalla_isochrone', {
			location,
			contoursMinutes,
			profile,
			polygons,
			baseUrl,
		})
	}

	/**
	 * Extract a PMTiles map excerpt for a bounding box. Returns an unsigned Blossom auth event for the client to sign, then call create_map_upload with the signed event.
	 * @param {number} west Western longitude of bounding box
	 * @param {number} south Southern latitude of bounding box
	 * @param {number} east Eastern longitude of bounding box
	 * @param {number} north Northern latitude of bounding box
	 * @param {number} maxZoom [optional] Maximum zoom level (0-16, default 14)
	 * @param {string} blossomServer Blossom server URL for upload
	 * @returns {Promise<CreateMapExtractOutput>} The result of the create_map_extract operation
	 */
	async CreateMapExtract(
		west: number,
		south: number,
		east: number,
		north: number,
		maxZoom: number | undefined,
		blossomServer: string,
	): Promise<CreateMapExtractOutput> {
		return this.call('create_map_extract', { west, south, east, north, maxZoom, blossomServer })
	}

	/**
	 * Upload the extracted PMTiles file to Blossom using a signed auth event. Call create_map_extract first to get the unsigned event.
	 * @param {string} requestId Request ID from create_map_extract
	 * @param {object} signedEvent Signed Blossom auth event from client
	 * @returns {Promise<CreateMapUploadOutput>} The result of the create_map_upload operation
	 */
	async CreateMapUpload(requestId: string, signedEvent: object): Promise<CreateMapUploadOutput> {
		return this.call('create_map_upload', { requestId, signedEvent })
	}

	/**
	 * Search Wikipedia, Wikidata, and Earthly's private SearXNG instance in parallel. Returns partial results with provider health when one source is unavailable.
	 * @param {string} query Search query string
	 * @param {number} limit [optional] Maximum number of results to return (default: 5, max: 20)
	 * @param {string} categories [optional] SearXNG search categories, comma-separated (e.g., "general", "science", "it"). Wikipedia and Wikidata are always searched. Default: "general"
	 * @param {string} language [optional] Language code for results (e.g., "en", "de"). Default: "en"
	 * @returns {Promise<WebSearchOutput>} The result of the web_search operation
	 */
	async WebSearch(
		query: string,
		limit?: number,
		categories?: string,
		language?: string,
	): Promise<WebSearchOutput> {
		return this.call('web_search', { query, limit, categories, language })
	}

	/**
	 * Fetch a URL and extract readable text content using Mozilla Readability. Returns title, description, and cleaned article text.
	 * @param {string} url The URL to fetch and extract content from
	 * @param {number} maxLength [optional] Maximum character length of extracted text content (default: 10000)
	 * @returns {Promise<FetchUrlOutput>} The result of the fetch_url operation
	 */
	async FetchUrl(url: string, maxLength?: number): Promise<FetchUrlOutput> {
		return this.call('fetch_url', { url, maxLength })
	}

	/**
	 * Search Wikipedia full text, look up an exact title, or find nearby articles by geographic coordinates. Returns article summaries and coordinates.
	 * @param {string} query [optional] Full-text Wikipedia search query (e.g., "Roman ruins Carinthia"). Query takes precedence over title and coordinates.
	 * @param {string} title [optional] Exact Wikipedia article title (e.g., "Mount Everest"). Either query, title, or lat+lon is required.
	 * @param {number} lat [optional] Latitude for geographic article search. Must be paired with lon.
	 * @param {number} lon [optional] Longitude for geographic article search. Must be paired with lat.
	 * @param {number} radius [optional] Search radius in meters for geo lookup (default: 1000, max: 10000)
	 * @param {number} limit [optional] Max articles to return for geo search (default: 5, max: 10)
	 * @param {string} language [optional] Wikipedia language code (default: "en"). Examples: "en", "de", "fr", "ja"
	 * @returns {Promise<WikipediaLookupOutput>} The result of the wikipedia_lookup operation
	 */
	async WikipediaLookup(
		query?: string,
		title?: string,
		lat?: number,
		lon?: number,
		radius?: number,
		limit?: number,
		language?: string,
	): Promise<WikipediaLookupOutput> {
		return this.call('wikipedia_lookup', { query, title, lat, lon, radius, limit, language })
	}

	/**
	 * Read bounded prose or structured tables from one Wikipedia article without scraping alternate raw/API URLs. Use article mode for prose, section mode with a section index/title for focused prose, outline mode to discover sections and tables, and table mode for rows. Prose continuations use textPagination.nextOffset and must pass the returned revisionId; table continuations use pagination.nextOffset. Every response preserves article and revision provenance.
	 * @param {string} url [optional] A wikipedia.org article URL. Either url or title is required.
	 * @param {string} title [optional] Exact Wikipedia article title. Either title or url is required.
	 * @param {string} language [optional] Wikipedia language code when title is used (default: "en").
	 * @param {string} mode [optional] "article" reads bounded article prose; "section" reads one bounded section; "outline" lists sections and table shapes; "table" returns rows from tableIndex. Default: "outline".
	 * @param {number} revisionId [optional] Revision ID returned by a previous prose page. Pass it on continuations so textOffset addresses the same article revision.
	 * @param {string} sectionIndex [optional] MediaWiki section index from outline mode (for example "2" or "2.1").
	 * @param {string} sectionTitle [optional] Exact section title when sectionIndex is unavailable. Must identify one section.
	 * @param {number} textOffset [optional] Zero-based character offset in article or section mode (default: 0).
	 * @param {number} textLimit [optional] Maximum characters returned in article or section mode (default: 12000, max: 30000).
	 * @param {number} tableIndex [optional] Zero-based table index. Required in table mode.
	 * @param {number} rowOffset [optional] Zero-based data-row offset in table mode (default: 0).
	 * @param {number} rowLimit [optional] Maximum rows returned in table mode (default: 50, max: 200).
	 * @returns {Promise<WikipediaExtractOutput>} The result of the wikipedia_extract operation
	 */
	async WikipediaExtract(
		url?: string,
		title?: string,
		language?: string,
		mode?: string,
		revisionId?: number,
		sectionIndex?: string,
		sectionTitle?: string,
		textOffset?: number,
		textLimit?: number,
		tableIndex?: number,
		rowOffset?: number,
		rowLimit?: number,
	): Promise<WikipediaExtractOutput> {
		return this.call('wikipedia_extract', {
			url,
			title,
			language,
			mode,
			revisionId,
			sectionIndex,
			sectionTitle,
			textOffset,
			textLimit,
			tableIndex,
			rowOffset,
			rowLimit,
		})
	}
}
