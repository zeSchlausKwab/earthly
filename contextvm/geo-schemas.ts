import { z } from "zod";

export const nominatimLocationSchema = z.object({
	placeId: z.number(),
	displayName: z.string(),
	osmType: z.enum(["node", "way", "relation"]).nullable(),
	osmId: z.number().nullable(),
	coordinates: z.object({
		lat: z.number(),
		lon: z.number(),
	}),
	boundingbox: z
		.tuple([z.number(), z.number(), z.number(), z.number()])
		.nullable()
		.describe("Bounding box in [west, south, east, north] order"),
	type: z.string(),
	class: z.string(),
	importance: z.number().optional(),
	address: z.record(z.string(), z.string()).optional(),
	extratags: z.record(z.string(), z.string()).optional(),
	geojson: z.any().optional(),
});

export type NominatimLocation = z.infer<typeof nominatimLocationSchema>;

export const searchLocationInputSchema = {
	query: z.string().describe('The location query (e.g., "New York City")'),
	limit: z
		.number()
		.optional()
		.describe("Maximum number of results (default: 10, max: 50)"),
};

export const searchLocationOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		results: z.array(nominatimLocationSchema),
	}),
};

export type SearchLocationInput = {
	query: string;
	limit?: number;
};

export type SearchLocationOutput = {
	result: {
		query: string;
		count: number;
		results: NominatimLocation[];
	};
};

export const reverseLookupInputSchema = {
	lat: z.number().min(-90).max(90).describe("Latitude coordinate in WGS84"),
	lon: z.number().min(-180).max(180).describe("Longitude coordinate in WGS84"),
	zoom: z
		.number()
		.optional()
		.describe("Level of detail required (0-18, default 18)"),
};

export const reverseLookupOutputSchema = {
	result: z.object({
		coordinates: z.object({
			lat: z.number(),
			lon: z.number(),
		}),
		zoom: z.number(),
		result: nominatimLocationSchema.nullable(),
	}),
};

export type ReverseLookupInput = {
	lat: number;
	lon: number;
	zoom?: number;
};

export type ReverseLookupOutput = {
	result: {
		coordinates: { lat: number; lon: number };
		zoom: number;
		result: NominatimLocation | null;
	};
};

// ==========================================
// Local GeoCatalog Schemas
// ==========================================

export const geoCatalogKindSchema = z.enum([
	"admin",
	"locality",
	"place",
	"road",
	"rail",
	"waterway",
	"infrastructure",
]);

export const queryGeographyInputSchema = {
	text: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Name or short geography search. Discovery can recover catalogued trailing qualifiers such as Nepal or Tibet and a small set of unambiguous spacing/spelling variants; stable-id and geometry lookups remain exact.",
		),
	ids: z
		.array(z.string().min(1))
		.min(1)
		.optional()
		.describe("Stable catalog ids to resolve exactly."),
	kinds: z
		.array(geoCatalogKindSchema)
		.min(1)
		.optional()
		.describe("Optional normalized feature kinds to include."),
	categories: z
		.array(z.string().min(1))
		.min(1)
		.optional()
		.describe(
			"Exact normalized classifications such as hospital, village, river, motorway, or corridor.",
		),
	adminLevels: z
		.array(z.number().int().nonnegative())
		.min(1)
		.optional()
		.describe("Administrative hierarchy levels, where 0 is country and 1 is first subdivision."),
	countryCode: z
		.string()
		.length(2)
		.optional()
		.describe("Optional ISO alpha-2 country code."),
	bbox: z
		.object({
			west: z.number().min(-180).max(180),
			south: z.number().min(-90).max(90),
			east: z.number().min(-180).max(180),
			north: z.number().min(-90).max(90),
		})
		.optional()
		.describe("Optional WGS84 bounding box."),
	near: z
		.object({
			longitude: z.number().min(-180).max(180),
			latitude: z.number().min(-90).max(90),
		})
		.optional()
		.describe("Optional point used for proximity filtering and ordering."),
	radiusMeters: z
		.number()
		.positive()
		.optional()
		.describe("Optional radius around near, in meters."),
	limit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Maximum number of results to return."),
	includeGeometry: z
		.boolean()
		.optional()
		.describe("Include GeoJSON geometry. Leave false for lightweight discovery."),
};

