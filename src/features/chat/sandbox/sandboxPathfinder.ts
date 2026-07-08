/**
 * Sandbox pathfinding primitive (AI_GEO_AWARENESS §3) — A* shortest path over
 * any GeoJSON LineString network via `geojson-path-finder`, exposed to the
 * run_code VM as the `pathfinder` global.
 *
 * One primitive × N network datasets = N capabilities: the bundled maritime
 * network, rivers, or any user-provided line dataset. The model names the
 * endpoints; deterministic code produces the coordinates — digitization stays
 * OUT of the model.
 *
 * Runs on the WORKER thread (outside the VM). Like turf, a synchronous call
 * here cannot be preempted by the in-VM interrupt, so the network size is
 * hard-capped (WR-01 idiom) and graphs are cached per network object so a
 * repeated layer route costs one build.
 *
 * Endpoints are SNAPPED to the nearest network vertex before routing —
 * `geojson-path-finder` only matches vertices within a tiny tolerance, and
 * model-supplied ports/cities are never exactly on the network.
 */

import { length as turfLength, lineString } from '@turf/turf'
import PathFinder from 'geojson-path-finder'

/** Hard cap on network coordinates (the bundled maritime net is ~10k). */
export const MAX_NETWORK_COORDINATES = 200_000

export interface PathfinderSnap {
	/** The requested [lon, lat]. */
	requested: [number, number]
	/** The network vertex actually used. */
	snapped: [number, number]
	/** Great-circle km between the two. */
	offsetKm: number
}

export interface PathfinderResult {
	path: GeoJSON.Feature<GeoJSON.LineString>
	lengthKm: number
	vertexCount: number
	from: PathfinderSnap
	to: PathfinderSnap
}

interface CachedGraph {
	finder: PathFinder<unknown, GeoJSON.GeoJsonProperties>
	vertices: [number, number][]
}

const graphCache = new WeakMap<object, CachedGraph>()

/** Flatten a FeatureCollection into pure-LineString features (splitting multis). */
function toLineNetwork(
	network: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
	const lines: GeoJSON.Feature<GeoJSON.LineString>[] = []
	let coordinates = 0
	for (const feature of network.features) {
		const geometry = feature.geometry
		if (!geometry) continue
		const parts: GeoJSON.Position[][] =
			geometry.type === 'LineString'
				? [geometry.coordinates]
				: geometry.type === 'MultiLineString'
					? geometry.coordinates
					: []
		for (const part of parts) {
			if (part.length < 2) continue
			coordinates += part.length
			if (coordinates > MAX_NETWORK_COORDINATES) {
				throw new Error(
					`network exceeds the ${MAX_NETWORK_COORDINATES}-coordinate cap — pass a smaller/pre-clipped network`,
				)
			}
			lines.push({
				type: 'Feature',
				properties: feature.properties ?? {},
				geometry: { type: 'LineString', coordinates: part },
			})
		}
	}
	if (lines.length === 0) {
		throw new Error('network has no LineString features to route over')
	}
	return { type: 'FeatureCollection', features: lines }
}

function buildGraph(network: GeoJSON.FeatureCollection): CachedGraph {
	const cached = graphCache.get(network)
	if (cached) return cached
	const lines = toLineNetwork(network)
	const finder = new PathFinder<unknown, GeoJSON.GeoJsonProperties>(lines)
	const seen = new Set<string>()
	const vertices: [number, number][] = []
	for (const feature of lines.features) {
		for (const position of feature.geometry.coordinates) {
			const key = `${position[0]},${position[1]}`
			if (seen.has(key)) continue
			seen.add(key)
			vertices.push([position[0] as number, position[1] as number])
		}
	}
	const graph = { finder, vertices }
	graphCache.set(network, graph)
	return graph
}

function requirePoint(value: unknown, label: string): [number, number] {
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		typeof value[0] !== 'number' ||
		typeof value[1] !== 'number' ||
		!Number.isFinite(value[0]) ||
		!Number.isFinite(value[1])
	) {
		throw new Error(`${label} must be a [lon, lat] pair of finite numbers`)
	}
	return [value[0], value[1]]
}

/** Nearest network vertex by equirectangular approximation (fine for snapping). */
function snapToNetwork(vertices: [number, number][], point: [number, number]): PathfinderSnap {
	const cosLat = Math.cos((point[1] * Math.PI) / 180)
	let best: [number, number] = vertices[0] as [number, number]
	let bestScore = Number.POSITIVE_INFINITY
	for (const vertex of vertices) {
		const dLon = (vertex[0] - point[0]) * cosLat
		const dLat = vertex[1] - point[1]
		const score = dLon * dLon + dLat * dLat
		if (score < bestScore) {
			bestScore = score
			best = vertex
		}
	}
	// ~111.32 km per degree at the equator; good enough for a snap-offset report.
	const offsetKm = Math.sqrt(bestScore) * 111.32
	return { requested: point, snapped: best, offsetKm: Math.round(offsetKm * 10) / 10 }
}

/**
 * Shortest path over `network` between two [lon, lat] points. Throws
 * descriptive errors (no path / bad input / oversized network) that the
 * sandbox surfaces to the model as tagged error strings.
 */
export function runPathfinder(
	network: GeoJSON.FeatureCollection,
	from: unknown,
	to: unknown,
): PathfinderResult {
	const fromPoint = requirePoint(from, 'from')
	const toPoint = requirePoint(to, 'to')
	const { finder, vertices } = buildGraph(network)

	const fromSnap = snapToNetwork(vertices, fromPoint)
	const toSnap = snapToNetwork(vertices, toPoint)

	const found = finder.findPath(
		{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: fromSnap.snapped } },
		{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toSnap.snapped } },
	)
	if (!found || found.path.length < 2) {
		throw new Error(
			'no path found between the snapped endpoints — the network may be disconnected there; try different endpoints or a denser network',
		)
	}

	const path = lineString(found.path as GeoJSON.Position[])
	return {
		path,
		lengthKm: Math.round(turfLength(path, { units: 'kilometers' }) * 10) / 10,
		vertexCount: found.path.length,
		from: fromSnap,
		to: toSnap,
	}
}
