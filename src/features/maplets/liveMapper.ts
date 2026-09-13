import type { Feature, FeatureCollection, MultiPolygon, Polygon, LineString } from 'geojson'
import samplePayload from './live-mapper/liveuamap-yemen.sample.json'
import { createLiveMapperWorkbenchHtml } from './workbench'

export const LIVE_MAPPER_SOURCE_URL =
	'https://yemen.liveuamap.com/ajax/do?act=acornice&time=1789297855&resid=53&lang=en&isUserReg=0'

export type LiveMapperConfig = {
	source: 'sample' | 'live'
	refreshSeconds: 0 | 60 | 300
	includeLines: boolean
}

export const LIVE_MAPPER_DEFAULT_CONFIG: LiveMapperConfig = {
	source: 'sample',
	refreshSeconds: 0,
	includeLines: true,
}

export const LIVE_MAPPER_CONFIG_SCHEMA = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	type: 'object',
	additionalProperties: false,
	properties: {},
} as const

export const LIVE_MAPPER_DEFINITION = {
	id: 'live-mapper',
	title: 'Live Mapper',
	description:
		'Import geographic JSON into named layers, publish collections and follow contributor snapshots.',
	requires: ['resource', 'config', 'map', 'identity'],
	archetype: 'maplet',
	attribution: 'Liveuamap',
} as const

export type LiveMapperMappingOptions = {
	source: 'sample' | 'live'
	includeLines?: boolean
	fetchedAt?: string | null
	sourceUrl?: string
}

/**
 * Intentionally self-contained: the identical function is embedded in the Napplet,
 * so all conversion happens inside its sandbox, not in the Earthly host.
 */
