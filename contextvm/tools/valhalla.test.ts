import { afterEach, describe, expect, test } from 'bun:test'
import { valhallaRoute } from './valhalla'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function response(points: Array<{ lat: number; lon: number }>, units = 'kilometers') {
	return { trip: { status: 0, units, summary: { length: 2, time: 120 },
		legs: points.slice(1).map((point, i) => ({ shape: { type: 'LineString',
			coordinates: [[points[i]!.lon, points[i]!.lat], [point.lon, point.lat]] } })) } }
}

describe('Valhalla route protocol', () => {
	test('decodes complete polyline6 geometry and rejects a truncated suffix', async () => {
		let shape = '??_ibE_ibE'
		globalThis.fetch = (async () => Response.json({ trip: { status: 0,
			summary: { length: 2, time: 120 }, legs: [{ shape }] } })) as unknown as typeof fetch
		const params = { locations: [{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0.1 }], baseUrl: 'https://routing.invalid' }
		const complete = await valhallaRoute(params)
		expect(complete.feature?.geometry.coordinates).toEqual([[0, 0], [0.1, 0.1]])
		shape += '_'
		const truncated = await valhallaRoute(params)
		expect(truncated.feature).toBeNull()
		expect(truncated.routing.failure?.message).toContain('truncated route polyline')
	})

	test('never filters invalid intermediate vertices into a straight shortcut', async () => {
		globalThis.fetch = (async () => Response.json({ trip: { status: 0,
			summary: { length: 2, time: 120 }, legs: [{ shape: { type: 'LineString',
				coordinates: [[0, 0], ['bad', 0.1], [1, 1]] } }] } })) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], baseUrl: 'https://routing.invalid' })
		expect(result.feature).toBeNull()
		expect(result.routing.failure?.message).toContain('invalid route vertex')
	})
	test('routes over the configured backend cap and accepts GeoJSON leg shapes', async () => {
		const sizes: number[] = []
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body)); sizes.push(payload.locations.length)
			return Response.json(response(payload.locations))
		}) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: Array.from({ length: 11 }, (_, i) => ({ lat: 40, lon: i })), baseUrl: 'https://routing.invalid/route' })
		expect(sizes).toEqual([10, 2])
		expect(result.feature?.geometry.coordinates).toHaveLength(11)
		expect(result.routing.status).toBe('complete')
	})

	test('honors an explicit error 150 cap and retries smaller ordered batches', async () => {
		const sizes: number[] = []
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body)); sizes.push(payload.locations.length)
			return sizes.length === 1 ? Response.json({ error_code: 150, error: 'Exceeded max locations: 5' }, { status: 400 }) : Response.json(response(payload.locations))
		}) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: Array.from({ length: 10 }, (_, i) => ({ lat: 40, lon: i })), baseUrl: 'https://routing.invalid' })
		expect(sizes).toEqual([10, 5, 5, 2])
		expect(result.routing.backendWaypointLimit).toBe(5)
		expect(result.routing.status).toBe('complete')
	})

	test('converts miles to kilometers without mislabeling the route summary', async () => {
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => Response.json(response(JSON.parse(String(init?.body)).locations, 'miles'))) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: [{ lat: 40, lon: 0 }, { lat: 40, lon: 1 }], units: 'miles', baseUrl: 'https://routing.invalid' })
		expect(result.summary.lengthKm).toBeCloseTo(3.218688)
		expect(result.summary.durationMin).toBe(2)
	})

	test('rejects missing waypoint legs and never skips a missing middle shape', async () => {
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			const data = response(JSON.parse(String(init?.body)).locations)
			data.trip.legs.splice(1, 1)
			return Response.json(data)
		}) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: [{ lat: 40, lon: 0 }, { lat: 40, lon: 1 }, { lat: 40, lon: 2 }], baseUrl: 'https://routing.invalid' })
		expect(result.feature).toBeNull()
		expect(result.routing.status).toBe('failed')
		expect(result.routing.failure?.message).toContain('missing waypoint legs')
	})

	test('an already-cancelled route does not contact the backend', async () => {
		let called = false
		globalThis.fetch = (async () => { called = true; return Response.json({}) }) as unknown as typeof fetch
		const result = await valhallaRoute({ locations: [{ lat: 40, lon: 0 }, { lat: 40, lon: 1 }], baseUrl: 'https://routing.invalid', signal: AbortSignal.abort() })
		expect(called).toBe(false)
		expect(result.routing.failure?.code).toBe('route_cancelled')
	})
})
