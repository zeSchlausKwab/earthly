import { Plus, Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
import {
	type CollectionColumnsContext,
	type CollectionRowData,
	createCollectionColumns,
} from '../features/collections/collections-columns'
import {
	createContextColumns,
	type ContextColumnsContext,
	type ContextRowData,
} from '../features/contexts/contexts-columns'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import { EntitySearchToolbar } from './entity-search'
import {
	createDatasetColumns,
	type DatasetColumnsContext,
	type DatasetRowData,
} from './datasets-columns'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'

export interface GeoDatasetsPanelProps {
	/** Which content to display: 'datasets' or 'collections' or 'contexts' */
	mode: 'datasets' | 'collections' | 'contexts'
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	mapContextEvents: NDKMapContextEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void
	onCreateCollection?: () => void
	onCreateContext?: () => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onEditContext?: (context: NDKMapContextEvent) => void
	availableFeatures?: GeoFeatureItem[]
	/** Whether focus mode is active (viewing a single dataset/collection via route) */
	isFocused?: boolean
	/** Callback to exit focus mode */
	onExitFocus?: () => void
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
}

const getDatasetDescriptionText = (event: NDKGeoEvent): string | undefined => {
	const featureCollection = event.featureCollection as Record<string, any>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		featureCollection?.properties?.description,
		featureCollection?.properties?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

const getCollectionDisplayName = (collection: NDKGeoCollectionEvent): string => {
	const metadata = collection.metadata
	return metadata.name ?? collection.collectionId ?? collection.id ?? 'Untitled'
}

// Filter configs for the abstract filter system
const createDatasetFilterConfig = (
	getDatasetName: (event: NDKGeoEvent) => string,
): FilterConfig<NDKGeoEvent> => ({
	getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
	getName: (event) => getDatasetName(event),
})

const collectionFilterConfig: FilterConfig<NDKGeoCollectionEvent> = {
	getSearchableText: (collection) => {
		const metadata = collection.metadata
		return [metadata.name, metadata.description, collection.collectionId, collection.id]
	},
	getName: (collection) => getCollectionDisplayName(collection),
}

const getContextDisplayName = (context: NDKMapContextEvent): string => {
	return context.context.name || context.contextId || context.id || 'Untitled'
}

const contextFilterConfig: FilterConfig<NDKMapContextEvent> = {
	getSearchableText: (context) => {
		const content = context.context
		return [
			content.name,
			content.description,
			content.contextUse,
			content.validationMode,
			context.contextId,
			context.id,
		]
	},
	getName: (context) => getContextDisplayName(context),
}

export function GeoDatasetsPanelContent({
	mode,
	geoEvents,
	collectionEvents,
	mapContextEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
	isPublishing,
	deletingKey,
	onClearEditing,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onInspectContext,
	onOpenDebug,
	onCreateCollection,
	onCreateContext,
	onEditCollection,
	onEditContext,
	availableFeatures = [],
	isFocused = false,
	onExitFocus,
	onFilteredDatasetKeysChange,
}: GeoDatasetsPanelProps) {
	// Filter state and hooks
	const filterState = useFilterState()

	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const datasetResult = useSortedFilteredItems(geoEvents, datasetFilterConfig, filterState)

	const collectionResult = useSortedFilteredItems(
		collectionEvents,
		collectionFilterConfig,
		filterState,
	)
	const contextResult = useSortedFilteredItems(mapContextEvents, contextFilterConfig, filterState)

	const filteredGeoEvents = datasetResult.items
	const filteredCollections = collectionResult.items
	const filteredContexts = contextResult.items

	// Track previous keys to avoid infinite update loops
	const prevFilteredKeysRef = useRef<Set<string> | null>(null)

	// Report filtered dataset keys to parent for map visibility sync
	useEffect(() => {
		if (!onFilteredDatasetKeysChange) return
		// Only sync dataset filters to the map when the dataset list is active.
		// (Collections view shouldn't implicitly hide datasets on the map.)
		if (mode !== 'datasets') return
		const keys = new Set(filteredGeoEvents.map((event) => getDatasetKey(event)))

		// Only update if keys actually changed
		const prevKeys = prevFilteredKeysRef.current
		if (prevKeys && keys.size === prevKeys.size) {
			let same = true
			for (const k of keys) {
				if (!prevKeys.has(k)) {
					same = false
					break
				}
			}
			if (same) return
		}

		prevFilteredKeysRef.current = keys
		onFilteredDatasetKeysChange(keys)
	}, [filteredGeoEvents, getDatasetKey, mode, onFilteredDatasetKeysChange])

	const datasetReferenceMap = useMemo(() => {
		const map = new Map<string, NDKGeoEvent>()
		geoEvents.forEach((event) => {
			const datasetId = event.datasetId ?? event.dTag ?? event.id
			if (!datasetId) return
			const kind = event.kind ?? 37515
			map.set(`${kind}:${event.pubkey}:${datasetId}`, event)
		})
		return map
	}, [geoEvents])

	// Prepare dataset table data
	const datasetTableData: DatasetRowData[] = useMemo(() => {
		return filteredGeoEvents.map((event) => {
			const datasetKey = getDatasetKey(event)
			const isActive = activeDataset && getDatasetKey(activeDataset) === datasetKey
			const isOwned = currentUserPubkey === event.pubkey
			const primaryLabel = isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy'
			const datasetName = getDatasetName(event)
			const isVisible = datasetVisibility[datasetKey] !== false

			return {
				event,
				datasetKey,
				datasetName,
				isActive: !!isActive,
				isOwned,
				isVisible,
				primaryLabel,
			}
		})
	}, [
		filteredGeoEvents,
		activeDataset,
		currentUserPubkey,
		datasetVisibility,
		getDatasetKey,
		getDatasetName,
	])

	// Compute visibility state for all filtered datasets (for header checkbox)
	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	// Get collection key for visibility
	const getCollectionKey = useCallback((collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}, [])

	// Prepare collection table data
	const collectionTableData: CollectionRowData[] = useMemo(() => {
		return filteredCollections.map((collection) => {
			const collectionName = getCollectionDisplayName(collection)
			const datasetCount = collection.datasetReferences.length
			const referencedEvents = collection.datasetReferences
				.map((reference) => datasetReferenceMap.get(reference))
				.filter((event): event is NDKGeoEvent => Boolean(event))
			const zoomDisabled =
				!onZoomToCollection || (!collection.boundingBox && referencedEvents.length === 0)
			const collectionKey = getCollectionKey(collection)
			const isVisible = collectionVisibility[collectionKey] !== false

			return {
				collection,
				collectionName,
				datasetCount,
				referencedEvents,
				zoomDisabled,
				isVisible,
			}
		})
	}, [
		filteredCollections,
		datasetReferenceMap,
		onZoomToCollection,
		collectionVisibility,
		getCollectionKey,
	])

	// Compute visibility state for all filtered collections (for header checkbox)
	const allCollectionVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (collectionTableData.length === 0) return 'none'
		const visibleCount = collectionTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === collectionTableData.length) return 'all'
		return 'some'
	}, [collectionTableData])

	const contextTableData: ContextRowData[] = useMemo(
		() =>
			filteredContexts.map((context) => {
				const content = context.context
				return {
					context,
					contextName: getContextDisplayName(context),
					contextUse: content.contextUse,
					validationMode: content.validationMode,
					attachmentPolicy: content.allowForeignAttachments ? 'open' : 'closed',
				}
			}),
		[filteredContexts],
	)

	// Dataset columns context
	// Note: resolvingDatasets/resolvingProgress not included - DatasetLoadButton subscribes directly to store
	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		}),
		[
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		],
	)

	// Collection columns context
	const collectionColumnsContext: CollectionColumnsContext = useMemo(
		() => ({
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleVisibility: onToggleCollectionVisibility,
			onToggleAllVisibility: onToggleAllCollectionVisibility,
			currentUserPubkey,
			allVisibleState: allCollectionVisibleState,
		}),
		[
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleCollectionVisibility,
			onToggleAllCollectionVisibility,
			currentUserPubkey,
			allCollectionVisibleState,
		],
	)

	const contextColumnsContext: ContextColumnsContext = useMemo(
		() => ({
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onOpenDebug: onOpenDebug
				? (event) => {
						onOpenDebug(event)
					}
				: undefined,
		}),
		[currentUserPubkey, onInspectContext, onEditContext, onOpenDebug],
	)

	const datasetColumns = useMemo(
		() => createDatasetColumns(datasetColumnsContext),
		[datasetColumnsContext],
	)

	const collectionColumns = useMemo(
		() => createCollectionColumns(collectionColumnsContext),
		[collectionColumnsContext],
	)

	const contextColumns = useMemo(
		() => createContextColumns(contextColumnsContext),
		[contextColumnsContext],
	)
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					{isFocused ? (
						<p className="text-xs text-amber-600">Focused view — others hidden</p>
					) : (
						<p className="text-xs text-gray-500">
							{mode === 'datasets'
								? 'Remote GeoJSON datasets available to load.'
								: mode === 'collections'
									? 'Curated collections of datasets.'
									: 'Taxonomy and validation contexts.'}
						</p>
					)}
				</div>
				<div className="flex items-center gap-1">
					{isFocused && onExitFocus && (
						<Button size="sm" variant="outline" onClick={onExitFocus} className="text-xs">
							<Eye className="h-3.5 w-3.5 mr-1" />
							Show all
						</Button>
					)}
					{mode === 'collections' && onCreateCollection && (
						<Button
							size="icon"
							variant="outline"
							onClick={onCreateCollection}
							aria-label="Create new collection"
							title="Create new collection"
						>
							<Plus className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>
			<EntitySearchToolbar
				{...filterState}
				totalCount={
					mode === 'datasets'
						? datasetResult.totalCount
						: mode === 'collections'
							? collectionResult.totalCount
							: contextResult.totalCount
				}
				filteredCount={
					mode === 'datasets'
						? datasetResult.filteredCount
						: mode === 'collections'
							? collectionResult.filteredCount
							: contextResult.filteredCount
				}
				displayedCount={
					mode === 'datasets'
						? datasetResult.displayedCount
						: mode === 'collections'
							? collectionResult.displayedCount
							: contextResult.displayedCount
				}
				hasMore={
					mode === 'datasets'
						? datasetResult.hasMore
						: mode === 'collections'
							? collectionResult.hasMore
							: contextResult.hasMore
				}
			/>

			{mode === 'datasets' ? (
				geoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">Listening for GeoJSON datasets…</p>
				) : filteredGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets match your filters.</p>
				) : (
					<DataTable
						columns={datasetColumns}
						data={datasetTableData}
						getRowId={(row) => row.datasetKey}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : mode === 'collections' ? (
				collectionEvents.length === 0 ? (
					<p className="text-xs text-gray-500">Listening for GeoJSON collections…</p>
				) : filteredCollections.length === 0 ? (
					<p className="text-xs text-gray-500">No collections match your filters.</p>
				) : (
					<DataTable
						columns={collectionColumns}
						data={collectionTableData}
						getRowId={(row) =>
							row.collection.dTag ??
							row.collection.collectionId ??
							row.collection.id ??
							row.collection.pubkey
						}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : mapContextEvents.length === 0 ? (
				<p className="text-xs text-gray-500">Listening for map contexts…</p>
			) : filteredContexts.length === 0 ? (
				<p className="text-xs text-gray-500">No contexts match your filters.</p>
			) : (
				<DataTable
					columns={contextColumns}
					data={contextTableData}
					getRowId={(row) => row.context.contextId ?? row.context.dTag ?? row.context.id}
				/>
			)}
		</div>
	)
}

export function GeoDatasetsSidebar({
	className,
	...props
}: GeoDatasetsPanelProps & { className?: string }) {
	return (
		<div className={cn('glass-panel w-80 rounded-lg p-3', className)}>
			<GeoDatasetsPanelContent {...props} />
		</div>
	)
}
