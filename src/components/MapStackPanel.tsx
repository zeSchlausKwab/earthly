import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Database,
	Layers,
	Loader2,
	MapPin,
	PencilLine,
	Radio,
	ScanSearch,
	X,
} from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	useEditorStore,
	type GeoQueryStatus,
	type MapStackEntry,
} from '../features/geo-editor/store'
import { getDefaultContextMapScopeMode, resolveContextMapScope } from '@/lib/context/scope'
import {
	DeleteActionIcon,
	InspectActionIcon,
	IsolateActionIcon,
	LoadEditorActionIcon,
	OpenPanelActionIcon,
	PinActionIcon,
	RemoveActionIcon,
	ZoomActionIcon,
} from './entity-action-icons'
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
	own: 'you',
	story: 'story',
	'geo-query': 'in view',
}

/**
 * Phase 13 (D-05, SPEC §3.4): human-readable label for the row meta line + the
 * aggregate-layer group headings. Every `MapStackEntryType` has an explicit case
 * so a new entity kind never falls through to a blank/unknown label. The aggregate
 * `*-layer` entries read "Sightings" / "Live beacons"; individual entity entries
 * fall back to the entry's own title (set at add-to-stack time from the entity
 * label).
 */
export function entityTypeLabel(entry: Pick<MapStackEntry, 'entityType' | 'title'>): string {
	switch (entry.entityType) {
		case 'sighting-layer':
			return 'Sightings'
		case 'beacon-layer':
			return 'Live beacons'
		case 'sighting':
			return entry.title?.trim() || 'Sighting'
		case 'beacon':
			return entry.title?.trim() || 'Live location'
		default:
			return entry.entityType
	}
}

/**
 * Phase 13: the short type descriptor shown on the row meta line (the "kind"
 * chip under the title). Distinct from `entityTypeLabel` (which is the row TITLE
 * for aggregate layers). Every type has an explicit case — no `unknown` fallthrough.
 */
export function entryTypeMetaLabel(entityType: MapStackEntry['entityType']): string {
	switch (entityType) {
		case 'sighting':
			return 'sighting'
		case 'beacon':
			return 'beacon'
		case 'sighting-layer':
			return 'sightings layer'
		case 'beacon-layer':
			return 'beacons layer'
		default:
			return entityType
	}
}

export interface MapStackBuckets {
	/** Aggregate layers pin to TOP (D-05), sighting layer first. */
	sightingLayerEntries: MapStackEntry[]
	beaconLayerEntries: MapStackEntry[]
	draftEntries: MapStackEntry[]
	/** Query-by-view results (source 'geo-query', unpinned) — own section for
	 * transparency; pinning an entry graduates it to its type bucket. */
	geoQueryEntries: MapStackEntry[]
	contextEntries: MapStackEntry[]
	datasetEntries: MapStackEntry[]
	/** Individual sighting/beacon pins + any other non-bucketed type. */
	otherEntries: MapStackEntry[]
}

/**
 * Phase 13 (D-05): pure bucket-and-order of the ordered stack entries. The
 * aggregate `sighting-layer`/`beacon-layer` entries are split into their own
 * buckets so the render body can pin them ABOVE dataset/context entries (D-05
 * top-pin). Individual `sighting`/`beacon` pins ride `otherEntries` (they don't
 * need top-pinning — only the aggregate layers do). Extracted so the ordering is
 * unit-testable without the DOM (MapStackPanel.layerEntries.test.ts).
 */
