import { describe, expect, test } from 'bun:test'
import { getPublicBaseUrl } from './origin'

describe('getPublicBaseUrl', () => {
	test('does not trust a proxy-facing request origin when a public origin is configured', () => {
		const request = new Request('http://earthly.city/geoevent/naddr1example')
		expect(getPublicBaseUrl(request, 'https://earthly.city')).toBe('https://earthly.city')
	})

	test('normalises a trailing slash', () => {
		const request = new Request('http://localhost:3000/')
		expect(getPublicBaseUrl(request, 'https://earthly.city/')).toBe('https://earthly.city')
	})

	test('falls back to the request origin for local development', () => {
		const request = new Request('http://localhost:3000/geoevent/naddr1example')
		expect(getPublicBaseUrl(request)).toBe('http://localhost:3000')
	})
})