const geoCatalogSourceSchema = z.object({
	name: z.string(),
	release: z.string(),
	recordId: z.string().optional(),
});

const geoCatalogEntrySchema = z.object({
	id: z.string(),
	kind: geoCatalogKindSchema,
	name: z.string(),
	aliases: z.array(z.string()),
	categories: z.array(z.string()),
	countryCode: z.string().optional(),
	adminLevel: z.number().int().nonnegative().optional(),
	bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
	center: z
		.object({ longitude: z.number(), latitude: z.number() }),
	importance: z.number(),
	source: geoCatalogSourceSchema,
	properties: z.record(z.string(), z.unknown()),
	geometry: z.unknown().optional(),
});

const geoCatalogBboxSchema = z.tuple([
	z.number(),
	z.number(),
	z.number(),
	z.number(),
]);

const geoCatalogCoverageSchema = z.object({
	spatial: z.object({
		status: z.enum([
			"global",
			"inside",
			"partial",
			"outside",
			"unscoped",
			"unknown",
		]),
		snapshotBbox: geoCatalogBboxSchema.optional(),
		queryBbox: geoCatalogBboxSchema.optional(),
	}),
	kinds: z.object({
		status: z.enum([
			"available",
			"partial",
			"unavailable",
			"unscoped",
			"unknown",
		]),
		available: z.array(geoCatalogKindSchema),
		missing: z.array(geoCatalogKindSchema),
	}),
	zeroResultReason: z
		.enum([
			"no_match_within_snapshot",
			"outside_snapshot",
			"kind_unavailable",
			"outside_snapshot_and_kind_unavailable",
			"query_location_unscoped",
			"coverage_unknown",
		])
		.optional(),
});

export const queryGeographyOutputSchema = {
	result: z.object({
		items: z.array(geoCatalogEntrySchema),
		metadata: z.object({
			snapshot: z.object({
				id: z.string(),
				createdAt: z.string(),
				schemaVersion: z.literal(1),
				coverage: z
					.object({
						spatial: z.union([
							z.object({ scope: z.literal("global") }),
							z.object({
								scope: z.literal("bbox"),
								bbox: geoCatalogBboxSchema,
							}),
						]),
						kinds: z.array(geoCatalogKindSchema),
					})
					.optional(),
				sources: z.array(
					z.object({
						name: z.string(),
						release: z.string(),
						attribution: z.string().optional(),
						attributionUrl: z.string().optional(),
						license: z.string().optional(),
						documents: z
							.array(
								z.object({
									name: z.string(),
									url: z.string(),
									content: z.string().optional(),
								}),
							)
							.optional(),
					}),
				),
			}),
			coverage: geoCatalogCoverageSchema,
			query: z.object({
				returned: z.number(),
				limit: z.number(),
				hasMore: z.boolean(),
				diagnostics: z
					.object({
						textRelaxation: z
							.object({
								status: z.literal("applied"),
								strategy: z.literal("generic_suffix"),
								removedTokens: z.array(z.string()),
								effectiveText: z.string(),
							})
							.optional(),
						textRecovery: z
							.object({
								status: z.literal("applied"),
								steps: z.array(
									z.union([
										z.object({
											strategy: z.literal("trailing_geographic_qualifier"),
											removedText: z.string(),
											inferredCountryCode: z.string().length(2),
										}),
										z.object({
											strategy: z.literal("generic_suffix"),
											removedText: z.string(),
										}),
										z.object({
											strategy: z.enum([
												"spacing_variant",
												"single_character_deletion",
											]),
											from: z.string(),
											to: z.string(),
										}),
									]),
								),
								effectiveText: z.string(),
								appliedCountryCode: z.string().length(2).optional(),
								appliedBbox: geoCatalogBboxSchema.optional(),
							})
							.optional(),
						categorySuggestions: z.array(z.string()).optional(),
						nearMatches: z
							.array(
								z.object({
									id: z.string(),
									name: z.string(),
									kind: geoCatalogKindSchema,
									categories: z.array(z.string()),
									geometry: z.unknown().optional(),
								}),
							)
							.optional(),
					})
					.optional(),
			}),
		}),
	}),
};

