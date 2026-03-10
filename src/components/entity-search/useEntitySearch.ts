import { useMemo } from 'react'
import type { FilterState } from '@/components/data-filter/types'
import { useSortedFilteredItems } from '@/components/data-filter/useSortedFilteredItems'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import {
	type EntitySearchOutput,
	type EntitySearchResultGroup,
	type EntitySearchSources,
	type EntityType,
	ENTITY_TYPE_LABELS,
	contextFilterConfig,
	contextToSearchResult,
	createDatasetFilterConfig,
	datasetToSearchResult,
	featureToSearchResult,
} from './types'

interface UseEntitySearchOptions {
	sources: EntitySearchSources
	entityTypes?: EntityType[]
	filterState: FilterState
	getDatasetName?: (event: NDKGeoEvent) => string
}

const defaultGetDatasetName = (event: NDKGeoEvent): string =>
	event.datasetId ?? event.dTag ?? event.id ?? 'Untitled'
const DEFAULT_ENTITY_TYPES: EntityType[] = ['dataset', 'context', 'feature']

export function useEntitySearch({
	sources,
	entityTypes,
	filterState,
	getDatasetName = defaultGetDatasetName,
}: UseEntitySearchOptions): EntitySearchOutput {
	const activeTypes = useMemo(() => entityTypes ?? DEFAULT_ENTITY_TYPES, [entityTypes])

	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const datasets = sources.datasets ?? []
	const contexts = sources.contexts ?? []
	const features = sources.features ?? []

	const datasetResult = useSortedFilteredItems(
		activeTypes.includes('dataset') ? datasets : [],
		datasetFilterConfig,
		filterState,
	)

	const contextResult = useSortedFilteredItems(
		activeTypes.includes('context') ? contexts : [],
		contextFilterConfig,
		filterState,
	)

	// Features lack created_at/pubkey so filter with simple useMemo
	const featureResult = useMemo(() => {
		if (!activeTypes.includes('feature') || features.length === 0) {
			return { items: [], totalCount: 0, filteredCount: 0 }
		}
		const query = filterState.searchQuery.trim().toLowerCase()
		const filtered = query
			? features.filter(
					(f) =>
						f.name.toLowerCase().includes(query) || f.datasetName?.toLowerCase().includes(query),
				)
			: features
		return {
			items: filtered.slice(0, filterState.displayLimit),
			totalCount: features.length,
			filteredCount: filtered.length,
		}
	}, [activeTypes, features, filterState.searchQuery, filterState.displayLimit])

	return useMemo(() => {
		const groups: EntitySearchResultGroup[] = []

		if (activeTypes.includes('dataset') && datasetResult.totalCount > 0) {
			groups.push({
				type: 'dataset',
				label: ENTITY_TYPE_LABELS.dataset,
				results: datasetResult.items.map((e) => datasetToSearchResult(e, getDatasetName)),
				totalCount: datasetResult.totalCount,
				filteredCount: datasetResult.filteredCount,
			})
		}

		if (activeTypes.includes('context') && contextResult.totalCount > 0) {
			groups.push({
				type: 'context',
				label: ENTITY_TYPE_LABELS.context,
				results: contextResult.items.map(contextToSearchResult),
				totalCount: contextResult.totalCount,
				filteredCount: contextResult.filteredCount,
			})
		}

		if (activeTypes.includes('feature') && featureResult.totalCount > 0) {
			groups.push({
				type: 'feature',
				label: ENTITY_TYPE_LABELS.feature,
				results: featureResult.items.map(featureToSearchResult),
				totalCount: featureResult.totalCount,
				filteredCount: featureResult.filteredCount,
			})
		}

		const results = groups.flatMap((g) => g.results)
		const totalCount = groups.reduce((sum, g) => sum + g.totalCount, 0)
		const filteredCount = groups.reduce((sum, g) => sum + g.filteredCount, 0)

		return {
			results,
			groups,
			totalCount,
			filteredCount,
			hasResults: results.length > 0,
		}
	}, [activeTypes, datasetResult, contextResult, featureResult, getDatasetName])
}
