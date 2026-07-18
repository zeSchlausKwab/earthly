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

	test('rechecks the native-local source before a previously successful mirror', async () => {
		const requests: string[] = []
		let localAvailable = false
		globalThis.fetch = (async (input) => {
			const url = String(input)
			requests.push(url)
			if (url.startsWith('http://127.0.0.1:17448')) {
				return localAvailable
					? new Response(new Uint8Array([9]), { status: 206 })
					: new Response('missing', { status: 404 })
			}
			return new Response(new Uint8Array([1]), { status: 206 })
		}) as typeof fetch

		const source = new MirrorPmtilesSource(
			'a.pmtiles',
			['https://mirror.example'],
			'http://127.0.0.1:17448/a',
		)
		expect([...new Uint8Array((await source.getBytes(0, 1)).data)]).toEqual([1])

		localAvailable = true
		requests.length = 0
		expect([...new Uint8Array((await source.getBytes(0, 1)).data)]).toEqual([9])
		expect(requests).toEqual(['http://127.0.0.1:17448/a'])
	})

	test('refreshes native authorization and endpoint after a local read failure', async () => {
		let accessRequests = 0
		const requests: string[] = []
		globalThis.fetch = (async (input, init) => {
			const url = String(input)
			requests.push(url)
			expect(new Headers(init?.headers).get('authorization')).toBe('Nostr signed-access')
			return url.includes('stale')
				? new Response('gone', { status: 404 })
				: new Response(new Uint8Array([7]), { status: 206 })
		}) as typeof fetch

		const source = new MirrorPmtilesSource('a.pmtiles', ['https://mirror.example'], async () => {
			accessRequests += 1
			return {
				url: `http://127.0.0.1:17448/${accessRequests === 1 ? 'stale' : 'current'}`,
				authorization: 'Nostr signed-access',
				expiresAt: Math.floor(Date.now() / 1_000) + 300,
			}
		})

		expect([...new Uint8Array((await source.getBytes(0, 1)).data)]).toEqual([7])
		expect(accessRequests).toBe(2)
		expect(requests).toEqual(['http://127.0.0.1:17448/stale', 'http://127.0.0.1:17448/current'])
	})

	test('falls through after one missing-local read when the endpoint did not change', async () => {
		let accessRequests = 0
		const requests: string[] = []
		globalThis.fetch = (async (input) => {
			const url = String(input)
			requests.push(url)
			return url.includes('127.0.0.1')
				? new Response('missing', { status: 404 })
				: new Response(new Uint8Array([5]), { status: 206 })
		}) as typeof fetch

		const source = new MirrorPmtilesSource('a.pmtiles', ['https://mirror.example'], async () => {
			accessRequests += 1
			return {
				url: 'http://127.0.0.1:17448/a',
				authorization: `Nostr signed-access-${accessRequests}`,
				expiresAt: Math.floor(Date.now() / 1_000) + 300,
			}
		})

		expect([...new Uint8Array((await source.getBytes(0, 1)).data)]).toEqual([5])
		expect([...new Uint8Array((await source.getBytes(1, 1)).data)]).toEqual([5])
		expect(requests).toEqual([
			'http://127.0.0.1:17448/a',
			'https://mirror.example/a.pmtiles',
			'https://mirror.example/a.pmtiles',
		])
		expect(accessRequests).toBe(2)
	})
})
