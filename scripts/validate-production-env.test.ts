import { describe, expect, test } from 'bun:test'
import { hexToBytes } from '@noble/hashes/utils.js'
import { getPublicKey } from 'nostr-tools/pure'
import { validateProductionEnv } from './validate-production-env'

const serverKey = '2'.repeat(64)
const cordnKey = '3'.repeat(64)

function validEnvironment(): Record<string, string> {
	return {
		NODE_ENV: 'production',
		RELAY_URL: 'wss://relay.earthly.city',
		SERVER_KEY: serverKey,
		SERVER_PUBKEY: getPublicKey(hexToBytes(serverKey)),
		CORDN_SERVER_PRIVATE_KEY: cordnKey,
		CORDN_SERVER_PUBKEY: getPublicKey(hexToBytes(cordnKey)),
		CORDN_RELAY_URLS: 'wss://relay.earthly.city',
		CORDN_STORAGE_BACKEND: 'sqlite',
		CORDN_NATIVE_SQLITE_PATH: 'data/cordn/cordn.sqlite',
		CORDN_SQLITE_SYNCHRONOUS: 'full',
		CORDN_MAX_AGE_DAYS: '30',
		CORDN_RATE_LIMIT_REFILL_PER_MINUTE: '500',
		CORDN_RATE_LIMIT_BURST: '160',
		CORDN_RATE_LIMIT_IDLE_TTL_SECONDS: '3600',
		CORDN_MAX_KEY_PACKAGES_PER_IDENTITY: '50',
		CORDN_MAX_LAST_RESORT_KEY_PACKAGES_PER_IDENTITY: '1',
		BLOSSOM_SERVER: 'https://blossom.earthly.city',
		MAPNOLIA_TRUSTED_PUBKEYS: '5'.repeat(64),
	}
}

describe('production environment validation', () => {
	test('accepts a persistent Cordn deployment whose public keys match', () => {
		const result = validateProductionEnv(validEnvironment())

		expect(result.errors).toEqual([])
		expect(result.cordnPubkey).toBe(getPublicKey(hexToBytes(cordnKey)))
	})

	test('rejects a Cordn public key mismatch', () => {
		const env = validEnvironment()
		env.CORDN_SERVER_PUBKEY = '4'.repeat(64)

		expect(validateProductionEnv(env).errors).toContain(
			'CORDN_SERVER_PUBKEY does not match its configured private key',
		)
	})

	test('rejects volatile storage, insecure relays, and an unsafe native database path', () => {
		const env = validEnvironment()
		env.CORDN_STORAGE_BACKEND = 'memory'
		env.CORDN_RELAY_URLS = 'ws://localhost:3334'
		env.CORDN_NATIVE_SQLITE_PATH = '../../cordn.sqlite'

		const errors = validateProductionEnv(env).errors.join('\n')
		expect(errors).toContain('must be sqlite')
		expect(errors).toContain('must use wss://')
		expect(errors).toContain('must not use a loopback relay')
		expect(errors).toContain('must be data/cordn/cordn.sqlite')
	})

	test('rejects Earthly development signing keys', () => {
		const env = validEnvironment()
		env.CORDN_SERVER_PRIVATE_KEY = `${'0'.repeat(63)}1`

		expect(validateProductionEnv(env).errors).toContain(
			"CORDN_SERVER_PRIVATE_KEY must not use Earthly's public development key",
		)
	})

	test('rejects missing or malformed trusted Mapnolia authors', () => {
		const missing = validEnvironment()
		missing.MAPNOLIA_TRUSTED_PUBKEYS = ''
		expect(validateProductionEnv(missing).errors.join('\n')).toContain(
			'MAPNOLIA_TRUSTED_PUBKEYS',
		)

		const malformed = validEnvironment()
		malformed.MAPNOLIA_TRUSTED_PUBKEYS = 'not-a-pubkey'
		expect(validateProductionEnv(malformed).errors.join('\n')).toContain(
			'MAPNOLIA_TRUSTED_PUBKEYS',
		)
	})
})
