/**
 * Non-visual ingest tools (INGEST-06 / D-05 / D-06): `place_dataset_features`
 * (host-builtin) and `batch_geocode` (remote-mcp).
 *
 * `place_dataset_features` applies an AI-supplied column-mapping rule over the
 * FULL parsed dataset (`getDataset(handleId).fullRows`, NOT the sampled rows the
 * model saw — D-05, anticipates SAFE-05), range-validates coordinates (V5),
 * builds GeoJSON features, and writes them through the Authoring API seam
 * (`importFeaturesToEditor` → `authoring.writeGeoJSON`, INFRA-02 / Phase 2 D-07
 * one-way layering) — NEVER the Zustand store. It returns counts only, never
 * `fullRows` (T-03-18).
 *
 * `batch_geocode` geocodes a place-name column server-side via the ContextVM
 * `search_location` MCP (fixed origin — no file-driven outbound URL, T-03-16),
 * bounded to BATCH_GEOCODE_MAX_ROWS, throttled to ~1 req/s
 * (BATCH_GEOCODE_MIN_INTERVAL_MS), de-duped + in-call cached (T-03-15 respects
 * Nominatim ~1 req/s policy), with skip-and-report partial-failure semantics
 * (D-06 / Open Q3). The throttle delay + geo client are injectable so tests use
 * a fake clock without sleeping.
 *
 * Error contract (D-16): an unknown handle, a degenerate mapping, or a write
 * failure throws an `Error`, which `registry.dispatch` wraps into a structured
 * `ToolError(handler_error)` — never a crash, never a silent no-op.
 */

import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { getDataset } from '@/features/chat/ingest/ingestStore'
import type { ToolEntry } from './registry'
import { clampPositiveInt, getGeoClient, importFeaturesToEditor } from './helpers'
import { schemaFor } from './schemas'

const REMOTE_MCP_ORIGIN = EarthlyGeoServerClient.SERVER_PUBKEY

/** Batch-geocode bound: at most this many rows are looked up per call (D-06). */
export const BATCH_GEOCODE_MAX_ROWS = 50
/** Batch-geocode throttle: minimum spacing between lookups (~1 req/s, Nominatim policy). */
export const BATCH_GEOCODE_MIN_INTERVAL_MS = 1000

// ---------------------------------------------------------------------------
// Mapping types
// ---------------------------------------------------------------------------

/** The AI-supplied column-mapping rule. */
export interface PlacementMapping {
	lat?: string
	lon?: string
	wkt?: string
	geometry?: string
	name?: string
	description?: string
	placeNameColumn?: string
}

function asMapping(value: unknown): PlacementMapping {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	const m = value as Record<string, unknown>
	const pick = (k: string): string | undefined =>
		typeof m[k] === 'string' && (m[k] as string).trim() ? (m[k] as string) : undefined
	return {
		lat: pick('lat'),
		lon: pick('lon'),
		wkt: pick('wkt'),
		geometry: pick('geometry'),
		name: pick('name'),
		description: pick('description'),
		placeNameColumn: pick('placeNameColumn'),
	}
}

// ---------------------------------------------------------------------------
// Coordinate + geometry parsing
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
	if (typeof value === 'string' && value.trim()) {
		const n = Number(value)
		return Number.isFinite(n) ? n : undefined
	}
	return undefined
}