export function mapLiveuamapPayload(
	payload: unknown,
	options: LiveMapperMappingOptions,
): {
	featureCollection: FeatureCollection
	warnings: string[]
} {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error('Live Mapper expected a keyed Liveuamap record object.')
	}
	const entries = Object.entries(payload)
	if (entries.length > 5_000) throw new Error('Live Mapper received too many source records.')
	const features: Feature<Polygon | MultiPolygon | LineString>[] = []
	const warnings: string[] = [
		options.source === 'sample'
			? 'Captured sample: capture time is unavailable; these features are not live.'
			: 'Fetched source: the meaning of its fixed time parameter is unverified. Retrieval time does not establish dataset freshness.',
	]
	const sourceUrl =
		options.sourceUrl ??
		'https://yemen.liveuamap.com/ajax/do?act=acornice&time=1789297855&resid=53&lang=en&isUserReg=0'
	let coordinateCount = 0
	let recognizedRecords = 0
	let validGeometries = 0
	const ids = new Set<string>()
	function boundedNumber(value: unknown, fallback: number, max: number): number {
		const result =
			typeof value === 'number' || (typeof value === 'string' && value.trim())
				? Number(value)
				: Number.NaN
		return Number.isFinite(result) ? Math.min(max, Math.max(0, result)) : fallback
	}
	function color(value: unknown, fallback: string): string {
		return typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value) ? value : fallback
	}
	function text(value: unknown, fallback: string): string {
		return typeof value === 'string' ? value.slice(0, 2_000) : fallback
	}
	for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			warnings.push(`Record ${key}: skipped an invalid source record.`)
			continue
		}
		const record = value as Record<string, unknown>
		if (!Array.isArray(record.points)) {
			warnings.push(`Record ${key}: skipped because points are missing.`)
			continue
		}
		if (record.type_id !== undefined && record.type_id !== 6 && record.type_id !== 14) {
			warnings.push(`Record ${key}: skipped unsupported source type ${String(record.type_id)}.`)
			continue
		}
		recognizedRecords++
		const sourceId =
			typeof record.id === 'number' || typeof record.id === 'string' ? String(record.id) : key
		if (ids.has(sourceId)) throw new Error(`Live Mapper received duplicate source id ${sourceId}.`)
		ids.add(sourceId)
		const name = text(record.name, `Liveuamap ${sourceId}`)
		const properties = {
			name,
			description: text(record.description, ''),
			fillColor: color(record.fillcolor, '#64748b'),
			fillOpacity: boundedNumber(record.fillopacity, 0.25, 1),
			strokeColor: color(record.strokecolor, '#64748b'),
			strokeWidth: boundedNumber(record.strokeweight, 2, 20),
			strokeOpacity: boundedNumber(record.strokeopacity, 1, 1),
			source: 'Liveuamap',
			sourceId,
			sourceUrl,
			sourceMode: options.source,
			sourceCapturedAt: null,
			sourceFetchedAt: options.fetchedAt ?? null,
			sourceTimeVerified: false,
			sourceTypeId: typeof record.type_id === 'number' ? record.type_id : null,
			sourceSymbolPath: text(record.symbolpath, ''),
		}
		type Coordinate = [number, number]
		if (record.type_id === 14) {
			// This source format is one ordered line of { lat, lng } points, not polygon rings.
			coordinateCount += record.points.length
			if (coordinateCount > 100_000)
				throw new Error('Live Mapper received more than 100,000 coordinates.')
			const coordinates: Coordinate[] = []
			let invalid = false
			for (const point of record.points) {
				if (
					!point ||
					typeof point !== 'object' ||
					Array.isArray(point) ||
					typeof point.lat !== 'number' ||
					typeof point.lng !== 'number' ||
					!Number.isFinite(point.lat) ||
					!Number.isFinite(point.lng) ||
					Math.abs(point.lat) > 90 ||
					Math.abs(point.lng) > 180
				) {
					invalid = true
					break
				}
				const previous = coordinates[coordinates.length - 1]
				if (!previous || previous[0] !== point.lng || previous[1] !== point.lat)
					coordinates.push([point.lng, point.lat])
			}
			if (invalid) {
				warnings.push(
					`${name}: skipped an invalid type-14 line; points need finite lat/lng numbers within WGS84 bounds.`,
				)
				continue
			}
			if (coordinates.length < 2) {
				warnings.push(`${name}: skipped a degenerate type-14 line.`)
				continue
			}
			validGeometries++
			if (options.includeLines === false) {
				warnings.push(`${name}: type-14 line omitted by the line configuration.`)
			} else {
				features.push({
					type: 'Feature',
					id: `liveuamap-yemen:${sourceId}:line:0`,
					properties,
					geometry: { type: 'LineString', coordinates },
				})
			}
			continue
		}
		const polygons: Coordinate[][][] = []
		for (const [pathIndex, path] of record.points.entries()) {
			const pathLabel = `${name}, path ${pathIndex + 1}`
			if (!Array.isArray(path) || path.length < 4 || path.length % 2 !== 0) {
				warnings.push(`${pathLabel}: skipped an invalid flat latitude/longitude path.`)
				continue
			}
			coordinateCount += path.length / 2
			if (coordinateCount > 100_000)
				throw new Error('Live Mapper received more than 100,000 coordinates.')
			const coordinates: Coordinate[] = []
			let invalid = false
			for (let index = 0; index < path.length; index += 2) {
				const lat: unknown = path[index]
				const lon: unknown = path[index + 1]
				if (
					typeof lat !== 'number' ||
					typeof lon !== 'number' ||
					!Number.isFinite(lat) ||
					!Number.isFinite(lon) ||
					Math.abs(lat) > 90 ||
					Math.abs(lon) > 180
				) {
					invalid = true
					break
				}
				const previous = coordinates[coordinates.length - 1]
				if (!previous || previous[0] !== lon || previous[1] !== lat) coordinates.push([lon, lat])
			}
			if (invalid) {
				warnings.push(`${pathLabel}: skipped coordinates outside WGS84 longitude/latitude bounds.`)
				continue
			}
			const first = coordinates[0]
			const last = coordinates[coordinates.length - 1]
			if (coordinates.length > 2 && first && last && first[0] === last[0] && first[1] === last[1])
				coordinates.pop()
			if (coordinates.length === 2) {
				validGeometries++
				warnings.push(
					`${pathLabel}: two-point path ${options.includeLines === false ? 'omitted' : 'retained as a line'}; it cannot form a polygon.`,
				)
				if (options.includeLines !== false)
					features.push({
						type: 'Feature',
						id: `liveuamap-yemen:${sourceId}:line:${pathIndex}`,
						properties: {
							...properties,
							geometryDiagnostic: 'Two-point source path; polygon interpretation is impossible.',
						},
						geometry: { type: 'LineString', coordinates },
					})
				continue
			}
			if (coordinates.length < 3 || !first) {
				warnings.push(`${pathLabel}: skipped a degenerate path.`)
				continue
			}
			coordinates.push([...first])
			let signedArea = 0
			for (let index = 0; index < coordinates.length - 1; index++) {
				const a = coordinates[index]
				const b = coordinates[index + 1]
				if (a && b) signedArea += a[0] * b[1] - b[0] * a[1]
			}
			if (Math.abs(signedArea) < 1e-12) {
				warnings.push(`${pathLabel}: skipped a zero-area polygon.`)
				continue
			}
			if (signedArea < 0) coordinates.reverse()
			validGeometries++
			polygons.push([coordinates])
		}
		const firstPolygon = polygons[0]
		if (firstPolygon) {
			if (polygons.length > 1)
				warnings.push(
					`${name}: source ring roles are unknown. Paths are treated as separate exterior polygons; holes are not inferred.`,
				)
			features.push({
				type: 'Feature',
				id: `liveuamap-yemen:${sourceId}:polygon`,
				properties: {
					...properties,
					ringInterpretation: 'Exterior paths; hole roles are not provided by the source.',
				},
				geometry:
					polygons.length === 1
						? { type: 'Polygon', coordinates: firstPolygon }
						: { type: 'MultiPolygon', coordinates: polygons },
			})
		}
	}
	if (entries.length && !recognizedRecords)
		throw new Error(
			'Live Mapper found no records with points. The source may have changed its format.',
		)
	if (entries.length && !validGeometries)
		throw new Error('Live Mapper could not map any valid source geometry.')
	return { featureCollection: { type: 'FeatureCollection', features }, warnings }
}

export const LIVE_MAPPER_HTML = createLiveMapperWorkbenchHtml(
	samplePayload,
	LIVE_MAPPER_SOURCE_URL,
	mapLiveuamapPayload,
)