// ==========================================
// Overpass API Schemas
// ==========================================

export const osmElementTypeSchema = z.enum(["node", "way", "relation"]);

export const osmFilterValueSchema = z.union([
	z.string(),
	z.array(z.string()).min(1),
]);

export const osmFiltersSchema = z
	.record(z.string(), osmFilterValueSchema)
	.describe(
		'OSM tag filters. Values can be a string or string array for OR matching. Use "*" for any value, e.g. { highway: "*" } or { military: ["base", "air_base"] }.'
	);

export const osmFilterSetsSchema = z
	.array(osmFiltersSchema)
	.min(1)
	.describe(
		'Alternative filter groups combined with OR semantics. Each object is an AND group; the array is matched as OR.'
	);

export const queryByIdInputSchema = {
	osmType: osmElementTypeSchema.describe("OSM element type"),
	osmId: z.number().positive().describe("OSM element ID"),
};

export const queryByIdOutputSchema = {
	result: z.object({
		feature: z.any().nullable().describe("GeoJSON Feature or null if not found"),
		osmType: osmElementTypeSchema,
		osmId: z.number(),
	}),
};

export type QueryByIdInput = {
	osmType: "node" | "way" | "relation";
	osmId: number;
};

export type QueryByIdOutput = {
	result: {
		feature: unknown | null;
		osmType: "node" | "way" | "relation";
		osmId: number;
	};
};

export const queryNearbyInputSchema = {
	lat: z.number().min(-90).max(90).describe("Latitude coordinate"),
	lon: z.number().min(-180).max(180).describe("Longitude coordinate"),
	radius: z.number().min(1).max(5000).default(100).describe("Search radius in meters (1-5000)"),
	filters: osmFiltersSchema.optional().describe("OSM tag filters"),
	filterSets: osmFilterSetsSchema.optional(),
	limit: z.number().min(1).max(100).optional().describe("Maximum results to return"),
	includeRelations: z
		.boolean()
		.optional()
		.describe("Include relation features (administrative boundaries, routes). Default false."),
};

export const queryFeaturesOutputSchema = {
	result: z.object({
		features: z.array(z.any()).describe("Array of GeoJSON Features"),
		count: z.number().describe("Number of features returned"),
	}),
};

export type QueryNearbyInput = {
	lat: number;
	lon: number;
	radius?: number;
	filters?: Record<string, string | string[]>;
	filterSets?: Array<Record<string, string | string[]>>;
	limit?: number;
	includeRelations?: boolean;
};

export type QueryFeaturesOutput = {
	result: {
		features: unknown[];
		count: number;
	};
};

export const queryBboxInputSchema = {
	west: z.number().min(-180).max(180).describe("Western longitude"),
	south: z.number().min(-90).max(90).describe("Southern latitude"),
	east: z.number().min(-180).max(180).describe("Eastern longitude"),
	north: z.number().min(-90).max(90).describe("Northern latitude"),
	filters: osmFiltersSchema.optional().describe("OSM tag filters"),
	filterSets: osmFilterSetsSchema.optional(),
	limit: z.number().min(1).max(100).optional().describe("Maximum results to return"),
	includeRelations: z
		.boolean()
		.optional()
		.describe("Include relation features (administrative boundaries, routes). Default false."),
};

