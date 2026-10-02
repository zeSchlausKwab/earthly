import { describe, expect, test } from 'bun:test'
import { appendRouteCoordinates, routeInOrder, ValhallaRequestError } from './valhallaRoute'

function locations(count: number) {
	return Array.from({ length: count }, (_, i) => ({ lat: 40, lon: i / 100 }))
}

function route(points: ReturnType<typeof locations>) {
	return {
		coordinates: points.map(({ lon, lat }) => [lon, lat] as [number, number]),
		lengthKm: points.length - 1,
		durationMin: 2 * (points.length - 1),
	}
}

describe('ordered backend-sized route batches', () => {
	test.each([2, 10, 11, 25, 100])(
		'preserves every waypoint and seam for %i inputs',
		async (count) => {
			const points = locations(count)
			const requests: (typeof points)[] = []
			const result = await routeInOrder({
				locations: points,
				profile: 'auto',
				backendCap: 10,
				request: async (batch) => {
					requests.push(batch)
					return route(batch)
				},
			})
			expect(requests.every((batch) => batch.length <= 10)).toBe(true)
			expect(requests.length).toBe(Math.ceil((count - 1) / 9))
			for (let i = 1; i < requests.length; i++)
				expect(requests[i]?.[0]).toEqual(requests[i - 1]?.at(-1))
			expect(result.feature?.geometry.coordinates).toEqual(route(points).coordinates)
			expect(result.routing).toMatchObject({
				status: 'complete',
				requestedWaypoints: count,
				completedWaypoints: count,
				completedBatches: requests.length,
			})
			expect(result.summary.lengthKm).toBe(count - 1)
		},
	)

	test('awaits each batch before starting the next', async () => {
		let active = false
		const result = await routeInOrder({
			locations: locations(25),
			profile: 'auto',
			backendCap: 10,
			request: async (batch) => {
				expect(active).toBe(false)
				active = true
				await Promise.resolve()
				active = false
				return route(batch)
			},
		})
		expect(result.routing.status).toBe('complete')
	})

	test('reports a failed middle batch and stops without inventing the remaining route', async () => {
		let calls = 0
		const result = await routeInOrder({
			locations: locations(25),
			profile: 'auto',
			backendCap: 10,
			request: async (batch) => {
				if (++calls === 2) throw new Error('No path could be found')
				return route(batch)
			},
		})
		expect(calls).toBe(2)
		expect(result.feature).toBeNull()
		expect(result.segments.features).toHaveLength(1)
		expect(result.routing).toMatchObject({
			status: 'partial',
			completedWaypoints: 10,
			completedBatches: 1,
			batchCount: 3,
			failure: { fromIndex: 9, toIndex: 18, code: 'batch_failed' },
		})
		expect(result.summary.lengthKm).toBe(9)
	})

	test('reports first-request failure as failed rather than a zero-length complete route', async () => {
		const result = await routeInOrder({
			locations: locations(2),
			profile: 'auto',
			backendCap: 10,
			request: async () => {
				throw new Error('unavailable')
			},
		})
		expect(result.routing.status).toBe('failed')
		expect(result.routing.completedWaypoints).toBe(0)
		expect(result.feature).toBeNull()
	})

	test('adapts once only to an explicit smaller backend cap before any successful batch', async () => {
		const sizes: number[] = []
		const result = await routeInOrder({
			locations: locations(25),
			profile: 'auto',
			backendCap: 20,
			request: async (batch) => {
				sizes.push(batch.length)
				if (sizes.length === 1) throw new ValhallaRequestError('Exceeded max locations: 10', 10)
				return route(batch)
			},
		})
		expect(sizes).toEqual([20, 10, 10, 7])
		expect(result.routing).toMatchObject({
			status: 'complete',
			backendWaypointLimit: 10,
			batchCount: 3,
		})
	})

	test('does not retry a generic routing failure or a cap error after partial success', async () => {
		let calls = 0
		const result = await routeInOrder({
			locations: locations(25),
			profile: 'truck',
			backendCap: 10,
			request: async (batch) => {
				if (++calls === 2) throw new ValhallaRequestError('limit', 5)
				return route(batch)
			},
		})
		expect(calls).toBe(2)
		expect(result.routing.status).toBe('partial')
		expect(result.routing.backendWaypointLimit).toBe(10)
	})

	test('never bridges independently snapped endpoints with a straight line', async () => {
		let calls = 0
		const result = await routeInOrder({
			locations: locations(11),
			profile: 'bicycle',
			backendCap: 10,
			request: async (batch) => {
				const response = route(batch)
				if (++calls === 2) response.coordinates[0] = [40, 40]
				return response
			},
		})
		expect(result.feature).toBeNull()
		expect(result.routing).toMatchObject({
			status: 'partial',
			completedBatches: 1,
			failure: { code: 'discontinuous_geometry' },
		})
	})

	test('does not dispatch later batches after cancellation or expose a complete route', async () => {
		const controller = new AbortController()
		let calls = 0
		const result = await routeInOrder({
			locations: locations(11),
			profile: 'auto',
			backendCap: 10,
			signal: controller.signal,
			request: async (batch) => {
				calls++
				controller.abort()
				return route(batch)
			},
		})
		expect(calls).toBe(1)
		expect(result.feature).toBeNull()
		expect(result.routing).toMatchObject({ status: 'failed', failure: { code: 'route_cancelled' } })
	})

	test('rejects invalid middle waypoints and excessive request budgets before networking', async () => {
		let called = false
		const request = async (points: ReturnType<typeof locations>) => {
			called = true
			return route(points)
		}
		await expect(
			routeInOrder({
				locations: [
					{ lat: 40, lon: 0 },
					{ lat: NaN, lon: 0 },
					{ lat: 40, lon: 1 },
				],
				profile: 'auto',
				backendCap: 10,
				request,
			}),
		).rejects.toThrow('locations[1]')
		await expect(
			routeInOrder({ locations: locations(100), profile: 'auto', backendCap: 2, request }),
		).rejects.toThrow('16 backend batches')
		expect(called).toBe(false)
	})

	test('counts the cap-discovery request against the total request budget', async () => {
		let calls = 0
		const result = await routeInOrder({
			locations: locations(17),
			profile: 'auto',
			backendCap: 20,
			request: async () => {
				calls++
				throw new ValhallaRequestError('limit', 2)
			},
		})
		expect(calls).toBe(1)
		expect(result.routing).toMatchObject({
			status: 'failed',
			requestCount: 1,
			failure: { code: 'route_request_budget' },
		})
	})

	test('distinguishes a total deadline from user cancellation', async () => {
		const controller = new AbortController()
		const result = await routeInOrder({
			locations: locations(2),
			profile: 'auto',
			backendCap: 10,
			signal: controller.signal,
			request: async (batch) => {
				controller.abort(new DOMException('Total routing deadline exceeded', 'TimeoutError'))
				return route(batch)
			},
		})
		expect(result.routing.failure?.code).toBe('route_timeout')
		expect(result.feature).toBeNull()
	})

	test('joins only endpoints within backend polyline precision', () => {
		const target: [number, number][] = [
			[0, 0],
			[1, 1],
		]
		expect(
			appendRouteCoordinates(target, [
				[1.0000001, 1],
				[2, 2],
			]),
		).toBe(true)
		expect(target).toEqual([
			[0, 0],
			[1, 1],
			[2, 2],
		])
		expect(
			appendRouteCoordinates(target, [
				[3, 3],
				[4, 4],
			]),
		).toBe(false)
		expect(target).toHaveLength(3)
	})
})