/** V5: lat∈[-90,90], lon∈[-180,180]. */
function isValidLngLat(lon: number, lat: number): boolean {
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

/**
 * V5 (CR-03): recursively range-validate EVERY [lon,lat] position in a parsed
 * geometry. The explicit lat/lon branch already calls `isValidLngLat`, but the
 * WKT and GeoJSON-geometry-cell branches built features with no range check, so
 * `POINT(9999 9999)` / `{"type":"Point","coordinates":[5000,5000]}` reached the
 * editor. A position is a `[number, number(, …)]`; anything else (non-numeric,
 * malformed) fails closed (out of range → skipped).
 */
function geometryCoordsInRange(geom: GeoJSON.Geometry): boolean {
	const walk = (c: unknown): boolean => {
		if (!Array.isArray(c)) return false
		// A coordinate position: at least [lon, lat] both numeric.
		if (typeof c[0] === 'number' && typeof c[1] === 'number') {
			return isValidLngLat(c[0], c[1])
		}
		// Otherwise a nested array of positions / rings / parts.
		return c.length > 0 && c.every(walk)
	}
	// GeometryCollection has no top-level `coordinates`; validate each member.
	if (geom.type === 'GeometryCollection') {
		return Array.isArray(geom.geometries) && geom.geometries.every(geometryCoordsInRange)
	}
	return 'coordinates' in geom ? walk((geom as { coordinates: unknown }).coordinates) : false
}

/**
 * Parse a minimal subset of WKT (POINT / LINESTRING / POLYGON, optionally with a
 * MULTI* prefix) into a GeoJSON geometry. WKT uses `lon lat` ordering. Returns
 * null on anything unrecognised so the row is skipped (not a crash).
 */
function parseWktGeometry(wkt: string): GeoJSON.Geometry | null {
	const text = wkt.trim()
	const match = /^([A-Za-z]+)\s*(z|m|zm)?\s*\((.*)\)\s*$/i.exec(text)
	if (!match) return null
	const type = match[1].toUpperCase()
	const body = match[3]

	const parsePositions = (group: string): number[][] =>
		group
			.split(',')
			.map((pair) => pair.trim().split(/\s+/).map(Number))
			.filter((nums) => nums.length >= 2 && nums.every((n) => Number.isFinite(n)))
			.map((nums) => [nums[0], nums[1]])

	const parseRings = (group: string): number[][][] => {
		const rings: number[][][] = []
		const re = /\(([^()]*)\)/g
		let m: RegExpExecArray | null = re.exec(group)
		while (m !== null) {
			rings.push(parsePositions(m[1]))
			m = re.exec(group)
		}
		return rings
	}

	try {
		switch (type) {
			case 'POINT': {
				const [pos] = parsePositions(body)
				return pos ? { type: 'Point', coordinates: pos } : null
			}
			case 'LINESTRING': {
				const coords = parsePositions(body)
				return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null
			}
			case 'POLYGON': {
				const rings = parseRings(body)
				return rings.length > 0 ? { type: 'Polygon', coordinates: rings } : null
			}
			case 'MULTIPOINT': {
				const coords = parsePositions(body.replace(/[()]/g, ''))
				return coords.length > 0 ? { type: 'MultiPoint', coordinates: coords } : null
			}
			case 'MULTILINESTRING': {
				const lines = parseRings(body)
				return lines.length > 0 ? { type: 'MultiLineString', coordinates: lines } : null
			}
			default:
				return null
		}
	} catch {
		return null
	}
}

/** Parse a GeoJSON-geometry cell — an object or a JSON string. */
function parseGeometryCell(value: unknown): GeoJSON.Geometry | null {
	let candidate: unknown = value
	if (typeof value === 'string' && value.trim()) {
		try {
			candidate = JSON.parse(value)
		} catch {
			return null
		}
	}
	if (
		candidate &&
		typeof candidate === 'object' &&
		typeof (candidate as { type?: unknown }).type === 'string' &&
		'coordinates' in (candidate as Record<string, unknown>)
	) {
		return candidate as GeoJSON.Geometry
	}
	return null
}

// ---------------------------------------------------------------------------
// Feature construction (the FULL-dataset iteration — D-05)
// ---------------------------------------------------------------------------

export interface BuildResult {
	features: GeoJSON.Feature[]
	skippedInvalid: number
	/** Rows that had no usable geometry but DO have a place name (geocoding candidates). */
	geocodeCandidates: { row: Record<string, unknown>; placeName: string }[]
}

function buildProperties(
	row: Record<string, unknown>,
	mapping: PlacementMapping,
): Record<string, unknown> {
	const props: Record<string, unknown> = {}
	if (mapping.name && row[mapping.name] != null) props.name = row[mapping.name]
	if (mapping.description && row[mapping.description] != null) {
		props.description = row[mapping.description]
	}
	return props
}

/**
 * Iterate the FULL row set (D-05) and build a point/geometry feature per row.
 * Out-of-range coordinates are skipped (V5). Rows lacking geometry but carrying
 * a place name are collected as geocode candidates rather than dropped.
 */
export function buildFeaturesFromRows(
	fullRows: Record<string, unknown>[],
	mapping: PlacementMapping,
): BuildResult {
	const features: GeoJSON.Feature[] = []
	const geocodeCandidates: { row: Record<string, unknown>; placeName: string }[] = []
	let skippedInvalid = 0

	for (const row of fullRows) {
		const props = buildProperties(row, mapping)

		// 1. Explicit lat/lon columns.
		if (mapping.lat && mapping.lon) {
			const lat = toNumber(row[mapping.lat])
			const lon = toNumber(row[mapping.lon])
			if (lat !== undefined && lon !== undefined) {
				if (!isValidLngLat(lon, lat)) {
					skippedInvalid += 1
					continue
				}
				features.push({
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [lon, lat] },
					properties: props,
				})
				continue
			}
			// missing coords → maybe geocode below
		}

		// 2. WKT column.
		if (mapping.wkt) {
			const raw = row[mapping.wkt]
			const geom = typeof raw === 'string' ? parseWktGeometry(raw) : null
			// V5 (CR-03): range-validate every coordinate before placing.
			if (geom && geometryCoordsInRange(geom)) {
				features.push({ type: 'Feature', geometry: geom, properties: props })
				continue
			}
			skippedInvalid += 1
			continue
		}

		// 3. GeoJSON-geometry column.
		if (mapping.geometry) {
			const geom = parseGeometryCell(row[mapping.geometry])
			// V5 (CR-03): range-validate every coordinate before placing.
			if (geom && geometryCoordsInRange(geom)) {
				features.push({ type: 'Feature', geometry: geom, properties: props })
				continue
			}
			skippedInvalid += 1
			continue
		}

		// 4. No coordinates yet — geocode candidate if a place name is available.
		const placeCol = mapping.placeNameColumn
		const placeName = placeCol && typeof row[placeCol] === 'string' ? (row[placeCol] as string) : ''
		if (placeName.trim()) {
			geocodeCandidates.push({ row, placeName: placeName.trim() })
		} else {
			skippedInvalid += 1
		}
	}

	return { features, skippedInvalid, geocodeCandidates }
}

