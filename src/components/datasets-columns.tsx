import type { ColumnDef } from '@tanstack/react-table'
import { CopyPlus, Loader2 } from 'lucide-react'
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
	ProposalActionIcon,
	ZoomActionIcon,
} from './entity-action-icons'
import { GeometryThumb, ListRow, RowActionButton } from './entity-list'
import { ConfirmDeleteAction } from './info-panel/ConfirmDeleteAction'
import { UserProfile } from './user-profile'
import { useEditorStore } from '../features/geo-editor/store'
import { GeoSocialActions } from '../features/social/comments/GeoSocialActions'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	getMapEditPresentation,
	type DatasetEditOptions,
} from './info-panel/mapProposalPresentation'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'

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
	currentUserPubkey?: string
	onLoadDataset: (event: GeoDataset, options?: DatasetEditOptions) => void
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
			const {
				event,
				datasetKey,
				datasetName,
				isActive,
				isOwned,
				isInMapStack,
				isCatalogPinned,
				isVisible,
			} = row.original
			const isOwner = context.currentUserPubkey
				? event.pubkey === context.currentUserPubkey
				: isOwned
			const editPresentation = getMapEditPresentation(isOwner)
			const canPropose =
				!privateWorkspaceIdForDataset(event) && !fieldSessionIdForEvent(event.event)

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
					geometryType: 'Map',
				}

				e.dataTransfer.setData('application/geo-feature', JSON.stringify(item))
				e.dataTransfer.setData('application/earthly-dataset-key', row.original.datasetKey)
				e.dataTransfer.effectAllowed = 'copy'
			}

			return (
				<ListRow
					leading={
						<GeometryThumb collection={event.featureCollection} fallbackIcon={DatasetGlyphIcon} />
					}
					title={datasetName}
					selected={isActive}
					dimmed={isInMapStack && !isVisible}
					draggable
					onDragStart={handleDragStart}
					onTitleClick={() => {
						if (!isInMapStack) context.onAddDatasetToMap?.(event)
						else if (!isVisible) context.onToggleVisibility(event)
						context.onZoomToDataset(event)
						context.onInspectDataset?.(event)
					}}
					titleAriaLabel={`Open map ${datasetName}`}
					titleTitle="Show on map and inspect"
					meta={
						<>
							<UserProfile
								pubkey={event.pubkey}
								mode="name-only"
								size="xs"
								showNip05Badge={false}
								interactive={false}
							/>
							{event.created_at ? (
								<>
									<span>·</span>
									<span>{new Date(event.created_at * 1000).toISOString().slice(0, 10)}</span>
								</>
							) : null}
							{event.featureCollection ? (
								<>
									<span>·</span>
									<span>{event.featureCollection.features.length} features</span>
								</>
							) : null}
							{event.datasetSize ? (
								<>
									<span>·</span>
									<span>{Math.max(1, Math.round(event.datasetSize / 1024))} KB</span>
								</>
							) : null}
							{event.hashtags?.length ? (
								<>
									<span>·</span>
									<span>
										{event.hashtags
											.slice(0, 2)
											.map((topic) => `#${topic}`)
											.join(' ')}
									</span>
								</>
							) : null}
						</>
					}
					primaryAction={
						context.onAddDatasetToMap ? (
							<RowActionButton
								icon={MapStackActionIcon}
								label={isInMapStack ? 'Remove from map' : 'Show on map'}
								active={isInMapStack}
								activeClassName="text-ok"
								onClick={() => {
									if (isInMapStack && context.onRemoveDatasetFromMap)
										context.onRemoveDatasetFromMap(event)
									else context.onAddDatasetToMap?.(event)
								}}
							/>
						) : null
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
							    debug → owned delete, using shared actions across entity rows. */}
							{context.onAddDatasetToMap ? (
								<RowActionButton
									icon={MapStackActionIcon}
									label={isInMapStack ? 'Remove from map' : 'Show on map'}
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
								label="Zoom to map"
								onClick={() => context.onZoomToDataset(event)}
							/>
							{context.onInspectDataset ? (
								<RowActionButton
									icon={InspectActionIcon}
									label="Open Map details"
									hover="hover:text-ok"
									onClick={() => context.onInspectDataset?.(event)}
								/>
							) : null}
							<RowActionButton
								icon={isOwner ? LoadEditorActionIcon : canPropose ? ProposalActionIcon : CopyPlus}
								label={!isOwner && !canPropose ? 'Fork map' : editPresentation.actionLabel}
								hover="hover:text-ok"
								disabled={context.isPublishing}
								onClick={() =>
									context.onLoadDataset(event, {
										intent: isOwner ? 'edit' : canPropose ? 'propose' : 'fork',
									})
								}
							/>
							{!isOwner && canPropose && (
								<RowActionButton
									icon={CopyPlus}
									label="Fork map"
									disabled={context.isPublishing}
									onClick={() => context.onLoadDataset(event, { intent: 'fork' })}
								/>
							)}
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
							{isOwner ? (
								<ConfirmDeleteAction
									label="Map"
									isDeleting={context.deletingKey === datasetKey}
									onConfirm={() => context.onDeleteDataset(event)}
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
