import { useMemo } from 'react'
import type { FilterConfig, FilterState, FilterableItem, FilteredResult } from './types'

export function useSortedFilteredItems<T extends FilterableItem>(
	items: T[],
	config: FilterConfig<T>,
	state: FilterState,
): FilteredResult<T> {
	return useMemo(() => {
		const totalCount = items.length
		const normalizedQuery = state.searchQuery.trim().toLowerCase()

		// Step 1: Filter by search query
		let filtered = items.filter((item) => {
			if (normalizedQuery) {
				const searchables = config.getSearchableText(item)
				return searchables.some(
					(text) => typeof text === 'string' && text.toLowerCase().includes(normalizedQuery),
				)
			}
			return true
		})

		const filteredCount = filtered.length

		// Step 2: Sort
		filtered = [...filtered].sort((a, b) => {
			if (state.sortConfig.field === 'recency') {
				const diff = (b.created_at ?? 0) - (a.created_at ?? 0)
				return state.sortConfig.direction === 'desc' ? diff : -diff
			}
			// Sort by name
			const nameA = config.getName(a).toLowerCase()
			const nameB = config.getName(b).toLowerCase()
			const diff = nameA.localeCompare(nameB)
			return state.sortConfig.direction === 'asc' ? diff : -diff
		})

		// Step 3: Limit
		const limited = filtered.slice(0, state.displayLimit)
		const hasMore = filtered.length > state.displayLimit

		return {
			items: limited,
			filteredItems: filtered,
			totalCount,
			filteredCount,
			displayedCount: limited.length,
			hasMore,
		}
	}, [items, config, state])
}
