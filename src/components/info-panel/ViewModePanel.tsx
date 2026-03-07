import { CopyPlus, Eye, EyeOff, FileText, GitPullRequest, Maximize2, Pencil } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import type { FeatureCollection } from 'geojson'
import { useEditorStore } from '@/features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { validateDatasetForContext } from '@/lib/context/validation'
import { Button } from '../ui/button'
import { DataTable } from '../ui/data-table'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { CommentsPanel } from '@/features/social/comments'
import { ProposalsPanel } from '@/features/social/proposals'
import type { NDKGeoEditProposalEvent } from '@/lib/ndk/NDKGeoEditProposalEvent'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import {
	createViewModeColumns,
	type ViewModeColumnsContext,
	type ViewModeRowData,
} from './view-mode-columns'
import { DatasetFeaturesList } from './DatasetFeaturesList'
import { EntityActionBar } from './EntityActionBar'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { UserProfile } from '../user-profile'

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
	onCommentGeometryVisibility?: (comment: NDKGeoCommentEvent, visible: boolean) => void
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
	/** Optional comment d-tag from the route to reveal in the thread */
	focusCommentId?: string
}

type ViewTab = 'details' | 'proposals'

function getDatasetDescription(dataset: NDKGeoEvent): string | null {
	const collection = dataset.featureCollection as Record<string, unknown>
	const properties =
		typeof collection?.properties === 'object' && collection.properties
			? (collection.properties as Record<string, unknown>)
			: {}

	const candidates = [
		collection?.description,
		collection?.summary,
		properties.description,
		properties.summary,
	]

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim()
		}
	}

	return null
}

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
	focusCommentId,
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
	const commentTarget: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent | null =
		viewDataset ?? viewCollection ?? viewContext

	// Reset comment-related state when target changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on target change
	useEffect(() => {
		setVisibleGeojsonCommentIds(new Set())
		setAttachedGeojson(null)
	}, [viewDataset, viewCollection, viewContext])

	useEffect(() => {
		if (!viewDataset && activeTab === 'proposals') {
			setActiveTab('details')
		}
	}, [activeTab, viewDataset])

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
			const id = comment.commentId ?? comment.id ?? ''
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
				onCommentGeometryVisibility(comment, visible)
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

	const commentsSection = commentTarget ? (
		<EntityPanelSurface tone="discussion" className="space-y-4">
			<EntityPanelSectionHeader
				eyebrow="Discussion"
				title="Comments"
				action={
					canAttachGeometry || attachedGeojson ? (
						<Button
							type="button"
							variant={attachedGeojson ? 'default' : 'outline'}
							size="sm"
							onClick={attachedGeojson ? handleClearAttachment : handleAttachGeometry}
							className="gap-1.5 rounded-none border-stone-200 bg-white px-2 text-[11px] text-stone-700 hover:bg-stone-100"
						>
							{attachedGeojson
								? `Clear ${attachedGeojson.features.length} attachment${
										attachedGeojson.features.length === 1 ? '' : 's'
									}`
								: `Attach ${selectedFeatures.length} selected`}
						</Button>
					) : null
				}
			/>
			<CommentsPanel
				key={commentTarget.id ?? commentTarget.dTag ?? 'no-target'}
				target={commentTarget}
				onCommentGeojsonVisibilityChange={handleCommentGeojsonVisibilityChange}
				onZoomToCommentGeojson={handleZoomToCommentGeojson}
				visibleGeojsonCommentIds={visibleGeojsonCommentIds}
				attachedGeojson={attachedGeojson}
				onClearAttachment={handleClearAttachment}
				availableFeatures={availableFeatures}
				onMentionVisibilityToggle={onMentionVisibilityToggle}
				onMentionZoomTo={onMentionZoomTo}
				focusCommentId={focusCommentId}
			/>
		</EntityPanelSurface>
	) : null

	const tabs = viewDataset ? (
		<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ViewTab)}>
			<TabsList className="h-8 rounded-none border-b border-slate-200 bg-transparent p-0">
				<TabsTrigger
					value="details"
					className="h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-slate-950 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					<FileText className="h-3.5 w-3.5" />
					Details
				</TabsTrigger>
				<TabsTrigger
					value="proposals"
					className="h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-slate-950 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					<GitPullRequest className="h-3.5 w-3.5" />
					Proposals
				</TabsTrigger>
			</TabsList>
		</Tabs>
	) : null

	return (
		<EntityPanelShell title={headerTitle} tabs={tabs}>
			{activeTab === 'details' ? (
				<div className="space-y-4">
					{/* Collection View */}
					{viewCollection && (
						<>
							<EntityPanelSurface tone="collection" className="space-y-3">
								<EntityPanelSectionHeader
									eyebrow="Collection"
									title={viewCollection.metadata.name ?? viewCollection.collectionId}
									action={
										onZoomToCollection ? (
											<EntityActionBar
												actions={[
													{
														icon: <Maximize2 className="h-3.5 w-3.5" />,
														label: 'Zoom bounds',
														onClick: () => onZoomToCollection(viewCollection, viewCollectionEvents),
													},
												]}
											/>
										) : null
									}
								/>
								{viewCollection.metadata.description && (
									<RichContentRenderer
										content={viewCollection.metadata.description}
										availableFeatures={availableFeatures}
										onMentionVisibilityToggle={onMentionVisibilityToggle}
										onMentionZoomTo={onMentionZoomTo}
										className="text-sm text-gray-600"
									/>
								)}
								<div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
									<div className="flex items-center gap-1.5 px-2 py-0.5">
										<span className="shrink-0">Maintainer:</span>
										<UserProfile
											pubkey={viewCollection.pubkey}
											mode="avatar-name"
											size="xs"
											showNip05Badge={false}
											interactive={false}
										/>
									</div>
									<span className="px-2 py-0.5">
										{viewCollection.datasetReferences.length} linked dataset
										{viewCollection.datasetReferences.length === 1 ? '' : 's'}
									</span>
								</div>
								{viewCollection.metadata.tags && viewCollection.metadata.tags.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{viewCollection.metadata.tags.slice(0, 5).map((tag) => (
											<span
												key={tag}
												className="border border-slate-200 px-2 py-0.5 text-[10px] text-purple-700"
											>
												#{tag}
											</span>
										))}
									</div>
								)}
							</EntityPanelSurface>

							<EntityPanelSurface tone="neutral" className="space-y-3">
								<EntityPanelSectionHeader
									eyebrow="Contents"
									title="Linked geo events"
									description="Datasets currently attached to this collection."
								/>
								{viewCollectionEvents.length === 0 ? (
									<p className="text-xs text-gray-500">
										No linked geo events are currently loaded. Listen for their coordinates or load
										datasets first.
									</p>
								) : (
									<DataTable
										columns={linkedEventsColumns}
										data={linkedEventsTableData}
										getRowId={(row) => row.datasetKey}
										getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
									/>
								)}
							</EntityPanelSurface>

							{commentsSection}
						</>
					)}

					{/* Dataset View (without collection) */}
					{viewDataset && !viewCollection && (
						<>
							<EntityPanelSurface tone="dataset" className="space-y-3">
								<EntityPanelSectionHeader eyebrow="Dataset" title={getDatasetName(viewDataset)} />
								{getDatasetDescription(viewDataset) && (
									<RichContentRenderer
										content={getDatasetDescription(viewDataset) ?? ''}
										availableFeatures={availableFeatures}
										onMentionVisibilityToggle={onMentionVisibilityToggle}
										onMentionZoomTo={onMentionZoomTo}
										className="text-sm text-gray-600"
									/>
								)}
								<div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
									<div className="flex items-center gap-1.5 px-2 py-0.5">
										<span className="shrink-0">Owner:</span>
										<UserProfile
											pubkey={viewDataset.pubkey}
											mode="avatar-name"
											size="xs"
											showNip05Badge={false}
											interactive={false}
										/>
									</div>
									<span className="px-2 py-0.5">
										Collections referenced: {viewDataset.collectionReferences.length}
									</span>
								</div>
								{viewDataset.hashtags.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{viewDataset.hashtags.slice(0, 5).map((tag) => (
											<span
												key={tag}
												className="border border-slate-200 px-2 py-0.5 text-[10px] text-blue-700"
											>
												#{tag}
											</span>
										))}
									</div>
								)}
								<div className="grid gap-1 text-[11px] text-gray-600 sm:grid-cols-2">
									<div className="border-l border-slate-200 pl-2">
										Bounding box:{' '}
										{viewDataset.boundingBox ? viewDataset.boundingBox.join(', ') : 'Not provided'}
									</div>
									<div className="border-l border-slate-200 pl-2">
										Geohash: {viewDataset.geohash ?? '—'}
									</div>
								</div>
							</EntityPanelSurface>

							<EntityPanelSurface tone="neutral">
								<EntityActionBar
									actions={[
										{
											icon:
												currentUserPubkey === viewDataset.pubkey ? (
													<Pencil className="h-3.5 w-3.5" />
												) : (
													<CopyPlus className="h-3.5 w-3.5" />
												),
											label:
												currentUserPubkey === viewDataset.pubkey ? 'Edit dataset' : 'Load copy',
											onClick: () => onLoadDataset(viewDataset),
											variant: 'outline',
											disabled: isPublishing,
										},
										{
											icon:
												datasetVisibility[getDatasetKey(viewDataset)] !== false ? (
													<EyeOff className="h-3.5 w-3.5" />
												) : (
													<Eye className="h-3.5 w-3.5" />
												),
											label:
												datasetVisibility[getDatasetKey(viewDataset)] !== false
													? 'Hide dataset'
													: 'Show dataset',
											onClick: () => onToggleVisibility(viewDataset),
										},
										{
											icon: <Maximize2 className="h-3.5 w-3.5" />,
											label: 'Zoom to dataset',
											onClick: () => onZoomToDataset(viewDataset),
										},
									]}
								/>
							</EntityPanelSurface>

							<EntityPanelSurface tone="neutral" className="space-y-3">
								<EntityPanelSectionHeader
									eyebrow="Geometry"
									title={`Features (${viewDataset.featureCollection?.features?.length ?? 0})`}
								/>
								<DatasetFeaturesList
									featureCollection={viewDataset.featureCollection}
									hiddenFeatureIds={hiddenFeatureIds}
									className="max-h-[40vh] overflow-y-auto"
								/>
							</EntityPanelSurface>

							{commentsSection}
						</>
					)}
				</div>
			) : activeTab === 'proposals' ? (
				<EntityPanelSurface tone="neutral">
					<ProposalsPanel
						key={viewDataset?.id ?? viewDataset?.dTag ?? 'no-target'}
						target={viewDataset}
						currentUserPubkey={currentUserPubkey}
						onToggleProposalOverlay={onToggleProposalOverlay}
						onProposalAccepted={onProposalAccepted}
						visibleProposalIds={visibleProposalIds}
					/>
				</EntityPanelSurface>
			) : null}
		</EntityPanelShell>
	)
}
