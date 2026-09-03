import { ExternalLink, Eye, EyeOff, GitPullRequest, Maximize2, Pencil } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import { useEditorStore } from '@/features/geo-editor/store'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { validateDatasetForContext } from '@/lib/context/validation'
import { extractCollectionMeta } from '@/features/geo-editor/utils'
import type { EarthlyObjectTab } from '@/router/routeContract'
import { Button } from '../ui/button'
import { CommentsPanel } from '@/features/social/comments'
import { ProposalsPanel } from '@/features/social/proposals'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { DatasetFeaturesList } from './DatasetFeaturesList'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { EntityActionBar } from './EntityActionBar'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { presentDatasetMetadata } from './datasetMetadataPresentation'
import { UserProfile } from '../user-profile'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'
import { getMapEditPresentation } from './mapProposalPresentation'

export interface ViewModePanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	deletingKey: string | null
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onCommentGeometryVisibility?: (comment: GeoComment, visible: boolean) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	onToggleProposalOverlay?: (proposal: GeoProposal, visible: boolean) => void
	onProposalAccepted?: (dataset: GeoDataset) => void
	visibleProposalIds?: Set<string>
	focusCommentId?: string
	/** Route-backed social-object tab. Omit to let the panel manage it locally. */
	objectTab?: EarthlyObjectTab
	onObjectTabChange?: (tab: EarthlyObjectTab) => void
	/** Callback to exit view mode (panel close). Optional — not all hosts support this. */
	onExitViewMode?: () => void
}