export function bucketMapStackEntries(entries: MapStackEntry[]): MapStackBuckets {
	const sightingLayerEntries: MapStackEntry[] = []
	const beaconLayerEntries: MapStackEntry[] = []
	const draftEntries: MapStackEntry[] = []
	const geoQueryEntries: MapStackEntry[] = []
	const contextEntries: MapStackEntry[] = []
	const datasetEntries: MapStackEntry[] = []
	const otherEntries: MapStackEntry[] = []
	for (const entry of entries) {
		// Query-by-view results bucket by SOURCE, not entity type: the whole
		// point of the section is showing the user what the viewport query put
		// on the map. Pinned ones graduate to their type bucket (user claimed
		// them; they survive viewport changes and Clear).
		if (entry.source === 'geo-query' && !entry.pinned) {
			geoQueryEntries.push(entry)
			continue
		}
		switch (entry.entityType) {
			case 'sighting-layer':
				sightingLayerEntries.push(entry)
				break
			case 'beacon-layer':
				beaconLayerEntries.push(entry)
				break
			case 'draft':
				draftEntries.push(entry)
				break
			case 'context':
				contextEntries.push(entry)
				break
			case 'dataset':
				datasetEntries.push(entry)
				break
			default:
				otherEntries.push(entry)
		}
	}
	return {
		sightingLayerEntries,
		beaconLayerEntries,
		draftEntries,
		geoQueryEntries,
		contextEntries,
		datasetEntries,
		otherEntries,
	}
}

/**
 * Phase 13 (D-05): the flat render order the panel emits. Aggregate layers pin to
 * the TOP, above every individual dataset/context entry, so their whole-layer
 * toggle is the first thing the user sees. Returns the entries in the exact order
 * groups are rendered — the test asserts aggregate layers precede dataset/context.
 */
