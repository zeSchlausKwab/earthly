import { describe, expect, test } from 'bun:test'
import { migrateV1ToV2 } from './settingsStorage'

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
