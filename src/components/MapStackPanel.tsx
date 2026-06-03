import {
	ChevronDown,
	ChevronUp,
	Database,
	Eye,
	EyeOff,
	Layers,
	LocateFixed,
	Search,
	Trash2,
	X,
} from 'lucide-react'
import type { DragEvent } from 'react'
import { useMemo, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore, type MapStackEntry } from '../features/geo-editor/store'
import { Button } from './ui/button'
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
	onSetEntryVisible: (entry: MapStackEntry, visible: boolean) => void
	onRemoveEntry: (entry: MapStackEntry) => void
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
}

function hasDatasetDragData(event: DragEvent<HTMLElement>) {
	return Array.from(event.dataTransfer.types).includes('application/earthly-dataset-key')
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
	onSetEntryVisible,
	onRemoveEntry,
	onClear,
	onClose,
	compact = false,
}: MapStackPanelProps) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
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
	const visibleCount = entries.filter((entry) => entry.visible).length
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
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={cn(
							compact ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-xs',
							'text-muted-foreground',
						)}
						onClick={onClear}
						disabled={entries.length === 0}
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
						<div className={cn(compact ? 'space-y-1' : 'space-y-1.5')}>
							{entries.map((entry) => {
								const dataset =
									entry.entityType === 'dataset' ? datasetByKey.get(entry.entityKey) : undefined
								const context =
									entry.entityType === 'context' ? contextByKey.get(entry.entityKey) : undefined
								const title = dataset ? getDatasetName(dataset) : entry.title

								return (
									<div
										key={entry.id}
										className={cn(
											'group flex items-start rounded-md border border-border bg-card',
											compact ? 'gap-1.5 p-1.5' : 'gap-2 p-2',
											!entry.visible && 'opacity-60',
										)}
									>
										<div
											className={cn(
												'flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
												compact ? 'mt-0.5 h-6 w-6' : 'mt-1 h-7 w-7',
											)}
										>
											{entry.entityType === 'dataset' ? (
												<Database className={actionIconClassName} />
											) : (
												<Layers className={actionIconClassName} />
											)}
										</div>
										<div className="min-w-0 flex-1">
											<div
												className={cn(
													'line-clamp-2 break-words font-medium text-foreground',
													compact ? 'text-xs leading-tight' : 'text-sm leading-snug',
												)}
											>
												{title}
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
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-0.5">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className={cn(actionButtonClassName, 'hover:text-sky-700')}
												onClick={() => onSetEntryVisible(entry, !entry.visible)}
												title={entry.visible ? 'Hide from map' : 'Show on map'}
												aria-label={entry.visible ? 'Hide from map' : 'Show on map'}
											>
												{entry.visible ? (
													<Eye className={actionIconClassName} />
												) : (
													<EyeOff className={actionIconClassName} />
												)}
											</Button>
											{dataset ? (
												<>
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														className={cn(actionButtonClassName, 'hover:text-sky-700')}
														onClick={() => onZoomToDataset(dataset)}
														title="Zoom to dataset"
														aria-label="Zoom to dataset"
													>
														<LocateFixed className={actionIconClassName} />
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														className={cn(actionButtonClassName, 'hover:text-emerald-700')}
														onClick={() => onInspectDataset(dataset)}
														title="Inspect dataset"
														aria-label="Inspect dataset"
													>
														<Search className={actionIconClassName} />
													</Button>
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														className={cn(actionButtonClassName, 'hover:text-emerald-700')}
														onClick={() => onLoadDataset(dataset)}
														title="Load dataset into editor"
														aria-label="Load dataset into editor"
													>
														<Database className={actionIconClassName} />
													</Button>
												</>
											) : null}
											{context ? (
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className={cn(actionButtonClassName, 'hover:text-emerald-700')}
													onClick={() => onInspectContext(context)}
													title="Inspect context"
													aria-label="Inspect context"
												>
													<Search className={actionIconClassName} />
												</Button>
											) : null}
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className={cn(actionButtonClassName, 'hover:text-destructive')}
												onClick={() => onRemoveEntry(entry)}
												title="Remove from map stack"
												aria-label="Remove from map stack"
											>
												{entry.pinned ? (
													<Trash2 className={actionIconClassName} />
												) : (
													<X className={actionIconClassName} />
												)}
											</Button>
										</div>
									</div>
								)
							})}
						</div>
					</div>
				)
			) : null}
		</section>
	)
}
