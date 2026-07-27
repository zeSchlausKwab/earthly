import { describe, expect, test } from 'bun:test'
import { earthlyPublicUrl } from './publicUrl'

describe('public Earthly URLs', () => {
	test('replaces a native WebView origin with the public HTTPS origin', () => {
		expect(
			earthlyPublicUrl('/context/naddr1example', {
				currentUrl: 'tauri://localhost/datasets',
				isNative: true,
			}),
		).toBe('https://earthly.city/context/naddr1example')
		expect(
			earthlyPublicUrl('/story/naddr1example', {
				currentUrl: 'http://tauri.localhost/stories',
				isNative: true,
			}),
		).toBe('https://earthly.city/story/naddr1example')
	})

	test('keeps the path, query, and hash when sharing the current native view', () => {
		expect(
			earthlyPublicUrl(undefined, {
				currentUrl: 'tauri://localhost/?ms=dataset%3Aone#details',
				isNative: true,
			}),
		).toBe('https://earthly.city/?ms=dataset%3Aone#details')
	})

	test('preserves a browser origin for local development', () => {
		expect(
			earthlyPublicUrl('/geoevent/naddr1example', {
				currentUrl: 'http://localhost:3000/datasets',
				isNative: false,
			}),
		).toBe('http://localhost:3000/geoevent/naddr1example')
	})
})
