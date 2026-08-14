const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const MIN_REQUEST_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;
let requestIntervalMs = MIN_REQUEST_INTERVAL_MS;

export class NominatimRequestError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryable: boolean;
	readonly retryAfterMs: number | null;

	constructor(status: number, statusText: string, retryAfterMs: number | null) {
		super(`Nominatim API error: ${status} ${statusText}`);
		this.name = "NominatimRequestError";
		this.code = `nominatim_http_${status}`;
		this.status = status;
		this.retryable = status === 429 || status === 503;
		this.retryAfterMs = retryAfterMs;
	}
}

// Raw Nominatim response shape
export interface NominatimResult {
	place_id: number;
	display_name: string;
	osm_type?: "N" | "W" | "R" | string;
	osm_id?: number;
	lat: string;
	lon: string;
	boundingbox?: string[];
	type: string;
	class: string;
	importance?: number;
	address?: Record<string, string>;
	extratags?: Record<string, string>;
	geojson?: unknown;
}

export interface NominatimLocation {
	placeId: number;
	displayName: string;
	osmType: "node" | "way" | "relation" | null;
	osmId: number | null;
	coordinates: { lat: number; lon: number };
	boundingbox: [number, number, number, number] | null; // [west, south, east, north]
	type: string;
	class: string;
	importance?: number;
	address?: Record<string, string>;
	extratags?: Record<string, string>;
	geojson?: unknown;
}

export interface SearchLocationResult {
	query: string;
	count: number;
	results: NominatimLocation[];
}

interface SearchLocationOptions {
	countryCode?: string;
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
	const parsed = boundingbox.slice(0, 4).map((value) => parseFloat(value));
	if (parsed.length < 4) return null;
	const south = parsed[0];
	const north = parsed[1];
	const west = parsed[2];
	const east = parsed[3];
	if (
		south === undefined ||
		north === undefined ||
		west === undefined ||
		east === undefined
	) {
		return null;
	}
	if ([south, north, west, east].some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
		return null;
	}
	return [west, south, east, north];
}

function normalizeResult(result: NominatimResult): NominatimLocation {
	let osmType: "node" | "way" | "relation" | null = null;
	const rawOsmType =
		typeof result.osm_type === "string" ? result.osm_type.trim().toLowerCase() : null;
	if (rawOsmType === "n" || rawOsmType === "node") osmType = "node";
	else if (rawOsmType === "w" || rawOsmType === "way") osmType = "way";
	else if (rawOsmType === "r" || rawOsmType === "relation") osmType = "relation";

	return {
		placeId: result.place_id,
		displayName: result.display_name,
		osmType,
		osmId: typeof result.osm_id === "number" ? result.osm_id : null,
		coordinates: {
			lat: parseFloat(result.lat),
			lon: parseFloat(result.lon),
		},
		boundingbox: normalizeBoundingBox(result.boundingbox),
		type: result.type,
		class: result.class,
		importance: result.importance,
		address: result.address ?? undefined,
		extratags: result.extratags ?? undefined,
		geojson: result.geojson ?? undefined,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

async function scheduleRequest<T>(request: () => Promise<T>): Promise<T> {
	const previous = requestQueue;
	let release!: () => void;
	requestQueue = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		const waitMs = Math.max(0, nextRequestAt - Date.now());
		if (waitMs > 0) await sleep(waitMs);
		nextRequestAt = Date.now() + requestIntervalMs;
		return await request();
	} finally {
		release();
	}
}

async function fetchJson(url: URL): Promise<unknown> {
	const key = url.toString();
	const cached = responseCache.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.value;
	if (cached) responseCache.delete(key);

	const pending = inFlightRequests.get(key);
	if (pending) return pending;

	const request = scheduleRequest(async () => {
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
			const response = await fetch(key, { headers: { "User-Agent": USER_AGENT } });
			if (response.ok) {
				const value = await response.json();
				responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
				return value;
			}
			if (response.status === 404) {
				responseCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
				return null;
			}
			const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
			const error = new NominatimRequestError(
				response.status,
				response.statusText,
				retryAfterMs,
			);
			if (!error.retryable || attempt >= MAX_RETRIES) throw error;
			// A retry is still a Nominatim request: preserve the one-request-per-
			// second ceiling even when Retry-After is absent or explicitly zero.
			await sleep(Math.max(requestIntervalMs, retryAfterMs ?? 500 * 2 ** attempt));
			nextRequestAt = Date.now() + requestIntervalMs;
		}
		throw new Error("Nominatim request exhausted without a result");
	});
	inFlightRequests.set(key, request);
	try {
		return await request;
	} finally {
		inFlightRequests.delete(key);
	}
}

export function resetNominatimRequestStateForTests(intervalMs = MIN_REQUEST_INTERVAL_MS): void {
	responseCache.clear();
	inFlightRequests.clear();
	requestQueue = Promise.resolve();
	nextRequestAt = 0;
	requestIntervalMs = intervalMs;
}

export async function searchLocation(
	query: string,
	limit = 10,
	options?: SearchLocationOptions,
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
	const countryCode = options?.countryCode?.trim().toLowerCase();
	if (countryCode && /^[a-z]{2}$/.test(countryCode)) {
		url.searchParams.set("countrycodes", countryCode);
	}

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
