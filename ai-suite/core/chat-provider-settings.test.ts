import { describe, expect, test } from 'bun:test'
import { deterministicChatSettings, validateAiSuiteChatSettings } from './chat-provider-settings'

describe('AI-suite chat provider settings', () => {
	test('normalizes an imported v2 snapshot without requiring a committed secret', () => {
		const settings = validateAiSuiteChatSettings({
			provider: 'custom',
			providerOverrides: {
				custom: { baseUrl: 'https://example.invalid/v1', apiKey: 'redacted-test-value' },
			},
			selectedModel: 'example-model',
			toolsEnabled: true,
			version: 2,
		})
		expect(settings.safetyLevel).toBe(2)
		expect(settings.promptProfile).toBe('compact')
		expect(settings.providerOverrides.lmstudio).toEqual({ baseUrl: '', apiKey: '' })
	})

	test('builds a no-secret confirm-all deterministic provider snapshot', () => {
		const settings = deterministicChatSettings(
			'http://model.earthly.localhost/v1',
			'earthly-spatial-fixture',
		)
		expect(settings.provider).toBe('custom')
		expect(settings.providerOverrides.custom.apiKey).toBe('')
		expect(settings.safetyLevel).toBe(1)
		expect(settings.promptProfile).toBe('compact')
	})

	test('rejects a plaintext remote endpoint', () => {
		expect(() =>
			validateAiSuiteChatSettings({
				provider: 'custom',
				providerOverrides: { custom: { baseUrl: 'http://example.invalid/v1', apiKey: '' } },
				selectedModel: 'example-model',
			}),
		).toThrow('Remote custom live AI endpoints must use HTTPS.')
	})
})
