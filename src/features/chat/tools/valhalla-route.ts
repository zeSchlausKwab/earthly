import type { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { validateRouteLocations, type ValhallaLocation } from '@/lib/geo/valhallaRoute'
import { asFeatureObject, extractMcpToolResult, toFiniteNumber } from './helpers'

/** Shared by chat and native WebMCP through the ordinary tool registry. */
export async function executeValhallaRoute(
	args: Record<string, unknown>,
	client: Pick<EarthlyGeoServerClient, 'ValhallaRoute'>,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	const raw = Array.isArray(args.locations) ? args.locations : []
	const locations: ValhallaLocation[] = raw.map((location, index) => {
		if (!location || typeof location !== 'object')
			throw new Error(`locations[${index}] must contain valid latitude and longitude`)
		const lat = toFiniteNumber((location as Record<string, unknown>).lat)
		const lon = toFiniteNumber((location as Record<string, unknown>).lon)
		if (lat === undefined || lon === undefined)
			throw new Error(`locations[${index}] must contain valid latitude and longitude`)
		return { lat, lon }
	})
	validateRouteLocations(locations)
	signal?.throwIfAborted()
	const response = await client.ValhallaRoute(
		locations,
		typeof args.profile === 'string' ? args.profile : undefined,
		typeof args.units === 'string' ? args.units : undefined,
		typeof args.baseUrl === 'string' ? args.baseUrl : undefined,
		{ signal },
	)
	signal?.throwIfAborted()
	const result = extractMcpToolResult('valhalla_route', response)
	const routing = result.routing as
		| { status?: unknown; failure?: { message?: unknown } }
		| undefined
	const feature = !routing || routing.status === 'complete' ? asFeatureObject(result.feature) : null
	if (args.toEditor === true && routing && (routing.status !== 'complete' || !feature)) {
		throw Object.assign(
			new Error(
				`Route was ${String(routing.status)} and was not imported. ${String(routing.failure?.message ?? 'Request a complete route before importing.')}`,
			),
			{ code: 'route_incomplete', retryable: false },
		)
	}
	return {
		...result,
		...(routing && routing.status !== 'complete' ? { feature: null } : {}),
		...(feature
			? {
					feature: {
						...feature,
						properties: {
							...(feature.properties ?? {}),
							geometryPrecision: 'network-derived',
							mappingBasis: 'Valhalla route over the configured transport network',
						},
					},
				}
			: {}),
	}
}
