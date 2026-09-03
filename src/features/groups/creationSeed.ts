import type { GroupGovernance } from '@/lib/nostr/group'
import {
	parseMapPresentationSource,
	type MapPresentationV1,
} from '@/lib/map-presentation'
import { coordinateToNaddrReference } from '@/lib/nostr/references'

export interface GroupCreationSeed {
	name?: string
	description?: string
	curatedReferences?: readonly string[]
	governance?: GroupGovernance
	presentation?: MapPresentationV1
}

/**
 * Turn an explicit canvas capture into a ready-to-review personal Atlas draft.
 * Every presentation source is also placed in the owner's authoritative `a`
 * lane, which keeps the embedded view authorized when it is published.
 */
export function buildSavedViewAtlasSeed(presentation: MapPresentationV1): GroupCreationSeed {
	const references: string[] = []
	const seen = new Set<string>()
	for (const layer of presentation.layers) {
		const source = parseMapPresentationSource(layer.source)
		if (!source || seen.has(source.coordinate)) continue
		const reference = coordinateToNaddrReference(source.coordinate)
		if (!reference) continue
		seen.add(source.coordinate)
		references.push(reference)
	}

	return Object.freeze({
		name: 'Saved view',
		description: 'A view saved from the Earthly canvas.',
		curatedReferences: Object.freeze(references),
		governance: 'closed',
		presentation,
	})
}
