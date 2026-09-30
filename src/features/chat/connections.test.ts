import { afterEach, describe, expect, test } from 'bun:test'
import {
	connectionProvider,
	legacyConnections,
	normalizeEndpoint,
	type ChatConnection,
} from './connections'
import { normalizeChatSettings } from './settingsStorage'
import { DEFAULT_CHAT_SETTINGS, chatStorePartialize, useChatStore } from './store'
import { fetchModels, streamChatCompletion } from './routstr'

const originalFetch = globalThis.fetch
const originalState = useChatStore.getState()
afterEach(() => {
	globalThis.fetch = originalFetch
	useChatStore.setState(originalState)
})
const connection = (id: string, apiKey = id): ChatConnection => ({
	id,
	apiKey,
	name: id,
	presetId: 'openrouter',
	baseUrl: 'https://openrouter.ai/api/v1/',
	selectedModel: `model-${id}`,
})

describe('saved connections', () => {
	test('migrates each configured legacy endpoint and its credentials', () => {
		const legacy = {
			...DEFAULT_CHAT_SETTINGS,
			connections: undefined,
			provider: 'custom' as const,
			selectedModel: 'kimi-k3',
			providerOverrides: {
				custom: { baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'secret' },
				lmstudio: { baseUrl: 'http://localhost:1234/v1', apiKey: '' },
				ollama: { baseUrl: '', apiKey: '' },
			},
		}
		expect(legacyConnections(legacy).map((item) => item.presetId)).toEqual(['lmstudio', 'custom'])
		expect(legacyConnections(legacy)[1]).toMatchObject({
			apiKey: 'secret',
			selectedModel: 'kimi-k3',
		})
	})
	test('preserves two accounts at the same provider and rejects duplicate IDs', () => {
		const settings = normalizeChatSettings({
			...DEFAULT_CHAT_SETTINGS,
			connections: [connection('work'), connection('personal')],
			activeConnectionId: 'personal',
		})
		expect(settings.connections).toHaveLength(2)
		expect(settings.selectedModel).toBe('model-personal')
		expect(settings.providerOverrides.custom.apiKey).toBe('personal')
		expect(() =>
			normalizeChatSettings({ ...settings, connections: [connection('work'), connection('work')] }),
		).toThrow('Duplicate')
	})
	test('never downgrades a future settings schema', () => {
		expect(() => normalizeChatSettings({ ...DEFAULT_CHAT_SETTINGS, version: 4 })).toThrow(
			'Unsupported',
		)
	})
	test('rejects malformed v3 snapshots instead of replacing saved connections with defaults', () => {
		for (const value of [null, [], { version: 3 }, { version: 3, connections: 'invalid' }])
			expect(() => normalizeChatSettings(value)).toThrow()
	})
	test('normalizes endpoint paths and rejects URL credentials or query secrets', () => {
		expect(normalizeEndpoint(' https://api.z.ai/api/paas/v4/ ')).toBe(
			'https://api.z.ai/api/paas/v4',
		)
		for (const url of [
			'ftp://server',
			'https://user:key@server/v1',
			'https://server/v1?key=secret',
			'https://server/#x',
		])
			expect(() => normalizeEndpoint(url)).toThrow()
	})
	test('funded Routstr keys bypass wallet spending', () => {
		expect(connectionProvider({ ...connection('paid'), presetId: 'routstr' }).requiresPayment).toBe(
			false,
		)
		expect(
			connectionProvider({ ...connection('wallet', ''), presetId: 'routstr' }).requiresPayment,
		).toBe(true)
	})
	test('selection, model preferences, deletion and persistence exclude secrets', async () => {
		globalThis.fetch = (async () =>
			Response.json({
				data: [{ id: 'model-work' }, { id: 'model-personal' }],
			})) as unknown as typeof fetch
		useChatStore.getState().hydrateSettings({
			...DEFAULT_CHAT_SETTINGS,
			connections: [connection('work'), connection('personal')],
			activeConnectionId: 'work',
		})
		useChatStore.getState().selectConnection('personal')
		await useChatStore.getState().loadModels()
		expect(useChatStore.getState().selectedModel).toBe('model-personal')
		useChatStore.getState().setSelectedModel('manual-model')
		useChatStore.getState().selectConnection('work')
		useChatStore.getState().selectConnection('personal')
		expect(useChatStore.getState().selectedModel).toBe('manual-model')
		expect(JSON.stringify(chatStorePartialize(useChatStore.getState()))).not.toContain('apiKey')
		expect(JSON.stringify(chatStorePartialize(useChatStore.getState()))).not.toContain(
			'openrouter.ai',
		)
		useChatStore.getState().deleteConnection('personal')
		expect(useChatStore.getState().activeConnectionId).toBe('work')
		useChatStore.getState().deleteConnection('work')
		expect(useChatStore.getState().connections).toEqual([])
		expect(useChatStore.getState().activeConnectionId).toBeNull()
		expect(useChatStore.getState().providerOverrides.custom.apiKey).toBe('')
		await Promise.resolve()
	})
	test('keeps OpenRouter dollar prices and tool metadata distinct from sats', async () => {
		globalThis.fetch = (async () =>
			Response.json({
				data: [
					{
						id: 'a',
						pricing: { prompt: '0.0000025', completion: '0.00001' },
						supported_parameters: ['tools'],
						context_length: 200000,
					},
				],
			})) as unknown as typeof fetch
		const [model] = await fetchModels(connectionProvider(connection('work')))
		expect(model?.pricing).toMatchObject({ input: 2.5, output: 10, currency: 'USD' })
		expect(model?.supportsTools).toBe(true)
	})
	test('does not offer non-chat OpenAI endpoints as default chat models', async () => {
		globalThis.fetch = (async () =>
			Response.json({
				data: [
					{ id: 'text-embedding-3-large' },
					{ id: 'gpt-image-1' },
					{ id: 'gpt-realtime' },
					{ id: 'sora-2' },
					{ id: 'gpt-chat-latest' },
				],
			})) as unknown as typeof fetch
		const models = await fetchModels(
			connectionProvider({ ...connection('openai'), presetId: 'openai' }),
		)
		expect(models.map((model) => model.id)).toEqual(['gpt-chat-latest'])
	})
	test('streamed provider errors do not become successful empty completions', async () => {
		globalThis.fetch = (async () =>
			new Response('data: {"error":{"message":"quota exceeded"}}\n\n')) as unknown as typeof fetch
		let completed = false
		let error = ''
		await streamChatCompletion(
			{ model: 'a', messages: [] },
			{
				onToken() {},
				onComplete() {
					completed = true
				},
				onError(value) {
					error = value.message
				},
			},
			connectionProvider(connection('work')),
		)
		expect(completed).toBe(false)
		expect(error).toBe('quota exceeded')
	})
})

test('preserves opaque Gemini tool signatures when assembling streamed tool calls', async () => {
	const extra = { google: { thought_signature: 'opaque-signature' } }
	globalThis.fetch = (async () =>
		new Response(
			`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'lookup', arguments: '{}' }, extra_content: extra }] } }] })}\n\ndata: [DONE]\n\n`,
		)) as unknown as typeof fetch
	let tools: unknown
	await streamChatCompletion(
		{ model: 'gemini', messages: [] },
		{
			onToken() {},
			onComplete() {},
			onToolCall(calls) {
				tools = calls
			},
			onError(error) {
				throw error
			},
		},
		connectionProvider(connection('google')),
	)
	expect(tools).toEqual([
		{
			id: 'call',
			type: 'function',
			function: { name: 'lookup', arguments: '{}' },
			extra_content: extra,
		},
	])
})
