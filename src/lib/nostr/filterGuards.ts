import type { Filter } from 'nostr-tools'

const INDEXABLE_CACHE_TAG = /^[#&][A-Za-z]$/

export function filterList(filters: Filter | Filter[] | null | undefined): Filter[] {
	if (!filters) return []
	if (!Array.isArray(filters)) return [filters]
	return filters.filter((filter): filter is Filter => Boolean(filter))
}

export function hasFilterList(filters: Filter | Filter[] | null | undefined): boolean {
	return filterList(filters).length > 0
}

export function filterRequestKey(filters: Filter | Filter[] | null | undefined): string | null {
	const list = filterList(filters)
	if (list.length === 0) return null
	return JSON.stringify(list)
}

export function isCacheQueryableFilter(filter: Filter): boolean {
	if (filter.search) return true
	if (
		filter.ids !== undefined ||
		filter.authors !== undefined ||
		filter.kinds !== undefined ||
		filter.since !== undefined ||
		filter.until !== undefined
	) {
		return true
	}

	return Object.entries(filter).some(
		([key, value]) => INDEXABLE_CACHE_TAG.test(key) && Array.isArray(value) && value.length > 0,
	)
}

export function cacheQueryableFilters(filters: Filter[]): Filter[] {
	return filters.filter(isCacheQueryableFilter)
}
