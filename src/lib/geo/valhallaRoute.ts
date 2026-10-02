import type { Feature, FeatureCollection, LineString } from 'geojson'

export type ValhallaProfile = 'auto' | 'bicycle' | 'pedestrian' | 'bus' | 'truck'
export type ValhallaLocation = { lat: number; lon: number }
export const MAX_ROUTE_WAYPOINTS = 100
export const MAX_ROUTE_BATCHES = 16
export const ROUTE_TIMEOUT_MS = 25_000

type Coordinate = [number, number]
export interface RouteBatch {
	coordinates: Coordinate[]
	lengthKm: number
	durationMin: number
}

export class ValhallaRequestError extends Error {
	constructor(
		message: string,
		readonly maxLocations?: number,
	) {
		super(message)
		this.name = 'ValhallaRequestError'
	}
}

export interface OrderedRouteResult {
	/** Only a complete, continuous route is importable as one feature. */
	feature: Feature<LineString> | null
	/** Individually routed batches, including a usable prefix on failure. */
	segments: FeatureCollection<LineString>
	summary: { lengthKm: number; durationMin: number; profile: ValhallaProfile }
	routing: {
		status: 'complete' | 'partial' | 'failed'
		requestedWaypoints: number
		completedWaypoints: number
		backendWaypointLimit: number
		batchCount: number
		completedBatches: number
		requestCount: number
		failure?: { fromIndex: number; toIndex: number; code: string; message: string }
	}
}

/** Never drop a waypoint: doing so silently changes the requested journey. */
export function validateRouteLocations(locations: ValhallaLocation[]): void {
	if (locations.length < 2 || locations.length > MAX_ROUTE_WAYPOINTS)
		throw new Error(`locations must contain 2 to ${MAX_ROUTE_WAYPOINTS} waypoints`)
	for (const [index, location] of locations.entries()) {
		if (
			!location ||
			!Number.isFinite(location.lat) ||
			!Number.isFinite(location.lon) ||
			location.lat < -90 ||
			location.lat > 90 ||
			location.lon < -180 ||
			location.lon > 180
		)
			throw new Error(`locations[${index}] must contain valid latitude and longitude`)
	}
}

function continuous(left: Coordinate, right: Coordinate): boolean {
	return Math.abs(left[0] - right[0]) <= 1e-6 && Math.abs(left[1] - right[1]) <= 1e-6
}

/** Append network geometry only when its endpoints meet; never invent a bridging line. */
export function appendRouteCoordinates(target: Coordinate[], segment: Coordinate[]): boolean {
	if (
		segment.length < 2 ||
		segment.some(
			([lon, lat]) =>
				!Number.isFinite(lon) ||
				!Number.isFinite(lat) ||
				lon < -180 ||
				lon > 180 ||
				lat < -90 ||
				lat > 90,
		)
	)
		return false
	const first = segment[0]
	const previous = target.at(-1)
	if (!first || (previous && !continuous(previous, first))) return false
	target.push(...(target.length ? segment.slice(1) : segment))
	return true
}

export async function routeInOrder(options: {
	locations: ValhallaLocation[]
	profile: ValhallaProfile
	backendCap: number
	signal?: AbortSignal
	request: (locations: ValhallaLocation[], signal?: AbortSignal) => Promise<RouteBatch>
}): Promise<OrderedRouteResult> {
	validateRouteLocations(options.locations)
	let cap = options.backendCap
	if (!Number.isInteger(cap) || cap < 2 || cap > MAX_ROUTE_WAYPOINTS)
		throw new Error('Valhalla backend waypoint limit must be an integer from 2 to 100')
	const coordinates: Coordinate[] = []
	const segments: Feature<LineString>[] = []
	let lengthKm = 0
	let durationMin = 0
	let completedWaypoints = 0
	let start = 0
	let retriedLimit = false
	let requestCount = 0
	let failure: OrderedRouteResult['routing']['failure']
	const batchCount = () => Math.ceil((options.locations.length - 1) / (cap - 1))
	if (batchCount() > MAX_ROUTE_BATCHES)
		throw new Error(
			`Route requires more than ${MAX_ROUTE_BATCHES} backend batches; split the journey`,
		)
	while (start < options.locations.length - 1) {
		const end = Math.min(start + cap - 1, options.locations.length - 1)
		try {
			options.signal?.throwIfAborted()
			if (requestCount >= MAX_ROUTE_BATCHES)
				throw new Error(`Route exceeded ${MAX_ROUTE_BATCHES} backend requests; split the journey`)
			requestCount++
			const batch = await options.request(options.locations.slice(start, end + 1), options.signal)
			options.signal?.throwIfAborted()
			if (
				!Number.isFinite(batch.lengthKm) ||
				batch.lengthKm < 0 ||
				!Number.isFinite(batch.durationMin) ||
				batch.durationMin < 0
			)
				throw new Error('Valhalla returned an invalid route summary')
			if (!appendRouteCoordinates(coordinates, batch.coordinates)) {
				failure = {
					fromIndex: start,
					toIndex: end,
					code: 'discontinuous_geometry',
					message:
						'Route geometry is missing or batch endpoints do not meet; no connecting line was invented.',
				}
				break
			}
			segments.push({
				type: 'Feature',
				properties: {
					source: 'valhalla',
					profile: options.profile,
					fromWaypointIndex: start,
					toWaypointIndex: end,
					lengthKm: batch.lengthKm,
					durationMin: batch.durationMin,
				},
				geometry: { type: 'LineString', coordinates: batch.coordinates },
			})
			lengthKm += batch.lengthKm
			durationMin += batch.durationMin
			completedWaypoints = end + 1
			start = end // adjacent requests share the exact boundary waypoint
		} catch (error) {
			// Retry only an explicit first-request error 150 containing a smaller proven cap.
			if (
				start === 0 &&
				!retriedLimit &&
				error instanceof ValhallaRequestError &&
				error.maxLocations !== undefined &&
				error.maxLocations >= 2 &&
				error.maxLocations < cap
			) {
				cap = error.maxLocations
				retriedLimit = true
				if (batchCount() + requestCount <= MAX_ROUTE_BATCHES) continue
				failure = {
					fromIndex: start,
					toIndex: options.locations.length - 1,
					code: 'route_request_budget',
					message: `The proven backend limit requires more than ${MAX_ROUTE_BATCHES} requests; split the journey.`,
				}
				break
			}
			failure = {
				fromIndex: start,
				toIndex: end,
				code: options.signal?.aborted
					? options.signal.reason?.name === 'TimeoutError'
						? 'route_timeout'
						: 'route_cancelled'
					: 'batch_failed',
				message: error instanceof Error ? error.message : 'Valhalla route batch failed',
			}
			break
		}
	}
	const status = !failure ? 'complete' : segments.length ? 'partial' : 'failed'
	return {
		feature:
			status === 'complete'
				? {
						type: 'Feature',
						properties: {
							source: 'valhalla',
							profile: options.profile,
							lengthKm,
							durationMin,
							routeComplete: true,
						},
						geometry: { type: 'LineString', coordinates },
					}
				: null,
		segments: { type: 'FeatureCollection', features: segments },
		summary: { lengthKm, durationMin, profile: options.profile },
		routing: {
			status,
			requestedWaypoints: options.locations.length,
			completedWaypoints,
			backendWaypointLimit: cap,
			batchCount: batchCount(),
			completedBatches: segments.length,
			requestCount,
			...(failure ? { failure } : {}),
		},
	}
}
