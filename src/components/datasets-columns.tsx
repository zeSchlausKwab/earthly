import type { ColumnDef } from '@tanstack/react-table'
import { Loader2 } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { memo } from 'react'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import {
	DatasetGlyphIcon,
	DebugActionIcon,
	FavoriteActionIcon,
	InspectActionIcon,
	LoadEditorActionIcon,
	MapStackActionIcon,
	ZoomActionIcon,
} from './entity-action-icons'
import { GlyphTile, ListRow, RowActionButton } from './entity-list'
import { UserProfile } from './user-profile'
import { useEditorStore } from '../features/geo-editor/store'
import { GeoSocialActions } from '../features/social/comments/GeoSocialActions'
import type { GeoDataset } from '@/lib/nostr/geo-event'

export interface DatasetRowData {
	event: GeoDataset
	datasetKey: string
	datasetName: string
	isActive: boolean
	isOwned: boolean
	isVisible: boolean
	isInMapStack: boolean
	/** Round G.2: starred in the catalog Favorites tab. Optional — profile view doesn't wire it. */
	isCatalogPinned?: boolean
	primaryLabel: string
}

export interface DatasetColumnsContext {
	onLoadDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onInspectDataset?: (event: GeoDataset) => void
	/** Add to map stack. Idempotent — calling on an already-stacked entity is a no-op. */
	onAddDatasetToMap?: (event: GeoDataset) => void
	/** Round C: remove from map stack. Paired with onAddDatasetToMap to make the Layers button a toggle. */
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	/** Round G.2: toggle catalog favorite (Star). */
	onToggleCatalogPin?: (event: GeoDataset) => void
	/**
	 * P2.2 (report 6.x): favorites are persisted per-pubkey, so they're
	 * meaningless while logged out. When false, the favorite action is shown
	 * disabled with a sign-in hint instead of silently writing guest-scoped
	 * state. Defaults to allowed when omitted (callers that don't know auth).
	 */
	canFavorite?: boolean
	onOpenDebug?: (event: GeoDataset) => void
	isPublishing: boolean
	deletingKey: string | null
	allVisibleState: 'all' | 'none' | 'some'
}

/**
 * Round F.1: the load verb moved into the row's overflow menu; this indicator
 * only surfaces blob-resolution progress (ring with percent, or a spinner
 * when the total is unknown). Renders nothing when idle.
 */
const DatasetResolvingIndicator = memo(function DatasetResolvingIndicator({
	datasetKey,
}: {
	datasetKey: string
}) {
	const isResolving = useEditorStore((state) => state.resolvingDatasets.has(datasetKey))
	const progress = useEditorStore((state) => state.resolvingProgress.get(datasetKey))

	if (!isResolving) return null

	const progressPercent =
		progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0

	if (progress && progress.total > 0) {
		const sizeMB = (progress.total / 1024 / 1024).toFixed(1)
		const label = `Loading ${progressPercent}% of ${sizeMB}MB...`
		return (
			<div className="relative flex h-8 w-8 items-center justify-center" title={label}>
				<svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="text-foreground"
					/>
					<circle
						cx="10"
						cy="10"
						r="8"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeDasharray={`${progressPercent * 0.5} 50`}
						className="text-info transition-all duration-150"
					/>
				</svg>
				<span className="absolute text-[8px] font-medium text-info">{progressPercent}</span>
			</div>
		)
	}

	return (
		<div className="flex h-8 w-8 items-center justify-center" title="Loading blob data...">
			<Loader2 className="h-4 w-4 animate-spin text-info" />
		</div>
	)
})

