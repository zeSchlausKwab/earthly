import { describe, expect, test } from 'bun:test'
// Wave-0 unit tests for SET-03 export/import escape hatch.
// Covers: reject malformed / unknown-provider / oversized (T-01-10 / V5),
// accept v1 (via migrateV1ToV2) + v2 (D-09), and serialize→parse→validate round-trip (D-08).
import { DEFAULT_CHAT_SETTINGS } from './store'
import type { ChatSettingsSnapshot } from './store'
import { MAX_IMPORT_BYTES, serializeSnapshot, validateImportedSnapshot } from './settingsExport'

function makeV2(): ChatSettingsSnapshot {
	return {
		provider: 'lmstudio',
		providerOverrides: {
			lmstudio: { baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-secret' },
			ollama: { baseUrl: '', apiKey: '' },
			custom: { baseUrl: 'http://example.test/v1', apiKey: 'custom-secret' },
		},
		selectedModel: 'some-model',
		toolsEnabled: false,
		safetyLevel: 3,
		promptProfile: 'compact',
		version: 2,
	}
}

describe('validateImportedSnapshot — rejection (T-01-10 / V5)', () => {
	test('rejects null', () => {
		expect(() => validateImportedSnapshot(null)).toThrow()
	})

	test('rejects an array', () => {
		expect(() => validateImportedSnapshot([])).toThrow()
	})

	test('rejects a non-object primitive', () => {
		expect(() => validateImportedSnapshot('not an object')).toThrow()
		expect(() => validateImportedSnapshot(42)).toThrow()
	})

	test('rejects an unknown provider', () => {
		expect(() =>
			validateImportedSnapshot({ provider: 'totally-not-a-provider', providerOverrides: {} }),
		).toThrow()
	})

	test('rejects an oversized payload', () => {
		const huge = {
			provider: 'custom',
			providerOverrides: {
				custom: { baseUrl: 'http://x', apiKey: 'a'.repeat(MAX_IMPORT_BYTES + 10) },
			},
		}
		expect(() => validateImportedSnapshot(huge)).toThrow()
	})
})

describe('validateImportedSnapshot — acceptance', () => {
	test('accepts a v2 payload and normalizes overrides', () => {
		const v2 = makeV2()
		const result = validateImportedSnapshot(JSON.parse(JSON.stringify(v2)))
		expect(result.provider).toBe('lmstudio')
		expect(result.providerOverrides.lmstudio).toEqual({
			baseUrl: 'http://localhost:1234/v1',
			apiKey: 'lm-secret',
		})
		expect(result.providerOverrides.custom).toEqual({
			baseUrl: 'http://example.test/v1',
			apiKey: 'custom-secret',
		})
		// missing override fields coerce to ''
		expect(result.providerOverrides.ollama).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.selectedModel).toBe('some-model')
		expect(result.toolsEnabled).toBe(false)
		expect(result.version).toBe(2)
	})

	test('coerces missing override fields to empty strings', () => {
		const result = validateImportedSnapshot({
			provider: 'lmstudio',
			providerOverrides: { lmstudio: { baseUrl: 'http://x' } },
		})
		expect(result.providerOverrides.lmstudio).toEqual({ baseUrl: 'http://x', apiKey: '' })
		expect(result.providerOverrides.ollama).toEqual({ baseUrl: '', apiKey: '' })
		expect(result.providerOverrides.custom).toEqual({ baseUrl: '', apiKey: '' })
	})

	test('accepts a v1 payload via migrateV1ToV2 (custom override populated)', () => {
		const v1 = {
			provider: 'custom',
			customEndpoint: 'http://legacy.test/v1',
			customApiKey: 'legacy-key',
			selectedModel: 'legacy-model',
			toolsEnabled: true,
		}
		const result = validateImportedSnapshot(v1)
		expect(result.provider).toBe('custom')
		expect(result.providerOverrides.custom).toEqual({
			baseUrl: 'http://legacy.test/v1',
			apiKey: 'legacy-key',
		})
		expect(result.selectedModel).toBe('legacy-model')
		expect(result.version).toBe(2)
	})

	test('coerces selectedModel to string|null and toolsEnabled to boolean (default true)', () => {
		const result = validateImportedSnapshot({
			provider: 'routstr',
			providerOverrides: {},
			selectedModel: undefined,
			toolsEnabled: 'nope',
		})
		expect(result.selectedModel).toBeNull()
		expect(result.toolsEnabled).toBe(true)
	})

	test('preserves a valid imported safetyLevel and normalizes an invalid one to 2 (SAFE-04 / T-05-11)', () => {
		for (const level of [1, 3] as const) {
			expect(
				validateImportedSnapshot({ provider: 'routstr', providerOverrides: {}, safetyLevel: level })
					.safetyLevel,
			).toBe(level)
		}
		for (const bad of [0, 5, '1', 'high', null, undefined]) {
			expect(
				validateImportedSnapshot({ provider: 'routstr', providerOverrides: {}, safetyLevel: bad })
					.safetyLevel,
			).toBe(2)
		}
	})
})

describe('serializeSnapshot — round-trip (D-08)', () => {
	test('serializeSnapshot returns pretty JSON', () => {
		const json = serializeSnapshot(makeV2())
		expect(json).toContain('\n')
		expect(JSON.parse(json)).toBeDefined()
	})

	test('serialize → JSON.parse → validate round-trips to the same effective config', () => {
		const snapshot = makeV2()
		const restored = validateImportedSnapshot(JSON.parse(serializeSnapshot(snapshot)))
		expect(restored).toEqual(snapshot)
	})

	test('default settings round-trip cleanly', () => {
		const restored = validateImportedSnapshot(JSON.parse(serializeSnapshot(DEFAULT_CHAT_SETTINGS)))
		expect(restored).toEqual(DEFAULT_CHAT_SETTINGS)
	})
})
