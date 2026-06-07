import { Eye } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
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
		],
	)

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
			({ context, depth, displayParentCoordinate }) => ({
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
				isMapActive: getContextCoordinate(context) === effectiveContextCoordinate,
			}),
		)
	}, [filteredContexts, effectiveContextCoordinate])

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
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
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
							<p className="text-xs text-amber-700">Focused map view</p>
							<p className="text-[11px] text-amber-600">
								Only the focused dataset is currently visible on the map. Visibility checkboxes
								below control map visibility only, and “Show all” restores the normal map view.
							</p>
						</div>
					) : (
						<p className="text-xs text-gray-500">
							{mode === 'datasets'
								? 'Remote GeoJSON datasets available to load.'
								: 'Taxonomy and validation contexts.'}
						</p>
					)}
				</div>
				<div className="flex items-center gap-1">
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
