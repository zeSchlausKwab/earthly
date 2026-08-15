import { afterEach, describe, expect, mock, test } from 'bun:test'
import { loadWorldLayer, resetWorldDataForTest } from './worldData'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
	resetWorldDataForTest()
})

describe('loadWorldLayer', () => {
	test('reports an HTML app-shell fallback as a missing bundled layer', async () => {
		globalThis.fetch = mock(
			async () =>
				new Response('<!DOCTYPE html><html></html>', {
					status: 200,
					headers: { 'content-type': 'text/html' },
				}),
		) as unknown as typeof fetch

		expect(loadWorldLayer('maritime_network')).rejects.toThrow(
			'maritime_network was served as text/html',
		)
	})
})
