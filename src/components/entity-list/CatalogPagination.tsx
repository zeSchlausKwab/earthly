import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import type { FilterState } from '@/components/data-filter/types'
import { catalogWindows, useCatalogWindow } from '@/lib/nostr/catalogWindow'

/** Local filters retain their full historical reach when the user asks for them. */
export function useCatalogFilterReach(kind: number, filters: FilterState, catalogTab = 'all') {
	const full = Boolean(filters.searchQuery.trim()) || catalogTab !== 'all' || filters.sortConfig.field !== 'recency' || filters.sortConfig.direction !== 'desc'
	const window = useCatalogWindow(kind)
	useEffect(() => {
		if (full || (window.limit !== null && filters.displayLimit > window.limit)) catalogWindows.all(kind)
	}, [kind, full, filters.displayLimit, window.limit])
}

export function CatalogPagination({ kind, label, onMore }: { kind: number; label: string; onMore?: () => void }) {
	const window = useCatalogWindow(kind)
	if (window.loading) return <span role="status">Loading {window.limit === null ? 'full catalog' : label}…</span>
	if (!window.hasMore) return null
	return <Button size="sm" variant="ghost" className="min-h-11 px-2 text-xs md:min-h-7" onClick={() => { catalogWindows.more(kind); onMore?.() }}>Load older {label}</Button>
}
