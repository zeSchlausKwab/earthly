import type { NDKEvent } from '@nostr-dev-kit/react'
import { nip19 } from 'nostr-tools'

export interface NostrAddressReference {
	address: string
	featureId?: string
}

const NADDR_REFERENCE_PATTERN = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/gi

export function extractNostrAddressReferences(text: string | null | undefined): NostrAddressReference[] {
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

export function syncAddressReferenceTags(
	event: NDKEvent,
	referencedCoordinates: string[],
	preservedCoordinates: string[] = [],
): void {
	const preserved = new Set(preservedCoordinates.filter(Boolean))
	const nextCoordinates: string[] = []
	const seen = new Set<string>()

	;[...preservedCoordinates, ...referencedCoordinates].forEach((coordinate) => {
		if (!coordinate || seen.has(coordinate)) return
		seen.add(coordinate)
		nextCoordinates.push(coordinate)
	})

	event.tags = event.tags.filter((tag) => tag[0] !== 'a' || preserved.has(tag[1] ?? ''))
	const existingAValues = new Set(
		event.tags
			.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)

	nextCoordinates.forEach((coordinate) => {
		if (existingAValues.has(coordinate)) return
		event.tags.push(['a', coordinate])
	})
}
