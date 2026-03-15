import { Eye, MapPin, Pencil } from 'lucide-react'
import type { FeatureCollection, Geometry } from 'geojson'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	getEffectiveContextUse,
	getEffectiveContextValidationMode,
	getContextRequiredPropertyDefaults,
	validateDatasetForContext,
	type ContextValidationResult,
} from '../lib/context/validation'
import { useEditorStore } from '../features/geo-editor/store'
import { sanitizeEditorProperties } from '../features/geo-editor/utils'
import { NDKGeoEvent as NDKGeoEventClass, type NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { MapContextValidationMode, NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
import {
	BlobReferencesSection,
	DatasetMetadataSection,
	EntityPanelSectionHeader,
	EntityPanelSurface,
	GeometriesTable,
	MapContextViewPanel,
	ViewModePanel,
} from './info-panel'
import { DatasetSizeIndicator } from './info-panel/DatasetSizeIndicator'
import { MapContextEditorPanel } from '../features/contexts/MapContextEditorPanel'
import { CommentsPanel } from '../features/social/comments'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { EntitySearchPopover, type EntitySearchResult } from './entity-search'
import type { EditorFeature } from '../features/geo-editor/core'
import type { BlossomUploadResult } from '../lib/blossom/blossomUpload'
import { Input } from './ui/input'

type ContextPropertyTypeHint = 'string' | 'number' | 'integer' | 'boolean'

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

export interface GeoEditorInfoPanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onStartNewDataset?: () => void
	onOpenGeometryEditor?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onDeleteContext?: (context: NDKMapContextEvent) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	onClose?: () => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (
		comment: import('../lib/ndk/NDKGeoCommentEvent').NDKGeoCommentEvent,
		visible: boolean,
	) => void
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
	/** Context editor mode */
	contextEditorMode?: 'none' | 'create' | 'edit'
	/** Context being edited */
	editingContext?: NDKMapContextEvent | null
	/** Callback when context is saved */
	onSaveContext?: (context: NDKMapContextEvent) => void
	/** Callback to close context editor */
	onCloseContextEditor?: () => void
	/** Available contexts for dataset attachment */
	mapContextEvents?: NDKMapContextEvent[]
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (
		proposal: import('@/lib/ndk/NDKGeoEditProposalEvent').NDKGeoEditProposalEvent,
		visible: boolean,
	) => void
	/** Callback when a proposal is accepted */
	onProposalAccepted?: (dataset: NDKGeoEvent) => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
	/** Callback when a feature is zoomed to from the geometries list */
	onZoomToFeature?: (feature: EditorFeature) => void
	/** Current feature collection for size checking */
	featureCollectionForUpload?: FeatureCollection | null
	/** Callback when blossom upload completes */
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	/** NDK instance for authenticated uploads */
	ndk?: import('@nostr-dev-kit/ndk').default | null
	/** Optional comment d-tag from the route to reveal in the thread */
	focusCommentId?: string
	entityWorkspace?: 'geometry' | 'context'
	entityIntent?: 'inspect' | 'edit'
}

export function GeoEditorInfoPanelContent(props: GeoEditorInfoPanelProps) {
	const {
		onLoadDataset,
		onInspectDataset,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onDeleteContext,
		currentUserPubkey,
		onOpenGeometryEditor,
		deletingKey,
		onExitViewMode,
		getDatasetKey,
		getDatasetName,
		onCommentGeometryVisibility,
		onZoomToBounds,
		availableFeatures = [],
		onMentionVisibilityToggle,
		onMentionZoomTo,
		contextEditorMode = 'none',
		editingContext,
		onSaveContext,
		onCloseContextEditor,
		mapContextEvents = [],
		onToggleProposalOverlay,
		onProposalAccepted,
		visibleProposalIds,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
		focusCommentId,
		entityWorkspace,
		entityIntent,
	} = props

	// Store state
	const stats = useEditorStore((state) => state.stats)
	const features = useEditorStore((state) => state.features)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const publishMessage = useEditorStore((state) => state.publishMessage)
	const publishError = useEditorStore((state) => state.publishError)
	const viewMode = useEditorStore((state) => state.viewMode)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const setViewDataset = useEditorStore((state) => state.setViewDataset)
	const blobReferences = useEditorStore((state) => state.blobReferences)
	const viewContext = useEditorStore((state) => state.viewContext)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const geoEditDrafts = useEditorStore((state) => state.geoEditDrafts)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const createGeoEditDraft = useEditorStore((state) => state.createGeoEditDraft)
	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)

	const existingCollectionBlob = blobReferences.find(
		(ref) => ref.scope === 'collection' && Boolean(ref.url),
	)

	const activeDatasetInfo = activeDataset
		? {
				name: getDatasetName(activeDataset),
				isOwner: currentUserPubkey === activeDataset.pubkey,
			}
		: null

	const activeDraft = useMemo(
		() => (activeGeoEditDraftId ? (geoEditDrafts[activeGeoEditDraftId] ?? null) : null),
		[activeGeoEditDraftId, geoEditDrafts],
	)
	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((feature) => selectedFeatureIds.includes(feature.id))
	}, [features, selectedFeatureIds])
	const canAttachCommentGeometry = selectedFeatures.length > 0 && !attachedGeojson
	const currentDraftSourceId = activeDataset
		? `dataset:${getDatasetKey(activeDataset)}`
		: (activeDraft?.sourceId ?? null)

	useEffect(() => {
		if (contextEditorMode !== 'none' || viewMode === 'view') return
		if (!currentDraftSourceId) return
		if (activeDraft?.sourceId === currentDraftSourceId) return

		const store = useEditorStore.getState()
		createGeoEditDraft(currentDraftSourceId, {
			name: store.collectionMeta.name,
			description: store.collectionMeta.description,
			collectionMeta: store.collectionMeta,
			features: store.features,
			selectedFeatureIds: store.selectedFeatureIds,
		})
	}, [contextEditorMode, viewMode, currentDraftSourceId, activeDraft?.sourceId, createGeoEditDraft])
	// Toggle to view mode - show the active dataset in view mode
	const handleSwitchToView = () => {
		if (activeDataset) {
			setViewDataset(activeDataset)
			setViewContext(null)
			setViewMode('view')
		}
	}

	const attachableContexts = useMemo(
		() =>
			mapContextEvents
				.map((context) => {
					const coordinate = context.contextCoordinate
					if (!coordinate) return null
					const isAttached = activeDatasetContextRefs.includes(coordinate)
					if (!context.context.allowForeignAttachments && !isAttached) {
						return null
					}
					return {
						coordinate,
						name: context.context.name || context.contextId || context.id || 'Untitled context',
						validationMode: getEffectiveContextValidationMode(context),
						contextUse: getEffectiveContextUse(context),
						contextEvent: context,
					}
				})
				.filter(
					(
						entry,
					): entry is {
						coordinate: string
						name: string
						validationMode: MapContextValidationMode
						contextUse: 'taxonomy' | 'validation' | 'hybrid'
						contextEvent: NDKMapContextEvent
					} => entry !== null,
				),
		[mapContextEvents, activeDatasetContextRefs],
	)

	// Split into: already attached (always shown) + recent unattached (top 5)
	const { attachedContexts, recentUnattachedContexts } = useMemo(() => {
		const attached = attachableContexts.filter((c) =>
			activeDatasetContextRefs.includes(c.coordinate),
		)
		const unattached = attachableContexts
			.filter((c) => !activeDatasetContextRefs.includes(c.coordinate))
			.sort((a, b) => (b.contextEvent.created_at ?? 0) - (a.contextEvent.created_at ?? 0))
			.slice(0, 5)
		return { attachedContexts: attached, recentUnattachedContexts: unattached }
	}, [attachableContexts, activeDatasetContextRefs])

	const datasetForValidation = useMemo(
		() => activeDataset ?? new NDKGeoEventClass(undefined),
		[activeDataset],
	)
	const editorFeatureCollection = useMemo<FeatureCollection>(
		() => ({
			type: 'FeatureCollection',
			features: features.map((feature) => {
				const sanitized = sanitizeEditorProperties(
					feature.properties as Record<string, unknown> | undefined,
				)
				return {
					type: 'Feature' as const,
					id: feature.id,
					geometry: feature.geometry as Geometry,
					properties: sanitized ?? {},
				}
			}),
		}),
		[features],
	)
	const attachableContextByCoordinate = useMemo(() => {
		const byCoordinate = new Map<
			string,
			{
				coordinate: string
				name: string
				validationMode: MapContextValidationMode
				contextUse: 'taxonomy' | 'validation' | 'hybrid'
				contextEvent: NDKMapContextEvent
			}
		>()
		attachableContexts.forEach((context) => {
			byCoordinate.set(context.coordinate, context)
		})
		return byCoordinate
	}, [attachableContexts])
	const contextValidationByCoordinate = useMemo(() => {
		const results = new Map<string, ContextValidationResult>()
		activeDatasetContextRefs.forEach((coordinate) => {
			const context = attachableContextByCoordinate.get(coordinate)
			if (!context) return
			const result = validateDatasetForContext(
				datasetForValidation,
				context.contextEvent,
				editorFeatureCollection,
				'strict',
			)
			results.set(coordinate, result)
		})
		return results
	}, [
		activeDatasetContextRefs,
		attachableContextByCoordinate,
		datasetForValidation,
		editorFeatureCollection,
	])
	const invalidAttachedContextCount = useMemo(
		() =>
			activeDatasetContextRefs.reduce((count, coordinate) => {
				const result = contextValidationByCoordinate.get(coordinate)
				return result?.status === 'invalid' ? count + 1 : count
			}, 0),
		[activeDatasetContextRefs, contextValidationByCoordinate],
	)
	const contextPropertyTypeHints = useMemo(() => {
		const hints = new Map<string, Set<ContextPropertyTypeHint>>()
		const supportedTypes = new Set<ContextPropertyTypeHint>([
			'string',
			'number',
			'integer',
			'boolean',
		])

		activeDatasetContextRefs.forEach((coordinate) => {
			const context = attachableContextByCoordinate.get(coordinate)
			if (!context) return
			if (context.contextUse === 'taxonomy') return

			const schema = asRecord(context.contextEvent.context.schema)
			const properties = asRecord(schema?.properties)
			if (!properties) return

			Object.entries(properties).forEach(([propertyKey, definition]) => {
				const definitionRecord = asRecord(definition)
				const type = typeof definitionRecord?.type === 'string' ? definitionRecord.type : null
				if (!type || !supportedTypes.has(type as ContextPropertyTypeHint)) return

				const currentSet = hints.get(propertyKey) ?? new Set<ContextPropertyTypeHint>()
				currentSet.add(type as ContextPropertyTypeHint)
				hints.set(propertyKey, currentSet)
			})
		})

		const resolved = new Map<string, ContextPropertyTypeHint>()
		hints.forEach((typeSet, propertyKey) => {
			if (typeSet.size !== 1) return
			const onlyType = Array.from(typeSet.values())[0]
			if (!onlyType) return
			resolved.set(propertyKey, onlyType)
		})
		return resolved
	}, [activeDatasetContextRefs, attachableContextByCoordinate])
	const contextValidationIssuesByFeatureId = useMemo(() => {
		const issues = new Map<string, Set<string>>()
		contextValidationByCoordinate.forEach((result) => {
			if (result.status !== 'invalid') return
			result.errors.forEach((error) => {
				if (!error.featureId) return
				const key = String(error.featureId)
				const set = issues.get(key) ?? new Set<string>()
				set.add(`${error.path || '/'} ${error.message}`)
				issues.set(key, set)
			})
		})

		const asArray = new Map<string, string[]>()
		issues.forEach((set, key) => {
			asArray.set(key, Array.from(set.values()))
		})
		return asArray
	}, [contextValidationByCoordinate])

	const getPrimaryContextError = useCallback(
		(coordinate: string) => {
			const result = contextValidationByCoordinate.get(coordinate)
			if (!result || result.status !== 'invalid' || result.errors.length === 0) return null
			return (
				result.errors.find((error) => error.path === '/geometry/type') ?? result.errors[0] ?? null
			)
		},
		[contextValidationByCoordinate],
	)

	const toggleContextAttachment = (coordinate: string, checked: boolean) => {
		const next = new Set(activeDatasetContextRefs)
		if (checked) {
			next.add(coordinate)
		} else {
			next.delete(coordinate)
		}
		setActiveDatasetContextRefs(Array.from(next))

		if (!checked) return
		const context = attachableContextByCoordinate.get(coordinate)
		if (!context) return

		const defaults = getContextRequiredPropertyDefaults(context.contextEvent)
		if (Object.keys(defaults).length === 0) return

		if (features.length === 0) return

		let changed = false
		const nextFeatures = features.map((feature) => {
			const rootProps =
				feature.properties && typeof feature.properties === 'object' ? feature.properties : {}
			const currentCustom =
				rootProps.customProperties &&
				typeof rootProps.customProperties === 'object' &&
				!Array.isArray(rootProps.customProperties)
					? (rootProps.customProperties as Record<string, unknown>)
					: {}

			const nextCustom = { ...currentCustom }
			let featureChanged = false
			for (const [key, value] of Object.entries(defaults)) {
				const hasRootValue = (rootProps as Record<string, unknown>)[key] !== undefined
				const hasCustomValue = nextCustom[key] !== undefined
				if (hasRootValue || hasCustomValue) continue
				nextCustom[key] = value
				featureChanged = true
			}

			if (!featureChanged) return feature
			changed = true
			return {
				...feature,
				properties: {
					...rootProps,
					customProperties: nextCustom,
				},
			}
		})

		if (changed) {
			setFeatures(nextFeatures)
		}
	}

	const handleContextSearchSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const contextEvent = result.entity as NDKMapContextEvent
		const coordinate = contextEvent.contextCoordinate
		if (coordinate) {
			toggleContextAttachment(coordinate, true)
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on active dataset change
	useEffect(() => {
		setVisibleGeojsonCommentIds(new Set())
		setAttachedGeojson(null)
	}, [activeDataset])

	const handleAttachCommentGeometry = useCallback(() => {
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
		(comment: import('../lib/ndk/NDKGeoCommentEvent').NDKGeoCommentEvent, visible: boolean) => {
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
		(comment: import('../lib/ndk/NDKGeoCommentEvent').NDKGeoCommentEvent) => {
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

	// Context Editor mode
	if (contextEditorMode !== 'none' && onSaveContext && onCloseContextEditor) {
		return (
			<MapContextEditorPanel
				initialContext={editingContext}
				onClose={onCloseContextEditor}
				onSave={onSaveContext}
				availableFeatures={availableFeatures}
				mapContextEvents={mapContextEvents}
			/>
		)
	}

	// View mode - delegate to ViewModePanel
	if (viewMode === 'view') {
		if (viewContext) {
			return (
				<MapContextViewPanel
					currentUserPubkey={currentUserPubkey}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onInspectDataset={onInspectDataset ?? onLoadDataset}
					onZoomToDataset={onZoomToDataset}
					onDeleteContext={onDeleteContext}
					deletingKey={deletingKey}
					onCommentGeometryVisibility={onCommentGeometryVisibility}
					onZoomToBounds={onZoomToBounds}
					availableFeatures={availableFeatures}
					mapContextEvents={mapContextEvents}
					onMentionVisibilityToggle={onMentionVisibilityToggle}
					onMentionZoomTo={onMentionZoomTo}
					focusCommentId={focusCommentId}
				/>
			)
		}

		if (!viewDataset) {
			const isEmptyGeometryInspect =
				entityWorkspace === 'geometry' && entityIntent === 'inspect' && !viewContext
			return (
				<div className="h-full flex items-center justify-center p-6">
					<div className="max-w-sm text-center space-y-3">
						<p className="text-sm font-medium text-gray-900">
							{isEmptyGeometryInspect ? 'No geometry selected' : 'Nothing selected'}
						</p>
						<p className="text-xs text-gray-500">
							{isEmptyGeometryInspect
								? 'Click on the map to inspect a geometry.'
								: 'Choose a geometry or context to inspect.'}
						</p>
						{isEmptyGeometryInspect && onOpenGeometryEditor ? (
							<div className="flex justify-center">
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="gap-1.5"
									onClick={onOpenGeometryEditor}
								>
									<Pencil className="h-3.5 w-3.5" />
									Start editing
								</Button>
							</div>
						) : null}
					</div>
				</div>
			)
		}

		return (
			<ViewModePanel
				currentUserPubkey={currentUserPubkey}
				onLoadDataset={onLoadDataset}
				onToggleVisibility={onToggleVisibility}
				onZoomToDataset={onZoomToDataset}
				onDeleteDataset={onDeleteDataset}
				deletingKey={deletingKey}
				onExitViewMode={onExitViewMode}
				getDatasetKey={getDatasetKey}
				getDatasetName={getDatasetName}
				onCommentGeometryVisibility={onCommentGeometryVisibility}
				onZoomToBounds={onZoomToBounds}
				availableFeatures={availableFeatures}
				onMentionVisibilityToggle={onMentionVisibilityToggle}
				onMentionZoomTo={onMentionZoomTo}
				onToggleProposalOverlay={onToggleProposalOverlay}
				onProposalAccepted={onProposalAccepted}
				visibleProposalIds={visibleProposalIds}
				focusCommentId={focusCommentId}
			/>
		)
	}

	// Edit mode - compact layout
	return (
		<div className="space-y-2 text-sm">
			{/* Header */}
			<div className="flex items-center justify-between gap-2 pb-1 border-b border-gray-100">
				<div className="flex items-center gap-2">
					{activeDataset && (
						<Button
							size="sm"
							variant="ghost"
							onClick={handleSwitchToView}
							title="Switch to view mode"
							className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
						>
							<Eye className="h-3 w-3 mr-1" />
							View
						</Button>
					)}
				</div>
				{activeDatasetInfo && (
					<span className="text-[10px] text-gray-500 truncate max-w-[100px]">
						{activeDatasetInfo.name} {activeDatasetInfo.isOwner ? '' : '(copy)'}
					</span>
				)}
			</div>

			{/* Stats row - inline */}
			<div className="flex items-center gap-3 text-[10px] text-gray-500">
				<span>{stats.points} pts</span>
				<span>{stats.lines} lines</span>
				<span>{stats.polygons} polys</span>
			</div>

			{/* Dataset size indicator - shows warning when over limit */}
			{featureCollectionForUpload && (
				<DatasetSizeIndicator
					featureCollection={featureCollectionForUpload}
					onUploadComplete={onBlossomUploadComplete}
					existingBlob={
						existingCollectionBlob
							? {
									url: existingCollectionBlob.url,
									sha256: existingCollectionBlob.sha256,
									size: existingCollectionBlob.size,
								}
							: null
					}
					ndk={ndk ?? undefined}
				/>
			)}

			{/* Dataset Metadata - collapsible */}
			<Collapsible defaultOpen>
				<CollapsibleTrigger className="text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-1">
					Dataset info
				</CollapsibleTrigger>
				<CollapsibleContent>
					<DatasetMetadataSection
						key={activeDataset?.id ?? 'new'}
						availableFeatures={availableFeatures}
					/>
				</CollapsibleContent>
			</Collapsible>

			<Collapsible defaultOpen={false}>
				<CollapsibleTrigger className="text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-1">
					Attached contexts ({activeDatasetContextRefs.length})
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="space-y-2">
						{invalidAttachedContextCount > 0 && (
							<p className="text-[11px] text-amber-700">
								{invalidAttachedContextCount} attached context
								{invalidAttachedContextCount === 1 ? '' : 's'} report constraint warnings.
							</p>
						)}

						{/* Attached contexts — always shown */}
						{attachedContexts.length > 0 && (
							<div className="space-y-1">
								{attachedContexts.map((context) => {
									const validation = contextValidationByCoordinate.get(context.coordinate)
									return (
										<div key={context.coordinate} className="space-y-1">
											<label
												className={`flex items-center justify-between gap-2 rounded border px-2 py-1 ${
													validation?.status === 'invalid'
														? 'border-amber-300 bg-amber-50/40'
														: 'border-gray-100'
												}`}
											>
												<span className="truncate text-xs text-gray-700">{context.name}</span>
												<div className="flex items-center gap-2 shrink-0">
													<span className="text-[10px] text-gray-500">
														{context.validationMode}
													</span>
													{validation?.status === 'valid' && (
														<span className="text-[10px] text-emerald-700">valid</span>
													)}
													{validation?.status === 'invalid' && (
														<span className="text-[10px] text-amber-700">
															{validation.featureErrorCount} invalid
														</span>
													)}
													<Input
														type="checkbox"
														checked
														onChange={() => toggleContextAttachment(context.coordinate, false)}
													/>
												</div>
											</label>
											{validation?.status === 'invalid' &&
												(() => {
													const primaryError = getPrimaryContextError(context.coordinate)
													if (!primaryError) return null
													return (
														<p className="px-2 text-[10px] text-amber-700">
															{primaryError.path || '/'} {primaryError.message}
														</p>
													)
												})()}
											{validation?.status === 'unresolved' && context.contextUse !== 'taxonomy' && (
												<p className="px-2 text-[10px] text-amber-600">
													Validation not run yet — save or re-open this dataset to trigger it.
												</p>
											)}
										</div>
									)
								})}
							</div>
						)}

						{/* Recent unattached contexts */}
						{recentUnattachedContexts.length > 0 && (
							<div className="space-y-1">
								<p className="text-[10px] text-gray-400 uppercase tracking-wide">Recent</p>
								{recentUnattachedContexts.map((context) => (
									<label
										key={context.coordinate}
										className="flex items-center justify-between gap-2 rounded border border-gray-100 px-2 py-1"
									>
										<span className="truncate text-xs text-gray-700">{context.name}</span>
										<div className="flex items-center gap-2 shrink-0">
											<span className="text-[10px] text-gray-500">{context.validationMode}</span>
											<Input
												type="checkbox"
												checked={false}
												onChange={() => toggleContextAttachment(context.coordinate, true)}
											/>
										</div>
									</label>
								))}
							</div>
						)}

						{/* Search for more contexts */}
						<EntitySearchPopover
							sources={{ contexts: attachableContexts.map((context) => context.contextEvent) }}
							entityTypes={['context']}
							onSelect={handleContextSearchSelect}
							placeholder="Search open contexts…"
							searchMode="local"
							compact
						/>
						{attachableContexts.length === 0 && recentUnattachedContexts.length === 0 && (
							<p className="text-[10px] text-gray-400 leading-snug">
								Only open contexts appear here. If you don't see yours, open its settings and enable
								"Allow foreign attachments".
							</p>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>

			{/* Blob References - collapsible */}
			<Collapsible defaultOpen={false}>
				<CollapsibleTrigger className="text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-1">
					External references
				</CollapsibleTrigger>
				<CollapsibleContent>
					<BlobReferencesSection />
				</CollapsibleContent>
			</Collapsible>

			{/* Geometries table */}
			<div className="flex flex-col min-h-0">
				<div className="text-xs font-medium text-gray-700 py-1">Geometries ({features.length})</div>
				<GeometriesTable
					className="max-h-[50vh] overflow-y-auto"
					onZoomToFeature={onZoomToFeature}
					contextValidationIssuesByFeatureId={contextValidationIssuesByFeatureId}
					contextPropertyTypeHints={contextPropertyTypeHints}
					availableFeatures={availableFeatures}
				/>
			</div>

			{activeDataset && (
				<EntityPanelSurface tone="discussion" className="space-y-4">
					<EntityPanelSectionHeader
						eyebrow="Discussion"
						title="Comments"
						action={
							canAttachCommentGeometry || attachedGeojson ? (
								<Button
									type="button"
									size="sm"
									variant={attachedGeojson ? 'default' : 'outline'}
									onClick={
										attachedGeojson ? () => setAttachedGeojson(null) : handleAttachCommentGeometry
									}
									className="gap-1.5 rounded-none border-stone-200 bg-white px-2 text-[11px] text-stone-700 hover:bg-stone-100"
								>
									<MapPin className="h-3.5 w-3.5" />
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
						key={activeDataset.id ?? activeDataset.dTag ?? 'edit-dataset'}
						target={activeDataset}
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
			)}

			{/* Publishing Status */}
			{(publishMessage || publishError) && (
				<div className="text-[10px] pt-1">
					{publishMessage && <p className="text-green-600">{publishMessage}</p>}
					{publishError && <p className="text-red-600">{publishError}</p>}
				</div>
			)}
		</div>
	)
}

export function GeoEditorInfoPanel({
	className,
	...props
}: GeoEditorInfoPanelProps & { className?: string }) {
	return (
		<div className={cn('w-80 rounded-xl bg-white p-3 shadow-lg', className)}>
			<GeoEditorInfoPanelContent {...props} />
		</div>
	)
}