// ---------------------------------------------------------------------------
// Geocoding (batch — bounded, throttled, de-duped, skip-and-report)
// ---------------------------------------------------------------------------

type DelayFn = (ms: number) => Promise<void>
type GeoClient = { SearchLocation: (query: string, limit?: number) => Promise<unknown> }

const realDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * WR-03: module-level throttle clock shared by ALL geocoder traffic, so the
 * ~1 req/s Nominatim policy holds ACROSS calls — `place_dataset_features`'s
 * geocode fallback, `batch_geocode`, and repeated/back-to-back calls — not just
 * within a single `batchGeocode` run. Initialized to `-Infinity` so the very
 * first lookup never waits. The clock source (`now`) is injectable for tests.
 */
let lastGeocodeRequestAt = Number.NEGATIVE_INFINITY

/** Reset the shared geocode throttle clock (test seam — see WR-03). */
export function resetGeocodeThrottle(): void {
	lastGeocodeRequestAt = Number.NEGATIVE_INFINITY
}

export interface BatchGeocodeOptions {
	maxRows?: number
	minIntervalMs?: number
	delay?: DelayFn
	client?: GeoClient
	/** Clock source for the shared throttle (default `Date.now`); injectable for tests. */
	now?: () => number
}

export interface BatchGeocodeResult {
	coordsByName: Map<string, [number, number]>
	located: number
	total: number
	failed: number
}

/** Pull the first {lat, lon} out of a search_location MCP response envelope. */
function firstCoordinate(response: unknown): [number, number] | null {
	const env = response as { result?: { results?: unknown[] } } | undefined
	const results = env?.result?.results
	if (!Array.isArray(results) || results.length === 0) return null
	const first = results[0] as { coordinates?: { lat?: unknown; lon?: unknown } }
	const lat = toNumber(first?.coordinates?.lat)
	const lon = toNumber(first?.coordinates?.lon)
	if (lat === undefined || lon === undefined) return null
	if (!isValidLngLat(lon, lat)) return null
	return [lon, lat]
}

/**
 * Geocode a set of place names: de-dupe, cap, throttle. Returns the name→[lon,lat]
 * map plus located/total/failed counts (skip-and-report). `total` counts UNIQUE
 * names after the cap.
 */
