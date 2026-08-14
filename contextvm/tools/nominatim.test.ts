import { afterEach, describe, expect, test } from 'bun:test'
import {
	NominatimRequestError,
	resetNominatimRequestStateForTests,
	searchLocation,
} from './nominatim'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
	resetNominatimRequestStateForTests(0)
})

function result(name: string) {
	return {
		place_id: 1,
		display_name: name,
		lat: '41.9',
		lon: '12.5',
		type: 'city',
		class: 'place',
	}
}

describe('Nominatim request coordination', () => {
	resetNominatimRequestStateForTests(0)
	test('coalesces concurrent identical searches and caches the response', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls += 1
			return Response.json([result('Rome')])
		}) as unknown as typeof fetch

		const [first, second] = await Promise.all([
			searchLocation('Rome', 5),
			searchLocation('Rome', 5),
		])
		const cached = await searchLocation('Rome', 5)

		expect(calls).toBe(1)
		expect(first.results[0]?.displayName).toBe('Rome')
		expect(second).toEqual(first)
		expect(cached).toEqual(first)
	})

	test('retries retryable 429 responses and respects Retry-After', async () => {
		let calls = 0
		globalThis.fetch = (async () => {
			calls += 1
			return calls === 1
				? new Response('', { status: 429, headers: { 'retry-after': '0' } })
				: Response.json([result('Berlin')])
		}) as unknown as typeof fetch

		const response = await searchLocation('Berlin')
		expect(calls).toBe(2)
		expect(response.results[0]?.displayName).toBe('Berlin')
	})

	test('surfaces a structured non-retryable failure', async () => {
		globalThis.fetch = (async () =>
			new Response('', { status: 400, statusText: 'Bad Request' })) as unknown as typeof fetch
		try {
			await searchLocation('bad')
			throw new Error('expected searchLocation to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(NominatimRequestError)
			expect(error).toMatchObject({
				code: 'nominatim_http_400',
				retryable: false,
				status: 400,
			})
		}
	})
})
