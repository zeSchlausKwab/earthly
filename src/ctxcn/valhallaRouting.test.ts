import { expect, test } from 'bun:test'
import { EarthlyGeoServerClient } from './EarthlyGeoServerClient'

test('cancelling a route while connecting rejects promptly and never sends a late request', async () => {
	let connected: (() => void) | undefined
	let calls = 0
	const connectionPromise = new Promise<void>((resolve) => {
		connected = resolve
	})
	// Exercise the real public method with an isolated, unresolved connection.
	const client = Object.assign(Object.create(EarthlyGeoServerClient.prototype), {
		connectionPromise,
		client: {
			callTool: async () => {
				calls++
				return { structuredContent: {} }
			},
		},
	}) as EarthlyGeoServerClient
	const controller = new AbortController()
	const pending = client.ValhallaRoute(
		[
			{ lat: 40, lon: 0 },
			{ lat: 40, lon: 1 },
		],
		undefined,
		undefined,
		undefined,
		{ signal: controller.signal },
	)
	controller.abort(new Error('Route cancelled while connecting'))
	await expect(pending).rejects.toThrow('Route cancelled while connecting')
	connected?.()
	await Promise.resolve()
	expect(calls).toBe(0)
})
