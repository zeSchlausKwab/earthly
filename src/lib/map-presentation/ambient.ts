import { naddrToCoordinate } from '@/lib/nostr/references'
import { parseMapPresentationSource } from './codec'
import type { MapPresentationLayerV1, MapPresentationSource } from './types'

export const AMBIENT_ON_LIMITS = Object.freeze({
	totalLength: 8_192,
	tokens: 64,
	tokenLength: 1_024,
	legacyIdentifierLength: 512,
})

export type AmbientOnIssueCode =
	| 'input-limit'
	| 'token-limit'
	| 'invalid-reference'
	| 'missing-legacy-source'
	| 'ambiguous-legacy-source'

export interface AmbientOnIssue {
	readonly code: AmbientOnIssueCode
	readonly token?: string
	readonly index?: number
	readonly message: string
}

export type AmbientOnToken =
	| {
			readonly kind: 'exact'
			readonly input: string
			readonly source: MapPresentationSource
	  }
	| {
			readonly kind: 'legacy'
			readonly input: string
			readonly identifier: string
	  }

export interface ParsedAmbientOn {
	readonly tokens: readonly AmbientOnToken[]
	readonly issues: readonly AmbientOnIssue[]
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index)
		if (code <= 31 || code === 127) return true
	}
	return false
}

/** Parse the public `on=` value without consulting the current dataset catalog. */
export function parseAmbientOn(value: string | null | undefined): ParsedAmbientOn {
	if (!value) return Object.freeze({ tokens: Object.freeze([]), issues: Object.freeze([]) })
	const issues: AmbientOnIssue[] = []
	let input = value
	if (input.length > AMBIENT_ON_LIMITS.totalLength) {
		input = input.slice(0, AMBIENT_ON_LIMITS.totalLength)
		issues.push(
			Object.freeze({
				code: 'input-limit' as const,
				message: `Only the first ${AMBIENT_ON_LIMITS.totalLength} characters of on= were considered.`,
			}),
		)
	}

	const parts = input.split(',')
	if (parts.length > AMBIENT_ON_LIMITS.tokens) {
		issues.push(
			Object.freeze({
				code: 'token-limit' as const,
				message: `Only the first ${AMBIENT_ON_LIMITS.tokens} on= entries were considered.`,
			}),
		)
	}

	const tokens: AmbientOnToken[] = []
	const seen = new Set<string>()
	for (let index = 0; index < Math.min(parts.length, AMBIENT_ON_LIMITS.tokens); index += 1) {
		const token = parts[index]?.trim() ?? ''
		if (!token) continue
		if (token.length > AMBIENT_ON_LIMITS.tokenLength || hasControlCharacter(token)) {
			issues.push(
				Object.freeze({
					code: 'invalid-reference' as const,
					token,
					index,
					message: 'Ambient Map reference is malformed or exceeds its size limit.',
				}),
			)
			continue
		}

		let exactInput: string | null = null
		const lowerToken = token.toLowerCase()
		const naddrToken = lowerToken.startsWith('nostr:naddr1') ? token.slice('nostr:'.length) : token
		if (naddrToken.toLowerCase().startsWith('naddr1')) exactInput = naddrToCoordinate(naddrToken)
		else if (token.startsWith('37515:')) exactInput = token

		if (exactInput !== null || naddrToken.toLowerCase().startsWith('naddr1')) {
			const parsed = parseMapPresentationSource(exactInput)
			if (!parsed) {
				issues.push(
					Object.freeze({
						code: 'invalid-reference' as const,
						token,
						index,
						message: 'Exact ambient references must identify one kind-37515 Map.',
					}),
				)
				continue
			}
			const key = `source:${parsed.coordinate}`
			if (seen.has(key)) continue
			seen.add(key)
			tokens.push(Object.freeze({ kind: 'exact', input: token, source: parsed.coordinate }))
			continue
		}

		if (
			token.includes(':') ||
			token.length > AMBIENT_ON_LIMITS.legacyIdentifierLength ||
			lowerToken.startsWith('nostr:')
		) {
			issues.push(
				Object.freeze({
					code: 'invalid-reference' as const,
					token,
					index,
					message: 'Ambient Map reference is neither an exact address nor a legacy d-tag.',
				}),
			)
			continue
		}
		const key = `legacy:${token}`
		if (seen.has(key)) continue
		seen.add(key)
		tokens.push(Object.freeze({ kind: 'legacy', input: token, identifier: token }))
	}

	return Object.freeze({ tokens: Object.freeze(tokens), issues: Object.freeze(issues) })
}

