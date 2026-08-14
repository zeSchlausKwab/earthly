import type { ISigner } from 'applesauce-signers'
import { isProviderType } from './routstr'
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

// Envelope schema versions this client knows how to decrypt + migrate (WR-02). An unknown
// version (future schema, garbage, wrong type) must NOT be decrypted-and-mis-migrated; it is
// treated as "no usable settings" so a forward-incompatible payload cannot be silently mangled.
const SUPPORTED_ENVELOPE_VERSIONS: ReadonlySet<number> = new Set([1, 2])

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

	// A corrupted/truncated/tampered envelope (quota-aborted write, manual edit) must NOT
	// surface as a decrypt failure (WR-01): treat an unparseable envelope as "no usable
	// settings" and return null so the load lifecycle reports loaded/default, not failed.
	let envelope: StoredChatSettingsEnvelope
	try {
		envelope = JSON.parse(raw) as StoredChatSettingsEnvelope
	} catch {
		return null
	}
	if (!envelope?.ciphertext || !envelope?.scheme) return null

	// Honor the version field (WR-02): an unsupported/garbage version is forward-incompatible —
	// decrypting it would risk mis-migrating an unknown inner shape. Bail to "no usable settings".
	if (!SUPPORTED_ENVELOPE_VERSIONS.has(envelope.version)) return null

	const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) {
		throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
	}
	const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
	// The payload decrypted successfully but may be structurally garbage (future schema, manual
	// tamper). migrateV1ToV2 is documented to never throw on garbage, but it is only reached if
	// the parse succeeds — route an unparseable payload through it (as undefined) for safe
	// defaults rather than letting a raw SyntaxError masquerade as a decryption failure (WR-01).
	let parsed: unknown
	try {
		parsed = JSON.parse(decrypted)
	} catch {
		parsed = undefined
	}
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
	// Normalize the snapshot through the v2 migration before stamping version: 2 (WR-06) so the
	// persisted envelope's version claim is always truthful — a malformed in-memory snapshot
	// (e.g. unknown provider, missing override) cannot be laundered into storage as "v2".
	const normalized = migrateV1ToV2(settings)
	const ciphertext = await provider.encrypt(pubkey, JSON.stringify(normalized))
	const envelope: StoredChatSettingsEnvelope = {
		version: 2,
		scheme,
		ciphertext,
		updatedAt: Date.now(),
	}

	window.localStorage.setItem(getChatSettingsStorageKey(pubkey), JSON.stringify(envelope))
}
