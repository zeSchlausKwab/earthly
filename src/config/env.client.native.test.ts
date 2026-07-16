import { afterEach, describe, expect, test } from 'bun:test'

const originalNodeEnv = process.env.NODE_ENV
const originalBlossomServer = process.env.BLOSSOM_SERVER
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')

afterEach(() => {
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = originalNodeEnv
	if (originalBlossomServer === undefined) delete process.env.BLOSSOM_SERVER
	else process.env.BLOSSOM_SERVER = originalBlossomServer
	if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
	else Reflect.deleteProperty(globalThis, 'location')
})

describe('native Blossom fallback', () => {
	test('does not expose a baked loopback server to the Android app', async () => {
		process.env.NODE_ENV = 'development'
		process.env.BLOSSOM_SERVER = 'http://localhost:3544'
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { hostname: 'tauri.localhost', protocol: 'tauri:' },
		})

		const { config } = await import(`./env.client.ts?native=${Date.now()}`)

		expect(config.blossomServer).toBe('https://blossom.earthly.city')
	})

	test('keeps the local Blossom server for local browser development', async () => {
		process.env.NODE_ENV = 'development'
		process.env.BLOSSOM_SERVER = 'http://localhost:3544'
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { hostname: 'localhost', protocol: 'http:' },
		})

		const { config } = await import(`./env.client.ts?local=${Date.now()}`)

		expect(config.blossomServer).toBe('http://localhost:3544')
	})

	test('does not expose a baked loopback server on a deployed web origin', async () => {
		process.env.NODE_ENV = 'production'
		process.env.BLOSSOM_SERVER = 'http://localhost:3544'
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { hostname: 'earthly.city', protocol: 'https:' },
		})

		const { config } = await import(`./env.client.ts?production=${Date.now()}`)

		expect(config.blossomServer).toBe('https://blossom.earthly.city')
	})
})
