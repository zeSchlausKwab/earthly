import { BookOpen, ExternalLink, Eye, EyeOff, Layers, Maximize2 } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import { useEditorStore } from '@/features/geo-editor/store'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import type { MapContext } from '@/lib/nostr/map-context'
import type { Article } from '@/lib/nostr/article'
import type { Group } from '@/lib/nostr/group'
import { privateDatasetStackEntryId } from '@/features/private-maps/privateDatasetStack'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'
import { formatBytes } from '@/lib/blossom/blossomUpload'
import { serializedJsonBytes } from '@/lib/geo/serializedSize'
import { validateDatasetForContext } from '@/lib/context/validation'
import { extractCollectionMeta } from '@/features/geo-editor/utils'
import type { EarthlyObjectTab } from '@/router/routeContract'
import { Button } from '../ui/button'
import { CommentsPanel, GeoSocialActions } from '@/features/social/comments'
import { ProposalsPanel } from '@/features/social/proposals'
import type { GeoProposal } from '@/lib/nostr/geo-proposal'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { DatasetFeaturesList } from './DatasetFeaturesList'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { ObjectDetailsSection, ObjectInspectLayout } from './ObjectInspectLayout'
import { presentDatasetMetadata } from './datasetMetadataPresentation'
import { UserProfile } from '../user-profile'
import { ObjectTabs, ThreadTabNotice } from './ObjectTabs'
import { useObjectContentTab } from './ObjectThreadPlacement'
import type { DatasetEditOptions } from './mapProposalPresentation'
import { MapEditActions } from './MapEditActions'

