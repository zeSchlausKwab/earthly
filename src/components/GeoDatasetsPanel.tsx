import { Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	getContextCoordinate,
	getEffectiveContextUse,
	getEffectiveContextValidationMode,
} from '@/lib/context/validation'
import { orderContextsForDisplay } from '@/lib/context/displayOrdering'
import { cn } from '@/lib/utils'
import { useEditorStore } from '@/features/geo-editor/store'
import { useFilterState, useSortedFilteredItems, type FilterConfig } from './data-filter'
import {
	createContextColumns,
	type ContextColumnsContext,
	type ContextRowData,
} from '../features/contexts/contexts-columns'
import { EntitySearchToolbar } from './entity-search'
import {
	createDatasetColumns,
	type DatasetColumnsContext,
	type DatasetRowData,
} from './datasets-columns'
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'

export interface GeoDatasetsPanelProps {
	mode: 'datasets' | 'contexts'
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	activeDataset: GeoDataset | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onInspectDataset?: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset) => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onInspectContext?: (context: MapContext) => void
	onOpenDebug?: (event: GeoDataset | MapContext) => void
	onCreateContext?: () => void
	onEditContext?: (context: MapContext) => void
	isFocused?: boolean
	onExitFocus?: () => void
	onFilteredDatasetKeysChange?: (keys: Set<string> | null) => void
}

