/**
 * Authoring API — read-only measurement primitives (AI_GEO_AWARENESS §2).
 *
 * ONE operation-dispatched entry point (`measureFeatures`) instead of a tool
 * per measurement — primitives over use-case tools. Strictly READ-ONLY: no
 * editor reference, mutates nothing.
 *
 * Boundary (D-07): imports ONLY the `EditorFeature` type and `@turf/turf` —
 * nothing from chat, the tool registry, or Nostr. `boundary.test.ts` enforces.
 */

import * as turf from '@turf/turf'
import type { EditorFeature } from '../core/types'

export type MeasureOperation =
	| 'length'
	| 'area'
	| 'perimeter'
	| 'distance'
	| 'bearing'
	| 'centroid'
	| 'bbox'
	| 'nearest_point'

export const MEASURE_OPERATIONS: MeasureOperation[] = [
	'length',
	'area',
	'perimeter',
	'distance',
	'bearing',
	'centroid',
	'bbox',
	'nearest_point',
]

export interface MeasureOptions {
	/** Reference point for distance / bearing / nearest_point, [lon, lat]. */
	from?: [number, number]
	/** Second point for distance / bearing, [lon, lat]. */
	to?: [number, number]
}

/** Per-feature entries are capped; totals always cover the full set. */
const MAX_PER_FEATURE_ENTRIES = 50

interface PerFeatureValue {
	featureId: string
	name?: string
	value: number
}

const round = (value: number, decimals = 3) => {
	const factor = 10 ** decimals
	return Math.round(value * factor) / factor
}

function featureName(feature: EditorFeature): string | undefined {
	const name = feature.properties?.name
	return typeof name === 'string' ? name : undefined
}

function asTurfFeature(feature: EditorFeature): turf.AllGeoJSON {
	return feature as unknown as turf.AllGeoJSON
}

function safeMeasure(feature: EditorFeature, fn: (f: turf.AllGeoJSON) => number): number {
	try {
		return fn(asTurfFeature(feature))
	} catch {
		return 0
	}
}

function perFeature(
	features: EditorFeature[],
	fn: (f: turf.AllGeoJSON) => number,
): { entries: PerFeatureValue[]; total: number; truncated: boolean } {
	let total = 0
	const entries: PerFeatureValue[] = []
	for (const feature of features) {
		const value = safeMeasure(feature, fn)
		total += value
		if (entries.length < MAX_PER_FEATURE_ENTRIES && value > 0) {
			entries.push({
				featureId: String(feature.id),
				name: featureName(feature),
				value: round(value),
			})
		}
	}
	return { entries, total: round(total), truncated: features.length > MAX_PER_FEATURE_ENTRIES }
}

function perimeterKm(f: turf.AllGeoJSON): number {
	const geometryType = (f as GeoJSON.Feature).geometry?.type
	if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') return 0
	const boundary = turf.polygonToLine(f as GeoJSON.Feature<GeoJSON.Polygon>)
	return turf.length(boundary as turf.AllGeoJSON, { units: 'kilometers' })
}

function requirePoint(value: [number, number] | undefined, label: string): [number, number] {
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		!Number.isFinite(value[0]) ||
		!Number.isFinite(value[1])
	) {
		throw new Error(`${label} must be a [lon, lat] pair of finite numbers`)
	}
	return value
}

/**
 * Resolve the two endpoints for distance/bearing: explicit from/to when given;
 * otherwise exactly two target features measured centroid-to-centroid.
 */
function resolveEndpoints(
	features: EditorFeature[],
	options: MeasureOptions,
): { from: [number, number]; to: [number, number]; basis: string } {
	if (options.from !== undefined || options.to !== undefined) {
		return {
			from: requirePoint(options.from, 'from'),
			to: requirePoint(options.to, 'to'),
			basis: 'from/to points',
		}
	}
	if (features.length === 2) {
		const [a, b] = features
		const centroidOf = (f: EditorFeature) =>
			turf.centroid(asTurfFeature(f)).geometry.coordinates as [number, number]
		return {
			from: centroidOf(a as EditorFeature),
			to: centroidOf(b as EditorFeature),
			basis: `centroids of ${String(a?.id)} and ${String(b?.id)}`,
		}
	}
	throw new Error(
		'distance/bearing needs either from+to [lon,lat] points, or exactly two target features (centroid-to-centroid)',
	)
}

