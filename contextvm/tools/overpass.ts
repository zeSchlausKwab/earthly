import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

// Multiple Overpass API endpoints for failover
const OVERPASS_ENDPOINTS = [
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";

// OSM element types
export type OsmElementType = "node" | "way" | "relation";

// Filter format: { highway: "*" } means any highway, { military: ["base", "air_base"] } means OR
export type OsmFilterValue = string | string[];
export type OsmFilters = Record<string, OsmFilterValue>;

// Raw Overpass API response shapes
interface OverpassNode {
	type: "node";
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
}

interface OverpassWay {
	type: "way";
	id: number;
	nodes?: number[];
	geometry?: { lat: number; lon: number }[];
	tags?: Record<string, string>;
}

interface OverpassRelation {
	type: "relation";
	id: number;
	members?: {
		type: string;
		ref: number;
		role: string;
		geometry?: { lat: number; lon: number }[];
	}[];
	tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

interface OverpassResponse {
	version: number;
	generator: string;
	elements: OverpassElement[];
}

// Result types
export interface QueryByIdResult {
	feature: Feature | null;
	osmType: OsmElementType;
	osmId: number;
}

export interface QueryFeaturesResult {
	features: Feature[];
	count: number;
}

/**
 * Execute an Overpass QL query with automatic failover between endpoints
 */
async function executeQuery(query: string): Promise<OverpassResponse> {
	let lastError: Error | null = null;
	
	for (const endpoint of OVERPASS_ENDPOINTS) {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout
			
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": USER_AGENT,
				},
				body: `data=${encodeURIComponent(query)}`,
				signal: controller.signal,
			});
			
			clearTimeout(timeoutId);

			if (!response.ok) {
				const text = await response.text();
				// If 504 or 429, try next endpoint
				if (response.status === 504 || response.status === 429 || response.status === 503) {
					console.warn(`Overpass ${endpoint} returned ${response.status}, trying next...`);
					lastError = new Error(`${response.status} - ${text.slice(0, 100)}`);
					continue;
				}
				throw new Error(`Overpass API error: ${response.status} - ${text.slice(0, 200)}`);
			}

			const data = await response.json();
			console.log(`✅ Overpass ${endpoint} returned ${data.elements?.length ?? 0} elements`);
			if (data.elements?.length > 0) {
				console.log(`   Sample element types: ${data.elements.slice(0, 5).map((e: any) => e.type).join(', ')}`);
			}
			return data;
		} catch (err: any) {
			// On timeout or network error, try next endpoint
			if (err.name === 'AbortError') {
				console.warn(`Overpass ${endpoint} timed out, trying next...`);
				lastError = new Error(`Request timeout`);
				continue;
			}
			lastError = err;
			console.warn(`Overpass ${endpoint} failed: ${err.message}, trying next...`);
		}
	}
	
	throw new Error(`All Overpass endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
}

/**
 * Build filter string from OsmFilters object
 * { highway: "*" } -> ["highway"]
 * { highway: "primary" } -> ["highway"="primary"]
 * { military: ["base", "air_base"] } -> ["military"~"^(?:base|air_base)$"]
 */
function escapeOverpassString(input: string): string {
	return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFilterString(filters: OsmFilters): string {
	return Object.entries(filters)
		.map(([key, value]) => {
			const escapedKey = escapeOverpassString(key);
			if (Array.isArray(value)) {
				const normalizedValues = Array.from(
					new Set(
						value
							.filter((entry): entry is string => typeof entry === "string")
							.map((entry) => entry.trim())
							.filter((entry) => entry.length > 0),
					),
				);
				if (normalizedValues.length === 0) {
					return "";
				}
				if (normalizedValues.includes("*")) {
					return `["${escapedKey}"]`;
				}
				return `["${escapedKey}"~"^(?:${normalizedValues.map(escapeOverpassRegex).join("|")})$"]`;
			}
			if (value === "*") {
				return `["${escapedKey}"]`;
			}
			return `["${escapedKey}"="${escapeOverpassString(value)}"]`;
		})
		.join("");
}

function mergeFilters(base?: OsmFilters, overrides?: OsmFilters): OsmFilters | undefined {
	if (!base && !overrides) return undefined;
	return {
		...(base ?? {}),
		...(overrides ?? {}),
	};
}

function normalizeFilterGroups(
	filters?: OsmFilters,
	filterSets?: OsmFilters[],
): OsmFilters[] {
	if (!filterSets || filterSets.length === 0) {
		return [filters ?? {}];
	}

	return filterSets.map((filterSet) => mergeFilters(filterSet, filters) ?? {});
}

function buildQueryBody(
	areaSelector: string,
	filterGroups: OsmFilters[],
	includeRelations: boolean,
): string {
	const elementTypes: OsmElementType[] = includeRelations
		? ["node", "way", "relation"]
		: ["node", "way"];

	return filterGroups
		.flatMap((filters) => {
			const filterStr = buildFilterString(filters);
			return elementTypes.map((elementType) => `  ${elementType}${filterStr}${areaSelector};`);
		})
		.join("\n");
}

/**
 * Convert Overpass node to GeoJSON Point
 */
function nodeToFeature(node: OverpassNode): Feature {
	return {
		type: "Feature",
		id: `node/${node.id}`,
		properties: {
			"@id": `node/${node.id}`,
			"@type": "node",
			...node.tags,
		},
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
	};
}

/**
 * Check if a way should be treated as a polygon (closed + area-like tags)
 */
function isPolygonWay(way: OverpassWay): boolean {
	if (!way.geometry || way.geometry.length < 4) return false;
	
	const first = way.geometry[0];
	const last = way.geometry[way.geometry.length - 1];
	if (!first || !last) return false;
	const isClosed = first.lat === last.lat && first.lon === last.lon;
	
	if (!isClosed) return false;
	
	// Check for area-indicating tags
	const areaTags = ["building", "landuse", "natural", "leisure", "amenity", "shop", "tourism", "area"];
	return areaTags.some(tag => way.tags?.[tag] !== undefined) || way.tags?.area === "yes";
}

/**
 * Convert Overpass way to GeoJSON Feature (LineString or Polygon)
 */
function wayToFeature(way: OverpassWay): Feature | null {
	if (!way.geometry || way.geometry.length < 2) {
		return null;
	}

	const coordinates: Position[] = way.geometry.map((p) => [p.lon, p.lat]);
	
	let geometry: Geometry;
	if (isPolygonWay(way)) {
		geometry = {
			type: "Polygon",
			coordinates: [coordinates],
		};
	} else {
		geometry = {
			type: "LineString",
			coordinates,
		};
	}

	return {
		type: "Feature",
		id: `way/${way.id}`,
		properties: {
			"@id": `way/${way.id}`,
			"@type": "way",
			...way.tags,
		},
		geometry,
	};
}

function coordsEqual(a: Position, b: Position): boolean {
	return a[0] === b[0] && a[1] === b[1];
}

function closeRing(ring: Position[]): Position[] {
	if (ring.length < 2) return ring;
	const first = ring[0];
	const last = ring[ring.length - 1];
	if (!first || !last) return ring;
	if (coordsEqual(first, last)) return ring;
	return [...ring, first];
}

function assembleRings(segments: Position[][]): Position[][] {
	const pending = segments
		.map((segment) => [...segment])
		.filter((segment) => segment.length >= 2);
	const rings: Position[][] = [];

	while (pending.length > 0) {
		const current = pending.shift();
		if (!current || current.length < 2) continue;
		let chain = [...current];

		for (let guard = 0; guard < 10000; guard += 1) {
			const start = chain[0];
			const end = chain[chain.length - 1];
			if (!start || !end) break;
			if (coordsEqual(start, end)) break;

			let matchIndex = -1;
			let reverse = false;

			for (let i = 0; i < pending.length; i += 1) {
				const candidate = pending[i];
				if (!candidate || candidate.length < 2) continue;
				const candidateStart = candidate[0];
				const candidateEnd = candidate[candidate.length - 1];
				if (!candidateStart || !candidateEnd) continue;

				if (coordsEqual(candidateStart, end)) {
					matchIndex = i;
					reverse = false;
					break;
				}
				if (coordsEqual(candidateEnd, end)) {
					matchIndex = i;
					reverse = true;
					break;
				}
			}

			if (matchIndex === -1) break;
			const matched = pending.splice(matchIndex, 1)[0];
			if (!matched) break;
			const append = reverse ? [...matched].reverse() : matched;
			chain = [...chain, ...append.slice(1)];
		}

		const ring = closeRing(chain);
		if (ring.length >= 4) {
			rings.push(ring);
		}
	}

	return rings;
}

function pointInRing(point: Position, ring: Position[]): boolean {
	let inside = false;
	const [x, y] = point;
	if (x === undefined || y === undefined) return false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const pi = ring[i];
		const pj = ring[j];
		if (!pi || !pj) continue;
		const xi = pi[0];
		const yi = pi[1];
		const xj = pj[0];
		const yj = pj[1];
		if (
			xi === undefined ||
			yi === undefined ||
			xj === undefined ||
			yj === undefined
		) {
			continue;
		}
		const intersects =
			yi > y !== yj > y &&
			x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}

function relationBoundaryToGeometry(
	segmentsByRole: { outer: Position[][]; inner: Position[][] },
): Geometry | null {
	const outerRings = assembleRings(segmentsByRole.outer);
	const innerRings = assembleRings(segmentsByRole.inner);

	if (outerRings.length === 0) return null;

	const polygons: Position[][][] = outerRings.map((outer) => [outer]);

	for (const hole of innerRings) {
		const probe = hole[0];
		if (!probe) continue;
		const polygonIndex = outerRings.findIndex((outer) => pointInRing(probe, outer));
		if (polygonIndex >= 0) {
			polygons[polygonIndex]?.push(hole);
		}
	}

	if (polygons.length === 1) {
		return {
			type: "Polygon",
			coordinates: polygons[0] as Position[][],
		};
	}

	return {
		type: "MultiPolygon",
		coordinates: polygons as Position[][][],
	};
}

function buildRelationFeature(
	relation: OverpassRelation,
	waysById?: Map<number, OverpassWay>,
): Feature | null {
	if (!relation.members || relation.members.length === 0) {
		return null;
	}

	const isMultipolygon =
		relation.tags?.type === "multipolygon" || relation.tags?.type === "boundary";

	if (isMultipolygon) {
		const segmentsByRole: { outer: Position[][]; inner: Position[][] } = {
			outer: [],
			inner: [],
		};

		for (const member of relation.members) {
			if (member.type !== "way") continue;
			const sourceGeometry =
				waysById?.get(member.ref)?.geometry ?? member.geometry ?? undefined;
			if (!sourceGeometry || sourceGeometry.length < 2) continue;
			const segment: Position[] = sourceGeometry.map((p) => [p.lon, p.lat]);
			if (member.role === "inner") {
				segmentsByRole.inner.push(segment);
			} else if (member.role === "outer" || !member.role) {
				segmentsByRole.outer.push(segment);
			}
		}

		const geometry = relationBoundaryToGeometry(segmentsByRole);
		if (geometry) {
			return {
				type: "Feature",
				id: `relation/${relation.id}`,
				properties: {
					"@id": `relation/${relation.id}`,
					"@type": "relation",
					...relation.tags,
				},
				geometry,
			};
		}
	}

	// Fallback for non-boundary or unresolved relation geometry.
	const lines: Position[][] = [];
	for (const member of relation.members) {
		const sourceGeometry =
			member.type === "way"
				? waysById?.get(member.ref)?.geometry ?? member.geometry
				: member.geometry;
		if (!sourceGeometry || sourceGeometry.length < 2) continue;
		lines.push(sourceGeometry.map((p) => [p.lon, p.lat]));
	}

	if (lines.length === 0) return null;

	const geometry: Geometry =
		lines.length === 1
			? { type: "LineString", coordinates: lines[0] as Position[] }
			: { type: "MultiLineString", coordinates: lines as Position[][] };

	return {
		type: "Feature",
		id: `relation/${relation.id}`,
		properties: {
			"@id": `relation/${relation.id}`,
			"@type": "relation",
			...relation.tags,
		},
		geometry,
	};
}

/**
 * Convert Overpass relation to GeoJSON Feature (MultiPolygon or GeometryCollection)
 */
function relationToFeature(relation: OverpassRelation): Feature | null {
	return buildRelationFeature(relation);
}

/**
 * Convert Overpass element to GeoJSON Feature
 */
function elementToFeature(
	element: OverpassElement,
	waysById?: Map<number, OverpassWay>,
): Feature | null {
	switch (element.type) {
		case "node":
			return nodeToFeature(element);
		case "way":
			return wayToFeature(element);
		case "relation":
			return buildRelationFeature(element, waysById);
		default:
			return null;
	}
}

/**
 * Query a single OSM element by type and ID
 */
export async function queryById(
	osmType: OsmElementType,
	osmId: number,
): Promise<QueryByIdResult> {
	if (osmId <= 0) {
		throw new Error("OSM ID must be a positive number");
	}

	const query = `[out:json][timeout:25];${osmType}(${osmId});out geom;`;
	const response = await executeQuery(query);

	const element = response.elements[0];
	const feature = element ? elementToFeature(element) : null;

	return {
		feature,
		osmType,
		osmId,
	};
}

/**
 * Query OSM elements near a point
 */
export async function queryNearby(
	lat: number,
	lon: number,
	radius: number = 100,
	filters?: OsmFilters,
	filterSets?: OsmFilters[],
	limit?: number,
	includeRelations: boolean = false,
): Promise<QueryFeaturesResult> {
	if (lat < -90 || lat > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}
	if (lon < -180 || lon > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}
	if (radius < 1 || radius > 5000) {
		throw new Error("Radius must be between 1 and 5000 meters");
	}

	const around = `(around:${radius},${lat},${lon})`;
	const filterGroups = normalizeFilterGroups(filters, filterSets);
	const queryBody = buildQueryBody(around, filterGroups, includeRelations);

	// Use shorter timeout to fail fast and allow retry
	const query = `[out:json][timeout:15];
(
${queryBody}
);
out geom;`;

	const response = await executeQuery(query);
	const waysById = new Map<number, OverpassWay>();
	for (const element of response.elements) {
		if (element.type === "way") {
			waysById.set(element.id, element);
		}
	}

	let features = response.elements
		.map((element) => elementToFeature(element, waysById))
		.filter((f): f is Feature => f !== null);

	const seen = new Set<string>();
	features = features.filter((feature) => {
		const id = typeof feature.id === "string" ? feature.id : String(feature.id ?? "");
		if (!id || seen.has(id)) return false;
		seen.add(id);
		return true;
	});

	// Apply limit if specified
	if (limit && limit > 0) {
		features = features.slice(0, limit);
	}

	return {
		features,
		count: features.length,
	};
}

/**
 * Query OSM elements within a bounding box
 */
export async function queryBbox(
	west: number,
	south: number,
	east: number,
	north: number,
	filters?: OsmFilters,
	filterSets?: OsmFilters[],
	limit?: number,
	includeRelations: boolean = false,
): Promise<QueryFeaturesResult> {
	if (south < -90 || south > 90 || north < -90 || north > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}
	if (west < -180 || west > 180 || east < -180 || east > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}
	if (south >= north) {
		throw new Error("South must be less than north");
	}

	const bbox = `(${south},${west},${north},${east})`;
	const filterGroups = normalizeFilterGroups(filters, filterSets);
	const queryBody = buildQueryBody(bbox, filterGroups, includeRelations);

	const query = `[out:json][timeout:15];
(
${queryBody}
);
out geom;`;

	const response = await executeQuery(query);
	const waysById = new Map<number, OverpassWay>();
	for (const element of response.elements) {
		if (element.type === "way") {
			waysById.set(element.id, element);
		}
	}

	let features = response.elements
		.map((element) => elementToFeature(element, waysById))
		.filter((f): f is Feature => f !== null);

	const seen = new Set<string>();
	features = features.filter((feature) => {
		const id = typeof feature.id === "string" ? feature.id : String(feature.id ?? "");
		if (!id || seen.has(id)) return false;
		seen.add(id);
		return true;
	});

	// Apply limit if specified
	if (limit && limit > 0) {
		features = features.slice(0, limit);
	}

	return {
		features,
		count: features.length,
	};
}

function escapeOverpassRegex(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickBestBoundaryRelation(
	relations: OverpassRelation[],
	name?: string,
): OverpassRelation | null {
	if (relations.length === 0) return null;
	if (!name) return relations[0] ?? null;
	const normalized = name.trim().toLowerCase();
	const scored = relations.map((relation) => {
		const tags = relation.tags ?? {};
		const candidates = [tags.name, tags["name:en"], tags.int_name, tags.official_name]
			.filter((value): value is string => typeof value === "string")
			.map((value) => value.toLowerCase());
		const exact = candidates.includes(normalized) ? 1 : 0;
		const contains = candidates.some((value) => value.includes(normalized)) ? 1 : 0;
		const maritime = tags.maritime === "yes" || tags.maritime === "1" ? 1 : 0;
		return {
			relation,
			score: exact * 100 + contains * 20 + maritime,
		};
	});
	scored.sort((a, b) => b.score - a.score);
	return scored[0]?.relation ?? null;
}

export async function findAdministrativeBoundaryRelation(
	params: {
		countryCode?: string;
		name?: string;
		adminLevel?: number;
	},
): Promise<{ relationId: number; relation: OverpassRelation; candidates: OverpassRelation[] }> {
	const adminLevel = Math.max(2, Math.min(12, Math.floor(params.adminLevel ?? 2)));
	const countryCode = params.countryCode?.trim().toUpperCase();
	const name = params.name?.trim();

	let filters = `["boundary"="administrative"]["admin_level"="${adminLevel}"]`;
	if (countryCode) {
		const cc = countryCode.replace(/"/g, '\\"');
		filters += `["ISO3166-1:alpha2"="${cc}"]`;
	}
	if (name) {
		const escaped = escapeOverpassRegex(name);
		filters += `["name"~"^${escaped}$",i]`;
	}

	const query = `[out:json][timeout:25];
rel${filters};
out tags ids 25;`;
	const response = await executeQuery(query);
	const candidates = response.elements.filter(
		(element): element is OverpassRelation => element.type === "relation",
	);
	const relation = pickBestBoundaryRelation(candidates, name);
	if (!relation) {
		throw new Error("No administrative boundary relation found.");
	}

	return {
		relationId: relation.id,
		relation,
		candidates,
	};
}

export async function queryRelationGeometry(
	relationId: number,
): Promise<{ feature: Feature | null; relation: OverpassRelation | null; tags: Record<string, string> }> {
	if (!Number.isFinite(relationId) || relationId <= 0) {
		throw new Error("relationId must be a positive number");
	}

	const query = `[out:json][timeout:30];
rel(${Math.floor(relationId)});
out body;
>;
out geom;`;
	const response = await executeQuery(query);
	const relation = response.elements.find(
		(element): element is OverpassRelation =>
			element.type === "relation" && element.id === Math.floor(relationId),
	);
	if (!relation) {
		return { feature: null, relation: null, tags: {} };
	}

	const waysById = new Map<number, OverpassWay>();
	for (const element of response.elements) {
		if (element.type === "way") {
			waysById.set(element.id, element);
		}
	}

	const feature = buildRelationFeature(relation, waysById);
	return {
		feature,
		relation,
		tags: relation.tags ?? {},
	};
}
