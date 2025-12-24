const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";

// Raw Nominatim response shape
export interface NominatimResult {
	place_id: number;
	display_name: string;
	lat: string;
	lon: string;
	boundingbox?: string[];
	type: string;
	class: string;
	importance?: number;
	address?: Record<string, string>;
	geojson?: unknown;
}

export interface NominatimLocation {
	placeId: number;
	displayName: string;
	coordinates: { lat: number; lon: number };
	boundingbox: [number, number, number, number] | null; // [west, south, east, north]
	type: string;
	class: string;
	importance?: number;
	address?: Record<string, string>;
	geojson?: unknown;
}

export interface SearchLocationResult {
	query: string;
	count: number;
	results: NominatimLocation[];
}

export interface ReverseLookupResult {
	coordinates: { lat: number; lon: number };
	zoom: number;
	result: NominatimLocation | null;
}

function normalizeBoundingBox(
	boundingbox?: string[],
): [number, number, number, number] | null {
	if (!boundingbox || boundingbox.length < 4) return null;
	const [south, north, west, east] = boundingbox.map((v) => parseFloat(v));
	if (
		[south, north, west, east].some(
			(value) => Number.isNaN(value) || !Number.isFinite(value),
		)
	) {
		return null;
	}
	return [west, south, east, north];
}

function normalizeResult(result: NominatimResult): NominatimLocation {
	return {
		placeId: result.place_id,
		displayName: result.display_name,
		coordinates: {
			lat: parseFloat(result.lat),
			lon: parseFloat(result.lon),
		},
		boundingbox: normalizeBoundingBox(result.boundingbox),
		type: result.type,
		class: result.class,
		importance: result.importance,
		address: result.address,
		geojson: result.geojson,
	};
}

async function fetchJson(url: URL) {
	const response = await fetch(url.toString(), {
		headers: {
			"User-Agent": USER_AGENT,
		},
	});

	if (!response.ok) {
		if (response.status === 404) {
			return null;
		}
		throw new Error(
			`Nominatim API error: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

export async function searchLocation(
	query: string,
	limit = 10,
): Promise<SearchLocationResult> {
	const trimmedQuery = query?.trim();
	if (!trimmedQuery) {
		throw new Error(
			"Query parameter is required and must be a non-empty string",
		);
	}

	const cappedLimit = Math.min(Math.max(limit ?? 10, 1), 50);

	const url = new URL(`${NOMINATIM_BASE_URL}/search`);
	url.searchParams.set("q", trimmedQuery);
	url.searchParams.set("format", "json");
	url.searchParams.set("addressdetails", "1");
	url.searchParams.set("limit", cappedLimit.toString());
	url.searchParams.set("extratags", "1");
	url.searchParams.set("namedetails", "1");
	url.searchParams.set("polygon_geojson", "1");
	url.searchParams.set("polygon_threshold", "0.01");

	const data = (await fetchJson(url)) as NominatimResult[] | null;
	const results = Array.isArray(data) ? data : [];

	const normalized = results.map(normalizeResult);

	return {
		query: trimmedQuery,
		count: normalized.length,
		results: normalized,
	};
}

export async function reverseLookup(
	lat: number,
	lon: number,
	zoom = 18,
): Promise<ReverseLookupResult> {
	if (typeof lat !== "number" || typeof lon !== "number") {
		throw new Error("Latitude and longitude must be numbers");
	}

	if (lat < -90 || lat > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}

	if (lon < -180 || lon > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}

	const normalizedZoom = Math.min(Math.max(zoom ?? 18, 0), 18);

	const url = new URL(`${NOMINATIM_BASE_URL}/reverse`);
	url.searchParams.set("lat", lat.toString());
	url.searchParams.set("lon", lon.toString());
	url.searchParams.set("format", "json");
	url.searchParams.set("addressdetails", "1");
	url.searchParams.set("extratags", "1");
	url.searchParams.set("namedetails", "1");
	url.searchParams.set("zoom", normalizedZoom.toString());
	url.searchParams.set("polygon_geojson", "1");
	url.searchParams.set("polygon_threshold", "0.01");

	const data = (await fetchJson(url)) as NominatimResult | null;
	const result = data ? normalizeResult(data) : null;

	return {
		coordinates: { lat, lon },
		zoom: normalizedZoom,
		result,
	};
}
