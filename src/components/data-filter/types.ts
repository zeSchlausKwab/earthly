export type SortField = 'recency' | 'name'
export type SortDirection = 'asc' | 'desc'

export interface SortConfig {
	field: SortField
	direction: SortDirection
}

export interface FilterState {
	searchQuery: string
	sortConfig: SortConfig
	displayLimit: number
}

export interface FilterActions {
	setSearchQuery: (query: string) => void
	setSortConfig: (config: SortConfig) => void
	setDisplayLimit: (limit: number) => void
	resetFilters: () => void
}

export interface FilterableItem {
	created_at?: number
	pubkey: string
}

export interface FilterConfig<T extends FilterableItem> {
	getSearchableText: (item: T) => (string | undefined)[]
	getName: (item: T) => string
}

export interface FilteredResult<T> {
	items: T[]
	filteredItems: T[]
	totalCount: number
	filteredCount: number
	displayedCount: number
	hasMore: boolean
}

export const DEFAULT_FILTER_STATE: FilterState = {
	searchQuery: '',
	sortConfig: { field: 'recency', direction: 'desc' },
	displayLimit: 25,
}

export const LIMIT_OPTIONS = [10, 25, 50, 100] as const
