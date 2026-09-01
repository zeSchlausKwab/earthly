import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const MAX_SETTINGS_BYTES = 65_536
const PROVIDERS = ['routstr', 'lmstudio', 'ollama', 'custom'] as const

export type AiSuiteChatProvider = (typeof PROVIDERS)[number]

export interface AiSuiteProviderOverride {
	baseUrl: string
	apiKey: string
}

export interface AiSuiteChatSettings {
	provider: AiSuiteChatProvider
	providerOverrides: {
		lmstudio: AiSuiteProviderOverride
		ollama: AiSuiteProviderOverride
		custom: AiSuiteProviderOverride
	}
	selectedModel: string
	toolsEnabled: boolean
	mapSnapshotsEnabled: boolean
	safetyLevel: 1 | 2 | 3
	promptProfile: 'compact' | 'legacy'
	version: 2
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function providerOverride(value: unknown): AiSuiteProviderOverride {
	if (!isRecord(value)) return { baseUrl: '', apiKey: '' }
	return {
		baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
		apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
	}
}

export function validateAiSuiteChatSettings(value: unknown): AiSuiteChatSettings {
	if (!isRecord(value)) throw new Error('Live AI settings must be a JSON object.')
	if (JSON.stringify(value).length > MAX_SETTINGS_BYTES) {
		throw new Error('Live AI settings are unexpectedly large.')
	}
	if (!PROVIDERS.includes(value.provider as AiSuiteChatProvider)) {
		throw new Error(`Unsupported live AI provider: ${String(value.provider)}`)
	}
	const overrides = isRecord(value.providerOverrides) ? value.providerOverrides : {}
	const selectedModel = typeof value.selectedModel === 'string' ? value.selectedModel.trim() : ''
	if (!selectedModel) throw new Error('Live AI settings require selectedModel.')

	const normalized: AiSuiteChatSettings = {
		provider: value.provider as AiSuiteChatProvider,
		providerOverrides: {
			lmstudio: providerOverride(overrides.lmstudio),
			ollama: providerOverride(overrides.ollama),
			custom: providerOverride(overrides.custom),
		},
		selectedModel,
		toolsEnabled: typeof value.toolsEnabled === 'boolean' ? value.toolsEnabled : true,
		mapSnapshotsEnabled:
			typeof value.mapSnapshotsEnabled === 'boolean' ? value.mapSnapshotsEnabled : true,
		safetyLevel: value.safetyLevel === 1 || value.safetyLevel === 3 ? value.safetyLevel : 2,
		promptProfile: value.promptProfile === 'legacy' ? 'legacy' : 'compact',
		version: 2,
	}

	if (normalized.provider === 'custom') {
		const endpoint = normalized.providerOverrides.custom.baseUrl.trim()
		if (!endpoint) throw new Error('Custom live AI settings require a baseUrl.')
		try {
			const url = new URL(endpoint)
			const loopback =
				url.hostname === 'localhost' ||
				url.hostname === '127.0.0.1' ||
				url.hostname === '::1' ||
				url.hostname.endsWith('.localhost')
			if (url.protocol !== 'https:' && !loopback) {
				throw new Error('Remote custom live AI endpoints must use HTTPS.')
			}
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === 'Remote custom live AI endpoints must use HTTPS.'
			) {
				throw error
			}
			throw new Error('Custom live AI settings contain an invalid baseUrl.')
		}
	}

	return normalized
}

function isInside(parent: string, candidate: string): boolean {
	const child = relative(parent, candidate)
	return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/**
 * Read the explicitly opted-in live provider snapshot without ever printing it.
 * Files inside the repository are accepted only from the ignored `.secrets`
 * directory; an absolute path outside the repository is also allowed.
 */
export function loadLiveAiSettings(
	env: Record<string, string | undefined> = process.env,
	cwd = process.cwd(),
): AiSuiteChatSettings | null {
	const configuredPath = env.EARTHLY_LIVE_AI_SETTINGS_FILE?.trim()
	if (!configuredPath) return null

	const repositoryRoot = resolve(cwd)
	const secretsRoot = resolve(repositoryRoot, 'ai-suite/.secrets')
	const settingsPath = resolve(repositoryRoot, configuredPath)
	if (isInside(repositoryRoot, settingsPath) && !isInside(secretsRoot, settingsPath)) {
		throw new Error(
			'Live AI settings inside the repository must live under ignored ai-suite/.secrets/.',
		)
	}

	const raw = readFileSync(settingsPath, 'utf8')
	if (raw.length > MAX_SETTINGS_BYTES) throw new Error('Live AI settings are unexpectedly large.')
	return validateAiSuiteChatSettings(JSON.parse(raw) as unknown)
}

export function deterministicChatSettings(baseUrl: string, modelId: string): AiSuiteChatSettings {
	return {
		provider: 'custom',
		providerOverrides: {
			lmstudio: { baseUrl: '', apiKey: '' },
			ollama: { baseUrl: '', apiKey: '' },
			custom: { baseUrl, apiKey: '' },
		},
		selectedModel: modelId,
		toolsEnabled: true,
		mapSnapshotsEnabled: true,
		safetyLevel: 1,
		promptProfile: 'compact',
		version: 2,
	}
}
