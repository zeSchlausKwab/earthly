import { useMemo } from 'react'
import type { FilterState } from '@/components/data-filter/types'
import { useSortedFilteredItems } from '@/components/data-filter/useSortedFilteredItems'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	type EntitySearchOutput,
	type EntitySearchResultGroup,
	type EntitySearchSources,
	type EntityType,
	ENTITY_TYPE_LABELS,
	beaconFilterConfig,
	beaconToSearchResult,
	contextFilterConfig,
	contextToSearchResult,
	createDatasetFilterConfig,
	datasetToSearchResult,
	featureToSearchResult,
	personFilterConfig,
	personToSearchResult,
	placeToSearchResult,
	sightingFilterConfig,
	sightingToSearchResult,
	storyFilterConfig,
	storyToSearchResult,
} from './types'

interface UseEntitySearchOptions {
	sources: EntitySearchSources
	entityTypes?: EntityType[]
	filterState: FilterState
	getDatasetName?: (event: GeoDataset) => string
}

const defaultGetDatasetName = (event: GeoDataset): string =>
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
	const stories = sources.stories ?? []
	const beacons = sources.beacons ?? []
	const sightings = sources.sightings ?? []
	const people = sources.people ?? []
	const places = sources.places ?? []

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

	const storyResult = useSortedFilteredItems(
		activeTypes.includes('story') ? stories : [],
		storyFilterConfig,
		filterState,
	)

	const sightingResult = useSortedFilteredItems(
		activeTypes.includes('sighting') ? sightings : [],
		sightingFilterConfig,
		filterState,
	)

	const beaconResult = useSortedFilteredItems(
		activeTypes.includes('beacon') ? beacons : [],
		beaconFilterConfig,
		filterState,
	)

	const personResult = useSortedFilteredItems(
		activeTypes.includes('person') ? people : [],
		personFilterConfig,
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

	// Place rows normally arrive from the existing geocoder hook, but accepting
	// local place sources keeps the search component usable with cached results.
	const placeResult = useMemo(() => {
		if (!activeTypes.includes('place') || places.length === 0) {
			return { items: [], totalCount: 0, filteredCount: 0 }
		}
		const query = filterState.searchQuery.trim().toLowerCase()
		const filtered = query
			? places.filter((place) =>
					[place.displayName, place.type, place.class].some((value) =>
						value?.toLowerCase().includes(query),
					),
				)
			: places
		const sorted =
			filterState.sortConfig.field === 'name'
				? [...filtered].sort((left, right) => {
						const diff = left.displayName.localeCompare(right.displayName)
						return filterState.sortConfig.direction === 'asc' ? diff : -diff
					})
				: filtered
		return {
			items: sorted.slice(0, filterState.displayLimit),
			totalCount: places.length,
			filteredCount: filtered.length,
		}
	}, [activeTypes, places, filterState])

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

		if (activeTypes.includes('story') && storyResult.totalCount > 0) {
			groups.push({
				type: 'story',
				label: ENTITY_TYPE_LABELS.story,
				results: storyResult.items.map(storyToSearchResult),
				totalCount: storyResult.totalCount,
				filteredCount: storyResult.filteredCount,
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

		if (activeTypes.includes('sighting') && sightingResult.totalCount > 0) {
			groups.push({
				type: 'sighting',
				label: ENTITY_TYPE_LABELS.sighting,
				results: sightingResult.items.map(sightingToSearchResult),
				totalCount: sightingResult.totalCount,
				filteredCount: sightingResult.filteredCount,
			})
		}

		if (activeTypes.includes('person') && personResult.totalCount > 0) {
			groups.push({
				type: 'person',
				label: ENTITY_TYPE_LABELS.person,
				results: personResult.items.map(personToSearchResult),
				totalCount: personResult.totalCount,
				filteredCount: personResult.filteredCount,
			})
		}

		if (activeTypes.includes('place') && placeResult.totalCount > 0) {
			groups.push({
				type: 'place',
				label: ENTITY_TYPE_LABELS.place,
				results: placeResult.items.map(placeToSearchResult),
				totalCount: placeResult.totalCount,
				filteredCount: placeResult.filteredCount,
			})
		}

		if (activeTypes.includes('beacon') && beaconResult.totalCount > 0) {
			groups.push({
				type: 'beacon',
				label: ENTITY_TYPE_LABELS.beacon,
				results: beaconResult.items.map(beaconToSearchResult),
				totalCount: beaconResult.totalCount,
				filteredCount: beaconResult.filteredCount,
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
	}, [
		activeTypes,
		beaconResult,
		contextResult,
		datasetResult,
		featureResult,
		getDatasetName,
		personResult,
		placeResult,
		sightingResult,
		storyResult,
	])
}
