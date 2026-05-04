import type { NDKEvent } from '@nostr-dev-kit/react'
import { nip19 } from 'nostr-tools'

export interface NostrAddressReference {
	address: string
	featureId?: string
}

const NADDR_REFERENCE_PATTERN = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/gi

export function stringifyNostrAddressReference(reference: NostrAddressReference): string {
	return `nostr:${reference.address}${reference.featureId ? `#${reference.featureId}` : ''}`
}

export function parseNostrAddressReference(
	value: string | null | undefined,
): NostrAddressReference | null {
	if (!value) return null
	const trimmed = value.trim()
	if (!trimmed) return null
	const match = trimmed.match(/^nostr:(naddr1[a-z0-9]+)(?:#([a-zA-Z0-9_-]+))?$/i)
	if (!match?.[1]) return null
	return {
		address: match[1],
		featureId: match[2] || undefined,
	}
}

export function extractNostrAddressReferences(
	text: string | null | undefined,
): NostrAddressReference[] {
	if (!text) return []

	const references: NostrAddressReference[] = []
	let match = NADDR_REFERENCE_PATTERN.exec(text)

	while (match !== null) {
		const address = match[1]
		if (address) {
			references.push({
				address,
				featureId: match[3] || undefined,
			})
		}
		match = NADDR_REFERENCE_PATTERN.exec(text)
	}

	return references
}

export function extractNostrAddressReferencesFromList(
	values: Array<string | null | undefined>,
): NostrAddressReference[] {
	return values.flatMap((value) => {
		const parsed = parseNostrAddressReference(value)
		return parsed ? [parsed] : []
	})
}

export function dedupeNostrAddressReferences(
	references: NostrAddressReference[],
): NostrAddressReference[] {
	const seen = new Set<string>()
	return references.flatMap((reference) => {
		const key = `${reference.address}#${reference.featureId ?? ''}`
		if (!reference.address || seen.has(key)) return []
		seen.add(key)
		return [reference]
	})
}

export function naddrToCoordinate(address: string): string | null {
	if (!address.startsWith('naddr1')) return null

	try {
		const decoded = nip19.decode(address)
		if (decoded.type !== 'naddr') return null
		const { kind, pubkey, identifier } = decoded.data
		return `${kind}:${pubkey}:${identifier}`
	} catch {
		return null
	}
}

export function extractReferencedCoordinates(text: string | null | undefined): string[] {
	const seen = new Set<string>()
	const coordinates: string[] = []

	extractNostrAddressReferences(text).forEach((reference) => {
		const coordinate = naddrToCoordinate(reference.address)
		if (!coordinate || seen.has(coordinate)) return
		seen.add(coordinate)
		coordinates.push(coordinate)
	})

	return coordinates
}

export function extractReferencedCoordinatesFromList(
	values: Array<string | null | undefined>,
): string[] {
	const seen = new Set<string>()
	const coordinates: string[] = []

	extractNostrAddressReferencesFromList(values).forEach((reference) => {
		const coordinate = naddrToCoordinate(reference.address)
		if (!coordinate || seen.has(coordinate)) return
		seen.add(coordinate)
		coordinates.push(coordinate)
	})

	return coordinates
}

export function syncAddressReferenceTags(
	event: NDKEvent,
	referencedCoordinates: string[],
	preservedCoordinates: string[] = [],
): void {
	event.tags = computeAddressReferenceTags(
		event.tags,
		referencedCoordinates,
		preservedCoordinates,
	)
}

/**
 * Pure version of `syncAddressReferenceTags` — takes the current tag array
 * and returns the new one. Use this with `factory.modifyPublicTags(...)`.
 *
 *   - Existing `a` tags are dropped UNLESS their coordinate is in
 *     `preservedCoordinates`.
 *   - Then the dedup'd `referencedCoordinates` are appended (also keeping
 *     `preservedCoordinates` first so order matches the legacy behavior).
 */
export function computeAddressReferenceTags(
	currentTags: string[][],
	referencedCoordinates: string[],
	preservedCoordinates: string[] = [],
): string[][] {
	const preserved = new Set(preservedCoordinates.filter(Boolean))
	const nextCoordinates: string[] = []
	const seen = new Set<string>()

	;[...preservedCoordinates, ...referencedCoordinates].forEach((coordinate) => {
		if (!coordinate || seen.has(coordinate)) return
		seen.add(coordinate)
		nextCoordinates.push(coordinate)
	})

	const filtered = currentTags.filter(
		(tag) => tag[0] !== 'a' || preserved.has(tag[1] ?? ''),
	)
	const existingAValues = new Set(
		filtered
			.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)
	const additions: string[][] = []
	nextCoordinates.forEach((coordinate) => {
		if (existingAValues.has(coordinate)) return
		additions.push(['a', coordinate])
	})
	return [...filtered, ...additions]
}

/**
 * Tag operation suitable for `factory.modifyPublicTags(setAddressReferenceTags(...))`.
 */
export function setAddressReferenceTags(
	referencedCoordinates: string[],
	preservedCoordinates: string[] = [],
) {
	return (tags: string[][]) =>
		computeAddressReferenceTags(tags, referencedCoordinates, preservedCoordinates)
}
