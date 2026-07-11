/**
 * Land/water classification against the Natural Earth land mask
 * (docs/AI_GEO_AWARENESS.md §1). Used by the automatic post-write validation
 * loop and `describe_location`.
 *
 * The mask is coarse (1:50m): narrow straits and canals (e.g. Suez) may read
 * as land. Findings are therefore ADVISORY — reported to the model, never a
 * block (per-design decision: no "passable corridors" overlay for now).
 *
 * Noise filter: a line entirely on land (a road) or entirely on water (a good
 * shipping lane) is unremarkable — only MIXED lines get per-run detail. Points
 * are summarized as counts.
 */

import * as turf from '@turf/turf'

interface LandPolygon {
	polygon: GeoJSON.Feature<GeoJSON.Polygon>
	bbox: [number, number, number, number]
}

const maskIndexCache = new WeakMap<GeoJSON.FeatureCollection, LandPolygon[]>()

/** Flatten the land FeatureCollection into bbox-indexed simple polygons. */
function landMaskIndex(mask: GeoJSON.FeatureCollection): LandPolygon[] {
	const cached = maskIndexCache.get(mask)
	if (cached) return cached
	const index: LandPolygon[] = []
	for (const feature of mask.features) {
		const geometry = feature.geometry
		if (!geometry) continue
		const polygonCoords: GeoJSON.Position[][][] =
			geometry.type === 'Polygon'
				? [geometry.coordinates]
				: geometry.type === 'MultiPolygon'
					? geometry.coordinates
					: []
		for (const coords of polygonCoords) {
			const polygon = turf.polygon(coords)
			index.push({
				polygon,
				bbox: turf.bbox(polygon) as [number, number, number, number],
			})
		}
	}
	maskIndexCache.set(mask, index)
	return index
}

