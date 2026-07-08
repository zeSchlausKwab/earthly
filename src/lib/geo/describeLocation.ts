/**
 * Textual grounding for coordinates (AI_GEO_AWARENESS §5): turn a point or
 * viewport into NAMED anchors — country, nearest city, on-land/on-water,
 * distance to coast. "Names are anchors; floats are not."
 *
 * Pure over injected world layers (callers pass whatever subset is loaded;
 * every part degrades to absence). The chat layer wires this to `worldData`.
 */

import * as turf from '@turf/turf'
import { isOnLand } from './landWater'

export interface WorldLayerBundle {
	land?: GeoJSON.FeatureCollection | null
	countries?: GeoJSON.FeatureCollection | null
	cities?: GeoJSON.FeatureCollection | null
	coastline?: GeoJSON.FeatureCollection | null
}

export interface NearestCity {
	name: string
	country?: string
	distanceKm: number
	direction: string
}

export interface LocationDescription {
	position: [number, number]
	/** Absent when no land mask was available. */
	onLand?: boolean
	country?: string
	nearestCity?: NearestCity
	/** Distance to the nearest 110m coastline vertex-projected point. */
	coastDistanceKm?: number
	/** Compass direction from the position toward that nearest coast point. */
	coastDirection?: string
	/** One assembled sentence for prompt injection. */
	text: string
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export function bearingToCompass(bearing: number): string {
	const normalized = ((bearing % 360) + 360) % 360
	return COMPASS[Math.round(normalized / 45) % 8] as string
}

const roundKm = (km: number) => (km >= 100 ? Math.round(km) : Math.round(km * 10) / 10)

function countryAt(
	countries: GeoJSON.FeatureCollection,
	position: [number, number],
): string | undefined {
	const point = turf.point(position)
	for (const feature of countries.features) {
		const geometry = feature.geometry
		if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
		try {
			if (turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon>)) {
				const name = feature.properties?.name
				return typeof name === 'string' ? name : undefined
			}
		} catch {
			// skip malformed country geometry
		}
	}
	return undefined
}

function nearestCityTo(
	cities: GeoJSON.FeatureCollection,
	position: [number, number],
): NearestCity | undefined {
	const points = cities.features.filter((f) => f.geometry?.type === 'Point')
	if (points.length === 0) return undefined
	try {
		const nearest = turf.nearestPoint(
			position,
			turf.featureCollection(points as GeoJSON.Feature<GeoJSON.Point>[]),
		)
		const name = nearest.properties?.name
		if (typeof name !== 'string') return undefined
		const target = nearest.geometry.coordinates as [number, number]
		return {
			name,
			country:
				typeof nearest.properties?.country === 'string' ? nearest.properties.country : undefined,
			distanceKm: roundKm(turf.distance(position, target, { units: 'kilometers' })),
			direction: bearingToCompass(turf.bearing(position, target)),
		}
	} catch {
		return undefined
	}
}

function nearestCoast(
	coastline: GeoJSON.FeatureCollection,
	position: [number, number],
): { distanceKm: number; direction: string } | undefined {
	let best: { distanceKm: number; point: GeoJSON.Position } | null = null
	for (const feature of coastline.features) {
		const geometry = feature.geometry
		if (!geometry || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString'))
			continue
		try {
			const snapped = turf.nearestPointOnLine(
				feature as GeoJSON.Feature<GeoJSON.LineString>,
				position,
				{ units: 'kilometers' },
			)
			const distanceKm = snapped.properties.dist
			if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) continue
			if (!best || distanceKm < best.distanceKm) {
				best = { distanceKm, point: snapped.geometry.coordinates }
			}
		} catch {
			// skip malformed coastline part
		}
	}
	if (!best) return undefined
	return {
		distanceKm: roundKm(best.distanceKm),
		direction: bearingToCompass(turf.bearing(position, best.point)),
	}
}

/** Describe one [lon, lat] position against whatever layers are available. */
export function describeLocation(
	layers: WorldLayerBundle,
	position: [number, number],
): LocationDescription {
	const description: LocationDescription = { position, text: '' }

	if (layers.land) description.onLand = isOnLand(layers.land, position)
	if (layers.countries) description.country = countryAt(layers.countries, position)
	if (layers.cities) description.nearestCity = nearestCityTo(layers.cities, position)
	if (layers.coastline) {
		const coast = nearestCoast(layers.coastline, position)
		if (coast) {
			description.coastDistanceKm = coast.distanceKm
			description.coastDirection = coast.direction
		}
	}

	const parts: string[] = []
	if (description.onLand !== undefined) parts.push(description.onLand ? 'on land' : 'on water')
	if (description.country) parts.push(`in ${description.country}`)
	if (description.coastDistanceKm !== undefined) {
		const relation = description.onLand === false ? 'off the nearest coast' : 'from the coast'
		parts.push(
			`${description.coastDistanceKm} km ${relation} (${description.coastDirection} to coast)`,
		)
	}
	if (description.nearestCity) {
		const city = description.nearestCity
		parts.push(
			`nearest city ${city.name}${city.country ? ` (${city.country})` : ''} ${city.distanceKm} km ${city.direction}`,
		)
	}
	description.text = parts.length > 0 ? parts.join(', ') : 'no reference data available'
	return description
}

export interface ViewportAnchors {
	/** Country names intersecting the viewport bbox (capped, alphabetical). */
	countriesInView: string[]
	/** Description of the viewport center. */
	center: LocationDescription
}

const MAX_COUNTRIES_IN_VIEW = 12

/** Named anchors for a viewport bbox [west, south, east, north]. */
export function describeViewport(
	layers: WorldLayerBundle,
	bbox: [number, number, number, number],
): ViewportAnchors {
	const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
	const countriesInView: string[] = []
	if (layers.countries) {
		const viewPolygon = turf.bboxPolygon(bbox)
		for (const feature of layers.countries.features) {
			const name = feature.properties?.name
			if (typeof name !== 'string') continue
			try {
				if (turf.booleanIntersects(viewPolygon, feature as GeoJSON.Feature)) {
					countriesInView.push(name)
				}
			} catch {
				// skip malformed country geometry
			}
			if (countriesInView.length >= MAX_COUNTRIES_IN_VIEW) break
		}
		countriesInView.sort()
	}
	return { countriesInView, center: describeLocation(layers, center) }
}
