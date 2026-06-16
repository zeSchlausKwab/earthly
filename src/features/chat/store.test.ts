import { beforeEach, describe, expect, test } from 'bun:test'
import { BUILTIN_PROVIDERS } from './routstr'
import { DEFAULT_CHAT_SETTINGS, chatStorePartialize, resolveProvider, useChatStore } from './store'
import type { ProviderOverrideMap } from './store'

function emptyOverrides(): ProviderOverrideMap {
	return {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	}
}

describe('resolveProvider', () => {
	test('falls back to BUILTIN localhost default when override baseUrl is empty (D-03)', () => {
		const lm = resolveProvider('lmstudio', emptyOverrides())
		expect(lm.baseUrl).toBe(BUILTIN_PROVIDERS.lmstudio.baseUrl)
		expect(lm.baseUrl).toBe('http://localhost:1234/v1')

		const ollama = resolveProvider('ollama', emptyOverrides())
		expect(ollama.baseUrl).toBe(BUILTIN_PROVIDERS.ollama.baseUrl)
		expect(ollama.baseUrl).toBe('http://localhost:11434/v1')
	})

	test('uses the override baseUrl when non-empty', () => {
		const overrides = emptyOverrides()
		overrides.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: '' }
		const lm = resolveProvider('lmstudio', overrides)
		expect(lm.baseUrl).toBe('http://host:9999/v1')
	})

	test('attaches apiKey only when override apiKey is non-empty', () => {
		const withKey = emptyOverrides()
		withKey.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: 'secret' }
		expect(resolveProvider('lmstudio', withKey).apiKey).toBe('secret')

		expect(resolveProvider('lmstudio', emptyOverrides()).apiKey).toBeUndefined()
	})

	test('custom provider reads baseUrl + apiKey from its override', () => {
		const overrides = emptyOverrides()
		overrides.custom = { baseUrl: 'http://custom/v1', apiKey: 'ck' }
		const custom = resolveProvider('custom', overrides)
		expect(custom.type).toBe('custom')
		expect(custom.baseUrl).toBe('http://custom/v1')
		expect(custom.apiKey).toBe('ck')

		const customNoKey = resolveProvider('custom', emptyOverrides())
		expect(customNoKey.apiKey).toBeUndefined()
	})
})

describe('setProviderOverride', () => {
	beforeEach(() => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
	})

	test('preserves each per-type override across a provider switch (D-02)', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('lmstudio', { baseUrl: 'A' })
		state.setProviderOverride('ollama', { baseUrl: 'B' })
		state.setProvider('lmstudio')

		const after = useChatStore.getState().providerOverrides
		expect(after.lmstudio.baseUrl).toBe('A')
		expect(after.ollama.baseUrl).toBe('B')
	})

	test('immutably merges the patch into the existing override', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('custom', { baseUrl: 'http://c/v1' })
		state.setProviderOverride('custom', { apiKey: 'k' })
		const custom = useChatStore.getState().providerOverrides.custom
		expect(custom).toEqual({ baseUrl: 'http://c/v1', apiKey: 'k' })
	})
})

describe('persist partialize secret-exclusion (SC-1 / T-01-01)', () => {
	test('partialized state contains no apiKey/baseUrl/providerOverrides secret', () => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
		useChatStore.getState().setProviderOverride('lmstudio', { apiKey: 'secret' })

		const partialized = chatStorePartialize(useChatStore.getState())
		const serialized = JSON.stringify(partialized)

		expect(serialized).not.toContain('secret')
		expect(serialized).not.toContain('apiKey')
		expect(serialized).not.toContain('baseUrl')
		expect(serialized).not.toContain('providerOverrides')

		expect(Object.keys(partialized).sort()).toEqual(['activeChatId', 'chatSessions'])
	})
})

describe('DEFAULT_CHAT_SETTINGS', () => {
	test('seeds all three overrides empty and version 2', () => {
		expect(DEFAULT_CHAT_SETTINGS.version).toBe(2)
		expect(DEFAULT_CHAT_SETTINGS.providerOverrides).toEqual(emptyOverrides())
	})
})
