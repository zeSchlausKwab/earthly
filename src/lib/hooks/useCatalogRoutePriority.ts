import { useEffect, useMemo } from 'react'
import { resolveEntityReference } from '@/lib/nostr/entityReference'
import { useTimelineWithEose } from '@/lib/nostr/hooks'
import { catalogWindows } from '@/lib/nostr/catalogWindow'
import { GEO_EVENT_KIND, ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import type { MapStackEntry } from '@/features/geo-editor/store/types'
import { publicCatalogStackFilters } from '@/lib/nostr/catalogReferences'

export function useCatalogStackPriority(entries: Record<string, MapStackEntry>, order: string[]) {
	const filters = useMemo(() => publicCatalogStackFilters(order.flatMap(id => entries[id] ? [entries[id]!] : [])), [entries, order])
	useTimelineWithEose(filters.length ? filters : null)
	const hasAtlas = filters.some(filter => filter.kinds?.includes(MAP_CONTEXT_KIND))
	useEffect(() => {
		// Atlas membership can recurse through child Atlases and foreign attachments.
		// Preserve its full reach when explicitly retained, as for a scoped route.
		if (!hasAtlas) return
		catalogWindows.all(MAP_CONTEXT_KIND)
		catalogWindows.all(GEO_EVENT_KIND)
	}, [hasAtlas])
}

/** Direct objects must never depend on appearing in the first discovery page. */
export function useCatalogRoutePriority(naddr?: string, contextNaddr?: string, userPubkey?: string) {
	const filters = useMemo(() => {
		const references = [naddr, contextNaddr].flatMap(value => {
			const reference = value ? resolveEntityReference(value) : null
			return reference ? [{ kinds: [reference.kind], authors: [reference.pubkey], '#d': [reference.identifier], limit: 1 }] : []
		})
		return references.length ? references : null
	}, [naddr, contextNaddr])
	useTimelineWithEose(filters)
	useEffect(() => {
		// Existing local profile/lens filters intentionally retain their historical
		// reach. Only ordinary recent Browse uses the bounded request window.
		if (!contextNaddr && !userPubkey) return
		for (const kind of [GEO_EVENT_KIND, ARTICLE_KIND, MAP_CONTEXT_KIND]) catalogWindows.all(kind)
	}, [contextNaddr, userPubkey])
}