export function orderedMapStackEntries(buckets: MapStackBuckets): MapStackEntry[] {
	return [
		...buckets.sightingLayerEntries,
		...buckets.beaconLayerEntries,
		...buckets.draftEntries,
		...buckets.geoQueryEntries,
		...buckets.contextEntries,
		...buckets.datasetEntries,
		...buckets.otherEntries,
	]
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
					className={cn(className, hoverClassName, active && 'bg-primary/10 text-primary')}
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
	const setDraftEditorSlot = useEditorStore((state) => state.setDraftEditorSlot)
	// Live draft name — reactive so the entry title updates on the fly as you type
	// it in the editor. Returns a constant '' for non-draft rows so only the draft
	// row re-renders on name changes (keeps the rest of the stack cheap).
	const liveDraftName = useEditorStore((state) =>
		entry.entityType === 'draft' ? (state.collectionMeta?.name ?? '') : '',
	)
	const displayTitle =
		entry.entityType === 'draft' && liveDraftName.trim() ? liveDraftName.trim() : title
	// The live draft opens expanded by default (editor-in-place, redesign §9).
	const [expanded, setExpanded] = useState(entry.entityType === 'draft')
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
	const isDraftEntry = entry.entityType === 'draft'
	// Draft entries expand into the geometry editor inline (SPEC: edit where the
	// layers are); context entries expand into their curated-dataset checklist.
	const canExpand = isContextEntry || isDraftEntry
	const [isReorderTarget, setIsReorderTarget] = useState(false)
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: drag-to-reorder container; all click targets inside are real buttons, and reordering stays reachable via the row action buttons for keyboard users.
		<div
			className={cn(
				'group relative flex cursor-grab flex-col rounded-md border bg-card transition-colors active:cursor-grabbing',
				isolated
					? 'border-primary/40 bg-primary/10 shadow-[inset_3px_0_0_0] shadow-primary'
					: 'border-border',
				!entry.visible && !isolated && 'opacity-60',
				isReorderTarget && 'border-info/40 shadow-[0_-2px_0_0] shadow-info',
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
			<div className={cn('flex items-start', compact ? 'gap-1.5 p-1 pl-1.5' : 'gap-2 p-2 pl-2.5')}>
				<div
					className={cn(
						'flex shrink-0 items-center justify-center rounded-md',
						entry.entityType === 'draft'
							? 'bg-ok/15 text-ok'
							: isolated
								? 'bg-primary/10 text-primary'
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
					) : entry.entityType === 'sighting' ? (
						<MapPin className={actionIconClassName} />
					) : entry.entityType === 'beacon' ? (
						<Radio className={actionIconClassName} />
					) : entry.entityType === 'sighting-layer' ? (
						<MapPin className={actionIconClassName} />
					) : entry.entityType === 'beacon-layer' ? (
						<Radio className={actionIconClassName} />
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
							{displayTitle}
						</div>
						{isolated ? (
							<span
								className={cn(
									'shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-primary',
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
							compact ? 'gap-1 text-[10px] leading-tight' : 'mt-1 gap-1.5 text-xs',
						)}
					>
						<span>{entryTypeMetaLabel(entry.entityType)}</span>
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
							label={
								isDraftEntry
									? expanded
										? 'Collapse editor'
										: 'Expand editor'
									: expanded
										? 'Collapse curated datasets'
										: 'Expand curated datasets'
							}
							tooltip={
								isDraftEntry
									? expanded
										? 'Hide the geometry editor'
										: 'Edit geometries inline'
									: expanded
										? 'Hide the curated dataset checklist'
										: 'Show the curated dataset checklist — uncheck to exclude per-context'
							}
							pressed={expanded}
						/>
					) : null}
					{onSetEntryIsolated ? (
						<RowAction
							icon={<IsolateActionIcon className={actionIconClassName} />}
							className={cn(
								actionButtonClassName,
								isolated ? 'text-primary hover:text-primary' : 'hover:text-primary',
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
					{/* U.4: actions inline (no overflow), in the canonical order
					    zoom → inspect → load, then Pin, then Remove — shared icons keep
					    them matching the catalog rows. */}
					{dataset ? (
						<>
							<RowAction
								icon={<ZoomActionIcon className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-info')}
								onClick={() => onZoomToDataset(dataset)}
								label="Zoom to dataset"
								tooltip="Zoom the map to this dataset's bounds"
							/>
							<RowAction
								icon={<InspectActionIcon className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-ok')}
								onClick={() => onInspectDataset(dataset)}
								label="Inspect dataset"
								tooltip="Open the dataset details panel"
							/>
							<RowAction
								icon={<LoadEditorActionIcon className={actionIconClassName} />}
								className={cn(actionButtonClassName, 'hover:text-ok')}
								onClick={() => onLoadDataset(dataset)}
								label="Load dataset into editor"
								tooltip="Load this dataset into the editor for changes"
							/>
						</>
					) : null}
					{context ? (
						<RowAction
							icon={<InspectActionIcon className={actionIconClassName} />}
							className={cn(actionButtonClassName, 'hover:text-ok')}
							onClick={() => onInspectContext(context)}
							label="Inspect context"
							tooltip="Open the context details panel"
						/>
					) : null}
					{entry.entityType === 'draft' ? (
						<>
							{onZoomToDraft ? (
								<RowAction
									icon={<ZoomActionIcon className={actionIconClassName} />}
									className={cn(actionButtonClassName, 'hover:text-info')}
									onClick={onZoomToDraft}
									label="Zoom to edit"
									tooltip="Zoom the map to the geometry being edited"
								/>
							) : null}
							{onOpenDraftEditor ? (
								<RowAction
									icon={<OpenPanelActionIcon className={actionIconClassName} />}
									className={cn(actionButtonClassName, 'hover:text-ok')}
									onClick={onOpenDraftEditor}
									label="Open editor panel"
									tooltip="Show the edit state in the side panel"
								/>
							) : null}
						</>
					) : null}
					{entry.entityType !== 'draft' ? (
						<RowAction
							icon={
								<PinActionIcon
									className={cn(actionIconClassName, entry.pinned && 'fill-current')}
								/>
							}
							className={cn(
								actionButtonClassName,
								entry.pinned ? 'text-info hover:text-info' : 'hover:text-info',
							)}
							onClick={() => onTogglePinned(entry.id)}
							label={entry.pinned ? 'Unpin' : 'Pin'}
							tooltip={
								entry.pinned ? 'Unpin — Clear will remove this entry again' : 'Pin — survives Clear'
							}
							pressed={entry.pinned}
						/>
					) : null}
					<RowAction
						icon={
							entry.pinned ? (
								<DeleteActionIcon className={actionIconClassName} />
							) : (
								<RemoveActionIcon className={actionIconClassName} />
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
			{canExpand && expanded && isDraftEntry ? (
				// DS "editor in Map Stack" (redesign doc §9/§10): the FULL sidebar
				// editor (metadata + color + context-attach searchbar + geometries +
				// publish) portals into this slot, so there's one editor with full
				// parity — no duplicate in the sidebar. See AppSidebar renderContent.
				<div ref={setDraftEditorSlot} className="border-border border-t bg-muted/30 p-2" />
			) : null}
			{canExpand && expanded && !isDraftEntry ? (
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
									className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-info"
									onClick={(event) => {
										event.preventDefault()
										onZoomToDataset(curated)
									}}
									aria-label={`Zoom to ${name}`}
									title="Zoom to dataset"
								>
									<ZoomActionIcon className="h-3 w-3" />
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
	sightingLayerEntries: MapStackEntry[]
	beaconLayerEntries: MapStackEntry[]
	draftEntries: MapStackEntry[]
	geoQueryEntries: MapStackEntry[]
	/** Query-by-view transparency readout (null when the mode is off). */
	geoQueryStatus: GeoQueryStatus | null
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
	sightingLayerEntries,
	beaconLayerEntries,
	draftEntries,
	geoQueryEntries,
	geoQueryStatus,
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
		// Phase 13 (D-05): aggregate + individual sighting/beacon entries resolve
		// their title through `entityTypeLabel` so an aggregate layer always reads
		// "Sightings"/"Live beacons" even if seeded without an explicit title.
		const title = dataset
			? getDatasetName(dataset)
			: entry.entityType === 'sighting-layer' ||
					entry.entityType === 'beacon-layer' ||
					entry.entityType === 'sighting' ||
					entry.entityType === 'beacon'
				? entityTypeLabel(entry)
				: entry.title
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
			{/* The live draft editor pins to the very TOP of the stack (redesign §9). */}
			{draftEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={cn(groupLabelClass, 'text-ok')}>
						<PencilLine className="h-3 w-3" />
						<span>Editing</span>
						<span className="font-normal text-muted-foreground/70">({draftEntries.length})</span>
					</div>
					{draftEntries.map(renderEntry)}
				</div>
			) : null}
			{/* Phase 13 (D-05): aggregate "Sightings" / "Live beacons" layer entries
			    pin above individual dataset/context entries. Their `visible` toggle
			    gates the whole subscription-driven layer. */}
			{sightingLayerEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={groupLabelClass}>
						<MapPin className="h-3 w-3" />
						<span>Sightings layer</span>
						<span className="font-normal text-muted-foreground/70">
							({sightingLayerEntries.length})
						</span>
					</div>
					{sightingLayerEntries.map(renderEntry)}
				</div>
			) : null}
			{beaconLayerEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={groupLabelClass}>
						<Radio className="h-3 w-3" />
						<span>Live beacons layer</span>
						<span className="font-normal text-muted-foreground/70">
							({beaconLayerEntries.length})
						</span>
					</div>
					{beaconLayerEntries.map(renderEntry)}
				</div>
			) : null}
			{/* Query-by-view: the section renders whenever the mode is on (status
			    non-null) so the transparency readout — queried cells, in-flight
			    state, match count — is visible even with zero results. */}
			{geoQueryStatus !== null || geoQueryEntries.length > 0 ? (
				<div className={cn(groupGap)}>
					<div className={cn(groupLabelClass, 'text-info')}>
						<ScanSearch className="h-3 w-3" />
						<span>Geo query</span>
						<span className="font-normal text-muted-foreground/70">({geoQueryEntries.length})</span>
						{geoQueryStatus?.loading ? (
							<Loader2 className="h-3 w-3 animate-spin text-muted-foreground/70" />
						) : null}
					</div>
					{geoQueryStatus ? (
						<div
							className={cn(
								'px-1 text-muted-foreground/80',
								compact ? 'text-[10px]' : 'text-[11px]',
							)}
						>
							{geoQueryStatus.cells.length > 0 ? (
								<span className="font-mono">
									{geoQueryStatus.cells.slice(0, 4).join(' ')}
									{geoQueryStatus.cells.length > 4 ? ` +${geoQueryStatus.cells.length - 4}` : ''}
								</span>
							) : (
								<span>waiting for map…</span>
							)}
							{geoQueryStatus.updatedAt !== null ? (
								<span>
									{' · '}
									{geoQueryStatus.matchCount} in view
								</span>
							) : null}
						</div>
					) : null}
					{geoQueryEntries.length > 0 ? (
						geoQueryEntries.map(renderEntry)
					) : geoQueryStatus && !geoQueryStatus.loading && geoQueryStatus.updatedAt !== null ? (
						<div
							className={cn(
								'px-1 text-muted-foreground/60',
								compact ? 'text-[10px]' : 'text-[11px]',
							)}
						>
							No entities in this view
						</div>
					) : null}
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
	// Group by entity type so the panel visually separates the aggregate
	// sighting/beacon layers (pinned to top, D-05), contexts (broader scope),
	// individual datasets, and the in-edit draft. Within a group, insertion order
	// is kept. Bucketing is a pure helper (unit-tested for the D-05 top-pin order).
	const {
		sightingLayerEntries,
		beaconLayerEntries,
		draftEntries,
		geoQueryEntries,
		contextEntries,
		datasetEntries,
		otherEntries,
	} = useMemo(() => bucketMapStackEntries(entries), [entries])
	const visibleCount = entries.filter((entry) => entry.visible).length
	// Query-by-view mode (header toggle + "Geo query" section readout).
	const geoQueryEnabled = useEditorStore((state) => state.geoQueryEnabled)
	const geoQueryStatus = useEditorStore((state) => state.geoQueryStatus)
	const setGeoQueryEnabled = useEditorStore((state) => state.setGeoQueryEnabled)
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
				isDragOver && 'border-ok/40 bg-ok/15',
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
					<Layers className={cn(actionIconClassName, 'text-ok')} />
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
									'mt-0.5 flex items-center gap-1 text-primary',
									compact ? 'text-[11px]' : 'text-xs',
								)}
							>
								<IsolateActionIcon className={cn(compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
								<span className="truncate">Isolating: {isolatedLabel}</span>
							</div>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn(
							actionButtonClassName,
							geoQueryEnabled && 'bg-info/15 text-info hover:bg-info/20 hover:text-info',
						)}
						onClick={() => setGeoQueryEnabled(!geoQueryEnabled)}
						aria-pressed={geoQueryEnabled}
						aria-label={geoQueryEnabled ? 'Turn off query by view' : 'Turn on query by view'}
						title={
							geoQueryEnabled
								? 'Query by view is ON — the relay is queried for entities in the viewport as you pan/zoom (see the Geo query section). Click to turn off.'
								: 'Query by view — search the relay for entities in the current viewport as you pan/zoom'
						}
					>
						<ScanSearch className={actionIconClassName} />
					</Button>
					{isolatedEntry && onSetEntryIsolated ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={cn(
								compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-xs',
								'text-primary hover:bg-primary/10 hover:text-primary',
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
							compact ? 'max-h-[calc(100vh-5rem)] p-1.5' : 'min-h-0 flex-1 p-2',
						)}
					>
						<EntryGroupList
							compact={compact}
							sightingLayerEntries={sightingLayerEntries}
							beaconLayerEntries={beaconLayerEntries}
							draftEntries={draftEntries}
							geoQueryEntries={geoQueryEntries}
							geoQueryStatus={geoQueryEnabled ? geoQueryStatus : null}
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