export const createDatasetColumns = (
	context: DatasetColumnsContext,
): ColumnDef<DatasetRowData>[] => [
	{
		accessorKey: 'datasetName',
		cell: ({ row }) => {
			const { event, datasetName, isActive, isInMapStack, isCatalogPinned, isVisible } =
				row.original

			const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
				const datasetId = event.datasetId ?? event.dTag
				if (!datasetId || !event.pubkey || !event.kind) return

				let naddr: string
				try {
					naddr = nip19.naddrEncode({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: datasetId,
					})
				} catch {
					naddr = `${event.kind}:${event.pubkey}:${datasetId}`
				}

				const item: GeoFeatureItem = {
					id: `dataset:${event.id}`,
					name: datasetName,
					address: naddr,
					datasetName,
					geometryType: 'Dataset',
				}

				e.dataTransfer.setData('application/geo-feature', JSON.stringify(item))
				e.dataTransfer.setData('application/earthly-dataset-key', row.original.datasetKey)
				e.dataTransfer.effectAllowed = 'copy'
			}

			return (
				<ListRow
					leading={<GlyphTile icon={DatasetGlyphIcon} />}
					title={datasetName}
					selected={isActive}
					dimmed={!isVisible}
					draggable
					onDragStart={handleDragStart}
					onTitleClick={() => {
						// Round C: stack = visibility. Clicking the dataset name shows it on
						// the map (additive append). Zoom-to follows so the user lands on it.
						if (!isInMapStack) context.onAddDatasetToMap?.(event)
						context.onZoomToDataset(event)
					}}
					titleAriaLabel={
						isInMapStack
							? `Zoom to dataset ${datasetName}`
							: `Show and zoom to dataset ${datasetName}`
					}
					titleTitle={isInMapStack ? 'Zoom to dataset' : 'Show on map and zoom'}
					meta={
						<UserProfile
							pubkey={event.pubkey}
							mode="avatar-name"
							size="xs"
							showNip05Badge={false}
							interactive={false}
						/>
					}
					engage={
						<GeoSocialActions
							target={event}
							onReplyClick={() => context.onInspectDataset?.(event)}
							showCommentButton={Boolean(context.onInspectDataset)}
							showAnnotateButton={false}
							loadCounts={false}
							compact
							className="-ml-2 shrink-0 gap-0"
						/>
					}
					actions={
						<>
							{/* Canonical order map-stack → zoom → inspect → load → favorite →
							    debug, using the shared action icons so every entity matches. */}
							{context.onAddDatasetToMap ? (
								<RowActionButton
									icon={MapStackActionIcon}
									label={isInMapStack ? 'Remove from map stack' : 'Add to map stack'}
									hover="hover:text-ok"
									active={isInMapStack}
									activeClassName="text-ok hover:text-ok"
									onClick={() => {
										if (isInMapStack && context.onRemoveDatasetFromMap) {
											context.onRemoveDatasetFromMap(event)
										} else {
											context.onAddDatasetToMap?.(event)
										}
									}}
								/>
							) : null}
							<RowActionButton
								icon={ZoomActionIcon}
								label="Zoom to dataset"
								onClick={() => context.onZoomToDataset(event)}
							/>
							{context.onInspectDataset ? (
								<RowActionButton
									icon={InspectActionIcon}
									label="Inspect dataset"
									hover="hover:text-ok"
									onClick={() => context.onInspectDataset?.(event)}
								/>
							) : null}
							<RowActionButton
								icon={LoadEditorActionIcon}
								label={isActive ? 'Loaded in editor' : 'Load into editor'}
								hover="hover:text-ok"
								disabled={context.isPublishing}
								onClick={() => context.onLoadDataset(event)}
							/>
							{context.onToggleCatalogPin ? (
								<RowActionButton
									icon={FavoriteActionIcon}
									label={
										context.canFavorite === false
											? 'Sign in to save favorites'
											: isCatalogPinned
												? 'Remove from favorites'
												: 'Add to favorites'
									}
									hover="hover:text-primary"
									active={Boolean(isCatalogPinned)}
									activeClassName="text-primary hover:text-primary"
									filled={Boolean(isCatalogPinned)}
									disabled={context.canFavorite === false}
									onClick={() => context.onToggleCatalogPin?.(event)}
								/>
							) : null}
							{context.onOpenDebug ? (
								<RowActionButton
									icon={DebugActionIcon}
									label="Debug event"
									hover="hover:text-primary"
									onClick={() => context.onOpenDebug?.(event)}
								/>
							) : null}
							<DatasetResolvingIndicator datasetKey={row.original.datasetKey} />
						</>
					}
				/>
			)
		},
	},
]
