import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { LIVE_MAPPER_SOURCE_URL } from './liveMapper'
import { resolveMapletResource } from './sourceResource'

const originalFetch = globalThis.fetch
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
	globalThis.fetch = originalFetch
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
	else Reflect.deleteProperty(globalThis, 'window')
})

describe('Maplet resource grants', () => {
	test('explains native import alternatives before fetching a nonexistent bundled backend', async () => {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { __TAURI_INTERNALS__: {} },
		})
		const network = spyOn(globalThis, 'fetch').mockRejectedValue(
			new Error('Network must not be reached'),
		)
		await expect(
			resolveMapletResource(LIVE_MAPPER_SOURCE_URL, new AbortController().signal),
		).rejects.toThrow('choose a JSON file, paste JSON, or follow a published collection')
		expect(network).not.toHaveBeenCalled()
	})
	test.each([
		'https://example.com/data.json',
		`${LIVE_MAPPER_SOURCE_URL}&extra=true`,
		LIVE_MAPPER_SOURCE_URL.replace('https:', 'http:'),
		'https://127.0.0.1/private',
		'not-a-url',
	])('denies ungranted resource %s before any network request', async (url) => {
		const network = spyOn(globalThis, 'fetch').mockRejectedValue(
			new Error('Network must not be reached'),
		)
		await expect(resolveMapletResource(url, new AbortController().signal)).rejects.toThrow(
			'has not enabled this resource',
		)
		expect(network).not.toHaveBeenCalled()
	})

	test('acquires only through the same-origin connector and unwraps complete JSON bytes', async () => {
		const payload = { area: { id: 1, description: 'x'.repeat(70_000), points: [[1, 2, 3, 4]] } }
		const network = spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ result: { payload, fetchedAt: '2026-09-13T12:00:00.000Z' } }),
		)
		const controller = new AbortController()
		const blob = await resolveMapletResource(LIVE_MAPPER_SOURCE_URL, controller.signal)
		expect(blob.type.split(';')[0]).toBe('application/json')
		expect(JSON.parse(await blob.text())).toEqual(payload)
		expect(network).toHaveBeenCalledTimes(1)
		expect(network).toHaveBeenCalledWith('/api/maplets/liveuamap-yemen', {
			signal: controller.signal,
			credentials: 'omit',
			headers: { Accept: 'application/json' },
		})
	})

	test('surfaces an upstream challenge without returning data or falling back to a sample', async () => {
		const message =
			'Liveuamap requires a browser challenge. Use the captured sample or an authorized data endpoint.'
		const network = spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ error: { code: 'upstream_challenge', message } }, { status: 502 }),
		)
		await expect(
			resolveMapletResource(LIVE_MAPPER_SOURCE_URL, new AbortController().signal),
		).rejects.toThrow(message)
		expect(network).toHaveBeenCalledTimes(1)
	})

	test('explains a static frontend or outdated backend instead of parsing its HTML as data', async () => {
		spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('<!doctype html><title>Earthly</title>', {
				headers: { 'content-type': 'text/html' },
			}),
		)
		await expect(
			resolveMapletResource(LIVE_MAPPER_SOURCE_URL, new AbortController().signal),
		).rejects.toThrow('Run the updated Earthly web backend')
	})

	test('forwards runtime cancellation to the connector request', async () => {
		const controller = new AbortController()
		spyOn(globalThis, 'fetch').mockImplementation(
			Object.assign(
				(_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('Request aborted', 'AbortError')),
						)
					}),
				{ preconnect: originalFetch.preconnect },
			),
		)
		const pending = resolveMapletResource(LIVE_MAPPER_SOURCE_URL, controller.signal)
		controller.abort()
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
	})
})
