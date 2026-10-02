import { describe, expect, test } from 'bun:test'
import type { EarthlyGeoServerClient, ValhallaRouteOutput } from '@/ctxcn/EarthlyGeoServerClient'
import { executeValhallaRoute } from './valhalla-route'

function client(
	result: Record<string, unknown>,
	onCall?: (points: object[]) => void,
): Pick<EarthlyGeoServerClient, 'ValhallaRoute'> {
	return {
		ValhallaRoute: async (points) => {
			onCall?.(points)
			return { result } as unknown as ValhallaRouteOutput
		},
	}
}
const points = [
	{ lat: 40, lon: 0 },
	{ lat: 40, lon: 1 },
]
const feature = {
	type: 'Feature',
	properties: {},
	geometry: {
		type: 'LineString',
		coordinates: [
			[0, 40],
			[1, 40],
		],
	},
}

describe('chat and native road routing contract', () => {
	test('never drops an invalid intermediate waypoint', async () => {
		let called = false
		await expect(
			executeValhallaRoute(
				{ locations: [points[0], { lat: 'bad', lon: 0.5 }, points[1]] },
				client({}, () => {
					called = true
				}),
			),
		).rejects.toThrow('locations[1]')
		expect(called).toBe(false)
	})
	test.each(['partial', 'failed'])(
		'does not import a %s route even when a faulty backend includes geometry',
		async (status) => {
			await expect(
				executeValhallaRoute(
					{ locations: points, toEditor: true },
					client({ feature, routing: { status, failure: { message: 'No path' } } }),
				),
			).rejects.toMatchObject({ code: 'route_incomplete' })
		},
	)
	test('preserves partial routing diagnostics for read-only requests', async () => {
		const result = {
			feature: null,
			segments: { type: 'FeatureCollection', features: [feature] },
			routing: { status: 'partial', completedWaypoints: 10, requestedWaypoints: 25 },
		}
		expect(await executeValhallaRoute({ locations: points }, client(result))).toEqual(result)
	})
	test('only marks a successful complete route as network-derived', async () => {
		const result = await executeValhallaRoute(
			{ locations: points, toEditor: true },
			client({ feature, routing: { status: 'complete' } }),
		)
		expect((result.feature as GeoJSON.Feature).properties?.geometryPrecision).toBe(
			'network-derived',
		)
	})
	test('rejects cancellation after a remote response before it can reach authoring', async () => {
		const controller = new AbortController()
		await expect(
			executeValhallaRoute(
				{ locations: points, toEditor: true },
				client({ feature, routing: { status: 'complete' } }, () => controller.abort()),
				controller.signal,
			),
		).rejects.toThrow()
	})
})
