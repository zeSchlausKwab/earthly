import type { ISigner } from 'applesauce-signers'
import { isProviderType } from './routstr'
import { DEFAULT_CHAT_SETTINGS } from './store'
import type { ChatSettingsSnapshot, ProviderOverride } from './store'
import { getConnectionPreset, legacyConnections, validateConnection } from './connections'

// Storage key prefix stays `.v1` on purpose (D-07 / Pitfall 1): the in-envelope `version`
// field is what tracks the schema; bumping the key prefix would orphan in-the-wild v1
// envelopes and present as the silent data loss SET-02 forbids.
const CHAT_SETTINGS_STORAGE_PREFIX = 'earthly.chat-settings.v1'

type Scheme = 'nip04' | 'nip44'

interface StoredChatSettingsEnvelope {
	version: 1 | 2 | 3
	scheme: Scheme
	ciphertext: string
	updatedAt: number
}

// Envelope schema versions this client knows how to decrypt + migrate (WR-02). An unknown
// version (future schema, garbage, wrong type) must NOT be decrypted-and-mis-migrated; it is
// rejected so a forward-incompatible payload cannot be silently overwritten.
const SUPPORTED_ENVELOPE_VERSIONS: ReadonlySet<number> = new Set([1, 2, 3])

export function normalizeChatSettings(parsed: unknown): ChatSettingsSnapshot {
	if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error('Invalid settings snapshot')
	if (parsed.version === 3 && !Array.isArray(parsed.connections))
		throw new Error('Version 3 settings must contain a connection list')
	if (isRecord(parsed) && 'version' in parsed && ![1, 2, 3].includes(parsed.version as number))
		throw new Error('Unsupported settings version; update Earthly before saving')
	const legacy = migrateV1ToV2(parsed)
	if (!isRecord(parsed) || !('connections' in parsed)) {
		const connections = legacyConnections(legacy)
		return {
			...legacy,
			connections,
			activeConnectionId:
				connections.find((item) => item.presetId === legacy.provider)?.id ??
				connections[0]?.id ??
				null,
			version: 3,
		}
	}
	if (parsed.version !== 3 || !Array.isArray(parsed.connections) || parsed.connections.length > 100)
		throw new Error('Unsupported connection settings format')
	const connections = parsed.connections.map(validateConnection)
	if (new Set(connections.map((item) => item.id)).size !== connections.length)
		throw new Error('Duplicate connection IDs')
	const activeConnectionId = connections.some((item) => item.id === parsed.activeConnectionId)
		? (parsed.activeConnectionId as string)
		: (connections[0]?.id ?? null)
	const active = connections.find((item) => item.id === activeConnectionId)
	const provider = active ? getConnectionPreset(active.presetId).provider : legacy.provider
	return {
		...legacy,
		provider,
		selectedModel: active?.selectedModel ?? null,
		providerOverrides: {
			...legacy.providerOverrides,
			...(active && provider !== 'routstr'
				? { [provider]: { baseUrl: active.baseUrl, apiKey: active.apiKey } }
				: {}),
		},
		connections,
		activeConnectionId,
		version: 3,
	}
}

/** Legacy v1 flat snapshot shape — only used for migration typing. */
interface V1ChatSettingsSnapshot {
	provider?: ChatSettingsSnapshot['provider']
	customEndpoint?: string
	customApiKey?: string
	selectedModel?: string | null
	toolsEnabled?: boolean
	mapSnapshotsEnabled?: boolean
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

/**
 * Membership-check the safety level (SAFE-04 / D-09 / T-05-11). A tampered/future/garbage
 * value (0, 5, "high", null, 2.5) MUST fall back to the safe default 2 — never trust the
 * decrypted shape, and never let an out-of-range value weaken gating.
 */
function normalizeSafetyLevel(value: unknown): 1 | 2 | 3 {
	return value === 1 || value === 3 ? value : 2
}

function normalizePromptProfile(value: unknown): ChatSettingsSnapshot['promptProfile'] {
	return value === 'compact' ? 'compact' : 'legacy'
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
			mapSnapshotsEnabled: defaults.mapSnapshotsEnabled,
			safetyLevel: defaults.safetyLevel,
			promptProfile: defaults.promptProfile,
			version: 2,
		}
	}

	// Membership-check the provider (WR-03): an unvalidated cast lets a tampered/future payload
	// (e.g. provider: "openai") flow into the store, where resolveProvider mis-handles it as a
	// builtin and produces a malformed ProviderConfig. Fall back to the default instead.
	const provider = isProviderType(parsed.provider) ? parsed.provider : defaults.provider
	const selectedModel =
		typeof parsed.selectedModel === 'string' ? parsed.selectedModel : defaults.selectedModel
	const toolsEnabled =
		typeof parsed.toolsEnabled === 'boolean' ? parsed.toolsEnabled : defaults.toolsEnabled
	const mapSnapshotsEnabled =
		typeof parsed.mapSnapshotsEnabled === 'boolean'
			? parsed.mapSnapshotsEnabled
			: defaults.mapSnapshotsEnabled
	const safetyLevel = normalizeSafetyLevel(parsed.safetyLevel)
	const promptProfile = normalizePromptProfile(parsed.promptProfile)

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
			mapSnapshotsEnabled,
			safetyLevel,
			promptProfile,
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
		mapSnapshotsEnabled,
		safetyLevel,
		promptProfile,
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

	// Preserve damaged ciphertext and fail closed until retry or explicit backup import.
	let envelope: StoredChatSettingsEnvelope
	try {
		envelope = JSON.parse(raw) as StoredChatSettingsEnvelope
	} catch {
		throw new Error('Saved settings are damaged; use a backup or retry without overwriting them')
	}
	if (!envelope?.ciphertext || !['nip04', 'nip44'].includes(envelope.scheme))
		throw new Error('Invalid saved settings envelope')

	// Honor the version field (WR-02): an unsupported/garbage version is forward-incompatible —
	// decrypting it would risk mis-migrating an unknown inner shape. Preserve the original.
	if (!SUPPORTED_ENVELOPE_VERSIONS.has(envelope.version))
		throw new Error('This settings version requires a newer Earthly client')

	const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) {
		throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
	}
	const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
	// Parsing failures remain recoverable; never replace them with empty defaults.
	let parsed: unknown
	try {
		parsed = JSON.parse(decrypted)
	} catch {
		throw new Error('Decrypted settings are not valid JSON')
	}
	return envelope.version === 3 ? normalizeChatSettings(parsed) : migrateV1ToV2(parsed)
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
	// Validate before claiming a schema version or overwriting the encrypted cache.
	const normalized =
		settings.version === 3 ? normalizeChatSettings(settings) : migrateV1ToV2(settings)
	const plaintext = JSON.stringify(normalized)
	if (new TextEncoder().encode(plaintext).length > 60_000)
		throw new Error('Too many connection settings to encrypt; remove unused connections')
	const ciphertext = await provider.encrypt(pubkey, plaintext)
	const envelope: StoredChatSettingsEnvelope = {
		version: normalized.version ?? 2,
		scheme,
		ciphertext,
		updatedAt: Date.now(),
	}

	window.localStorage.setItem(getChatSettingsStorageKey(pubkey), JSON.stringify(envelope))
}
