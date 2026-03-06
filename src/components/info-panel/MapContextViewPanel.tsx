import { Eye, FileText, Layers3, MapPin, Maximize2, MessageCircle } from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'

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
}

type ViewTab = 'details' | 'comments'

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
}: MapContextViewPanelProps) {
	const viewContext = useEditorStore((state) => state.viewContext)
	const viewContextDatasets = useEditorStore((state) => state.viewContextDatasets)
	const viewContextCollections = useEditorStore((state) => state.viewContextCollections)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const features = useEditorStore((state) => state.features)

	const [activeTab, setActiveTab] = useState<ViewTab>('details')
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
			const id = comment.id ?? comment.commentId ?? ''
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

	return (
		<div className="flex h-full flex-col text-sm">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="text-lg font-semibold text-gray-900">
					{contextContent.name || viewContext.contextId}
				</h2>
			</div>

			<div className="mb-3 flex items-center gap-1 border-b border-gray-100 pb-2">
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

				{activeTab === 'comments' && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={attachedGeojson ? 'default' : 'outline'}
								size="sm"
								onClick={() => {
									if (attachedGeojson) setAttachedGeojson(null)
									else handleAttachGeometry()
								}}
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

			<div className="min-h-0 flex-1 overflow-y-auto">
				{activeTab === 'details' ? (
					<div className="space-y-4 text-sm">
						<div className="space-y-2 rounded-lg border border-gray-200 p-3">
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
								<span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
									use: {contextContent.contextUse}
								</span>
								<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
									validation: {contextContent.validationMode}
								</span>
								{allowedGeometryTypes.length > 0 && (
									<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
										geometry: {allowedGeometryTypes.join(', ')}
									</span>
								)}
							</div>
						</div>

						<div className="space-y-2 rounded-lg border border-gray-200 p-3">
							<Label>Context filter mode</Label>
							<Select
								value={contextFilterMode}
								onValueChange={(mode) => setContextFilterMode(mode as ContextFilterMode)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="off">off</SelectItem>
									<SelectItem value="warn">warn</SelectItem>
									<SelectItem value="strict">strict</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-[11px] text-gray-500">
								Valid {counters.valid} · Invalid {counters.invalid} · Unresolved {counters.unresolved}
							</p>
						</div>

						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<Layers3 className="h-4 w-4 text-emerald-700" />
								<h3 className="font-medium text-gray-900">Map lane datasets</h3>
								<span className="text-xs text-gray-500">({mapLaneDatasets.length})</span>
							</div>

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
											<div
												key={key}
												className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
											>
												<div className="min-w-0">
													<p className="truncate text-xs font-medium text-gray-900">
														{getDatasetName(dataset)}
													</p>
													<div className="flex items-center gap-2">
														<span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClass}`}>
															{status}
														</span>
														{result && result.featureErrorCount > 0 && (
															<span className="text-[10px] text-red-600">
																{result.featureErrorCount} invalid feature(s)
															</span>
														)}
													</div>
												</div>
												<div className="flex shrink-0 items-center gap-1">
													<Button size="icon-sm" variant="outline" onClick={() => onLoadDataset(dataset)}>
														<Eye className="h-3 w-3" />
													</Button>
													<Button
														size="icon-sm"
														variant="outline"
														onClick={() => onZoomToDataset(dataset)}
													>
														<Maximize2 className="h-3 w-3" />
													</Button>
												</div>
											</div>
										)
									})}
								</div>
							)}
						</div>

						<div className="space-y-2">
							<div className="flex items-center gap-2">
								<h3 className="font-medium text-gray-900">Reference lane</h3>
								<span className="text-xs text-gray-500">({viewContextCollections.length})</span>
							</div>
							{viewContextCollections.length === 0 ? (
								<p className="text-xs text-gray-500">No attached references.</p>
							) : (
								<div className="space-y-2">
									{viewContextCollections.map((collection) => (
										<div
											key={collection.id ?? collection.collectionId}
											className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2"
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
											>
												Open isolation
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				) : (
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
					/>
				)}
			</div>
		</div>
	)
}
