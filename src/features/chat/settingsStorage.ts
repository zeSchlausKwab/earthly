import type { ISigner } from 'applesauce-signers'
import { DEFAULT_CHAT_SETTINGS } from './store'
import type { ChatSettingsSnapshot, ProviderOverride } from './store'

// Storage key prefix stays `.v1` on purpose (D-07 / Pitfall 1): the in-envelope `version`
// field is what tracks the schema; bumping the key prefix would orphan in-the-wild v1
// envelopes and present as the silent data loss SET-02 forbids.
const CHAT_SETTINGS_STORAGE_PREFIX = 'earthly.chat-settings.v1'

type Scheme = 'nip04' | 'nip44'

interface StoredChatSettingsEnvelope {
	version: 1 | 2
	scheme: Scheme
	ciphertext: string
	updatedAt: number
}

/** Legacy v1 flat snapshot shape — only used for migration typing. */
interface V1ChatSettingsSnapshot {
	provider?: ChatSettingsSnapshot['provider']
	customEndpoint?: string
	customApiKey?: string
	selectedModel?: string | null
	toolsEnabled?: boolean
}

function getChatSettingsStorageKey(pubkey: string): string {
	return `${CHAT_SETTINGS_STORAGE_PREFIX}.${pubkey}`
}

/** Pick nip44 if the signer supports it, fall back to nip04. */
function resolveEncryptionScheme(signer: ISigner): Scheme {
	if (signer.nip44) return 'nip44'
	return 'nip04'
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function normalizeOverride(value: unknown, fallback: ProviderOverride): ProviderOverride {
	if (!isRecord(value)) return { ...fallback }
	const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : fallback.baseUrl
	const apiKey = typeof value.apiKey === 'string' ? value.apiKey : fallback.apiKey
	return { baseUrl, apiKey }
}

/**
 * Pure, headless (`window`-free) migration from any historical/decrypted payload to the v2
 * snapshot shape. Never trusts the decrypted shape: a garbage payload yields safe defaults
 * without throwing (T-01-04). A flat v1 payload (customEndpoint/customApiKey, no
 * providerOverrides) folds its custom endpoint into `providerOverrides.custom` (D-05).
 */
export function migrateV1ToV2(parsed: unknown): ChatSettingsSnapshot {
	const defaults = DEFAULT_CHAT_SETTINGS
	if (!isRecord(parsed)) {
		return {
			provider: defaults.provider,
			providerOverrides: {
				lmstudio: { ...defaults.providerOverrides.lmstudio },
				ollama: { ...defaults.providerOverrides.ollama },
				custom: { ...defaults.providerOverrides.custom },
			},
			selectedModel: defaults.selectedModel,
			toolsEnabled: defaults.toolsEnabled,
			version: 2,
		}
	}

	const provider = (parsed.provider as ChatSettingsSnapshot['provider']) ?? defaults.provider
	const selectedModel =
		typeof parsed.selectedModel === 'string' ? parsed.selectedModel : defaults.selectedModel
	const toolsEnabled =
		typeof parsed.toolsEnabled === 'boolean' ? parsed.toolsEnabled : defaults.toolsEnabled

	// Already v2: normalize each override field-by-field (idempotent).
	if ('providerOverrides' in parsed) {
		const overrides = isRecord(parsed.providerOverrides) ? parsed.providerOverrides : {}
		return {
			provider,
			providerOverrides: {
				lmstudio: normalizeOverride(overrides.lmstudio, defaults.providerOverrides.lmstudio),
				ollama: normalizeOverride(overrides.ollama, defaults.providerOverrides.ollama),
				custom: normalizeOverride(overrides.custom, defaults.providerOverrides.custom),
			},
			selectedModel,
			toolsEnabled,
			version: 2,
		}
	}

	// Flat v1: fold customEndpoint/customApiKey into providerOverrides.custom.
	const v1 = parsed as V1ChatSettingsSnapshot
	return {
		provider,
		providerOverrides: {
			lmstudio: { ...defaults.providerOverrides.lmstudio },
			ollama: { ...defaults.providerOverrides.ollama },
			custom: {
				baseUrl: typeof v1.customEndpoint === 'string' ? v1.customEndpoint : '',
				apiKey: typeof v1.customApiKey === 'string' ? v1.customApiKey : '',
			},
		},
		selectedModel,
		toolsEnabled,
		version: 2,
	}
}

export async function loadEncryptedChatSettings(
	signer: ISigner,
	pubkey: string,
): Promise<ChatSettingsSnapshot | null> {
	if (typeof window === 'undefined') return null

	const raw = window.localStorage.getItem(getChatSettingsStorageKey(pubkey))
	if (!raw) return null

	const envelope = JSON.parse(raw) as StoredChatSettingsEnvelope
	if (!envelope?.ciphertext || !envelope?.scheme) return null

	const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) {
		throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
	}
	const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
	const parsed = JSON.parse(decrypted)
	return migrateV1ToV2(parsed)
}

export async function saveEncryptedChatSettings(
	signer: ISigner,
	pubkey: string,
	settings: ChatSettingsSnapshot,
): Promise<void> {
	if (typeof window === 'undefined') return

	const scheme = resolveEncryptionScheme(signer)
	const provider = scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) throw new Error(`Active signer does not support ${scheme} encryption`)
	const ciphertext = await provider.encrypt(pubkey, JSON.stringify(settings))
	const envelope: StoredChatSettingsEnvelope = {
		version: 2,
		scheme,
		ciphertext,
		updatedAt: Date.now(),
	}

	window.localStorage.setItem(getChatSettingsStorageKey(pubkey), JSON.stringify(envelope))
}
