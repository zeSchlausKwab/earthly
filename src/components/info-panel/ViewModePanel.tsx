import { Maximize2, FileText, MessageCircle, MapPin, GitPullRequest } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import type { FeatureCollection } from 'geojson'
import { useEditorStore } from '@/features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import { cn } from '@/lib/utils'
import { validateDatasetForContext } from '@/lib/context/validation'
import { Button } from '../ui/button'
import { DataTable } from '../ui/data-table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { CommentsPanel } from '@/features/social/comments'
import { ProposalsPanel } from '@/features/social/proposals'
import type { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'
import { GeoRichTextEditor, type GeoFeatureItem } from '../editor/GeoRichTextEditor'
import {
	createViewModeColumns,
	type ViewModeColumnsContext,
	type ViewModeRowData,
} from './view-mode-columns'
import { DatasetFeaturesList } from './DatasetFeaturesList'

export interface ViewModePanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (commentId: string, geojson: FeatureCollection | null) => void
	/** Callback to zoom to a bounding box */
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Available features for $ mentions in comments */
	availableFeatures?: GeoFeatureItem[]
	/** Callback when a geo mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (proposal: NDKGeoEditProposalEvent, visible: boolean) => void
	/** Callback when a proposal is accepted */
	onProposalAccepted?: () => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
}

type ViewTab = 'details' | 'comments' | 'proposals'

export interface ViewModePanelCallbacks {
	onCommentGeojsonVisibilityChange?: (comment: NDKGeoCommentEvent, visible: boolean) => void
	onZoomToCommentGeojson?: (comment: NDKGeoCommentEvent) => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}

/**
 * Panel displayed when viewing a dataset or collection (not editing).
 * Shows metadata and actions for the viewed item with tabs for Details and Comments.
 */
