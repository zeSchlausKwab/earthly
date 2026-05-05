import { Database, Eye, EyeOff, Layers, LocateFixed, Search, Trash2, X } from 'lucide-react'
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
}: MapStackPanelProps) {
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
	const [isDragOver, setIsDragOver] = useState(false)

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
			const key = context.coordinate ?? context.id ?? context.contextId ?? context.dTag
			if (key) map.set(key, context)
		})
		return map
	}, [mapContextEvents])

	const entries = useMemo(
		() => mapStackOrder.map((id) => mapStackEntries[id]).filter(Boolean),
		[mapStackEntries, mapStackOrder],
	)
	const visibleCount = entries.filter((entry) => entry.visible).length

	const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		setIsDragOver(false)
		const datasetKey = event.dataTransfer.getData('application/earthly-dataset-key')
		if (!datasetKey) return
		const dataset = datasetByKey.get(datasetKey)
		if (dataset) onAddDatasetToMap?.(dataset)
	}

	return (
		<div
			className={cn(
				'flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background',
				isDragOver && 'border-emerald-500 bg-emerald-50/60',
			)}
			onDragEnter={(event) => {
				if (event.dataTransfer.types.includes('application/earthly-dataset-key')) {
					setIsDragOver(true)
				}
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes('application/earthly-dataset-key')) {
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
			<div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<Layers className="h-4 w-4 text-emerald-600" />
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-foreground">Map Stack</div>
						<div className="text-xs text-muted-foreground">
							{visibleCount}/{entries.length} visible
						</div>
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 px-2 text-xs text-muted-foreground"
					onClick={onClear}
					disabled={entries.length === 0}
				>
					Clear
				</Button>
			</div>

			{entries.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-5 text-center text-sm text-muted-foreground">
					No map stack entries.
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					<div className="space-y-1.5">
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
										'group flex items-start gap-2 rounded-md border border-border bg-card p-2',
										!entry.visible && 'opacity-60',
									)}
								>
									<div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
										{entry.entityType === 'dataset' ? (
											<Database className="h-4 w-4" />
										) : (
											<Layers className="h-4 w-4" />
										)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground">
											{title}
										</div>
										<div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
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
											className="h-7 w-7 text-muted-foreground hover:text-sky-700"
											onClick={() => onSetEntryVisible(entry, !entry.visible)}
											title={entry.visible ? 'Hide from map' : 'Show on map'}
											aria-label={entry.visible ? 'Hide from map' : 'Show on map'}
										>
											{entry.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
										</Button>
										{dataset ? (
											<>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className="h-7 w-7 text-muted-foreground hover:text-sky-700"
													onClick={() => onZoomToDataset(dataset)}
													title="Zoom to dataset"
													aria-label="Zoom to dataset"
												>
													<LocateFixed className="h-4 w-4" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className="h-7 w-7 text-muted-foreground hover:text-emerald-700"
													onClick={() => onInspectDataset(dataset)}
													title="Inspect dataset"
													aria-label="Inspect dataset"
												>
													<Search className="h-4 w-4" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className="h-7 w-7 text-muted-foreground hover:text-emerald-700"
													onClick={() => onLoadDataset(dataset)}
													title="Load dataset into editor"
													aria-label="Load dataset into editor"
												>
													<Database className="h-4 w-4" />
												</Button>
											</>
										) : null}
										{context ? (
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 text-muted-foreground hover:text-emerald-700"
												onClick={() => onInspectContext(context)}
												title="Inspect context"
												aria-label="Inspect context"
											>
												<Search className="h-4 w-4" />
											</Button>
										) : null}
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="h-7 w-7 text-muted-foreground hover:text-destructive"
											onClick={() => onRemoveEntry(entry)}
											title="Remove from map stack"
											aria-label="Remove from map stack"
										>
											{entry.pinned ? <Trash2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}