function getDatasetDescription(dataset: GeoDataset): string | null {
	const collection = dataset.featureCollection as unknown as Record<string, unknown>
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

function formatDatasetPropertyValue(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

export function ViewModePanel({
	currentUserPubkey,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset,
	deletingKey,
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
	objectTab,
	onObjectTabChange,
}: ViewModePanelProps) {
	const [uncontrolledObjectTab, setUncontrolledObjectTab] = useState<EarthlyObjectTab>('details')
	const activeObjectTab = objectTab ?? uncontrolledObjectTab
	const setActiveObjectTab = useCallback(
		(tab: EarthlyObjectTab) => {
			if (objectTab === undefined) setUncontrolledObjectTab(tab)
			onObjectTabChange?.(tab)
		},
		[objectTab, onObjectTabChange],
	)
	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)
	const lastViewedDatasetKeyRef = useRef<string | null>(null)

	const isPublishing = useEditorStore((state) => state.isPublishing)
	// Round D.3: visibility derives from stack membership. Same semantic
	// the user would get from the catalog Layers toggle or MapStackPanel rows.
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewContext = useEditorStore((state) => state.viewContext)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	const viewedDatasetKey = viewDataset ? getDatasetKey(viewDataset) : null
	const isDeletingDataset = viewedDatasetKey ? deletingKey === viewedDatasetKey : false
	const editPresentation = getMapEditPresentation(currentUserPubkey === viewDataset?.pubkey)

	useEffect(() => {
		if (lastViewedDatasetKeyRef.current === viewedDatasetKey) return
		lastViewedDatasetKeyRef.current = viewedDatasetKey
		setVisibleGeojsonCommentIds(new Set())
		setAttachedGeojson(null)
		if (objectTab === undefined) setUncontrolledObjectTab('details')
	}, [viewedDatasetKey, objectTab])

	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((f) => selectedFeatureIds.includes(f.id))
	}, [features, selectedFeatureIds])
	const datasetMetadata = useMemo(() => {
		if (!viewDataset) return { properties: [], manifests: [] }
		return presentDatasetMetadata(
			extractCollectionMeta(viewDataset.featureCollection).customProperties,
		)
	}, [viewDataset])
	const datasetProperties = datasetMetadata.properties
	const catalogManifests = datasetMetadata.manifests

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson

	const handleAttachGeometry = useCallback(() => {
		if (selectedFeatures.length === 0) return
		setAttachedGeojson({
			type: 'FeatureCollection',
			features: selectedFeatures.map((f) => ({
				type: 'Feature' as const,
				id: f.id,
				geometry: f.geometry,
				properties: f.properties ?? {},
			})),
		})
	}, [selectedFeatures])

	const handleClearAttachment = useCallback(() => {
		setAttachedGeojson(null)
	}, [])

	const handleCommentGeojsonVisibilityChange = useCallback(
		(comment: GeoComment, visible: boolean) => {
			const id = comment.commentId ?? comment.id ?? ''
			setVisibleGeojsonCommentIds((prev) => {
				const next = new Set(prev)
				if (visible) next.add(id)
				else next.delete(id)
				return next
			})
			onCommentGeometryVisibility?.(comment, visible)
		},
		[onCommentGeometryVisibility],
	)

	// Zoom to a single feature from the read-only features list — inspect-view
	// parity with the edit view's per-feature zoom.
	const handleZoomToFeature = useCallback(
		(feature: GeoJSON.Feature<GeoJSON.Geometry | null, GeoJSON.GeoJsonProperties>) => {
			if (!feature.geometry || !onZoomToBounds) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature as GeoJSON.Feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						onZoomToBounds(bbox)
					}
				})
				.catch(() => {
					console.warn('Could not calculate bounds for feature')
				})
		},
		[onZoomToBounds],
	)

	const handleZoomToCommentGeojson = useCallback(
		(comment: GeoComment) => {
			const geojson = comment.geojson
			if (comment.boundingBox && onZoomToBounds) {
				onZoomToBounds(comment.boundingBox)
			} else if (geojson && onZoomToBounds) {
				import('@turf/turf')
					.then((turf) => {
						const bbox = turf.bbox(geojson) as [number, number, number, number]
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

	if (!viewDataset) {
		return (
			<EntityPanelShell title="Map overview">
				<div className="text-sm text-muted-foreground">No Map selected.</div>
			</EntityPanelShell>
		)
	}

	const commentsSection = (
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
							className="gap-1.5 rounded-none border-border bg-card px-2 text-[11px] text-foreground hover:bg-muted"
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
				key={viewDataset.id ?? viewDataset.dTag ?? 'no-target'}
				target={viewDataset}
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
	)

	return (
		<EntityPanelShell
			title="Map overview"
			tabs={<ObjectTabs value={activeObjectTab} onValueChange={setActiveObjectTab} />}
		>
			{activeObjectTab === 'details' ? (
				<div className="space-y-4">
					<EntityPanelSurface tone="dataset" className="space-y-3">
						<EntityPanelSectionHeader eyebrow="Map" title={getDatasetName(viewDataset)} />
						{getDatasetDescription(viewDataset) && (
							<RichContentRenderer
								content={getDatasetDescription(viewDataset) ?? ''}
								availableFeatures={availableFeatures}
								onMentionVisibilityToggle={onMentionVisibilityToggle}
								onMentionZoomTo={onMentionZoomTo}
								className="text-sm text-muted-foreground"
							/>
						)}
						<div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
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
								Contexts attached: {viewDataset.contextReferences.length}
							</span>
						</div>
						{viewDataset.hashtags.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{viewDataset.hashtags.slice(0, 5).map((tag) => (
									<span
										key={tag}
										className="border border-border px-2 py-0.5 text-[10px] text-info"
									>
										#{tag}
									</span>
								))}
							</div>
						)}
						<div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
							<div className="border-l border-border pl-2">
								Bounding box:{' '}
								{viewDataset.boundingBox ? viewDataset.boundingBox.join(', ') : 'Not provided'}
							</div>
							<div className="border-l border-border pl-2">
								Geohash: {viewDataset.geohash ?? '—'}
							</div>
						</div>
					</EntityPanelSurface>

					<EntityPanelSurface tone="neutral" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Metadata"
							title={`Properties${datasetProperties.length > 0 ? ` (${datasetProperties.length})` : ''}`}
						/>
						{datasetProperties.length > 0 ? (
							<div className="space-y-2">
								{datasetProperties.map(([key, value]) => {
									const displayValue = formatDatasetPropertyValue(value)
									const isLink = typeof value === 'string' && /^https?:\/\//i.test(value.trim())
									return (
										<div
											key={key}
											className="flex flex-col gap-1 border-b border-border pb-2 text-sm last:border-b-0 last:pb-0"
										>
											<span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
												{key}
											</span>
											{isLink ? (
												<a
													href={String(value)}
													target="_blank"
													rel="noreferrer"
													className="break-all text-info underline decoration-info underline-offset-2"
												>
													{displayValue}
												</a>
											) : (
												<span className="break-words text-foreground">{displayValue}</span>
											)}
										</div>
									)
								})}
							</div>
						) : catalogManifests.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								No dataset-level properties were published with this version yet.
							</p>
						) : null}
						{catalogManifests.length > 0 && (
							<div
								className={
									datasetProperties.length > 0
										? 'space-y-2 border-t border-border pt-3'
										: 'space-y-2'
								}
							>
								<div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
									Catalog provenance ({catalogManifests.length})
								</div>
								{catalogManifests.map((manifest) => (
									<div
										key={manifest.snapshotId}
										className="space-y-2 border-l border-border pl-2 text-xs"
									>
										<div className="min-w-0">
											<div
												className="truncate font-medium text-foreground"
												title={manifest.snapshotId}
											>
												{manifest.snapshotId}
											</div>
											{manifest.createdAt && (
												<div className="text-[11px] text-muted-foreground">
													Snapshot created {manifest.createdAt.slice(0, 10)}
												</div>
											)}
										</div>
										{manifest.sources.length > 0 ? (
											<div className="space-y-2">
												{manifest.sources.map((source) => (
													<div
														key={`${source.name}:${source.release}`}
														className="min-w-0 space-y-1"
													>
														<div className="flex flex-wrap items-baseline gap-x-1.5 text-foreground">
															<span className="font-medium">{source.name}</span>
															<span className="text-muted-foreground">{source.release}</span>
														</div>
														{source.license && (
															<div className="break-words text-[11px] text-muted-foreground">
																License: {source.license}
															</div>
														)}
														{source.attribution && (
															<p
																className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground"
																title={source.attribution}
															>
																{source.attribution}
															</p>
														)}
														{(source.attributionUrl || source.documents?.length) && (
															<div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
																{source.attributionUrl && (
																	<a
																		href={source.attributionUrl}
																		target="_blank"
																		rel="noreferrer"
																		className="inline-flex items-center gap-1 text-info underline decoration-info underline-offset-2"
																	>
																		Attribution
																		<ExternalLink className="h-3 w-3" aria-hidden="true" />
																	</a>
																)}
																{source.documents?.map((document) => (
																	<a
																		key={`${document.name}:${document.url}`}
																		href={document.url}
																		target="_blank"
																		rel="noreferrer"
																		className="inline-flex items-center gap-1 text-info underline decoration-info underline-offset-2"
																	>
																		{document.name}
																		<ExternalLink className="h-3 w-3" aria-hidden="true" />
																	</a>
																))}
															</div>
														)}
													</div>
												))}
											</div>
										) : (
											<div className="text-[11px] text-muted-foreground">
												Source details unavailable.
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</EntityPanelSurface>

					<EntityPanelSurface tone="neutral">
						<div className="flex items-center justify-between gap-2">
							<EntityActionBar
								actions={[
									{
										icon:
											currentUserPubkey === viewDataset.pubkey ? (
												<Pencil className="h-3.5 w-3.5" />
											) : (
												<GitPullRequest className="h-3.5 w-3.5" />
											),
										label: editPresentation.actionLabel,
										// Non-owners still enter the existing source-backed working copy;
										// PublishDropdown turns that source relationship into a proposal.
										onClick: () => onLoadDataset(viewDataset),
										variant: 'outline',
										disabled: isPublishing,
									},
									(() => {
										const isOnStack = Boolean(
											mapStackEntries[`dataset:${getDatasetKey(viewDataset)}`],
										)
										return {
											icon: isOnStack ? (
												<EyeOff className="h-3.5 w-3.5" />
											) : (
												<Eye className="h-3.5 w-3.5" />
											),
											label: isOnStack ? 'Remove from Shelf' : 'Show on map',
											// `onToggleVisibility` is now a stack-aware toggle wired in
											// GeoEditorView — adds when not on stack, removes when on.
											onClick: () => onToggleVisibility(viewDataset),
										}
									})(),
									{
										icon: <Maximize2 className="h-3.5 w-3.5" />,
										label: 'Frame Map',
										onClick: () => onZoomToDataset(viewDataset),
									},
								]}
							/>
							{currentUserPubkey === viewDataset.pubkey ? (
								<ConfirmDeleteAction
									label="Map"
									isDeleting={isDeletingDataset}
									onConfirm={() => onDeleteDataset(viewDataset)}
								/>
							) : null}
						</div>
					</EntityPanelSurface>

					<EntityPanelSurface tone="neutral" className="space-y-3">
						<EntityPanelSectionHeader
							eyebrow="Geometry"
							title={`Features (${viewDataset.featureCollection?.features?.length ?? 0})`}
						/>
						<DatasetFeaturesList
							featureCollection={viewDataset.featureCollection}
							datasetAddress={viewDataset.address}
							hiddenFeatureIds={hiddenFeatureIds}
							className="max-h-[40vh] overflow-y-auto"
							onZoomToFeature={handleZoomToFeature}
						/>
					</EntityPanelSurface>

					<EntityPanelSurface tone="neutral">
						<ProposalsPanel
							key={viewDataset.id ?? viewDataset.dTag ?? 'no-target'}
							target={viewDataset}
							currentUserPubkey={currentUserPubkey}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
						/>
					</EntityPanelSurface>
				</div>
			) : activeObjectTab === 'comments' ? (
				commentsSection
			) : (
				<ThreadTabNotice />
			)}
		</EntityPanelShell>
	)
}
