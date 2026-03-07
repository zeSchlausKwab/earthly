import { Eye, Layers3, Maximize2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'
import { useEditorStore } from '@/features/geo-editor/store'
import { validateDatasetForContext, type ContextFilterMode } from '@/lib/context/validation'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { CommentsPanel } from '@/features/social/comments'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { EntityActionBar } from './EntityActionBar'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'

interface MapContextViewPanelProps {
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onLoadDataset: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onOpenReferenceCollection?: (collection: NDKGeoCollectionEvent) => void
	onCommentGeometryVisibility?: (comment: NDKGeoCommentEvent, visible: boolean) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	focusCommentId?: string
}

export function MapContextViewPanel({
	getDatasetKey,
	getDatasetName,
	onLoadDataset,
	onZoomToDataset,
	onOpenReferenceCollection,
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	focusCommentId,
}: MapContextViewPanelProps) {
	const viewContext = useEditorStore((state) => state.viewContext)
	const viewContextDatasets = useEditorStore((state) => state.viewContextDatasets)
	const viewContextCollections = useEditorStore((state) => state.viewContextCollections)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const features = useEditorStore((state) => state.features)

	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)

	const validationModeForDisplay = contextFilterMode === 'off' ? 'warn' : contextFilterMode

	const validationByDatasetKey = useMemo(() => {
		const map = new Map<string, ReturnType<typeof validateDatasetForContext>>()
		if (!viewContext) return map
		viewContextDatasets.forEach((dataset) => {
			const key = getDatasetKey(dataset)
			map.set(
				key,
				validateDatasetForContext(dataset, viewContext, undefined, validationModeForDisplay),
			)
		})
		return map
	}, [viewContext, viewContextDatasets, getDatasetKey, validationModeForDisplay])

	const counters = useMemo(() => {
		let valid = 0
		let invalid = 0
		let unresolved = 0
		validationByDatasetKey.forEach((result) => {
			if (result.status === 'valid') valid += 1
			else if (result.status === 'invalid') invalid += 1
			else unresolved += 1
		})
		return { valid, invalid, unresolved }
	}, [validationByDatasetKey])

	const mapLaneDatasets = useMemo(() => {
		if (contextFilterMode !== 'strict') return viewContextDatasets
		return viewContextDatasets.filter((dataset) => {
			const key = getDatasetKey(dataset)
			return validationByDatasetKey.get(key)?.status === 'valid'
		})
	}, [contextFilterMode, viewContextDatasets, getDatasetKey, validationByDatasetKey])

	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((feature) => selectedFeatureIds.includes(feature.id))
	}, [features, selectedFeatureIds])

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson

	const handleAttachGeometry = useCallback(() => {
		if (selectedFeatures.length === 0) return
		setAttachedGeojson({
			type: 'FeatureCollection',
			features: selectedFeatures.map((feature) => ({
				type: 'Feature' as const,
				id: feature.id,
				geometry: feature.geometry,
				properties: feature.properties ?? {},
			})),
		})
	}, [selectedFeatures])

	const handleCommentGeojsonVisibilityChange = useCallback(
		(comment: NDKGeoCommentEvent, visible: boolean) => {
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

	const handleZoomToCommentGeojson = useCallback(
		(comment: NDKGeoCommentEvent) => {
			if (comment.boundingBox && onZoomToBounds) {
				onZoomToBounds(comment.boundingBox)
				return
			}

			if (comment.geojson && onZoomToBounds) {
				import('@turf/turf')
					.then((turf) => {
						const bounds = turf.bbox(comment.geojson as FeatureCollection) as [
							number,
							number,
							number,
							number,
						]
						if (bounds.every((value) => Number.isFinite(value))) {
							onZoomToBounds(bounds)
						}
					})
					.catch(() => undefined)
			}
		},
		[onZoomToBounds],
	)

	if (!viewContext) {
		return <div className="text-sm text-gray-500">No context selected.</div>
	}

	const contextContent = viewContext.context
	const allowedGeometryTypes = contextContent.geometryConstraints?.allowedTypes ?? []
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
							onClick={() => {
								if (attachedGeojson) setAttachedGeojson(null)
								else handleAttachGeometry()
							}}
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
				key={viewContext.id ?? viewContext.dTag ?? 'no-context'}
				target={viewContext}
				onCommentGeojsonVisibilityChange={handleCommentGeojsonVisibilityChange}
				onZoomToCommentGeojson={handleZoomToCommentGeojson}
				visibleGeojsonCommentIds={visibleGeojsonCommentIds}
				attachedGeojson={attachedGeojson}
				onClearAttachment={() => setAttachedGeojson(null)}
				availableFeatures={availableFeatures}
				onMentionVisibilityToggle={onMentionVisibilityToggle}
				onMentionZoomTo={onMentionZoomTo}
				focusCommentId={focusCommentId}
			/>
		</EntityPanelSurface>
	)

	return (
		<EntityPanelShell title={contextContent.name || viewContext.contextId}>
			<div className="space-y-3 text-[13px]">
				<EntityPanelSurface tone="context" className="space-y-3">
					{contextContent.description && (
						<RichContentRenderer
							content={contextContent.description}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="text-sm text-gray-600"
						/>
					)}
					<div className="flex flex-wrap gap-2 text-[10px]">
						<span className="border border-slate-200 px-2 py-0.5 text-blue-700">
									use: {contextContent.contextUse}
						</span>
						<span className="border border-slate-200 px-2 py-0.5 text-amber-700">
									validation: {contextContent.validationMode}
						</span>
						{allowedGeometryTypes.length > 0 && (
							<span className="border border-slate-200 px-2 py-0.5 text-emerald-700">
										geometry: {allowedGeometryTypes.join(', ')}
							</span>
						)}
					</div>
				</EntityPanelSurface>

				<EntityPanelSurface tone="neutral" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Filter"
						title="Context filter mode"
						description={`Valid ${counters.valid} · Invalid ${counters.invalid} · Unresolved ${counters.unresolved}`}
					/>
					<Label className="sr-only">Context filter mode</Label>
						<Select
							value={contextFilterMode}
							onValueChange={(mode) => setContextFilterMode(mode as ContextFilterMode)}
						>
						<SelectTrigger className="max-w-[10rem] rounded-none text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="off">off</SelectItem>
							<SelectItem value="warn">warn</SelectItem>
							<SelectItem value="strict">strict</SelectItem>
						</SelectContent>
					</Select>
				</EntityPanelSurface>

				<EntityPanelSurface tone="neutral" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Map Lane"
						title={`Map lane datasets (${mapLaneDatasets.length})`}
					/>

					{mapLaneDatasets.length === 0 ? (
						<p className="text-xs text-gray-500">No datasets in the current filter mode.</p>
					) : (
						<div className="space-y-2">
							{mapLaneDatasets.map((dataset) => {
								const key = getDatasetKey(dataset)
								const result = validationByDatasetKey.get(key)
								const status = result?.status ?? 'unresolved'
								const statusClass =
									status === 'valid'
										? 'bg-emerald-100 text-emerald-700'
										: status === 'invalid'
											? 'bg-red-100 text-red-700'
											: 'bg-gray-100 text-gray-700'
								return (
									<div key={key} className="flex items-center justify-between gap-2 border-b border-slate-200 py-2">
										<div className="min-w-0">
											<p className="truncate text-xs font-medium text-gray-900">
												{getDatasetName(dataset)}
											</p>
											<div className="flex items-center gap-2">
												<span className={`border px-2 py-0.5 text-[10px] ${statusClass}`}>
													{status}
												</span>
												{result && result.featureErrorCount > 0 && (
													<span className="text-[10px] text-red-600">
														{result.featureErrorCount} invalid feature(s)
													</span>
												)}
											</div>
										</div>
										<EntityActionBar
											actions={[
												{
													icon: <Eye className="h-3.5 w-3.5" />,
													label: 'Inspect dataset',
													onClick: () => onLoadDataset(dataset),
												},
												{
													icon: <Maximize2 className="h-3.5 w-3.5" />,
													label: 'Zoom to dataset',
													onClick: () => onZoomToDataset(dataset),
												},
											]}
										/>
									</div>
								)
							})}
						</div>
					)}
				</EntityPanelSurface>

				<EntityPanelSurface tone="neutral" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Reference Lane"
						title={`References (${viewContextCollections.length})`}
					/>
					{viewContextCollections.length === 0 ? (
						<p className="text-xs text-gray-500">No attached references.</p>
					) : (
						<div className="space-y-2">
							{viewContextCollections.map((collection) => (
								<div
									key={collection.id ?? collection.collectionId}
									className="flex items-center justify-between gap-2 border-b border-slate-200 py-2"
								>
									<div className="min-w-0">
										<p className="truncate text-xs font-medium text-gray-900">
											{collection.metadata.name ?? collection.collectionId}
										</p>
										<p className="text-[10px] text-gray-500">
											{collection.datasetReferences.length} dataset reference(s)
										</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										onClick={() => onOpenReferenceCollection?.(collection)}
										className="rounded-none border-stone-200 bg-white px-2 text-xs"
									>
										Open isolation
									</Button>
								</div>
							))}
						</div>
					)}
				</EntityPanelSurface>

				{commentsSection}
			</div>
		</EntityPanelShell>
	)
}