/**
 * Run one measurement over a feature set. Returns a compact JSON-able result;
 * throws a descriptive error on unusable input (surfaces as a self-correctable
 * ToolError in the chat loop).
 */
export function measureFeatures(
	operation: MeasureOperation,
	features: EditorFeature[],
	options: MeasureOptions = {},
): Record<string, unknown> {
	switch (operation) {
		case 'length': {
			const { entries, total, truncated } = perFeature(features, (f) =>
				turf.length(f, { units: 'kilometers' }),
			)
			return { operation, unit: 'km', totalKm: total, features: entries, truncated }
		}
		case 'perimeter': {
			const { entries, total, truncated } = perFeature(features, perimeterKm)
			return { operation, unit: 'km', totalKm: total, features: entries, truncated }
		}
		case 'area': {
			const { entries, total, truncated } = perFeature(features, (f) => turf.area(f) / 1e6)
			return { operation, unit: 'km2', totalKm2: total, features: entries, truncated }
		}
		case 'distance': {
			const { from, to, basis } = resolveEndpoints(features, options)
			return {
				operation,
				unit: 'km',
				km: round(turf.distance(from, to, { units: 'kilometers' })),
				basis,
			}
		}
		case 'bearing': {
			const { from, to, basis } = resolveEndpoints(features, options)
			return { operation, unit: 'degrees', degrees: round(turf.bearing(from, to), 1), basis }
		}
		case 'centroid': {
			if (features.length === 0) throw new Error('centroid needs at least one target feature')
			const centroids = features.slice(0, MAX_PER_FEATURE_ENTRIES).map((feature) => ({
				featureId: String(feature.id),
				name: featureName(feature),
				coordinates: turf.centroid(asTurfFeature(feature)).geometry.coordinates,
			}))
			const overall = turf.centroid(
				turf.featureCollection(features.map((f) => asTurfFeature(f)) as GeoJSON.Feature[]),
			).geometry.coordinates
			return { operation, centroids, overall, truncated: features.length > MAX_PER_FEATURE_ENTRIES }
		}
		case 'bbox': {
			if (features.length === 0) throw new Error('bbox needs at least one target feature')
			const box = turf.bbox(
				turf.featureCollection(features.map((f) => asTurfFeature(f)) as GeoJSON.Feature[]),
			)
			return { operation, bbox: box.map((v) => round(v, 6)), order: 'west,south,east,north' }
		}
		case 'nearest_point': {
			const from = requirePoint(options.from, 'from')
			if (features.length === 0) throw new Error('nearest_point needs at least one target feature')
			let best: {
				featureId: string
				name?: string
				coordinates: number[]
				distanceKm: number
			} | null = null
			for (const feature of features) {
				let candidate: GeoJSON.Position | null = null
				try {
					// Vertex-level nearest: explode covers every geometry type uniformly.
					const vertices = turf.explode(asTurfFeature(feature) as GeoJSON.Feature)
					const nearest = turf.nearestPoint(from, vertices)
					candidate = nearest.geometry.coordinates
				} catch {
					continue
				}
				if (!candidate) continue
				const distanceKm = turf.distance(from, candidate, { units: 'kilometers' })
				if (!best || distanceKm < best.distanceKm) {
					best = {
						featureId: String(feature.id),
						name: featureName(feature),
						coordinates: candidate,
						distanceKm: round(distanceKm),
					}
				}
			}
			if (!best) throw new Error('nearest_point: no measurable vertices in the target features')
			return { operation, unit: 'km', nearest: best }
		}
		default:
			throw new Error(
				`Unknown measure operation "${String(operation)}". Valid: ${MEASURE_OPERATIONS.join(', ')}`,
			)
	}
}

