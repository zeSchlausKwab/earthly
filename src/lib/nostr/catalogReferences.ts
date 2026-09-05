import type { Filter } from 'nostr-tools'
import type { MapStackEntry } from '@/features/geo-editor/store/types'
import { resolveEntityReference } from './entityReference'
import { GEO_EVENT_KIND } from './kinds'

/** Only explicitly public stack entries may generate public relay requests. */
export function publicCatalogStackFilters(entries: readonly MapStackEntry[]): Filter[] {
	const references = new Map<string, Filter>()
	for (const entry of entries) {
		if (['private-group', 'field-session', 'workspace'].includes(entry.source)) continue
		if (entry.entityType !== 'dataset' && entry.entityType !== 'context') continue
		const value = entry.entityType === 'dataset' ? `${GEO_EVENT_KIND}:${entry.entityKey}` : entry.entityKey
		const reference = resolveEntityReference(value)
		if (!reference) continue
		references.set(reference.coordinate, {
			kinds: [reference.kind], authors: [reference.pubkey], '#d': [reference.identifier], limit: 1,
		})
	}
	return [...references.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, filter]) => filter)
}
