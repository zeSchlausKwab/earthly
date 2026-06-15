import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Database,
	Focus,
	Layers,
	LocateFixed,
	PanelLeft,
	PencilLine,
	Pin,
	Search,
	Trash2,
	X,
} from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore, type MapStackEntry } from '../features/geo-editor/store'
import { getDefaultContextMapScopeMode, resolveContextMapScope } from '@/lib/context/scope'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { cn } from '@/lib/utils'

interface MapStackPanelProps {
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onAddDatasetToMap?: (event: GeoDataset) => void
	onInspectDataset: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	onLoadDataset: (event: GeoDataset) => void
	onInspectContext: (context: MapContext) => void
	/**
	 * Retained for backward compatibility — under the Round C invariant
	 * (stack = map visibility), the eye toggle is dropped and visibility is
	 * implicit. This callback is no longer wired to a UI control.
	 */
	onSetEntryVisible?: (entry: MapStackEntry, visible: boolean) => void
	onSetEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
	onRemoveEntry: (entry: MapStackEntry) => void
	/** Round H.5: open the editor panel in the sidebar for the in-edit draft row. */
	onOpenDraftEditor?: () => void
	/** Round H.5: zoom the map to the in-edit draft's geometry. */
	onZoomToDraft?: () => void
	onClear: () => void
	onClose?: () => void
	compact?: boolean
}

const sourceLabel: Record<MapStackEntry['source'], string> = {
	manual: 'manual',
	route: 'link',
	'context-curated': 'curated',
	'context-foreign': 'referenced',
	'child-context': 'child',
	chat: 'chat',
	comment: 'comment',
	proposal: 'proposal',
	workspace: 'workspace',
	'browse-default': 'suggested',
}

function hasDatasetDragData(event: DragEvent<HTMLElement>) {
	return Array.from(event.dataTransfer.types).includes('application/earthly-dataset-key')
}

/** Round G.1: mime used for intra-panel drag-to-reorder of stack rows. */
const STACK_REORDER_MIME = 'application/earthly-stack-entry'

function hasStackReorderData(event: DragEvent<HTMLElement>) {
	return Array.from(event.dataTransfer.types).includes(STACK_REORDER_MIME)
}

interface RowActionProps {
	icon: ReactNode
	label: string
	onClick: () => void
	tooltip?: ReactNode
	hoverClassName?: string
	className?: string
	active?: boolean
	pressed?: boolean
}

/**
 * Single per-row action button with Radix tooltip. Keeps the row JSX flat —
 * each call site is one tag rather than five layers of Tooltip/Trigger/Button.
 */
function RowAction({
	icon,
	label,
	onClick,
	tooltip,
	hoverClassName,
	className,
	active = false,
	pressed,
}: RowActionProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className={cn(className, hoverClassName, active && 'bg-amber-100 text-amber-700')}
					onClick={onClick}
					aria-label={label}
					aria-pressed={pressed}
				>
					{icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top" sideOffset={4} className="max-w-xs text-xs">
				{tooltip ?? label}
			</TooltipContent>
		</Tooltip>
	)
}

interface EntryRowProps {
	entry: MapStackEntry
	dataset: GeoDataset | undefined
	context: MapContext | undefined
	title: string
	compact: boolean
	actionIconClassName: string
	actionButtonClassName: string
	sourceLabel: Record<MapStackEntry['source'], string>
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onSetEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
	onZoomToDataset: (dataset: GeoDataset) => void
	onInspectDataset: (dataset: GeoDataset) => void
	onLoadDataset: (dataset: GeoDataset) => void
	onInspectContext: (context: MapContext) => void
	onRemoveEntry: (entry: MapStackEntry) => void
	onToggleEntryExclusion: (entryId: string, datasetKey: string) => void
	onTogglePinned: (entryId: string) => void
	onReorderEntry: (draggedId: string, targetId: string) => void
	onOpenDraftEditor?: () => void
	onZoomToDraft?: () => void
}