/**
 * Passive companion for context injection: computed length/area for one
 * feature, or null when neither applies (points). Cheap enough to run over
 * the selected-feature summaries on every context build.
 */
export function summarizeFeatureMeasurements(
	feature: EditorFeature,
): { lengthKm?: number; areaKm2?: number } | null {
	const type = feature.geometry?.type
	if (type === 'LineString' || type === 'MultiLineString') {
		return { lengthKm: round(safeMeasure(feature, (f) => turf.length(f, { units: 'kilometers' }))) }
	}
	if (type === 'Polygon' || type === 'MultiPolygon') {
		return { areaKm2: round(safeMeasure(feature, (f) => turf.area(f) / 1e6)) }
	}
	return null
}

/**
 * Whole-set totals for the passive-companion surfaces (chat context, info
 * panel stats row, measure popover). Null when nothing is measurable so
 * point-only datasets stay clean.
 */
export interface DatasetMeasurements {
	lineCount: number
	totalLengthKm: number
	polygonCount: number
	totalAreaKm2: number
}

export function aggregateMeasurements(features: EditorFeature[]): DatasetMeasurements | null {
	let lineCount = 0
	let totalLengthKm = 0
	let polygonCount = 0
	let totalAreaKm2 = 0
	for (const feature of features) {
		const type = feature.geometry?.type
		if (type === 'LineString' || type === 'MultiLineString') {
			lineCount++
			totalLengthKm += safeMeasure(feature, (f) => turf.length(f, { units: 'kilometers' }))
		} else if (type === 'Polygon' || type === 'MultiPolygon') {
			polygonCount++
			totalAreaKm2 += safeMeasure(feature, (f) => turf.area(f) / 1e6)
		}
	}
	if (lineCount === 0 && polygonCount === 0) return null
	return {
		lineCount,
		totalLengthKm: round(totalLengthKm),
		polygonCount,
		totalAreaKm2: round(totalAreaKm2),
	}
}

/** "832 m" below 1 km, "12.4 km" above (unit auto-switch for display). */
export function formatLengthKm(km: number): string {
	if (!Number.isFinite(km)) return '—'
	if (km < 1) return `${Math.round(km * 1000)} m`
	return `${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(km >= 10 ? 1 : 2)} km`
}

/** "4,300 m²" below 0.01 km², "3.42 km²" above. */
export function formatAreaKm2(km2: number): string {
	if (!Number.isFinite(km2)) return '—'
	if (km2 < 0.01) return `${Math.round(km2 * 1e6).toLocaleString()} m²`
	return `${km2 >= 100 ? Math.round(km2).toLocaleString() : km2.toFixed(km2 >= 10 ? 1 : 2)} km²`
}

/**
 * One display string for a single geometry ("12.4 km", "3.42 km² · perimeter
 * 8.1 km"), or null for points/empty geometry. Feeds the inspect/edit views.
 */
export function formatGeometryMeasurement(
	geometry: GeoJSON.Geometry | null | undefined,
): string | null {
	if (!geometry) return null
	const pseudo = { type: 'Feature', id: 'display', properties: {}, geometry } as EditorFeature
	const type = geometry.type
	if (type === 'LineString' || type === 'MultiLineString') {
		const km = safeMeasure(pseudo, (f) => turf.length(f, { units: 'kilometers' }))
		return km > 0 ? formatLengthKm(km) : null
	}
	if (type === 'Polygon' || type === 'MultiPolygon') {
		const km2 = safeMeasure(pseudo, (f) => turf.area(f) / 1e6)
		if (km2 <= 0) return null
		const perimeter = safeMeasure(pseudo, perimeterKm)
		return perimeter > 0
			? `${formatAreaKm2(km2)} · perimeter ${formatLengthKm(perimeter)}`
			: formatAreaKm2(km2)
	}
	return null
}