const getDatasetDescriptionText = (event: GeoDataset): string | undefined => {
	const featureCollection = event.featureCollection as unknown as Record<string, unknown>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection.description,
		featureCollection.summary,
		(featureCollection.properties as Record<string, unknown> | undefined)?.description,
		(featureCollection.properties as Record<string, unknown> | undefined)?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

const createDatasetFilterConfig = (
	getDatasetName: (event: GeoDataset) => string,
): FilterConfig<GeoDataset> => ({
	getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
	getName: (event) => getDatasetName(event),
})

const getContextDisplayName = (context: MapContext): string =>
	context.context.name || context.contextId || context.id || 'Untitled'

const contextFilterConfig: FilterConfig<MapContext> = {
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
	mapContextEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	isPublishing,
	deletingKey,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onInspectDataset,
	onAddDatasetToMap,
	onRemoveDatasetFromMap,
	onInspectContext,
	onOpenDebug,
	onCreateContext,
	onEditContext,
	isFocused = false,
	onExitFocus,
	onFilteredDatasetKeysChange,
}: GeoDatasetsPanelProps) {
	const filterState = useFilterState()
	const prevFilteredKeysRef = useRef<Set<string> | null>(null)
	const viewContext = useEditorStore((state) => state.viewContext)
	const activeContextScopeCoordinate = useEditorStore((state) => state.activeContextScopeCoordinate)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const effectiveContextCoordinate = viewContext?.contextCoordinate ?? activeContextScopeCoordinate
	// Round G.2: catalog favorites + recents (scoped localStorage via the
	// catalog slice). The tab strip below narrows the table to either set.
	const pinnedEntityIds = useEditorStore((state) => state.pinnedEntityIds)
	const recentEntities = useEditorStore((state) => state.recentEntities)
	const togglePinnedEntity = useEditorStore((state) => state.togglePinnedEntity)
	const [catalogTab, setCatalogTab] = useState<'all' | 'favorites' | 'recent'>('all')
	const pinnedEntitySet = useMemo(() => new Set(pinnedEntityIds), [pinnedEntityIds])
	const recentRankById = useMemo(
		() => new Map(recentEntities.map((entry, index) => [entry.id, index])),
		[recentEntities],
	)

	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const datasetResult = useSortedFilteredItems(geoEvents, datasetFilterConfig, filterState)
	const contextResult = useSortedFilteredItems(mapContextEvents, contextFilterConfig, filterState)

	const filteredGeoEvents = datasetResult.items
	const filteredContexts = contextResult.items

	useEffect(() => {
		if (!onFilteredDatasetKeysChange) return
		return () => {
			prevFilteredKeysRef.current = null
			onFilteredDatasetKeysChange(null)
		}
	}, [onFilteredDatasetKeysChange])

	useEffect(() => {
		if (!onFilteredDatasetKeysChange) return
		if (mode !== 'datasets') {
			prevFilteredKeysRef.current = null
			onFilteredDatasetKeysChange(null)
			return
		}

		const keys = new Set(datasetResult.filteredItems.map((event) => getDatasetKey(event)))
		const previous = prevFilteredKeysRef.current
		if (previous && previous.size === keys.size) {
			let same = true
			for (const key of keys) {
				if (!previous.has(key)) {
					same = false
					break
				}
			}
			if (same) return
		}
		prevFilteredKeysRef.current = keys
		onFilteredDatasetKeysChange(keys)
	}, [datasetResult.filteredItems, getDatasetKey, mode, onFilteredDatasetKeysChange])

	const datasetTableData: DatasetRowData[] = useMemo(
		() =>
			filteredGeoEvents.map((event) => {
				const datasetKey = getDatasetKey(event)
				const isActive = activeDataset ? getDatasetKey(activeDataset) === datasetKey : false
				const isOwned = currentUserPubkey === event.pubkey
				return {
					event,
					datasetKey,
					datasetName: getDatasetName(event),
					isActive,
					isOwned,
					isVisible: datasetVisibility[datasetKey] !== false,
					isInMapStack: Boolean(mapStackEntries[`dataset:${datasetKey}`]),
					isCatalogPinned: pinnedEntitySet.has(`dataset:${datasetKey}`),
					primaryLabel: isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy',
				}
			}),
		[
			filteredGeoEvents,
			activeDataset,
			currentUserPubkey,
			datasetVisibility,
			getDatasetKey,
			getDatasetName,
			mapStackEntries,
			pinnedEntitySet,
		],
	)

	// Round G.2: tab-narrowed views. Favorites filters to starred entities;
	// Recent filters to the interaction ring buffer, most recent first.
	const displayedDatasetRows = useMemo(() => {
		if (catalogTab === 'favorites') {
			return datasetTableData.filter((row) => row.isCatalogPinned)
		}
		if (catalogTab === 'recent') {
			return datasetTableData
				.filter((row) => recentRankById.has(`dataset:${row.datasetKey}`))
				.sort(
					(a, b) =>
						(recentRankById.get(`dataset:${a.datasetKey}`) ?? 0) -
						(recentRankById.get(`dataset:${b.datasetKey}`) ?? 0),
				)
		}
		return datasetTableData
	}, [datasetTableData, catalogTab, recentRankById])

	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	const contextTableData: ContextRowData[] = useMemo(() => {
		const nameByCoordinate = new Map<string, string>()
		filteredContexts.forEach((context) => {
			const coordinate = context.contextCoordinate
			if (coordinate) {
				nameByCoordinate.set(coordinate, getContextDisplayName(context))
			}
		})
		return orderContextsForDisplay(filteredContexts).map(
			({ context, depth, displayParentCoordinate }) => {
				const coordinate = getContextCoordinate(context)
				return {
					context,
					contextName: getContextDisplayName(context),
					contextUse: getEffectiveContextUse(context),
					validationMode: context.context.allowForeignAttachments
						? getEffectiveContextValidationMode(context)
						: null,
					attachmentPolicy: context.context.allowForeignAttachments ? 'open' : 'closed',
					displayDepth: depth,
					displayParentName: displayParentCoordinate
						? (nameByCoordinate.get(displayParentCoordinate) ?? null)
						: null,
					isCuratedChild:
						depth > 0 &&
						!context.context.allowForeignAttachments &&
						context.contextReferences.length > 0,
					attachmentCount: context.contextReferences.length,
					isMapActive: coordinate === effectiveContextCoordinate,
					isInMapStack: Boolean(coordinate && mapStackEntries[`context:${coordinate}`]),
					isCatalogPinned: Boolean(coordinate && pinnedEntitySet.has(`context:${coordinate}`)),
				}
			},
		)
	}, [filteredContexts, effectiveContextCoordinate, mapStackEntries, pinnedEntitySet])

	const displayedContextRows = useMemo(() => {
		const coordOf = (row: ContextRowData) => getContextCoordinate(row.context)
		if (catalogTab === 'favorites') {
			return contextTableData.filter((row) => row.isCatalogPinned)
		}
		if (catalogTab === 'recent') {
			return contextTableData
				.filter((row) => recentRankById.has(`context:${coordOf(row)}`))
				.sort(
					(a, b) =>
						(recentRankById.get(`context:${coordOf(a)}`) ?? 0) -
						(recentRankById.get(`context:${coordOf(b)}`) ?? 0),
				)
		}
		return contextTableData
	}, [contextTableData, catalogTab, recentRankById])

	const toggleDatasetFavorite = useCallback(
		(event: GeoDataset) => {
			togglePinnedEntity(`dataset:${getDatasetKey(event)}`)
		},
		[togglePinnedEntity, getDatasetKey],
	)

	const toggleContextFavorite = useCallback(
		(context: MapContext) => {
			const coordinate = getContextCoordinate(context)
			if (coordinate) togglePinnedEntity(`context:${coordinate}`)
		},
		[togglePinnedEntity],
	)

	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onAddDatasetToMap,
			onRemoveDatasetFromMap,
			onToggleCatalogPin: toggleDatasetFavorite,
			canFavorite: Boolean(currentUserPubkey),
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
			onAddDatasetToMap,
			onRemoveDatasetFromMap,
			toggleDatasetFavorite,
			currentUserPubkey,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		],
	)

	// Round F.3: context rows get the same stack-toggle primary verb as dataset
	// rows. Reads/writes the store directly (like MapStackPanel does) so the
	// verb works in every surface that renders this panel without prop drift.
	const toggleContextOnMap = useCallback((context: MapContext) => {
		const coordinate = getContextCoordinate(context)
		if (!coordinate) return
		const store = useEditorStore.getState()
		const entryId = `context:${coordinate}`
		if (store.mapStackEntries[entryId]) {
			store.removeMapStackEntry(entryId)
			return
		}
		store.addMapStackEntry({
			entityType: 'context',
			entityKey: coordinate,
			title: getContextDisplayName(context),
			source: 'manual',
			visible: true,
			pinned: false,
		})
	}, [])

	const contextColumnsContext: ContextColumnsContext = useMemo(
		() => ({
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onToggleContextOnMap: toggleContextOnMap,
			onToggleCatalogPin: toggleContextFavorite,
			onOpenDebug: onOpenDebug
				? (event) => {
						onOpenDebug(event)
					}
				: undefined,
		}),
		[
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onOpenDebug,
			toggleContextOnMap,
			toggleContextFavorite,
		],
	)

	const datasetColumns = useMemo(
		() => createDatasetColumns(datasetColumnsContext),
		[datasetColumnsContext],
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
						<div className="space-y-1">
							<p className="text-xs text-primary">Focused map view</p>
							<p className="text-[11px] text-primary">
								Only the focused dataset is currently visible on the map. Visibility checkboxes
								below control map visibility only, and “Show all” restores the normal map view.
							</p>
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							{mode === 'datasets'
								? 'Remote GeoJSON datasets available to load.'
								: 'Taxonomy and validation contexts.'}
						</p>
					)}
				</div>
				<div className="flex items-center gap-1">
					{/* Round G.2 / U.5: All | Favorites | Recent tab strip — moved up
					    onto the header row to save a row. Favorites and recents are
					    per-user (scoped localStorage) and apply on top of the filter
					    toolbar below. */}
					<div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
						{(
							[
								{ key: 'all', label: 'All' },
								{ key: 'favorites', label: 'Favorites' },
								{ key: 'recent', label: 'Recent' },
							] as const
						).map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => setCatalogTab(tab.key)}
								className={cn(
									'rounded-md px-2 py-1 text-xs font-medium transition-colors',
									catalogTab === tab.key
										? 'bg-background text-foreground shadow-sm'
										: 'text-muted-foreground hover:text-foreground',
								)}
							>
								{tab.label}
							</button>
						))}
					</div>
					{isFocused && onExitFocus ? (
						<Button
							size="sm"
							variant="outline"
							onClick={onExitFocus}
							className="text-xs"
							title="Restore normal map visibility for all datasets"
						>
							<Eye className="mr-1 h-3.5 w-3.5" />
							Show all
						</Button>
					) : null}
					{mode === 'contexts' && onCreateContext ? (
						<Button size="sm" variant="outline" onClick={onCreateContext} className="text-xs">
							New context
						</Button>
					) : null}
				</div>
			</div>

			<EntitySearchToolbar
				{...filterState}
				totalCount={mode === 'datasets' ? datasetResult.totalCount : contextResult.totalCount}
				filteredCount={
					mode === 'datasets' ? datasetResult.filteredCount : contextResult.filteredCount
				}
				displayedCount={
					mode === 'datasets' ? datasetResult.displayedCount : contextResult.displayedCount
				}
				hasMore={mode === 'datasets' ? datasetResult.hasMore : contextResult.hasMore}
			/>

			{mode === 'datasets' ? (
				geoEvents.length === 0 ? (
					<p className="text-xs text-muted-foreground">Listening for GeoJSON datasets…</p>
				) : displayedDatasetRows.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						{catalogTab === 'favorites'
							? 'No favorite datasets yet — tap the star on a row.'
							: catalogTab === 'recent'
								? 'No recently viewed datasets yet.'
								: 'No datasets match your filters.'}
					</p>
				) : (
					<DataTable
						columns={datasetColumns}
						data={displayedDatasetRows}
						getRowId={(row) => row.datasetKey}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : mapContextEvents.length === 0 ? (
				<p className="text-xs text-muted-foreground">Listening for map contexts…</p>
			) : displayedContextRows.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					{catalogTab === 'favorites'
						? 'No favorite contexts yet — star one on a row.'
						: catalogTab === 'recent'
							? 'No recently viewed contexts yet.'
							: 'No contexts match your filters.'}
				</p>
			) : (
				<DataTable
					columns={contextColumns}
					data={displayedContextRows}
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