function EntryRow({
	entry,
	dataset,
	context,
	title,
	compact,
	actionIconClassName,
	actionButtonClassName,
	sourceLabel,
	geoEvents,
	mapContextEvents,
	getDatasetKey,
	getDatasetName,
	onSetEntryIsolated,
	onZoomToDataset,
	onInspectDataset,
	onLoadDataset,
	onInspectContext,
	onRemoveEntry,
	onToggleEntryExclusion,
	onTogglePinned,
	onOpenDraftEditor,
	onZoomToDraft,
	onReorderEntry,
}: EntryRowProps) {
	const isolated = entry.isolated === true
	const [expanded, setExpanded] = useState(false)
	// Resolve curated datasets only when this is a context entry. We compute
	// regardless of `expanded` (cheap; usually a handful) so the row can show
	// an accurate counter — but only render the checklist when expanded.
	const curatedDatasets = useMemo(() => {
		if (entry.entityType !== 'context' || !context) return [] as GeoDataset[]
		const scope = resolveContextMapScope(
			context,
			geoEvents,
			mapContextEvents,
			getDefaultContextMapScopeMode(context),
		)
		return scope.datasets.map((scoped) => scoped.dataset)
	}, [entry.entityType, context, geoEvents, mapContextEvents])
	const exclusionSet = useMemo(() => new Set(entry.exclusions ?? []), [entry.exclusions])
	const includedCuratedCount = curatedDatasets.reduce(
		(acc, d) => (exclusionSet.has(getDatasetKey(d)) ? acc : acc + 1),
		0,
	)
	// Context entries always show a count + expand affordance, even when the
	// curated set is empty. That makes "this context loaded but resolved to 0
	// datasets" legible instead of looking like the entry does nothing.
	const isContextEntry = entry.entityType === 'context'
	const canExpand = isContextEntry
	const [isReorderTarget, setIsReorderTarget] = useState(false)
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag-to-reorder container; all click targets inside are real buttons, and reordering stays reachable via the row action buttons for keyboard users.
		<div
			className={cn(
				'group relative flex cursor-grab flex-col rounded-md border bg-card transition-colors active:cursor-grabbing',
				isolated
					? 'border-amber-300 bg-amber-50/50 shadow-[inset_3px_0_0_0] shadow-amber-500'
					: 'border-border',
				!entry.visible && !isolated && 'opacity-60',
				isReorderTarget && 'border-sky-400 shadow-[0_-2px_0_0] shadow-sky-400',
			)}
			data-isolated={isolated ? 'true' : undefined}
			draggable
			onDragStart={(event) => {
				event.dataTransfer.setData(STACK_REORDER_MIME, entry.id)
				event.dataTransfer.effectAllowed = 'move'
			}}
			onDragOver={(event) => {
				if (!hasStackReorderData(event)) return
				event.preventDefault()
				event.stopPropagation()
				event.dataTransfer.dropEffect = 'move'
				setIsReorderTarget(true)
			}}
			onDragLeave={() => setIsReorderTarget(false)}
			onDrop={(event) => {
				if (!hasStackReorderData(event)) return
				event.preventDefault()
				event.stopPropagation()
				setIsReorderTarget(false)
				const draggedId = event.dataTransfer.getData(STACK_REORDER_MIME)
				if (draggedId && draggedId !== entry.id) {
					onReorderEntry(draggedId, entry.id)
				}
			}}
		>
			<div className={cn('flex items-start', compact ? 'gap-1.5 p-1.5 pl-2' : 'gap-2 p-2 pl-2.5')}>
				<div
					className={cn(
						'flex shrink-0 items-center justify-center rounded-md',
						entry.entityType === 'draft'
							? 'bg-emerald-100 text-emerald-700'
							: isolated
								? 'bg-amber-100 text-amber-700'
								: 'bg-muted text-muted-foreground',
						compact ? 'mt-0.5 h-6 w-6' : 'mt-1 h-7 w-7',
					)}
				>
					{entry.entityType === 'dataset' ? (
						<Database className={actionIconClassName} />
					) : entry.entityType === 'context' ? (
						<Layers className={actionIconClassName} />
					) : entry.entityType === 'draft' ? (
						<PencilLine className={actionIconClassName} />
					) : (
						<Layers className={actionIconClassName} />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<div
							className={cn(
								'line-clamp-2 min-w-0 break-words font-medium text-foreground',
								compact ? 'text-xs leading-tight' : 'text-sm leading-snug',
							)}
						>
							{title}
						</div>
						{isolated ? (
							<span
								className={cn(
									'shrink-0 rounded-full bg-amber-200/70 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-800',
									compact ? 'text-[9px]' : 'text-[10px]',
								)}
							>
								Isolated
							</span>
						) : null}
					</div>
					<div
						className={cn(
							'flex items-center text-muted-foreground',
							compact ? 'mt-0.5 gap-1 text-[11px]' : 'mt-1 gap-1.5 text-xs',
						)}
					>
						<span>{entry.entityType}</span>
						<span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
						<span>{sourceLabel[entry.source]}</span>
						{isContextEntry ? (
							<>
								<span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
								<span className={curatedDatasets.length === 0 ? 'italic' : undefined}>
									{curatedDatasets.length === 0
										? 'no curated data'
										: `${includedCuratedCount}/${curatedDatasets.length} curated`}
								</span>
							</>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					{canExpand ? (
						<RowAction
							icon={
								expanded ? (
									<ChevronDown className={actionIconClassName} />
								) : (
									<ChevronRight className={actionIconClassName} />
								)
							}
							className={cn(actionButtonClassName, 'hover:text-foreground')}
							onClick={() => setExpanded((open) => !open)}
							label={expanded ? 'Collapse curated datasets' : 'Expand curated datasets'}
							tooltip={
								expanded
									? 'Hide the curated dataset checklist'
									: 'Show the curated dataset checklist — uncheck to exclude per-context'
							}
							pressed={expanded}
						/>
					) : null}
					{onSetEntryIsolated ? (
						<RowAction
							icon={<Focus className={actionIconClassName} />}
							className={cn(
								actionButtonClassName,
								isolated ? 'text-amber-600 hover:text-amber-700' : 'hover:text-amber-700',
							)}
							onClick={() => onSetEntryIsolated(entry, !isolated)}
							label={isolated ? 'Stop isolating' : 'Isolate on the map'}
							tooltip={
								isolated
									? 'Show all (stop isolating)'
									: entry.entityType === 'context'
										? 'Show only this context on the map'
										: entry.entityType === 'draft'
											? 'Isolate the edit — hide other layers while drawing'
											: 'Show only this dataset on the map'
							}
							pressed={isolated}
							active={isolated}
						/>
					) : null}
					{entry.entityType === 'draft' ? (
						<>
							{onZoomToDraft ? (
								<RowAction
									icon={<LocateFixed className={actionIconClassName} />}
									className={cn(actionButtonClassName, 'hover:text-sky-700')}
									onClick={onZoomToDraft}
									label="Zoom to edit"
									tooltip="Zoom the map to the geometry being edited"
								/>
							) : null}
							{onOpenDraftEditor ? (
								<RowAction
									icon={<PanelLeft className={actionIconClassName} />}
									className={cn(actionButtonClassName, 'hover:text-emerald-700')}
									onClick={onOpenDraftEditor}
									label="Open editor panel"
									tooltip="Show the edit state in the side panel"
								/>
							) : null}
						</>
					) : null}
					{entry.entityType !== 'draft' ? (
						<RowAction
							icon={<Pin className={cn(actionIconClassName, entry.pinned && 'fill-current')} />}
							className={cn(
								actionButtonClassName,
								entry.pinned ? 'text-sky-600 hover:text-sky-700' : 'hover:text-sky-700',
							)}
							onClick={() => onTogglePinned(entry.id)}
							label={entry.pinned ? 'Unpin' : 'Pin'}
							tooltip={
								entry.pinned ? 'Unpin — Clear will remove this entry again' : 'Pin — survives Clear'
							}
							pressed={entry.pinned}
						/>
					) : null}
					{dataset ? (
						<>
							<RowAction
								icon={<LocateFixed className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-sky-700')}
								onClick={() => onZoomToDataset(dataset)}
								label="Zoom to dataset"
								tooltip="Zoom the map to this dataset's bounds"
							/>
							<RowAction
								icon={<Search className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-emerald-700')}
								onClick={() => onInspectDataset(dataset)}
								label="Inspect dataset"
								tooltip="Open the dataset details panel"
							/>
							<RowAction
								icon={<Database className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-emerald-700')}
								onClick={() => onLoadDataset(dataset)}
								label="Load dataset into editor"
								tooltip="Load this dataset into the editor for changes"
							/>
						</>
					) : null}
					{context ? (
						<RowAction
							icon={<Search className={actionIconClassName} />}
							className={cn(actionButtonClassName, 'hover:text-emerald-700')}
							onClick={() => onInspectContext(context)}
							label="Inspect context"
							tooltip="Open the context details panel"
						/>
					) : null}
					<RowAction
						icon={
							entry.pinned ? (
								<Trash2 className={actionIconClassName} />
							) : (
								<X className={actionIconClassName} />
							)
						}
						className={cn(actionButtonClassName, 'hover:text-destructive')}
						onClick={() => onRemoveEntry(entry)}
						label={
							entry.entityType === 'draft'
								? 'Stop editing'
								: entry.pinned
									? 'Remove pinned entry'
									: 'Remove from map stack'
						}
						tooltip={
							entry.entityType === 'draft'
								? 'Stop editing and remove the draft from the map'
								: entry.pinned
									? 'Remove this pinned entry from the map stack'
									: 'Remove this entry from the map stack'
						}
					/>
				</div>
			</div>
			{canExpand && expanded ? (
				<div
					className={cn(
						'border-border border-t bg-muted/30 px-2 py-1.5',
						compact ? 'space-y-0.5' : 'space-y-1',
					)}
				>
					{curatedDatasets.length === 0 ? (
						<div
							className={cn(
								'rounded px-1.5 py-2 text-center text-muted-foreground italic',
								compact ? 'text-[11px]' : 'text-xs',
							)}
						>
							No curated datasets resolved for this context yet.
							{context?.context?.allowForeignAttachments ? (
								<>
									{' '}
									Datasets with an{' '}
									<code className="rounded bg-muted px-1 font-mono text-[10px]">a</code> tag
									pointing here will appear automatically.
								</>
							) : null}
						</div>
					) : null}
					{curatedDatasets.map((curated) => {
						const datasetKey = getDatasetKey(curated)
						const isExcluded = exclusionSet.has(datasetKey)
						const name = getDatasetName(curated)
						return (
							<label
								key={datasetKey}
								className={cn(
									'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-muted/60',
									compact ? 'text-[11px]' : 'text-xs',
								)}
							>
								<input
									type="checkbox"
									className="size-3.5 shrink-0 cursor-pointer rounded border-border accent-emerald-600"
									checked={!isExcluded}
									onChange={() => onToggleEntryExclusion(entry.id, datasetKey)}
									aria-label={
										isExcluded
											? `Include ${name} in this context`
											: `Exclude ${name} from this context`
									}
								/>
								<span
									className={cn(
										'min-w-0 flex-1 truncate',
										isExcluded ? 'text-muted-foreground line-through' : 'text-foreground',
									)}
								>
									{name}
								</span>
								<button
									type="button"
									className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-sky-700"
									onClick={(event) => {
										event.preventDefault()
										onZoomToDataset(curated)
									}}
									aria-label={`Zoom to ${name}`}
									title="Zoom to dataset"
								>
									<LocateFixed className="h-3 w-3" />
								</button>
							</label>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

interface EntryGroupListProps {
	compact: boolean
	draftEntries: MapStackEntry[]
	contextEntries: MapStackEntry[]
	datasetEntries: MapStackEntry[]
	otherEntries: MapStackEntry[]
	datasetByKey: Map<string, GeoDataset>
	contextByKey: Map<string, MapContext>
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	sourceLabel: Record<MapStackEntry['source'], string>
	actionIconClassName: string
	actionButtonClassName: string
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	onSetEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
	onZoomToDataset: (dataset: GeoDataset) => void
	onInspectDataset: (dataset: GeoDataset) => void
	onLoadDataset: (dataset: GeoDataset) => void
	onInspectContext: (context: MapContext) => void
	onRemoveEntry: (entry: MapStackEntry) => void
	onToggleEntryExclusion: (entryId: string, datasetKey: string) => void
	onTogglePinned: (entryId: string) => void
	onReorderEntry: (draggedId: string, targetId: string) => void
	onOpenDraftEditor?: () => void
	onZoomToDraft?: () => void
}

function EntryGroupList({
	compact,
	draftEntries,
	contextEntries,
	datasetEntries,
	otherEntries,
	datasetByKey,
	contextByKey,
	getDatasetKey,
	getDatasetName,
	sourceLabel,
	actionIconClassName,
	actionButtonClassName,
	geoEvents,
	mapContextEvents,
	onSetEntryIsolated,
	onZoomToDataset,
	onInspectDataset,
	onLoadDataset,
	onInspectContext,
	onRemoveEntry,
	onToggleEntryExclusion,
	onTogglePinned,
	onReorderEntry,
	onOpenDraftEditor,
	onZoomToDraft,
}: EntryGroupListProps) {
	const renderEntry = (entry: MapStackEntry) => {
		const dataset = entry.entityType === 'dataset' ? datasetByKey.get(entry.entityKey) : undefined
		const context = entry.entityType === 'context' ? contextByKey.get(entry.entityKey) : undefined
		const title = dataset ? getDatasetName(dataset) : entry.title
		return (
			<EntryRow
				key={entry.id}
				entry={entry}
				dataset={dataset}
				context={context}
				title={title}
				compact={compact}
				actionIconClassName={actionIconClassName}
				actionButtonClassName={actionButtonClassName}
				sourceLabel={sourceLabel}
				geoEvents={geoEvents}
				mapContextEvents={mapContextEvents}
				getDatasetKey={getDatasetKey}
				getDatasetName={getDatasetName}
				onSetEntryIsolated={onSetEntryIsolated}
				onZoomToDataset={onZoomToDataset}
				onInspectDataset={onInspectDataset}
				onLoadDataset={onLoadDataset}
				onInspectContext={onInspectContext}
				onRemoveEntry={onRemoveEntry}
				onToggleEntryExclusion={onToggleEntryExclusion}
				onTogglePinned={onTogglePinned}
				onReorderEntry={onReorderEntry}
				onOpenDraftEditor={onOpenDraftEditor}
				onZoomToDraft={onZoomToDraft}
			/>
		)
	}
	const groupLabelClass = cn(
		'flex items-center gap-1.5 px-1 pt-1 pb-0.5 font-semibold uppercase tracking-wide text-muted-foreground',
		compact ? 'text-[10px]' : 'text-[11px]',
	)
	const groupGap = compact ? 'space-y-1' : 'space-y-1.5'
	return (
		<div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3')}>
			{draftEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={cn(groupLabelClass, 'text-emerald-700')}>
						<PencilLine className="h-3 w-3" />
						<span>Editing</span>
						<span className="font-normal text-muted-foreground/70">({draftEntries.length})</span>
					</div>
					{draftEntries.map(renderEntry)}
				</div>
			) : null}
			{contextEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={groupLabelClass}>
						<Layers className="h-3 w-3" />
						<span>Contexts</span>
						<span className="font-normal text-muted-foreground/70">({contextEntries.length})</span>
					</div>
					{contextEntries.map(renderEntry)}
				</div>
			) : null}
			{datasetEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={groupLabelClass}>
						<Database className="h-3 w-3" />
						<span>Datasets</span>
						<span className="font-normal text-muted-foreground/70">({datasetEntries.length})</span>
					</div>
					{datasetEntries.map(renderEntry)}
				</div>
			) : null}
			{otherEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={groupLabelClass}>
						<span>Other</span>
						<span className="font-normal text-muted-foreground/70">({otherEntries.length})</span>
					</div>
					{otherEntries.map(renderEntry)}
				</div>
			) : null}
		</div>
	)
}

export function MapStackPanel({
	geoEvents,
	mapContextEvents,
	getDatasetKey,
	getDatasetName,
	onAddDatasetToMap,
	onInspectDataset,
	onZoomToDataset,
	onLoadDataset,
	onInspectContext,
	onSetEntryVisible: _onSetEntryVisible,
	onSetEntryIsolated,
	onRemoveEntry,
	onOpenDraftEditor,
	onZoomToDraft,
	onClear,
	onClose,
	compact = false,
}: MapStackPanelProps) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
	const toggleEntryExclusion = useEditorStore((state) => state.toggleMapStackEntryExclusion)
	const toggleEntryPinned = useEditorStore((state) => state.toggleMapStackEntryPinned)
	const setMapStackOrder = useEditorStore((state) => state.setMapStackOrder)

	// Round G.1: drag-to-reorder. Dropping row A on row B inserts A before B
	// in the global stack order. Visual grouping (contexts/datasets) is
	// unaffected — only relative order within each group changes, which also
	// drives dataset render order on the map.
	const reorderEntry = (draggedId: string, targetId: string) => {
		const order = mapStackOrder.filter((id) => id !== draggedId)
		const targetIndex = order.indexOf(targetId)
		if (targetIndex < 0) return
		order.splice(targetIndex, 0, draggedId)
		setMapStackOrder(order)
	}
	const [isDragOver, setIsDragOver] = useState(false)
	const [isCollapsed, setIsCollapsed] = useState(false)

	const datasetByKey = useMemo(() => {
		const map = new Map<string, GeoDataset>()
		geoEvents.forEach((event) => {
			map.set(getDatasetKey(event), event)
		})
		return map
	}, [geoEvents, getDatasetKey])

	const contextByKey = useMemo(() => {
		const map = new Map<string, MapContext>()
		mapContextEvents.forEach((context) => {
			const key = context.contextCoordinate ?? context.id ?? context.contextId ?? context.dTag
			if (key) map.set(key, context)
		})
		return map
	}, [mapContextEvents])

	const entries = useMemo(
		(): MapStackEntry[] =>
			mapStackOrder
				.map((id) => mapStackEntries[id])
				.filter((entry): entry is MapStackEntry => Boolean(entry)),
		[mapStackEntries, mapStackOrder],
	)
	// Group by entity type so the panel visually separates contexts (broader
	// scope), individual datasets, and the in-edit draft. Within a group,
	// insertion order is kept.
	const draftEntries = useMemo(
		() => entries.filter((entry) => entry.entityType === 'draft'),
		[entries],
	)
	const contextEntries = useMemo(
		() => entries.filter((entry) => entry.entityType === 'context'),
		[entries],
	)
	const datasetEntries = useMemo(
		() => entries.filter((entry) => entry.entityType === 'dataset'),
		[entries],
	)
	const otherEntries = useMemo(
		() =>
			entries.filter(
				(entry) =>
					entry.entityType !== 'context' &&
					entry.entityType !== 'dataset' &&
					entry.entityType !== 'draft',
			),
		[entries],
	)
	const visibleCount = entries.filter((entry) => entry.visible).length
	const isolatedEntry = entries.find((entry) => entry.isolated) ?? null
	const isolatedLabel = (() => {
		if (!isolatedEntry) return null
		if (isolatedEntry.entityType === 'dataset') {
			const dataset = datasetByKey.get(isolatedEntry.entityKey)
			return dataset ? getDatasetName(dataset) : isolatedEntry.title || isolatedEntry.entityKey
		}
		if (isolatedEntry.entityType === 'context') {
			const context = contextByKey.get(isolatedEntry.entityKey)
			return context?.context?.name || isolatedEntry.title || isolatedEntry.entityKey
		}
		return isolatedEntry.title || isolatedEntry.entityKey
	})()
	const actionButtonClassName = cn(compact ? 'h-6 w-6' : 'h-7 w-7', 'text-muted-foreground')
	const actionIconClassName = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const isPanelCollapsed = compact && isCollapsed

	const handleDrop = (event: DragEvent<HTMLElement>) => {
		event.preventDefault()
		setIsDragOver(false)
		const datasetKey = event.dataTransfer.getData('application/earthly-dataset-key')
		if (!datasetKey) return
		const dataset = datasetByKey.get(datasetKey)
		if (dataset) onAddDatasetToMap?.(dataset)
	}

	return (
		<section
			aria-label="Map stack"
			className={cn(
				'flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background',
				compact ? 'h-auto' : 'h-full',
				compact && 'bg-background/95 backdrop-blur',
				isDragOver && 'border-emerald-500 bg-emerald-50/60',
			)}
			onDragEnter={(event) => {
				if (hasDatasetDragData(event)) {
					setIsDragOver(true)
				}
			}}
			onDragOver={(event) => {
				if (hasDatasetDragData(event)) {
					event.preventDefault()
					event.dataTransfer.dropEffect = 'copy'
				}
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setIsDragOver(false)
				}
			}}
			onDrop={handleDrop}
		>
			<div
				className={cn(
					'flex items-center justify-between border-border',
					isPanelCollapsed ? 'border-b-0' : 'border-b',
					compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-3 py-2',
				)}
			>
				<div className="flex min-w-0 items-center gap-2">
					<Layers className={cn(actionIconClassName, 'text-emerald-600')} />
					<div className="min-w-0">
						<div
							className={cn(
								'truncate font-semibold text-foreground',
								compact ? 'text-xs' : 'text-sm',
							)}
						>
							Map Stack
						</div>
						<div className={cn('text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
							{visibleCount}/{entries.length} visible
						</div>
						{isolatedEntry && isolatedLabel ? (
							<div
								className={cn(
									'mt-0.5 flex items-center gap-1 text-amber-600',
									compact ? 'text-[11px]' : 'text-xs',
								)}
							>
								<Focus className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
								<span className="truncate">Isolating: {isolatedLabel}</span>
							</div>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{isolatedEntry && onSetEntryIsolated ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn(
								compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-xs',
								'text-amber-700 hover:bg-amber-100 hover:text-amber-800',
							)}
							onClick={() => onSetEntryIsolated(isolatedEntry, false)}
							title="Stop isolating — show all again"
						>
							Show all
						</Button>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={cn(
							compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-xs',
							'text-muted-foreground',
						)}
						onClick={onClear}
						disabled={!entries.some((entry) => !entry.pinned && entry.entityType !== 'draft')}
						title="Remove all unpinned entries (pinned and the active draft stay)"
					>
						Clear
					</Button>
					{compact ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={actionButtonClassName}
							onClick={() => setIsCollapsed((collapsed) => !collapsed)}
							aria-expanded={!isPanelCollapsed}
							aria-label={isPanelCollapsed ? 'Expand map stack' : 'Collapse map stack'}
							title={isPanelCollapsed ? 'Expand map stack' : 'Collapse map stack'}
						>
							{isPanelCollapsed ? (
								<ChevronDown className={actionIconClassName} />
							) : (
								<ChevronUp className={actionIconClassName} />
							)}
						</Button>
					) : null}
					{onClose ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={actionButtonClassName}
							onClick={onClose}
							aria-label="Close map stack"
							title="Close map stack"
						>
							<X className={actionIconClassName} />
						</Button>
					) : null}
				</div>
			</div>

			{!isPanelCollapsed ? (
				entries.length === 0 ? (
					<div
						className={cn(
							'flex flex-1 items-center justify-center text-center text-muted-foreground',
							compact ? 'min-h-24 px-4 text-xs' : 'px-5 text-sm',
						)}
					>
						No map stack entries.
					</div>
				) : (
					<div
						className={cn(
							'overflow-y-auto',
							compact ? 'max-h-[min(20rem,calc(100vh-8rem))] p-1.5' : 'min-h-0 flex-1 p-2',
						)}
					>
						<EntryGroupList
							compact={compact}
							draftEntries={draftEntries}
							contextEntries={contextEntries}
							datasetEntries={datasetEntries}
							otherEntries={otherEntries}
							datasetByKey={datasetByKey}
							contextByKey={contextByKey}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							sourceLabel={sourceLabel}
							actionIconClassName={actionIconClassName}
							actionButtonClassName={actionButtonClassName}
							geoEvents={geoEvents}
							mapContextEvents={mapContextEvents}
							onSetEntryIsolated={onSetEntryIsolated}
							onZoomToDataset={onZoomToDataset}
							onInspectDataset={onInspectDataset}
							onLoadDataset={onLoadDataset}
							onInspectContext={onInspectContext}
							onRemoveEntry={onRemoveEntry}
							onToggleEntryExclusion={toggleEntryExclusion}
							onTogglePinned={toggleEntryPinned}
							onReorderEntry={reorderEntry}
							onOpenDraftEditor={onOpenDraftEditor}
							onZoomToDraft={onZoomToDraft}
						/>
					</div>
				)
			) : null}
		</section>
	)
}