export type QueryBboxInput = {
	west: number;
	south: number;
	east: number;
	north: number;
	filters?: Record<string, string | string[]>;
	filterSets?: Array<Record<string, string | string[]>>;
	limit?: number;
	includeRelations?: boolean;
};

export const resolveOsmEntityInputSchema = {
	query: z.string().min(1).describe("Entity name, e.g. 'Vienna' or 'Germany'."),
	limit: z.number().int().min(1).max(10).optional().describe("Maximum candidate results (default 5)."),
	preferredOsmType: osmElementTypeSchema
		.optional()
		.describe("Prefer results with this OSM type (relation recommended for boundaries)."),
	adminLevel: z
		.number()
		.int()
		.min(2)
		.max(12)
		.optional()
		.describe("Optional administrative level filter (2=country, 4=state, etc)."),
	countryCode: z
		.string()
		.length(2)
		.optional()
		.describe("Optional ISO alpha-2 country code to constrain results (e.g., 'AT')."),
};

export const resolveOsmEntityOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		candidates: z.array(
			z.object({
				placeId: z.number(),
				displayName: z.string(),
				osmType: osmElementTypeSchema.nullable(),
				osmId: z.number().nullable(),
				class: z.string(),
				type: z.string(),
				importance: z.number().optional(),
				coordinates: z.object({
					lat: z.number(),
					lon: z.number(),
				}),
				boundingbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
				extratags: z.record(z.string(), z.string()).optional(),
			}),
		),
	}),
};

export const getOsmRelationGeometryInputSchema = {
	relationId: z.number().positive().describe("OSM relation ID."),
	coordinatePrecision: z
		.number()
		.int()
		.min(3)
		.max(7)
		.optional()
		.describe("Optional coordinate precision (decimals) for output simplification."),
	maxPointsPerRing: z
		.number()
		.int()
		.min(50)
		.max(20000)
		.optional()
		.describe("Optional cap for vertices per ring/path."),
};

export const getOsmRelationGeometryOutputSchema = {
	result: z.object({
		relationId: z.number(),
		feature: z.any().nullable().describe("GeoJSON feature for the relation geometry."),
		tags: z.record(z.string(), z.string()).optional(),
		transport: z.record(z.string(), z.unknown()).optional(),
	}),
};

export const getCountryBoundaryInputSchema = {
	countryCode: z
		.string()
		.length(2)
		.optional()
		.describe("ISO alpha-2 country code (recommended)."),
	name: z
		.string()
		.optional()
		.describe("Fallback country name if countryCode is unavailable."),
	adminLevel: z.number().int().min(2).max(12).optional().describe("Boundary admin level (default 2)."),
	coordinatePrecision: z.number().int().min(3).max(7).optional(),
	maxPointsPerRing: z.number().int().min(50).max(20000).optional(),
};

export const getCountryBoundaryOutputSchema = {
	result: z.object({
		query: z.string(),
		relationId: z.number(),
		candidateCount: z.number(),
		feature: z.any().nullable(),
		tags: z.record(z.string(), z.string()).optional(),
		transport: z.record(z.string(), z.unknown()).optional(),
	}),
};

const valhallaLocationSchema = z.object({
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
});

export const valhallaRouteInputSchema = {
	locations: z
		.array(valhallaLocationSchema)
		.min(2)
		.max(25)
		.describe("Route waypoints in traversal order."),
	profile: z
		.enum(["auto", "bicycle", "pedestrian", "bus", "truck"])
		.optional()
		.describe("Valhalla costing profile (default auto)."),
	units: z.enum(["kilometers", "miles"]).optional().describe("Narrative units (default kilometers)."),
	baseUrl: z.string().url().optional().describe("Optional Valhalla base URL override."),
};

