import { describe, expect, test } from 'bun:test'
import {
	createMapletFeedConnector,
	MAPLET_FEED_MAX_BYTES,
	MAPLET_FEED_SOURCE_URL,
} from './maplet-feed'

const input = { feed: 'liveuamap-yemen' } as const

describe('fixed Maplet feed connector', () => {
	test('returns complete JSON without readability truncation, and never sends credentials', async () => {
		const payload = { first: { description: 'x'.repeat(90_000), points: [[1, 2, 3, 4]] } }
		let requested: { url: string; init: RequestInit } | undefined
		const connector = createMapletFeedConnector({
			now: () => 1_000,
			fetch: async (url, init) => { requested = { url, init }; return Response.json(payload) },
		})
		const result = await connector(input)
		expect(result.payload).toEqual(payload)
		expect(result).toMatchObject({ fetchedAt: '1970-01-01T00:00:01.000Z', capturedAt: null, cached: false })
		expect(requested?.url).toBe(MAPLET_FEED_SOURCE_URL)
		expect(requested?.init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual' })
		expect(new Headers(requested?.init.headers).has('cookie')).toBe(false)
		expect(new Headers(requested?.init.headers).has('authorization')).toBe(false)
	})

	test('coalesces concurrent requests and returns an isolated cached copy with original acquisition time', async () => {
		let currentTime = 1000
		let calls = 0
		let resolveFetch!: (value: Response) => void
		const connector = createMapletFeedConnector({ now: () => currentTime, fetch: () => {
			calls++
			return new Promise(resolve => { resolveFetch = resolve })
		} })
		const first = connector(input)
		const second = connector(input)
		resolveFetch(Response.json({ item: { id: 1 } }))
		const [a, b] = await Promise.all([first, second])
		expect(calls).toBe(1)
		a.payload.item = 'changed'
		expect(b.payload).toEqual({ item: { id: 1 } })
		currentTime = 2000
		const cached = await connector(input)
		expect(cached.cached).toBe(true)
		expect(cached.fetchedAt).toBe(b.fetchedAt)
		expect(cached.payload).toEqual({ item: { id: 1 } })
		currentTime = 62_000
		const next = connector(input)
		expect(calls).toBe(2)
		resolveFetch(Response.json({ item: { id: 2 } }))
		expect((await next).payload).toEqual({ item: { id: 2 } })
	})

	test('reports challenge responses without returning their HTML and briefly backs off', async () => {
		let calls = 0
		const connector = createMapletFeedConnector({ fetch: async () => {
			calls++
			return new Response('<html>Just a moment… Cloudflare cf-chl-sensitive</html>', { status: 403 })
		} })
		await expect(connector(input)).rejects.toMatchObject({ code: 'upstream_challenge', retryable: false })
		await expect(connector(input)).rejects.toThrow('captured sample')
		expect(calls).toBe(1)
	})

	test('recognizes challenge headers even if an upstream response has no body', async () => {
		const connector = createMapletFeedConnector({ fetch: async () => new Response('', { headers: { 'cf-mitigated': 'challenge' } }) })
		await expect(connector(input)).rejects.toMatchObject({ code: 'upstream_challenge' })
	})

	test('never follows a redirect to another resource', async () => {
		let calls = 0
		const connector = createMapletFeedConnector({ fetch: async () => {
			calls++
			return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
		} })
		await expect(connector(input)).rejects.toMatchObject({ code: 'redirect_denied' })
		expect(calls).toBe(1)
	})

	test('rejects advertised oversized data without parsing or returning a prefix', async () => {
		const connector = createMapletFeedConnector({ fetch: async () => new Response('{}', { headers: { 'content-length': String(MAPLET_FEED_MAX_BYTES + 1) } }) })
		await expect(connector(input)).rejects.toMatchObject({ code: 'response_too_large' })
	})

	test('enforces the byte cap on streamed data even without Content-Length', async () => {
		const connector = createMapletFeedConnector({ fetch: async () => new Response(new ReadableStream({ start(controller) {
			controller.enqueue(new Uint8Array(MAPLET_FEED_MAX_BYTES))
			controller.enqueue(new Uint8Array(1))
			controller.close()
		} })) })
		await expect(connector(input)).rejects.toMatchObject({ code: 'response_too_large' })
	})

	test.each([
		['not json', 'invalid_json'],
		['null', 'invalid_payload'],
		['[]', 'invalid_payload'],
	])('rejects unexpected response %s', async (body, code) => {
		const connector = createMapletFeedConnector({ fetch: async () => new Response(body) })
		await expect(connector(input)).rejects.toMatchObject({ code })
	})

	test('times out stalled requests and emits a useful retryable error', async () => {
		const connector = createMapletFeedConnector({ timeoutMs: 5, fetch: (_url, init) => new Promise((_resolve, reject) => {
			init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
		}) })
		await expect(connector(input)).rejects.toMatchObject({ code: 'timeout', retryable: true })
	})
})
