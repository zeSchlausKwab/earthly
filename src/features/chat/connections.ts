import type { ChatSettingsSnapshot } from './store'
import { BUILTIN_PROVIDERS, type ProviderConfig, type ProviderType } from './routstr'

export interface ConnectionPreset {
	id: string
	name: string
	baseUrl: string
	provider: ProviderType
	keyRequired: boolean
	docs: string
	hint?: string
	model?: string
}

// Verified against official documentation on 2026-09-30. Models are discovered live;
// avoid frozen model lists that silently age out as vendors retire models.
export const CONNECTION_PRESETS: readonly ConnectionPreset[] = [
	{
		id: 'routstr',
		name: 'Routstr',
		baseUrl: 'https://api.routstr.com/v1',
		provider: 'routstr',
		keyRequired: false,
		docs: 'https://docs.routstr.com/',
		hint: 'Pay with your NIP-60 wallet, or enter a funded Routstr API key.',
	},
	{
		id: 'openrouter',
		name: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://openrouter.ai/docs/quickstart',
	},
	{
		id: 'kimi',
		name: 'Kimi / Moonshot',
		baseUrl: 'https://api.moonshot.ai/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://platform.moonshot.ai/docs',
		hint: 'Use a Moonshot Platform API key. For a China-region key, use api.moonshot.cn.',
	},
	{
		id: 'glm',
		name: 'Z.ai / GLM',
		baseUrl: 'https://api.z.ai/api/paas/v4',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://docs.z.ai/guides/overview/quick-start',
		model: 'glm-5.3',
		hint: 'Use a standard API key; Coding Plan credentials use a separate endpoint.',
	},
	{
		id: 'deepseek',
		name: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://api-docs.deepseek.com/',
	},
	{
		id: 'openai',
		name: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://platform.openai.com/docs/api-reference/chat',
	},
	{
		id: 'anthropic',
		name: 'Anthropic / Claude',
		baseUrl: 'https://api.anthropic.com/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk',
		hint: 'Uses Claude’s OpenAI compatibility API for chat, streaming, and tools.',
	},
	{
		id: 'gemini',
		name: 'Google / Gemini',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://ai.google.dev/gemini-api/docs/openai',
	},
	{
		id: 'xai',
		name: 'xAI / Grok',
		baseUrl: 'https://api.x.ai/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://docs.x.ai/developers/rest-api-reference/inference',
	},
	{
		id: 'mistral',
		name: 'Mistral',
		baseUrl: 'https://api.mistral.ai/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://docs.mistral.ai/resources/migration-guides',
	},
	{
		id: 'groq',
		name: 'Groq',
		baseUrl: 'https://api.groq.com/openai/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://console.groq.com/docs/overview',
	},
	{
		id: 'together',
		name: 'Together AI',
		baseUrl: 'https://api.together.xyz/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://www.together.ai/serverless-inference',
	},
	{
		id: 'fireworks',
		name: 'Fireworks AI',
		baseUrl: 'https://api.fireworks.ai/inference/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://docs.fireworks.ai/',
	},
	{
		id: 'cerebras',
		name: 'Cerebras',
		baseUrl: 'https://api.cerebras.ai/v1',
		provider: 'custom',
		keyRequired: true,
		docs: 'https://inference-docs.cerebras.ai/quickstart',
	},
	{
		id: 'lmstudio',
		name: 'LM Studio',
		baseUrl: 'http://localhost:1234/v1',
		provider: 'lmstudio',
		keyRequired: false,
		docs: 'https://lmstudio.ai/docs/developer/openai-compat',
		hint: 'Start the local server and enable CORS. On a phone, use your computer’s LAN address.',
	},
	{
		id: 'ollama',
		name: 'Ollama',
		baseUrl: 'http://localhost:11434/v1',
		provider: 'ollama',
		keyRequired: false,
		docs: 'https://docs.ollama.com/api/openai-compatibility',
		hint: 'Allow Earthly’s origin with OLLAMA_ORIGINS. On a phone, localhost refers to the phone.',
	},
	{
		id: 'custom',
		name: 'Custom endpoint',
		baseUrl: '',
		provider: 'custom',
		keyRequired: false,
		docs: '',
		hint: 'Any OpenAI-compatible Chat Completions API. Include its API base path.',
	},
]

export interface ChatConnection {
	id: string
	name: string
	presetId: string
	baseUrl: string
	apiKey: string
	selectedModel: string | null
}

export function getConnectionPreset(id: string): ConnectionPreset {
	const preset =
		CONNECTION_PRESETS.find((preset) => preset.id === id) ??
		CONNECTION_PRESETS.find((preset) => preset.id === 'custom')
	if (!preset) throw new Error('Missing custom connection preset')
	return preset
}

export function normalizeEndpoint(value: string): string {
	let url: URL
	try {
		url = new URL(value.trim())
	} catch {
		throw new Error('Enter a valid HTTP or HTTPS endpoint URL')
	}
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			'Use an HTTP or HTTPS base URL without credentials, query parameters, or a fragment',
		)
	}
	return url.toString().replace(/\/+$/, '')
}

export function validateConnection(value: unknown): ChatConnection {
	if (!value || typeof value !== 'object') throw new Error('Invalid connection')
	const row = value as Record<string, unknown>
	for (const key of ['id', 'name', 'presetId', 'baseUrl', 'apiKey']) {
		if (typeof row[key] !== 'string') throw new Error(`Invalid connection ${key}`)
	}
	if (!(row.id as string).trim() || !(row.name as string).trim())
		throw new Error('Give the connection a name')
	if (!CONNECTION_PRESETS.some((preset) => preset.id === row.presetId))
		throw new Error('Unknown connection provider')
	return {
		id: row.id as string,
		name: (row.name as string).trim(),
		presetId: row.presetId as string,
		baseUrl: normalizeEndpoint(row.baseUrl as string),
		apiKey: (row.apiKey as string).trim(),
		selectedModel:
			typeof row.selectedModel === 'string' && row.selectedModel.trim()
				? row.selectedModel.trim()
				: null,
	}
}

export function connectionProvider(connection: ChatConnection): ProviderConfig {
	const preset = getConnectionPreset(connection.presetId)
	return {
		type: preset.provider,
		name: connection.name,
		baseUrl: normalizeEndpoint(connection.baseUrl),
		apiKey: connection.apiKey || undefined,
		requiresPayment: preset.provider === 'routstr' && !connection.apiKey,
		presetId: preset.id,
	}
}

/** Migrate every configured legacy endpoint, not just the currently selected one. */
export function legacyConnections(settings: ChatSettingsSnapshot): ChatConnection[] {
	const types: ProviderType[] = ['routstr', 'lmstudio', 'ollama', 'custom']
	return types.flatMap((type) => {
		const override = type === 'routstr' ? undefined : settings.providerOverrides[type]
		if (type !== settings.provider && !override?.baseUrl && !override?.apiKey) return []
		const baseUrl = override?.baseUrl || (type === 'custom' ? '' : BUILTIN_PROVIDERS[type].baseUrl)
		if (!baseUrl) return []
		return [
			{
				id: `legacy-${type}`,
				name: getConnectionPreset(type).name,
				presetId: type,
				baseUrl,
				apiKey: override?.apiKey ?? '',
				selectedModel: type === settings.provider ? settings.selectedModel : null,
			},
		]
	})
}
