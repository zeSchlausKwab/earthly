import { describe, expect, test } from 'bun:test'
import { FRONTEND_ENV_KEYS, parseEnv } from './env.schema'

describe('frontend environment allow-list', () => {
	test('contains no private signing credentials', () => {
		expect(FRONTEND_ENV_KEYS).not.toContain('CLIENT_KEY' as never)
		expect(FRONTEND_ENV_KEYS).not.toContain('SERVER_KEY' as never)
		expect(FRONTEND_ENV_KEYS).not.toContain('APP_PRIVATE_KEY' as never)
		expect(FRONTEND_ENV_KEYS).not.toContain('PUBLIC_BASE_URL' as never)
		expect(FRONTEND_ENV_KEYS).toContain('MAPNOLIA_TRUSTED_PUBKEYS')
	})

	test('does not retain the retired shared client key', () => {
		const parsed = parseEnv({
			NODE_ENV: 'test',
			CLIENT_KEY: '4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c',
		})

		expect('CLIENT_KEY' in parsed).toBe(false)
	})

	test('rejects an invalid trusted Mapnolia author list', () => {
		expect(() =>
			parseEnv({ NODE_ENV: 'production', MAPNOLIA_TRUSTED_PUBKEYS: 'not-a-pubkey' }),
		).toThrow()
	})

	test('uses a trusted HTTPS public origin in production', () => {
		const parsed = parseEnv({ NODE_ENV: 'production' })
		expect(parsed.PUBLIC_BASE_URL).toBe('https://earthly.city')
		expect(() =>
			parseEnv({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'javascript:alert(1)' }),
		).toThrow()
	})
})