export interface ResolvedAmbientOn {
	readonly sources: readonly MapPresentationSource[]
	readonly issues: readonly AmbientOnIssue[]
}

/** Resolve old d-tag-only entries only when the catalog has exactly one match. */
export function resolveAmbientOn(
	parsed: ParsedAmbientOn,
	availableSources: readonly string[],
): ResolvedAmbientOn {
	const sourcesByIdentifier = new Map<string, MapPresentationSource[]>()
	for (const sourceValue of availableSources) {
		const parsedSource = parseMapPresentationSource(sourceValue)
		if (!parsedSource) continue
		const candidates = sourcesByIdentifier.get(parsedSource.identifier) ?? []
		if (!candidates.includes(parsedSource.coordinate)) candidates.push(parsedSource.coordinate)
		sourcesByIdentifier.set(parsedSource.identifier, candidates)
	}

	const sources: MapPresentationSource[] = []
	const seenSources = new Set<MapPresentationSource>()
	const issues = [...parsed.issues]
	for (let index = 0; index < parsed.tokens.length; index += 1) {
		const token = parsed.tokens[index]
		if (!token) continue
		let source: MapPresentationSource | undefined
		if (token.kind === 'exact') {
			source = token.source
		} else {
			const candidates = sourcesByIdentifier.get(token.identifier) ?? []
			if (candidates.length === 0) {
				issues.push(
					Object.freeze({
						code: 'missing-legacy-source' as const,
						token: token.input,
						index,
						message: `No loaded Map has the legacy d-tag '${token.identifier}'.`,
					}),
				)
				continue
			}
			if (candidates.length > 1) {
				issues.push(
					Object.freeze({
						code: 'ambiguous-legacy-source' as const,
						token: token.input,
						index,
						message: `More than one loaded Map has the legacy d-tag '${token.identifier}'.`,
					}),
				)
				continue
			}
			source = candidates[0]
		}
		if (!source || seenSources.has(source)) continue
		seenSources.add(source)
		sources.push(source)
	}

	return Object.freeze({ sources: Object.freeze(sources), issues: Object.freeze(issues) })
}

export interface AmbientLayerComposition {
	readonly layers: readonly MapPresentationLayerV1[]
	/** Existing Story layer ids whose effective visibility was forced on by `on=`. */
	readonly forcedVisibleLayerIds: readonly string[]
	/** Synthetic ids appended after view reduction; view blocks can never target them. */
	readonly ambientLayerIds: readonly string[]
}

/**
 * Apply ambient sources after Story view reduction. Matching Story sources are
 * forced visible; other sources become temporary author-styled whole-Map layers.
 */
export function applyAmbientSourcesToLayers(
	baseLayers: readonly MapPresentationLayerV1[],
	ambientSources: readonly MapPresentationSource[],
): AmbientLayerComposition {
	const layers = baseLayers.map((layer) => ({ ...layer }))
	const forcedVisibleLayerIds: string[] = []
	const ambientLayerIds: string[] = []
	const usedIds = new Set(layers.map((layer) => layer.id))
	const seenSources = new Set<MapPresentationSource>()
	let ambientOrdinal = 1

	for (const source of ambientSources) {
		if (seenSources.has(source)) continue
		seenSources.add(source)
		let matched = false
		for (let index = 0; index < layers.length; index += 1) {
			const layer = layers[index]
			if (!layer || layer.source !== source) continue
			matched = true
			if (!layer.visible) {
				layers[index] = { ...layer, visible: true }
				forcedVisibleLayerIds.push(layer.id)
			}
		}
		if (matched) continue

		let id = `ambient-${ambientOrdinal}`
		while (usedIds.has(id)) {
			ambientOrdinal += 1
			id = `ambient-${ambientOrdinal}`
		}
		ambientOrdinal += 1
		usedIds.add(id)
		ambientLayerIds.push(id)
		layers.push({
			id,
			source,
			visible: true,
			opacityMultiplier: 1,
		})
	}

	return Object.freeze({
		layers: Object.freeze(layers.map((layer) => Object.freeze(layer))),
		forcedVisibleLayerIds: Object.freeze(forcedVisibleLayerIds),
		ambientLayerIds: Object.freeze(ambientLayerIds),
	})
}
