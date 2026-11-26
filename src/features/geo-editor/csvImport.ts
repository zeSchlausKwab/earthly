import type { Feature, FeatureCollection } from 'geojson'
import Papa from 'papaparse'
import { parseCsvToGeoJsonWasm, preloadEarthlyWasm } from '@/lib/wasm/earthlyWasm'

const LAT_COLUMNS = new Set(['lat', 'latitude', 'y', 'lat_deg', 'wgs84_lat'])
const LON_COLUMNS = new Set(['lon', 'lng', 'long', 'longitude', 'x', 'lon_deg', 'wgs84_lon'])
const NAME_COLUMNS = new Set(['name', 'title', 'label'])
const MAX_CSV_FEATURES = 5_000

function toFiniteCoord(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) return null
		const parsed = Number(trimmed)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function parseCsvFallback(text: string, filename?: string): FeatureCollection {
	const trimmed = text.replace(/^\uFEFF/, '').trim()
	if (!trimmed) {
		throw new Error('CSV file is empty.')
	}
	const parsed = Papa.parse<Record<string, unknown>>(trimmed, {
		header: true,
		dynamicTyping: true,
		skipEmptyLines: true,
	})
	const fields = parsed.meta.fields ?? []
	const latCol = fields.find((field) => LAT_COLUMNS.has(field.trim().toLowerCase()))
	const lonCol = fields.find((field) => LON_COLUMNS.has(field.trim().toLowerCase()))
	if (!latCol || !lonCol) {
		throw new Error('CSV missing lat/latitude and lon/lng/longitude columns.')
	}

	const features: Feature[] = []
	for (const row of parsed.data) {
		if (features.length >= MAX_CSV_FEATURES) break
		const lat = toFiniteCoord(row[latCol])
		const lon = toFiniteCoord(row[lonCol])
		if (lat === null || lon === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
			continue
		}

		const properties: Record<string, unknown> = {}
		for (const field of fields) {
			if (field === latCol || field === lonCol) continue
			const value = row[field]
			if (value === undefined || value === null || value === '') continue
			properties[field] = value
			if (properties.name === undefined && NAME_COLUMNS.has(field.trim().toLowerCase())) {
				properties.name = String(value)
			}
		}

		features.push({
			type: 'Feature',
			id: `csv-${features.length + 1}`,
			geometry: { type: 'Point', coordinates: [lon, lat] },
			properties,
		})
	}

	if (features.length === 0) {
		throw new Error('CSV contained no rows with valid WGS-84 coordinates.')
	}

	const title = filename?.replace(/\.[^.]+$/, '').trim()
	return {
		type: 'FeatureCollection',
		...(title ? { name: title } : {}),
		features,
	} as FeatureCollection
}

/**
 * Parse a CSV or TSV file containing lat/lon columns into a GeoJSON `FeatureCollection`.
 * Uses `parseCsvToGeoJsonWasm` when WASM is available, falling back to PapaParse.
 */
export async function importCsvAsFeatureCollection(file: File): Promise<FeatureCollection> {
	void preloadEarthlyWasm()
	const text = await file.text()
	try {
		const wasmResult = await parseCsvToGeoJsonWasm(text, file.name)
		if (wasmResult?.geojson?.features?.length) {
			return wasmResult.geojson as unknown as FeatureCollection
		}
	} catch {
		// Fall back to PapaParse so quoted multiline cells or non-standard delimiters still work.
	}
	return parseCsvFallback(text, file.name)
}
