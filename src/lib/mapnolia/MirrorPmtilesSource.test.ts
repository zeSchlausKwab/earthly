import { afterEach, describe, expect, test } from 'bun:test'
import { MirrorPmtilesSource } from './MirrorPmtilesSource'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('MirrorPmtilesSource', () => {
	test('fails over range reads and keeps the successful mirror preferred', async () => {
		const requests: string[] = []
		globalThis.fetch = (async (input, init) => {
			const url = String(input)
			requests.push(url)
			if (url.startsWith('https://one.example')) {
				return new Response('offline', { status: 503 })
			}
			expect(new Headers(init?.headers).get('range')).toBe('bytes=4-7')
			return new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 206,
				headers: { 'content-length': '4', etag: 'provider-specific' },
			})
		}) as typeof fetch

		const source = new MirrorPmtilesSource('a.pmtiles', [
			'https://one.example',
			'https://two.example',
		])
		const first = await source.getBytes(4, 4)
		expect([...new Uint8Array(first.data)]).toEqual([1, 2, 3, 4])
		expect(first.etag).toBeUndefined()
		expect(requests).toEqual(['https://one.example/a.pmtiles', 'https://two.example/a.pmtiles'])

		requests.length = 0
		await source.getBytes(4, 4)
		expect(requests).toEqual(['https://two.example/a.pmtiles'])
	})
})