export const valhallaRouteOutputSchema = {
	result: z.object({
		feature: z.any().nullable().describe("GeoJSON LineString feature for the route."),
		summary: z.object({
			lengthKm: z.number(),
			durationMin: z.number(),
			profile: z.string(),
		}),
	}),
};

export const valhallaIsochroneInputSchema = {
	location: valhallaLocationSchema.describe("Center point for isochrone computation."),
	contoursMinutes: z
		.array(z.number().int().min(1).max(240))
		.min(1)
		.max(6)
		.optional()
		.describe("Isochrone minute contours, e.g. [10, 20, 30]."),
	profile: z
		.enum(["auto", "bicycle", "pedestrian"])
		.optional()
		.describe("Valhalla costing profile (default auto)."),
	polygons: z.boolean().optional().describe("Return polygons instead of lines (default true)."),
	baseUrl: z.string().url().optional().describe("Optional Valhalla base URL override."),
};

export const valhallaIsochroneOutputSchema = {
	result: z.object({
		featureCollection: z.any().describe("GeoJSON FeatureCollection containing contour features."),
		count: z.number(),
		profile: z.string(),
		contoursMinutes: z.array(z.number()),
	}),
};

// ==========================================
// Create Map (PMTiles) Schemas
// ==========================================

export const createMapExtractInputSchema = {
	west: z.number().min(-180).max(180).describe("Western longitude of bounding box"),
	south: z.number().min(-90).max(90).describe("Southern latitude of bounding box"),
	east: z.number().min(-180).max(180).describe("Eastern longitude of bounding box"),
	north: z.number().min(-90).max(90).describe("Northern latitude of bounding box"),
	maxZoom: z.number().int().min(0).max(16).default(14).describe("Maximum zoom level (0-16, default 14)"),
	blossomServer: z.string().url().describe("Blossom server URL for upload"),
};

export const unsignedEventSchema = z.object({
	kind: z.number(),
	created_at: z.number(),
	tags: z.array(z.array(z.string())),
	content: z.string(),
});

export const createMapExtractOutputSchema = {
	result: z.object({
		requestId: z.string().describe("Unique ID to reference this extraction"),
		sha256: z.string().describe("SHA-256 hash of the extracted PMTiles file"),
		fileSizeBytes: z.number().describe("Size of the extracted file in bytes"),
		areaSqKm: z.number().describe("Area of the bounding box in square kilometers"),
		unsignedEvent: unsignedEventSchema.describe("Unsigned Blossom auth event (kind 24242) for client to sign"),
	}),
};

export type CreateMapExtractInput = {
	west: number;
	south: number;
	east: number;
	north: number;
	maxZoom?: number;
	blossomServer: string;
};

export type CreateMapExtractOutput = {
	result: {
		requestId: string;
		sha256: string;
		fileSizeBytes: number;
		areaSqKm: number;
		unsignedEvent: {
			kind: number;
			created_at: number;
			tags: string[][];
			content: string;
		};
	};
};

export const signedEventSchema = z.object({
	id: z.string(),
	pubkey: z.string(),
	kind: z.number(),
	created_at: z.number(),
	tags: z.array(z.array(z.string())),
	content: z.string(),
	sig: z.string(),
});

export const createMapUploadInputSchema = {
	requestId: z.string().describe("Request ID from create_map_extract"),
	signedEvent: signedEventSchema.describe("Signed Blossom auth event from client"),
};

export const createMapUploadOutputSchema = {
	result: z.object({
		blobUrl: z.string().describe("URL of the uploaded PMTiles file"),
		sha256: z.string().describe("SHA-256 hash of the uploaded file"),
	}),
};

export type CreateMapUploadInput = {
	requestId: string;
	signedEvent: {
		id: string;
		pubkey: string;
		kind: number;
		created_at: number;
		tags: string[][];
		content: string;
		sig: string;
	};
};

export type CreateMapUploadOutput = {
	result: {
		blobUrl: string;
		sha256: string;
	};
};
