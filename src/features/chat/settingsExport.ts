import { isProviderType } from './routstr'
import { migrateV1ToV2 } from './settingsStorage'
import { DEFAULT_CHAT_SETTINGS } from './store'
import type { ChatSettingsSnapshot, ProviderOverride } from './store'

// SET-03 export/import escape hatch (D-08/D-09). These helpers are pure and DOM-free:
// the UI owns clipboard/textarea I/O, error narrowing, and re-encrypt-via-save.
// Hand-written type guards per CONVENTIONS (Zod is env-only).

// Sanity cap on the serialized import payload (T-01-10 / V5): a settings snapshot is tiny;
// anything larger is malformed/hostile and is rejected before it reaches the store.
export const MAX_IMPORT_BYTES = 65536

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function coerceOverride(value: unknown, fallback: ProviderOverride): ProviderOverride {
	if (!isRecord(value)) return { ...fallback }
	const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : ''
	const apiKey = typeof value.apiKey === 'string' ? value.apiKey : ''
	return { baseUrl, apiKey }
}

/** Serialize a snapshot to pretty plaintext JSON (incl. API keys) for the clipboard (D-08). */
export function serializeSnapshot(snapshot: ChatSettingsSnapshot): string {
	return JSON.stringify(snapshot, null, 2)
}

/**
 * Validate untrusted, user-pasted import JSON and return a normalized v2 snapshot, or throw
 * (the UI narrows the Error). Rejects null/array/non-object, unknown `provider`, and oversized
 * payloads (T-01-10 / V5). Accepts both v1 (flat customEndpoint/customApiKey → routed through
 * `migrateV1ToV2`) and v2 payloads; coerces missing override fields to '', `selectedModel` to
 * `string | null`, and `toolsEnabled` to a boolean defaulting `true`.
 */
export function validateImportedSnapshot(parsed: unknown): ChatSettingsSnapshot {
	if (!isRecord(parsed)) {
		throw new Error('Settings import must be a JSON object')
	}

	if (JSON.stringify(parsed).length > MAX_IMPORT_BYTES) {
		throw new Error('Settings import is too large')
	}

	if ('provider' in parsed && !isProviderType(parsed.provider)) {
		throw new Error(`Unknown provider: ${String(parsed.provider)}`)
	}

	const defaults = DEFAULT_CHAT_SETTINGS

	// Flat v1 payload (no providerOverrides): fold through the shared migration so the custom
	// endpoint/key land in providerOverrides.custom, then normalize below.
	const v2: ChatSettingsSnapshot =
		'providerOverrides' in parsed
			? {
					provider: isProviderType(parsed.provider) ? parsed.provider : defaults.provider,
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
			: migrateV1ToV2(parsed)

	const overrides = isRecord(parsed.providerOverrides) ? parsed.providerOverrides : {}

	return {
		provider: v2.provider,
		providerOverrides: {
			lmstudio:
				'providerOverrides' in parsed
					? coerceOverride(overrides.lmstudio, defaults.providerOverrides.lmstudio)
					: v2.providerOverrides.lmstudio,
			ollama:
				'providerOverrides' in parsed
					? coerceOverride(overrides.ollama, defaults.providerOverrides.ollama)
					: v2.providerOverrides.ollama,
			custom:
				'providerOverrides' in parsed
					? coerceOverride(overrides.custom, defaults.providerOverrides.custom)
					: v2.providerOverrides.custom,
		},
		selectedModel: typeof parsed.selectedModel === 'string' ? parsed.selectedModel : null,
		toolsEnabled: typeof parsed.toolsEnabled === 'boolean' ? parsed.toolsEnabled : true,
		// SAFE-04 / T-05-11: membership-check the imported safety level; an out-of-range or
		// wrong-type value falls back to the safe default 2 rather than weakening gating.
		safetyLevel: parsed.safetyLevel === 1 || parsed.safetyLevel === 3 ? parsed.safetyLevel : 2,
		promptProfile: parsed.promptProfile === 'compact' ? 'compact' : 'legacy',
		version: 2,
	}
}