export function ViewModePanel({
	currentUserPubkey,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset: _onDeleteDataset,
	onZoomToCollection,
	deletingKey: _deletingKey,
	onExitViewMode: _onExitViewMode,
	getDatasetKey,
	getDatasetName,
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	onToggleProposalOverlay,
	onProposalAccepted,
	visibleProposalIds = new Set(),
}: ViewModePanelProps) {
	const [activeTab, setActiveTab] = useState<ViewTab>('details')
	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)

	const isPublishing = useEditorStore((state) => state.isPublishing)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const viewCollection = useEditorStore((state) => state.viewCollection)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewCollectionEvents = useEditorStore((state) => state.viewCollectionEvents)
	const viewContext = useEditorStore((state) => state.viewContext)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	const headerTitle = viewCollection ? 'Collection overview' : 'Dataset overview'

	// Get the target for comments (either dataset or collection)
	const commentTarget = viewDataset ?? viewCollection

	// Reset comment-related state when target changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on target change
	useEffect(() => {
		setVisibleGeojsonCommentIds(new Set())
		setAttachedGeojson(null)
	}, [viewDataset, viewCollection])

	// Get selected features for attachment
	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((f) => selectedFeatureIds.includes(f.id))
	}, [features, selectedFeatureIds])

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson

	const handleAttachGeometry = useCallback(() => {
		if (selectedFeatures.length === 0) return
		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features: selectedFeatures.map((f) => ({
				type: 'Feature' as const,
				id: f.id,
				geometry: f.geometry,
				properties: f.properties ?? {},
			})),
		}
		setAttachedGeojson(collection)
	}, [selectedFeatures])

	const handleClearAttachment = useCallback(() => {
		setAttachedGeojson(null)
	}, [])

	const handleCommentGeojsonVisibilityChange = useCallback(
		(comment: NDKGeoCommentEvent, visible: boolean) => {
			const id = comment.id ?? comment.commentId ?? ''
			setVisibleGeojsonCommentIds((prev) => {
				const next = new Set(prev)
				if (visible) {
					next.add(id)
				} else {
					next.delete(id)
				}
				return next
			})
			// Add/remove comment's GeoJSON from map layers
			if (onCommentGeometryVisibility) {
				onCommentGeometryVisibility(id, visible ? (comment.geojson ?? null) : null)
			}
		},
		[onCommentGeometryVisibility],
	)

	const handleZoomToCommentGeojson = useCallback(
		(comment: NDKGeoCommentEvent) => {
			if (comment.boundingBox && onZoomToBounds) {
				onZoomToBounds(comment.boundingBox)
			} else if (comment.geojson && onZoomToBounds) {
				// Calculate bounds from GeoJSON if no bbox tag
				const geojsonData = comment.geojson
				import('@turf/turf')
					.then((turf) => {
						const bbox = turf.bbox(geojsonData) as [number, number, number, number]
						if (bbox.every((v) => Number.isFinite(v))) {
							onZoomToBounds(bbox)
						}
					})
					.catch(() => {
						console.warn('Could not calculate bounds for comment GeoJSON')
					})
			}
		},
		[onZoomToBounds],
	)

	// Prepare linked events table data for collection view
	const linkedEventsTableData: ViewModeRowData[] = useMemo(() => {
		return viewCollectionEvents.map((event) => {
			const datasetKey = getDatasetKey(event)
			const datasetName = getDatasetName(event)
			const isVisible = datasetVisibility[datasetKey] !== false
			const isOwned = currentUserPubkey === event.pubkey
			return { event, datasetKey, datasetName, isVisible, isOwned }
		})
	}, [viewCollectionEvents, getDatasetKey, getDatasetName, datasetVisibility, currentUserPubkey])

	// Columns context for linked events table
	const linkedEventsColumnsContext: ViewModeColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onToggleVisibility,
			onZoomToDataset,
			isPublishing,
			datasetVisibility,
		}),
		[onLoadDataset, onToggleVisibility, onZoomToDataset, isPublishing, datasetVisibility],
	)

	const linkedEventsColumns = useMemo(
		() => createViewModeColumns(linkedEventsColumnsContext),
		[linkedEventsColumnsContext],
	)

	const hiddenFeatureIds = useMemo(() => {
		if (!viewDataset || !viewContext || contextFilterMode !== 'strict') return undefined
		const contextCoordinate = viewContext.contextCoordinate
		if (!contextCoordinate || !viewDataset.contextReferences.includes(contextCoordinate)) {
			return undefined
		}
		if (viewContext.context.contextUse === 'taxonomy') return undefined

		const validation = validateDatasetForContext(
			viewDataset,
			viewContext,
			viewDataset.featureCollection,
			'strict',
		)
		if (validation.status !== 'invalid') return undefined

		const hidden = new Set<string>()
		validation.errors.forEach((error) => {
			if (error.featureId) {
				hidden.add(String(error.featureId))
			}
		})
		return hidden.size > 0 ? hidden : undefined
	}, [viewDataset, viewContext, contextFilterMode])

	return (
		<div className="flex flex-col h-full text-sm">
			{/* Header */}
			<div className="flex-shrink-0 flex items-center justify-between gap-2 mb-3">
				<div className="flex items-center gap-2">
					<h2 className="text-lg font-bold text-gray-900">{headerTitle}</h2>
				</div>
			</div>

			{/* Tab buttons */}
			<div className="flex-shrink-0 flex items-center gap-1 mb-3 border-b border-gray-100 pb-2">
				<Button
					variant={activeTab === 'details' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('details')}
					className="gap-1.5"
				>
					<FileText className="h-3.5 w-3.5" />
					Details
				</Button>
				<Button
					variant={activeTab === 'comments' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('comments')}
					className="gap-1.5"
				>
					<MessageCircle className="h-3.5 w-3.5" />
					Comments
				</Button>
				{viewDataset && (
					<Button
						variant={activeTab === 'proposals' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setActiveTab('proposals')}
						className="gap-1.5"
					>
						<GitPullRequest className="h-3.5 w-3.5" />
						Proposals
					</Button>
				)}

				{/* Attach geometry button - only show when on comments tab */}
				{activeTab === 'comments' && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={attachedGeojson ? 'default' : 'outline'}
								size="sm"
								onClick={attachedGeojson ? handleClearAttachment : handleAttachGeometry}
								disabled={!canAttachGeometry && !attachedGeojson}
								className="ml-auto gap-1.5"
							>
								<MapPin className="h-3.5 w-3.5" />
								{attachedGeojson
									? `${attachedGeojson.features.length} attached`
									: selectedFeatures.length > 0
										? `Attach ${selectedFeatures.length}`
										: 'Select geometry'}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{attachedGeojson
								? 'Click to clear attachment'
								: selectedFeatures.length > 0
									? 'Attach selected geometry to your comment'
									: 'Select geometry in the editor first, then attach it here'}
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			{/* Tab content */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{activeTab === 'details' ? (
					<div className="space-y-4">
						{/* Collection View */}
						{viewCollection && (
							<>
								<section className="rounded-lg border border-gray-200 p-3 space-y-2">
									<div className="flex items-center justify-between gap-2">
										<h3 className="text-base font-semibold text-gray-900">
											{viewCollection.metadata.name ?? viewCollection.collectionId}
										</h3>
										{onZoomToCollection && (
											<Button
												size="sm"
												variant="outline"
												onClick={() => onZoomToCollection(viewCollection, viewCollectionEvents)}
											>
												<Maximize2 className="h-3 w-3" />
												Zoom bounds
											</Button>
										)}
									</div>
									{viewCollection.metadata.description && (
										<div className="text-sm text-gray-600">
											<GeoRichTextEditor
												initialValue={viewCollection.metadata.description}
												readOnly
												availableFeatures={availableFeatures}
												onMentionVisibilityToggle={onMentionVisibilityToggle}
												onMentionZoomTo={onMentionZoomTo}
											/>
										</div>
									)}
									<div className="text-[11px] text-gray-500">
										Maintainer: {viewCollection.pubkey.slice(0, 8)}…
										{viewCollection.pubkey.slice(-4)}
									</div>
									<div className="text-[11px] text-gray-500">
										{viewCollection.datasetReferences.length} linked dataset
										{viewCollection.datasetReferences.length === 1 ? '' : 's'}
									</div>
									{viewCollection.metadata.tags && viewCollection.metadata.tags.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{viewCollection.metadata.tags.slice(0, 5).map((tag) => (
												<span
													key={tag}
													className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700"
												>
													#{tag}
												</span>
											))}
										</div>
									)}
								</section>

								<section className="space-y-2">
									<h4 className="text-sm font-semibold text-gray-800">Linked geo events</h4>
									{viewCollectionEvents.length === 0 ? (
										<p className="text-xs text-gray-500">
											No linked geo events are currently loaded. Listen for their coordinates or
											load datasets first.
										</p>
									) : (
										<DataTable
											columns={linkedEventsColumns}
											data={linkedEventsTableData}
											getRowId={(row) => row.datasetKey}
											getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
										/>
									)}
								</section>
							</>
						)}

						{/* Dataset View (without collection) */}
						{viewDataset && !viewCollection && (
							<>
								<section className="rounded-lg border border-gray-200 p-3 space-y-2">
									<div className="text-base font-semibold text-gray-900">
										{getDatasetName(viewDataset)}
									</div>
									<div className="text-[11px] text-gray-500">
										Owner: {viewDataset.pubkey.slice(0, 8)}…{viewDataset.pubkey.slice(-4)}
									</div>
									{viewDataset.hashtags.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{viewDataset.hashtags.slice(0, 5).map((tag) => (
												<span
													key={tag}
													className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
												>
													#{tag}
												</span>
											))}
										</div>
									)}
									<div className="text-xs text-gray-600 space-y-1">
										<div>
											Bounding box:{' '}
											{viewDataset.boundingBox
												? viewDataset.boundingBox.join(', ')
												: 'Not provided'}
										</div>
										<div>Geohash: {viewDataset.geohash ?? '—'}</div>
										<div>Collections referenced: {viewDataset.collectionReferences.length}</div>
									</div>
								</section>

								{/* Inline action buttons */}
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										className={cn(
											currentUserPubkey === viewDataset.pubkey
												? 'bg-green-600 text-white hover:bg-green-700'
												: 'bg-blue-600 text-white hover:bg-blue-700',
										)}
										onClick={() => onLoadDataset(viewDataset)}
										disabled={isPublishing}
									>
										{currentUserPubkey === viewDataset.pubkey ? 'Edit' : 'Load copy'}
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => onToggleVisibility(viewDataset)}
									>
										{datasetVisibility[getDatasetKey(viewDataset)] !== false ? 'Hide' : 'Show'}
									</Button>
									<Button size="sm" variant="outline" onClick={() => onZoomToDataset(viewDataset)}>
										Zoom
									</Button>
								</div>

								{/* Features list */}
								<section className="space-y-2">
									<h4 className="text-sm font-semibold text-gray-800">
										Features ({viewDataset.featureCollection?.features?.length ?? 0})
									</h4>
									<DatasetFeaturesList
										featureCollection={viewDataset.featureCollection}
										hiddenFeatureIds={hiddenFeatureIds}
										className="max-h-[40vh] overflow-y-auto"
									/>
								</section>
							</>
						)}
					</div>
				) : activeTab === 'comments' ? (
					<CommentsPanel
						key={commentTarget?.id ?? commentTarget?.dTag ?? 'no-target'}
						target={commentTarget}
						onCommentGeojsonVisibilityChange={handleCommentGeojsonVisibilityChange}
						onZoomToCommentGeojson={handleZoomToCommentGeojson}
						visibleGeojsonCommentIds={visibleGeojsonCommentIds}
						attachedGeojson={attachedGeojson}
						onClearAttachment={handleClearAttachment}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
					/>
				) : activeTab === 'proposals' ? (
					<ProposalsPanel
						key={viewDataset?.id ?? viewDataset?.dTag ?? 'no-target'}
						target={viewDataset}
						currentUserPubkey={currentUserPubkey}
						onToggleProposalOverlay={onToggleProposalOverlay}
						onProposalAccepted={onProposalAccepted}
						visibleProposalIds={visibleProposalIds}
					/>
				) : null}
			</div>
		</div>
	)
}
