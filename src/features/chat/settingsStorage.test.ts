import { describe, expect, test } from 'bun:test'
import {
	loadEncryptedChatSettings,
	migrateV1ToV2,
	saveEncryptedChatSettings,
} from './settingsStorage'

describe('migrateV1ToV2', () => {
	test('folds a flat v1 payload into providerOverrides.custom (D-05)', () => {
		const v1 = {
			provider: 'custom' as const,
			customEndpoint: 'http://x/v1',
			customApiKey: 'k',
			selectedModel: 'm',
			toolsEnabled: false,
		}

		const result = migrateV1ToV2(v1)

		expect(result.provider).toBe('custom')
		expect(result.providerOverrides.custom).toEqual({ baseUrl: 'http://x/v1', apiKey: 'k' })
		expect(result.providerOverrides.lmstudio).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.providerOverrides.ollama).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.selectedModel).toBe('m')
		expect(result.toolsEnabled).toBe(false)
		expect(result.version).toBe(2)
	})

	test('is idempotent on an already-v2 payload', () => {
		const v2 = {
			provider: 'lmstudio' as const,
			providerOverrides: {
				lmstudio: { baseUrl: 'http://host:9999/v1', apiKey: 'a' },
				ollama: { baseUrl: '', apiKey: '' },
				custom: { baseUrl: '', apiKey: '' },
			},
			selectedModel: 'foo',
			toolsEnabled: true,
			version: 2 as const,
		}

		const once = migrateV1ToV2(v2)
		const twice = migrateV1ToV2(once)

		expect(once).toEqual(twice)
		expect(once.provider).toBe('lmstudio')
		expect(once.providerOverrides.lmstudio).toEqual({ baseUrl: 'http://host:9999/v1', apiKey: 'a' })
		expect(once.version).toBe(2)
	})

	test('returns DEFAULT-equivalent overrides for a garbage/empty payload without throwing', () => {
		for (const garbage of [null, undefined, 42, 'nope', {}, []]) {
			const result = migrateV1ToV2(garbage)
			expect(result.providerOverrides.lmstudio).toEqual({ baseUrl: '', apiKey: '' })
			expect(result.providerOverrides.ollama).toEqual({ baseUrl: '', apiKey: '' })
			expect(result.providerOverrides.custom).toEqual({ baseUrl: '', apiKey: '' })
			expect(result.provider).toBe('routstr')
			expect(result.selectedModel).toBeNull()
			expect(result.toolsEnabled).toBe(true)
			expect(result.version).toBe(2)
		}
	})

	test('tolerates a v2 payload with malformed override fields', () => {
		const result = migrateV1ToV2({
			provider: 'ollama',
			providerOverrides: {
				lmstudio: { baseUrl: 123, apiKey: null },
				ollama: 'not-an-object',
			},
			selectedModel: null,
			toolsEnabled: true,
		})

		expect(result.providerOverrides.lmstudio).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.providerOverrides.ollama).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.providerOverrides.custom).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.provider).toBe('ollama')
	})
})