export interface ViewModePanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: GeoDataset, options?: DatasetEditOptions) => void
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
	mapContextEvents?: MapContext[]
	mapStories?: Article[]
	mapGroups?: Group[]
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
	onExitViewMode,
	mapContextEvents = [],
	mapStories,
	mapGroups = [],
}: ViewModePanelProps) {
	const [uncontrolledObjectTab, setUncontrolledObjectTab] = useState<EarthlyObjectTab>('details')
	const activeObjectTab = objectTab ?? uncontrolledObjectTab
	const contentTab = useObjectContentTab(activeObjectTab)
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
	const datasetSize = useMemo(
		() =>
			viewDataset
				? (viewDataset.datasetSize ?? serializedJsonBytes(viewDataset.featureCollection))
				: 0,
		[viewDataset],
	)

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
	const privateWorkspaceId = privateWorkspaceIdForDataset(viewDataset)
	const stackId = privateWorkspaceId
		? privateDatasetStackEntryId(privateWorkspaceId, getDatasetKey(viewDataset))
		: `dataset:${getDatasetKey(viewDataset)}`
	const isOnMap = Boolean(mapStackEntries[stackId])
	const featureCount = viewDataset.featureCollection?.features?.length ?? 0
	const publishedDate = new Date(viewDataset.created_at * 1000).toISOString().slice(0, 10)
	const audience = privateWorkspaceId
		? 'Circle only'
		: fieldSessionIdForEvent(viewDataset.rawEvent())
			? 'Nearby session'
			: 'Everyone'
	const mapCoordinate = `${viewDataset.kind}:${viewDataset.pubkey}:${viewDataset.dTag}`
	const atlasCandidates = [
		...mapGroups.map((atlas) => ({
			coordinate: atlas.groupCoordinate,
			name: atlas.group.name,
			referencedAddresses: atlas.referencedAddresses,
		})),
		...mapContextEvents.map((atlas) => ({
			coordinate: atlas.contextCoordinate,
			name: atlas.context.name,
			referencedAddresses: atlas.referencedAddresses,
		})),
	]
	const relatedAtlases = [
		...new Map(atlasCandidates.map((atlas) => [atlas.coordinate, atlas])).values(),
	].filter(
		(atlas) =>
			viewDataset.contextReferences.includes(atlas.coordinate ?? '') ||
			atlas.referencedAddresses.includes(mapCoordinate),
	)
	const unresolvedAtlasRefs = viewDataset.contextReferences.filter(
		(coordinate) => !relatedAtlases.some((atlas) => atlas.coordinate === coordinate),
	)
	const relatedStories = mapStories?.filter((story) =>
		story.referencedAddresses.includes(mapCoordinate),
	)

	const commentsSection = (
		<EntityPanelSurface tone="discussion" className="h-full min-h-0 px-0 py-2">
			<CommentsPanel
				key={viewDataset.id ?? viewDataset.dTag ?? 'no-target'}
				embedded
				toolbarAction={
					canAttachGeometry || attachedGeojson ? (
						<Button
							type="button"
							variant={attachedGeojson ? 'default' : 'outline'}
							size="sm"
							onClick={attachedGeojson ? handleClearAttachment : handleAttachGeometry}
							className="gap-1.5 rounded-none border-border bg-transparent px-2 text-[11px] text-foreground hover:bg-muted/60"
						>
							{attachedGeojson
								? `Clear ${attachedGeojson.features.length} attachment${
										attachedGeojson.features.length === 1 ? '' : 's'
									}`
								: `Attach ${selectedFeatures.length} selected`}
						</Button>
					) : null
				}
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
		<ObjectInspectLayout
			contained={contentTab === 'comments'}
			kind="Map"
			title={getDatasetName(viewDataset)}
			state={`${audience === 'Everyone' ? '' : `${audience} · `}published · ${publishedDate}`}
			author={
				<UserProfile
					pubkey={viewDataset.pubkey}
					mode="avatar-name"
					size="xs"
					showNip05Badge={false}
				/>
			}
			meta={`${featureCount} feature${featureCount === 1 ? '' : 's'}`}
			onBack={onExitViewMode}
			actions={
				<>
					<MapEditActions
						dataset={viewDataset}
						isOwner={currentUserPubkey === viewDataset.pubkey}
						onBegin={onLoadDataset}
						disabled={isPublishing}
					/>
					<Button
						size="sm"
						variant="outline"
						className="rounded-none gap-1"
						onClick={() => onToggleVisibility(viewDataset)}
						aria-label={isOnMap ? 'Remove from map' : 'Show on map'}
						title={isOnMap ? 'Remove from map' : 'Show on map'}
					>
						{isOnMap ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
						<span className="hidden sm:inline">{isOnMap ? 'Remove from map' : 'Show on map'}</span>
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						onClick={() => onZoomToDataset(viewDataset)}
						aria-label="Frame Map"
						title="Frame Map"
					>
						<Maximize2 className="size-3.5" />
					</Button>
				</>
			}
			social={
				<GeoSocialActions
					target={viewDataset}
					compact
					onReplyClick={() => setActiveObjectTab('comments')}
					showShareButton
				/>
			}
			tabs={<ObjectTabs value={activeObjectTab} onValueChange={setActiveObjectTab} />}
		>
			{contentTab === 'details' ? (
				<div className="space-y-3">
					{getDatasetDescription(viewDataset) && (
						<RichContentRenderer
							content={getDatasetDescription(viewDataset) ?? ''}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="text-sm leading-relaxed text-foreground"
						/>
					)}
					<ObjectDetailsSection title="At a glance">
						<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
							{[
								['Features', featureCount],
								['Size', formatBytes(datasetSize)],
								['Published', publishedDate],
								['Audience', audience],
							].map(([label, value]) => (
								<div key={label} className="flex flex-wrap gap-x-2">
									<dt className="text-muted-foreground">{label}</dt>
									<dd>{value}</dd>
								</div>
							))}
							<div className="col-span-2 flex items-center gap-2">
								<dt className="text-muted-foreground">Author</dt>
								<dd>
									<UserProfile
										pubkey={viewDataset.pubkey}
										mode="name-only"
										size="xs"
										showNip05Badge={false}
									/>
								</dd>
							</div>
						</dl>
						<details className="mt-2 text-[11px] text-muted-foreground">
							<summary className="cursor-pointer">Spatial metadata</summary>
							<div className="mt-1 break-words">
								Bounding box: {viewDataset.boundingBox?.join(', ') ?? 'Not provided'}
								<br />
								Geohash: {viewDataset.geohash ?? '—'}
							</div>
						</details>
					</ObjectDetailsSection>

					<ObjectDetailsSection title="Features" count={featureCount}>
						<DatasetFeaturesList
							key={viewedDatasetKey}
							featureCollection={viewDataset.featureCollection}
							datasetAddress={viewDataset.address}
							hiddenFeatureIds={hiddenFeatureIds}
							onZoomToFeature={handleZoomToFeature}
							onCommentOnFeature={(feature) => {
								if (!feature.geometry) return
								setAttachedGeojson({
									type: 'FeatureCollection',
									features: [feature as GeoJSON.Feature],
								})
								setActiveObjectTab('comments')
							}}
						/>
					</ObjectDetailsSection>

					<ObjectDetailsSection title="Belonging" hint="Edit the Map to change">
						<div className="space-y-3 text-xs">
							<div>
								<div className="mb-1.5 text-muted-foreground">Atlases</div>
								<div className="flex flex-wrap gap-1.5">
									{relatedAtlases.map((atlas) => (
										<span
											key={atlas.coordinate}
											className="inline-flex items-center gap-1 border border-border px-2 py-1"
										>
											<Layers className="size-3" />
											{atlas.name}
											{atlas.referencedAddresses.includes(mapCoordinate)
												? ' · pinned'
												: ' · contributed'}
										</span>
									))}
									{unresolvedAtlasRefs.map((coordinate) => (
										<span
											key={coordinate}
											title={coordinate}
											className="max-w-full truncate border border-border px-2 py-1 text-muted-foreground"
										>
											Atlas {coordinate.split(':').slice(2).join(':')} · not loaded
										</span>
									))}
									{relatedAtlases.length + unresolvedAtlasRefs.length === 0 && (
										<p className="text-muted-foreground">Not in any atlas.</p>
									)}
								</div>
							</div>
							<div>
								<div className="mb-1.5 text-muted-foreground">Topics</div>
								<div className="flex flex-wrap gap-1.5">
									{viewDataset.hashtags.length ? (
										viewDataset.hashtags.map((tag) => (
											<span key={tag} className="border border-border px-1.5 py-0.5">
												#{tag}
											</span>
										))
									) : (
										<p className="text-muted-foreground">No topics.</p>
									)}
								</div>
							</div>
						</div>
					</ObjectDetailsSection>

					{(datasetProperties.length > 0 || catalogManifests.length > 0) && (
						<ObjectDetailsSection title="Properties" count={datasetProperties.length}>
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
									No Map-level properties were published yet.
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
						</ObjectDetailsSection>
					)}

					<ObjectDetailsSection title="Appears in" count={relatedStories?.length}>
						{relatedStories?.length ? (
							<div className="space-y-1.5">
								{relatedStories.map((story) => (
									<div key={story.id} className="flex items-center gap-2 text-xs">
										<BookOpen className="size-3.5 shrink-0" />
										<span>{story.article.title || 'Untitled Story'}</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-xs text-muted-foreground">
								{mapStories
									? 'No loaded Story references this Map yet.'
									: 'Story references have not been loaded.'}
							</p>
						)}
					</ObjectDetailsSection>

					<ObjectDetailsSection title="Proposals">
						<ProposalsPanel
							key={viewDataset.id ?? viewDataset.dTag ?? 'no-target'}
							target={viewDataset}
							currentUserPubkey={currentUserPubkey}
							onToggleProposalOverlay={onToggleProposalOverlay}
							onProposalAccepted={onProposalAccepted}
							visibleProposalIds={visibleProposalIds}
						/>
					</ObjectDetailsSection>
					{currentUserPubkey === viewDataset.pubkey && (
						<div className="flex items-center gap-2 pt-1 text-xs text-destructive">
							<ConfirmDeleteAction
								label="Map"
								isDeleting={isDeletingDataset}
								onConfirm={() => onDeleteDataset(viewDataset)}
							/>
							<span>Delete map…</span>
						</div>
					)}
				</div>
			) : contentTab === 'comments' ? (
				commentsSection
			) : (
				<ThreadTabNotice />
			)}
		</ObjectInspectLayout>
	)
}