function bboxContains(bbox: [number, number, number, number], lon: number, lat: number): boolean {
	return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

/** Whether a lon/lat position is on land per the given mask. */
export function isOnLand(mask: GeoJSON.FeatureCollection, position: GeoJSON.Position): boolean {
	const [lon, lat] = position
	if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
	const point = turf.point([lon, lat])
	for (const { polygon, bbox } of landMaskIndex(mask)) {
		if (!bboxContains(bbox, lon, lat)) continue
		if (turf.booleanPointInPolygon(point, polygon)) return true
	}
	return false
}

/** A contiguous run of on-land vertices within a line ("segments 12–18"). */
export interface LandRun {
	/** First on-land vertex index of the run. */
	from: number
	/** Last on-land vertex index of the run. */
	to: number
	/** Representative coordinate (first vertex of the run), [lon, lat]. */
	near: GeoJSON.Position
}

export interface MixedLineFinding {
	featureId: string
	name?: string
	vertexCount: number
	landVertexCount: number
	/** Runs of consecutive on-land vertices (capped). */
	landRuns: LandRun[]
	/** Human sentence the model can act on directly. */
	summary: string
}

export interface LandWaterReport {
	maskResolution: '1:50m'
	advisory: string
	lines: {
		checked: number
		fullyOnLand: number
		fullyOnWater: number
		mixed: MixedLineFinding[]
	}
	points: {
		checked: number
		onLand: number
		onWater: number
	}
	/** Set when vertex sampling kicked in (very large lines). */
	sampled?: boolean
}

const ADVISORY =
	'Advisory land/water check against the 1:50m Natural Earth land mask. Narrow straits/canals can read as land; land contact is expected for terrestrial features. Self-correct only where the intent is water-bound (or vice versa).'

/** Per-feature vertex budget; beyond it vertices are sampled evenly. */
const MAX_VERTICES_PER_LINE = 1500
/** Cap on detailed mixed-line findings (the counts stay exact). */
const MAX_MIXED_FINDINGS = 10
/** Cap on reported runs per line. */
const MAX_RUNS_PER_LINE = 6

interface FeatureLike {
	id?: string | number
	properties?: Record<string, unknown> | null
	geometry?: GeoJSON.Geometry | null
}

function lineParts(geometry: GeoJSON.Geometry): GeoJSON.Position[][] {
	if (geometry.type === 'LineString') return [geometry.coordinates]
	if (geometry.type === 'MultiLineString') return geometry.coordinates
	return []
}

function pointParts(geometry: GeoJSON.Geometry): GeoJSON.Position[] {
	if (geometry.type === 'Point') return [geometry.coordinates]
	if (geometry.type === 'MultiPoint') return geometry.coordinates
	return []
}

function sampleVertices(coords: GeoJSON.Position[]): {
	coords: GeoJSON.Position[]
	sampled: boolean
} {
	if (coords.length <= MAX_VERTICES_PER_LINE) return { coords, sampled: false }
	const step = coords.length / MAX_VERTICES_PER_LINE
	const out: GeoJSON.Position[] = []
	for (let i = 0; i < MAX_VERTICES_PER_LINE; i++) {
		out.push(coords[Math.min(coords.length - 1, Math.floor(i * step))] as GeoJSON.Position)
	}
	return { coords: out, sampled: true }
}

function roundPosition(position: GeoJSON.Position): GeoJSON.Position {
	return [
		Math.round((position[0] as number) * 100) / 100,
		Math.round((position[1] as number) * 100) / 100,
	]
}

/**
 * Classify a feature set against the land mask. Lines and points only —
 * polygons are skipped (they are terrestrial in the overwhelming case and a
 * polygon-on-water report would be noise).
 */
export function checkFeaturesAgainstLandMask(
	mask: GeoJSON.FeatureCollection,
	features: FeatureLike[],
): LandWaterReport {
	const report: LandWaterReport = {
		maskResolution: '1:50m',
		advisory: ADVISORY,
		lines: { checked: 0, fullyOnLand: 0, fullyOnWater: 0, mixed: [] },
		points: { checked: 0, onLand: 0, onWater: 0 },
	}

	for (const feature of features) {
		const geometry = feature.geometry
		if (!geometry) continue

		for (const position of pointParts(geometry)) {
			report.points.checked++
			if (isOnLand(mask, position)) report.points.onLand++
			else report.points.onWater++
		}

		const parts = lineParts(geometry)
		if (parts.length === 0) continue
		report.lines.checked++

		// Classify all (possibly sampled) vertices across the line parts.
		let vertexCount = 0
		let landVertexCount = 0
		const runs: LandRun[] = []
		let openRun: LandRun | null = null
		for (const part of parts) {
			const { coords, sampled } = sampleVertices(part)
			if (sampled) report.sampled = true
			for (const position of coords) {
				const onLand = isOnLand(mask, position)
				if (onLand) {
					landVertexCount++
					if (openRun) {
						openRun.to = vertexCount
					} else {
						openRun = { from: vertexCount, to: vertexCount, near: roundPosition(position) }
					}
				} else if (openRun) {
					runs.push(openRun)
					openRun = null
				}
				vertexCount++
			}
			if (openRun) {
				runs.push(openRun)
				openRun = null
			}
		}

		if (landVertexCount === 0) {
			report.lines.fullyOnWater++
			continue
		}
		if (landVertexCount === vertexCount) {
			report.lines.fullyOnLand++
			continue
		}
		if (report.lines.mixed.length >= MAX_MIXED_FINDINGS) continue

		const shownRuns = runs.slice(0, MAX_RUNS_PER_LINE)
		const runText = shownRuns
			.map((run) =>
				run.from === run.to
					? `vertex ${run.from} at [${run.near[0]}, ${run.near[1]}]`
					: `vertices ${run.from}–${run.to} near [${run.near[0]}, ${run.near[1]}]`,
			)
			.join('; ')
		const name = typeof feature.properties?.name === 'string' ? feature.properties.name : undefined
		report.lines.mixed.push({
			featureId: String(feature.id ?? ''),
			name,
			vertexCount,
			landVertexCount,
			landRuns: shownRuns,
			summary: `${landVertexCount}/${vertexCount} vertices on land (${runText}${runs.length > shownRuns.length ? `; +${runs.length - shownRuns.length} more runs` : ''})`,
		})
	}

	return report
}