describe('migrateV1ToV2 — safetyLevel (SAFE-04 / D-09 / T-05-11)', () => {
	// (a) a v2 envelope WITHOUT safetyLevel hydrates to the safe default 2, never a decrypt failure.
	test('defaults a missing safetyLevel to 2 (v2 branch)', () => {
		const result = migrateV1ToV2({
			provider: 'ollama',
			providerOverrides: {
				lmstudio: { baseUrl: '', apiKey: '' },
				ollama: { baseUrl: '', apiKey: '' },
				custom: { baseUrl: '', apiKey: '' },
			},
			selectedModel: null,
			toolsEnabled: true,
		})

		expect(result.safetyLevel).toBe(2)
	})

	// flat-v1 branch carries the default too.
	test('defaults safetyLevel to 2 on a flat v1 payload', () => {
		const result = migrateV1ToV2({
			provider: 'custom',
			customEndpoint: 'http://x/v1',
			customApiKey: 'k',
			selectedModel: 'm',
			toolsEnabled: false,
		})

		expect(result.safetyLevel).toBe(2)
	})

	// not-a-record branch carries the default too.
	test('defaults safetyLevel to 2 on a garbage payload', () => {
		for (const garbage of [null, undefined, 42, 'nope', {}, []]) {
			expect(migrateV1ToV2(garbage).safetyLevel).toBe(2)
		}
	})

	// (b) an out-of-range / wrong-type safetyLevel normalizes to 2 (T-05-11 tamper guard).
	test('normalizes an invalid safetyLevel to 2', () => {
		for (const bad of [0, 5, -1, 2.5, '1', 'high', null, true, {}]) {
			const result = migrateV1ToV2({
				provider: 'routstr',
				providerOverrides: {
					lmstudio: { baseUrl: '', apiKey: '' },
					ollama: { baseUrl: '', apiKey: '' },
					custom: { baseUrl: '', apiKey: '' },
				},
				selectedModel: null,
				toolsEnabled: true,
				safetyLevel: bad,
			})
			expect(result.safetyLevel).toBe(2)
		}
	})

	// (c) a valid 1 or 3 is preserved through migration.
	test('preserves a valid safetyLevel of 1 or 3', () => {
		for (const level of [1, 3] as const) {
			const result = migrateV1ToV2({
				provider: 'routstr',
				providerOverrides: {
					lmstudio: { baseUrl: '', apiKey: '' },
					ollama: { baseUrl: '', apiKey: '' },
					custom: { baseUrl: '', apiKey: '' },
				},
				selectedModel: null,
				toolsEnabled: true,
				safetyLevel: level,
			})
			expect(result.safetyLevel).toBe(level)
		}
	})
})

describe('migrateV1ToV2 — prompt profile', () => {
	test('defaults old snapshots to guided legacy and preserves an explicit compact cohort', () => {
		expect(migrateV1ToV2({}).promptProfile).toBe('legacy')
		expect(migrateV1ToV2({ providerOverrides: {}, promptProfile: 'legacy' }).promptProfile).toBe(
			'legacy',
		)
		expect(migrateV1ToV2({ providerOverrides: {}, promptProfile: 'compact' }).promptProfile).toBe(
			'compact',
		)
		expect(migrateV1ToV2({ providerOverrides: {}, promptProfile: 'unknown' }).promptProfile).toBe(
			'legacy',
		)
	})
})

describe('saveEncryptedChatSettings → loadEncryptedChatSettings round-trip (SAFE-04)', () => {
	// (d) a save→load encrypt→decrypt round-trip preserves the set safetyLevel.
	// A minimal in-memory localStorage + identity-cipher signer keeps this headless.
	function installFakeWindow(): void {
		const store = new Map<string, string>()
		const localStorage = {
			getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
			setItem: (key: string, value: string) => {
				store.set(key, value)
			},
			removeItem: (key: string) => {
				store.delete(key)
			},
		}
		;(globalThis as unknown as { window: unknown }).window = { localStorage }
	}

	function clearFakeWindow(): void {
		;(globalThis as unknown as { window?: unknown }).window = undefined
	}

	// Identity nip44 "cipher" — encrypt/decrypt are pass-through so the round-trip exercises the
	// envelope + migrate path without real crypto.
	function makeFakeSigner() {
		return {
			nip44: {
				encrypt: async (_pubkey: string, plaintext: string) => plaintext,
				decrypt: async (_pubkey: string, ciphertext: string) => ciphertext,
			},
		}
	}

	test('preserves safetyLevel through a save→load round-trip', async () => {
		installFakeWindow()
		try {
			const signer = makeFakeSigner()
			const pubkey = 'npub-test'
			for (const level of [1, 2, 3] as const) {
				await saveEncryptedChatSettings(signer as never, pubkey, {
					provider: 'routstr',
					providerOverrides: {
						lmstudio: { baseUrl: '', apiKey: '' },
						ollama: { baseUrl: '', apiKey: '' },
						custom: { baseUrl: '', apiKey: '' },
					},
					selectedModel: null,
					toolsEnabled: true,
					safetyLevel: level,
					promptProfile: 'compact',
				})

				const loaded = await loadEncryptedChatSettings(signer as never, pubkey)
				expect(loaded?.safetyLevel).toBe(level)
			}
		} finally {
			clearFakeWindow()
		}
	})
})