export async function batchGeocode(
	names: string[],
	options: BatchGeocodeOptions = {},
): Promise<BatchGeocodeResult> {
	const maxRows = clampPositiveInt(options.maxRows, BATCH_GEOCODE_MAX_ROWS, BATCH_GEOCODE_MAX_ROWS)
	const minInterval =
		options.minIntervalMs === undefined ? BATCH_GEOCODE_MIN_INTERVAL_MS : options.minIntervalMs
	const delay = options.delay ?? realDelay
	const now = options.now ?? Date.now
	const client = options.client ?? (getGeoClient() as unknown as GeoClient)

	// De-dupe identical names (preserve first-seen order), then cap.
	const unique: string[] = []
	const seen = new Set<string>()
	for (const name of names) {
		const key = name.trim()
		if (!key || seen.has(key)) continue
		seen.add(key)
		unique.push(key)
		if (unique.length >= maxRows) break
	}

	const coordsByName = new Map<string, [number, number]>()
	let failed = 0
	for (let i = 0; i < unique.length; i += 1) {
		// WR-03: throttle against the SHARED module clock, so spacing holds both
		// within this call and across back-to-back calls/tools (not just `i > 0`).
		if (minInterval > 0) {
			const wait = minInterval - (now() - lastGeocodeRequestAt)
			if (wait > 0) await delay(wait)
		}
		lastGeocodeRequestAt = now()
		const name = unique[i]
		try {
			const response = await client.SearchLocation(name, 1)
			const coord = firstCoordinate(response)
			if (coord) coordsByName.set(name, coord)
			else failed += 1
		} catch {
			failed += 1
		}
	}

	return { coordsByName, located: coordsByName.size, total: unique.length, failed }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the two ingest tools into the central registry. `register` is
 * injected (not imported) to keep the registry → ingest-tools edge one-way and
 * avoid a dev-bundler circular-init crash (mirrors `registerPrimitiveTools`).
 */
export function registerIngestTools(
	register: (entry: ToolEntry) => void,
	batchOptions: BatchGeocodeOptions = {},
): void {
	register({
		name: 'place_dataset_features',
		kind: 'host-builtin',
		schema: schemaFor('place_dataset_features'),
		handler: async (args) => {
			const handleId = String(args.handleId ?? '')
			const ds = getDataset(handleId)
			if (!ds) throw new Error(`Unknown ingest handle: ${handleId || '(none)'}`)
			const mapping = asMapping(args.mapping)

			const built = buildFeaturesFromRows(ds.fullRows, mapping)
			const features = [...built.features]
			let geocoded = 0
			let geocodeFailed = 0

			// Single-row fallback for a small candidate set reuses the same bounded
			// batch path (place_dataset_features stays a host-builtin; the geocoder
			// runs server-side via search_location).
			if (built.geocodeCandidates.length > 0 && mapping.placeNameColumn) {
				const geo = await batchGeocode(
					built.geocodeCandidates.map((c) => c.placeName),
					batchOptions,
				)
				for (const candidate of built.geocodeCandidates) {
					const coord = geo.coordsByName.get(candidate.placeName)
					if (!coord) {
						geocodeFailed += 1
						continue
					}
					features.push({
						type: 'Feature',
						geometry: { type: 'Point', coordinates: coord },
						properties: buildProperties(candidate.row, mapping),
					})
					geocoded += 1
				}
			} else {
				geocodeFailed = built.geocodeCandidates.length
			}

			if (features.length === 0) {
				throw new Error(
					'No placeable features were produced from the dataset with the given mapping.',
				)
			}

			const result = importFeaturesToEditor(features, false)
			return {
				importedCount: result.importedCount,
				skippedDuplicates: result.skippedDuplicates,
				skippedInvalid: built.skippedInvalid,
				geocoded,
				geocodeFailed,
				totalFeaturesInEditor: result.totalFeaturesInEditor,
			}
		},
	})

	register({
		name: 'batch_geocode',
		kind: 'remote-mcp',
		origin: REMOTE_MCP_ORIGIN,
		schema: schemaFor('batch_geocode'),
		handler: async (args) => {
			const handleId = String(args.handleId ?? '')
			const ds = getDataset(handleId)
			if (!ds) throw new Error(`Unknown ingest handle: ${handleId || '(none)'}`)
			const placeNameColumn = typeof args.placeNameColumn === 'string' ? args.placeNameColumn : ''
			if (!placeNameColumn) throw new Error('placeNameColumn must be a non-empty string')
			const mapping = asMapping(args.mapping)

			// Pull the place-name column from the FULL dataset, keeping each name's row
			// so located rows can be placed with their mapped properties.
			const rows = ds.fullRows
				.map((row) => ({ row, placeName: row[placeNameColumn] }))
				.filter(
					(r): r is { row: Record<string, unknown>; placeName: string } =>
						typeof r.placeName === 'string' && r.placeName.trim().length > 0,
				)
				.map((r) => ({ row: r.row, placeName: r.placeName.trim() }))

			const totalRowsWithName = rows.length
			const geo = await batchGeocode(
				rows.map((r) => r.placeName),
				batchOptions,
			)

			const features: GeoJSON.Feature[] = []
			let placed = 0
			let failedRows = 0
			for (const { row, placeName } of rows) {
				const coord = geo.coordsByName.get(placeName)
				if (!coord) {
					failedRows += 1
					continue
				}
				features.push({
					type: 'Feature',
					geometry: { type: 'Point', coordinates: coord },
					properties: buildProperties(row, mapping),
				})
				placed += 1
			}

			let importedCount = 0
			let skippedDuplicates = 0
			let totalFeaturesInEditor = 0
			if (features.length > 0) {
				const result = importFeaturesToEditor(features, false)
				importedCount = result.importedCount
				skippedDuplicates = result.skippedDuplicates
				totalFeaturesInEditor = result.totalFeaturesInEditor
			}

			return {
				located: placed,
				total: totalRowsWithName,
				failed: failedRows,
				uniqueNamesLookedUp: geo.total,
				importedCount,
				skippedDuplicates,
				totalFeaturesInEditor,
				message: `Located ${placed} of ${totalRowsWithName} rows. ${failedRows} couldn't be geocoded.`,
			}
		},
	})
}
