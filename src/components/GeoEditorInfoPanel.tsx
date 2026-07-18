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
import {
	aggregateMeasurements,
	formatAreaKm2,
	formatLengthKm,
} from '../features/geo-editor/api/measure'
import { useEditorStore } from '../features/geo-editor/store'
import { sanitizeEditorProperties } from '../features/geo-editor/utils'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContextValidationMode, MapContext } from '@/lib/nostr/map-context'
import {
	BlobReferencesSection,
	DatasetMetadataSection,
	EntityPanelSectionHeader,
	EntityPanelSurface,
	GeometriesTable,
	GroupViewPanel,
	SightingViewPanel,
	StoryViewPanel,
	ViewModePanel,
} from './info-panel'
import { StoryEditorPanel } from './info-panel/StoryEditorPanel'
import { SightingEditorPanel } from './info-panel/SightingEditorPanel'
import { BeaconControlPanel } from './info-panel/BeaconControlPanel'
import type { BeaconStartOptions } from './info-panel/BeaconControlPanel'
import { BeaconViewPanel } from './info-panel/BeaconViewPanel'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { DatasetSizeIndicator } from './info-panel/DatasetSizeIndicator'
import { GroupEditorPanel } from '../features/groups/GroupEditorPanel'
import type { Article } from '@/lib/nostr/article'
import { GroupAttachField } from '../features/geo-editor/components/GroupAttachField'
import { CommentsPanel } from '../features/social/comments'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EntitySearchResult } from './entity-search'
import type { EditorFeature } from '../features/geo-editor/core'
import type { BlossomUploadResult } from '../lib/blossom/blossomUpload'
import { privateWorkspaceIdForDataset } from '@/lib/private-workspace'
import { fieldSessionIdForEvent } from '@/features/field-sessions/events'
import { LocalDraftPersistenceWarning } from '@/features/geo-editor/components/LocalDraftPersistenceWarning'

type ContextPropertyTypeHint = 'string' | 'number' | 'integer' | 'boolean'

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

export interface GeoEditorInfoPanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: GeoDataset) => void
	onInspectDataset?: (event: GeoDataset) => void
	onStartNewDataset?: () => void
	onOpenGeometryEditor?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onToggleVisibility: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	onClose?: () => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (
		comment: import('@/lib/nostr/geo-comment').GeoComment,
		visible: boolean,
	) => void
	/** Callback to zoom to a bounding box */
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Fly the map to a Sighting and focus it (geometry-aware; used by the Sighting
	 * view panel's "Zoom to" button). */
	onZoomToSighting?: (sighting: import('@/lib/nostr/temporal-sighting').TemporalSighting) => void
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
	/** Map-stack-derived visibility for inline Story refs (single source of truth) */
	isMentionVisible?: (address: string, featureId: string | undefined) => boolean
	/** Context editor mode */
	contextEditorMode?: 'none' | 'create' | 'edit'
	/** Context being edited */
	editingContext?: MapContext | null
	/** Callback when context is saved */
	onSaveContext?: (context: MapContext) => void
	/** Callback to close context editor */
	onCloseContextEditor?: () => void
	/** Available contexts for dataset attachment */
	mapContextEvents?: MapContext[]
	/** Callback when a proposal overlay visibility is toggled */
	onToggleProposalOverlay?: (
		proposal: import('@/lib/nostr/geo-proposal').GeoProposal,
		visible: boolean,
	) => void
	/** Callback when a proposal is accepted */
	onProposalAccepted?: (dataset: GeoDataset) => void
	/** Set of proposal IDs whose overlay is visible */
	visibleProposalIds?: Set<string>
	/** Callback when a feature is zoomed to from the geometries list */
	onZoomToFeature?: (feature: EditorFeature) => void
	/** Current feature collection for size checking */
	featureCollectionForUpload?: FeatureCollection | null
	/** Callback when blossom upload completes */
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	/** Publish-new action for the contributor Group attach field (GROUP-02/04). */
	onPublishNew?: () => void | Promise<void>
	/** Whether publish-new is currently possible (NEVER gated by validation — GROUP-04). */
	canPublishNew?: boolean
	/** True while a publish is in flight. */
	isPublishing?: boolean
	/** Optional comment d-tag from the route to reveal in the thread */
	focusCommentId?: string
	entityWorkspace?: 'geometry' | 'context' | 'story' | 'sighting' | 'beacon'
	entityIntent?: 'inspect' | 'edit'
	/** Story editor mode (Phase 10, D-03). */
	storyEditorMode?: 'none' | 'create' | 'edit'
	/** Story being edited (create ⇒ null). */
	editingStory?: Article | null
	/** Callback when a Story is saved (publish/edit). */
	onSaveStory?: (story: Article) => void
	/** Callback to close the Story editor. */
	onCloseStoryEditor?: () => void
	/** Callback to open a Story in the editor (owner Edit affordance in the view). */
	onEditStory?: (story: Article) => void
	/** Callback to delete a Story (owner). */
	onDeleteStory?: (story: Article) => void
	/** Callback with the republished Story after an accepted proposed edit (refresh view in place). */
	onStoryUpdated?: (updated: Article) => void
	/** Sighting editor mode (Phase 11, D-01/D-07). */
	sightingEditorMode?: 'none' | 'create' | 'edit'
	/** Sighting being edited (create ⇒ null). */
	editingSighting?: TemporalSighting | null
	/** The Sighting currently inspected in the view panel. */
	viewSighting?: TemporalSighting | null
	/**
	 * WR-06: the comment d-tag to focus beneath the viewed Sighting. Separate from
	 * the generic `focusCommentId` because the sighting focus path switches the
	 * sidebar via `navigateToView` (which drops the URL `/comment/:id` segment), so
	 * the global route-derived `focusCommentId` would be wiped — this one is held in
	 * `useSightingEditor` state and survives that navigation.
	 */
	sightingFocusCommentId?: string
	/**
	 * D-10: the comment d-tag to focus beneath the viewed Beacon. Separate from the
	 * generic `focusCommentId` for the same reason as `sightingFocusCommentId` — the
	 * beacon focus path switches the sidebar via `navigateTo`/`navigateToView` (which
	 * drops the URL `/comment/:id` segment), so the route-derived `focusCommentId`
	 * would be wiped. Held in `useBeaconController` state and survives that navigation.
	 */
	beaconFocusCommentId?: string
	/** The geometry placed by the map-first pin-drop, fed to the create form. */
	placedSightingGeometry?: Geometry | null
	/** Switch the Sighting create flow to line/polygon draw (D-02). */
	onDrawSightingArea?: () => void
	/** Callback when a Sighting is saved (publish/edit). */
	onSaveSighting?: (sighting: TemporalSighting) => void
	/** Callback to close the Sighting editor. */
	onCloseSightingEditor?: () => void
	/** Callback to open a Sighting in the editor (owner Edit affordance). */
	onEditSighting?: (sighting: TemporalSighting) => void
	/** Callback to delete a Sighting (owner). */
	onDeleteSighting?: (sighting: TemporalSighting) => void
	/** Phase 13 (SPEC §3.4): add the viewed Sighting to the Map Stack (view-panel affordance). */
	onAddSightingToMapStack?: (sighting: TemporalSighting) => void
	/** Beacon control panel mode (Phase 12, BEACON-01). 'none' ⇒ no control surface. */
	beaconControlMode?: 'none' | 'create' | 'adjust'
	/** The beacon being adjusted — pre-fills the control panel (create ⇒ null). */
	adjustingBeacon?: LiveBeacon | null
	/** The beacon currently inspected in the view panel. */
	viewBeacon?: LiveBeacon | null
	/** True while the map is following the viewed beacon (recenters on each fix). */
	isFollowingBeacon?: boolean
	/** Toggle follow mode for the viewed beacon. */
	onToggleFollowBeacon?: () => void
	/** True while the publisher is starting (Start → "Starting…"). */
	beaconIsStarting?: boolean
	/** Start the publisher session from the control panel. */
	onStartBeacon?: (options: BeaconStartOptions) => void
	/** Close the beacon control panel without starting. */
	onCloseBeaconControl?: () => void
	/** Stop the user's own active beacon (owner-only, from the view panel). */
	onStopBeacon?: (beacon: LiveBeacon) => void
	/** Adjust the user's own active beacon — reopens the control pre-filled. */
	onAdjustBeacon?: (beacon?: LiveBeacon) => void
	/** Fly the map to a beacon and focus it (view-panel "Watch on map"). */
	onZoomToBeacon?: (beacon: LiveBeacon) => void
	/** Phase 13 (SPEC §3.4): add the viewed Beacon to the Map Stack (view-panel affordance). */
	onAddBeaconToMapStack?: (beacon: LiveBeacon) => void
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
		onZoomToSighting,
		availableFeatures = [],
		onMentionVisibilityToggle,
		onMentionZoomTo,
		isMentionVisible,
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
		onPublishNew,
		canPublishNew = false,
		isPublishing = false,
		focusCommentId,
		entityWorkspace,
		entityIntent,
		storyEditorMode = 'none',
		editingStory,
		onSaveStory,
		onCloseStoryEditor,
		onEditStory,
		onDeleteStory,
		onStoryUpdated,
		sightingEditorMode = 'none',
		editingSighting,
		viewSighting,
		sightingFocusCommentId,
		beaconFocusCommentId,
		placedSightingGeometry,
		onDrawSightingArea,
		onSaveSighting,
		onCloseSightingEditor,
		onEditSighting,
		onDeleteSighting,
		onAddSightingToMapStack,
		beaconControlMode = 'none',
		adjustingBeacon,
		viewBeacon,
		isFollowingBeacon,
		onToggleFollowBeacon,
		beaconIsStarting,
		onStartBeacon,
		onCloseBeaconControl,
		onStopBeacon,
		onAdjustBeacon,
		onZoomToBeacon,
		onAddBeaconToMapStack,
	} = props

	// Store state
	const stats = useEditorStore((state) => state.stats)
	const features = useEditorStore((state) => state.features)
	// Stable array of feature properties for GroupAttachField's off-thread schema
	// validation. Built inline as `features.map(...)` this allocated a NEW array on
	// every render, which is one of GroupAttachField's validation-effect deps — so
	// any re-render re-triggered a full worker validation pass (the schema worker
	// pegging a core / GC thrash). Memoizing on the stable `features` ref means the
	// effect only re-validates when the features actually change.
	const featurePropertiesForGroup = useMemo(
		() => features.map((feature) => feature.properties as Record<string, unknown> | undefined),
		[features],
	)
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
	const viewStory = useEditorStore((state) => state.viewStory)
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
	// Passive companion (AI_GEO_AWARENESS §2): dataset totals for the stats row.
	const datasetMeasurements = useMemo(() => aggregateMeasurements(features), [features])
	const canAttachCommentGeometry = selectedFeatures.length > 0 && !attachedGeojson
	const currentDraftSourceId = activeDataset
		? `dataset:${getDatasetKey(activeDataset)}`
		: (activeDraft?.sourceId ?? null)

	useEffect(() => {
		if (contextEditorMode !== 'none' || viewMode === 'view') return
		if (!currentDraftSourceId) return
		if (activeDraft?.sourceId === currentDraftSourceId) return

		const store = useEditorStore.getState()
		const privateGroupId = activeDataset ? privateWorkspaceIdForDataset(activeDataset) : undefined
		const fieldSessionId = activeDataset ? fieldSessionIdForEvent(activeDataset.event) : undefined
		createGeoEditDraft(currentDraftSourceId, {
			name: store.collectionMeta.name,
			description: store.collectionMeta.description,
			collectionMeta: store.collectionMeta,
			features: store.features,
			selectedFeatureIds: store.selectedFeatureIds,
			publishChannel: privateGroupId
				? { kind: 'private-group', id: privateGroupId }
				: fieldSessionId
					? { kind: 'field-session', id: fieldSessionId }
					: { kind: 'public' },
			contextRefs: store.activeDatasetContextRefs,
			blobReferences: store.blobReferences,
		})
	}, [
		contextEditorMode,
		viewMode,
		currentDraftSourceId,
		activeDraft?.sourceId,
		activeDataset,
		createGeoEditDraft,
	])
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
						contextEvent: MapContext
					} => entry !== null,
				),
		[mapContextEvents, activeDatasetContextRefs],
	)

	// Pass the dataset (or null) directly; validation accepts a nullable dataset
	// when an explicit FeatureCollection is provided.
	const datasetForValidation = activeDataset ?? null
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
				contextEvent: MapContext
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
	const _invalidAttachedContextCount = useMemo(
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

	const _getPrimaryContextError = useCallback(
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

	const _handleContextSearchSelect = (result: EntitySearchResult) => {
		if (result.type !== 'context') return
		const contextEvent = result.entity as MapContext
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
		(comment: import('@/lib/nostr/geo-comment').GeoComment, visible: boolean) => {
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
		(comment: import('@/lib/nostr/geo-comment').GeoComment) => {
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

	// Beacon control mode (Phase 12, BEACON-01) — the Start-beacon authoring surface
	// (time-box / visibility / identity / consent). No pin-drop: position comes from
	// GPS via the publisher. Mounted before the Sighting/Story/context branches.
	if (beaconControlMode !== 'none' && onStartBeacon && onCloseBeaconControl) {
		const isAdjusting = beaconControlMode === 'adjust'
		return (
			<BeaconControlPanel
				initialLabel={isAdjusting ? adjustingBeacon?.beacon.label : undefined}
				isAdjusting={isAdjusting}
				isStarting={beaconIsStarting}
				onStart={onStartBeacon}
				onClose={onCloseBeaconControl}
			/>
		)
	}

	// Sighting Editor mode (D-01/D-07) — create/edit a Sighting in place. The
	// create form opens with the map-first placed geometry as a prop.
	if (sightingEditorMode !== 'none' && onSaveSighting && onCloseSightingEditor) {
		return (
			<SightingEditorPanel
				initialSighting={editingSighting}
				placedGeometry={placedSightingGeometry}
				onDrawArea={onDrawSightingArea}
				onClose={onCloseSightingEditor}
				onSave={onSaveSighting}
			/>
		)
	}

	// Story Editor mode (D-03) — create/edit a Story in place.
	if (storyEditorMode !== 'none' && onSaveStory && onCloseStoryEditor) {
		return (
			<StoryEditorPanel
				initialStory={editingStory}
				onClose={onCloseStoryEditor}
				onSave={onSaveStory}
				availableFeatures={availableFeatures}
			/>
		)
	}

	// Context Editor mode
	if (contextEditorMode !== 'none' && onSaveContext && onCloseContextEditor) {
		return (
			<GroupEditorPanel
				initialContext={editingContext}
				onClose={onCloseContextEditor}
				onSave={onSaveContext}
				availableFeatures={availableFeatures}
			/>
		)
	}

	// View mode - delegate to ViewModePanel
	if (viewMode === 'view') {
		// Beacon view (Phase 12, BEACON-03/04, D-11) — opened beacon renders the
		// read surface (label + live/stale/ended status + last-seen + countdown +
		// Copy-share-link with the throwaway pubkey). Owner sees inline Stop/Adjust.
		// Expired beacons are gated inside the panel (T-12-05-FROZEN). XCUT-01 wired
		// the CommentsPanel mount (Plan 01) and XCUT-02/D-10 (Plan 02) threads the
		// comment deep link here so /beacon/:naddr/comment/:id focuses a comment,
		// reaching parity with Story/Sighting. Mounted before the Sighting/Story/
		// context branches.
		if (viewBeacon) {
			return (
				<BeaconViewPanel
					beacon={viewBeacon}
					currentUserPubkey={currentUserPubkey}
					onStopBeacon={onStopBeacon}
					onAdjustBeacon={onAdjustBeacon}
					onAddToMapStack={onAddBeaconToMapStack}
					onZoomTo={onZoomToBeacon ? () => onZoomToBeacon(viewBeacon) : undefined}
					isFollowing={isFollowingBeacon}
					onToggleFollow={onToggleFollowBeacon}
					availableFeatures={availableFeatures}
					onCommentGeometryVisibility={onCommentGeometryVisibility}
					onMentionVisibilityToggle={onMentionVisibilityToggle}
					onMentionZoomTo={onMentionZoomTo}
					onZoomToBounds={onZoomToBounds}
					focusCommentId={beaconFocusCommentId ?? focusCommentId}
				/>
			)
		}

		// Sighting view (D-07/SIGHT-04) — opened Sighting renders the read surface in
		// the right info panel (observation-time range + expiry countdown + comments /
		// react); the main map stays the canvas. Mounted before the Story/context/
		// dataset branches. Expired sightings are gated inside the panel (SIGHT-03).
		if (viewSighting) {
			return (
				<SightingViewPanel
					sighting={viewSighting}
					currentUserPubkey={currentUserPubkey}
					onEditSighting={onEditSighting}
					onDeleteSighting={onDeleteSighting}
					onAddToMapStack={onAddSightingToMapStack}
					onZoomTo={onZoomToSighting ? () => onZoomToSighting(viewSighting) : undefined}
					deletingKey={deletingKey}
					availableFeatures={availableFeatures}
					onCommentGeometryVisibility={onCommentGeometryVisibility}
					onMentionVisibilityToggle={onMentionVisibilityToggle}
					onMentionZoomTo={onMentionZoomTo}
					onZoomToBounds={onZoomToBounds}
					focusCommentId={sightingFocusCommentId ?? focusCommentId}
				/>
			)
		}

		// Story view (D-03) — opened Story renders in the right info panel; the main
		// map stays the canvas. Mounted before the context/dataset branches.
		if (viewStory) {
			return (
				<StoryViewPanel
					story={viewStory}
					currentUserPubkey={currentUserPubkey}
					onEditStory={onEditStory}
					onDeleteStory={onDeleteStory}
					onStoryUpdated={onStoryUpdated}
					onZoomTo={
						viewStory.boundingBox && onZoomToBounds
							? () => onZoomToBounds(viewStory.boundingBox as [number, number, number, number])
							: undefined
					}
					deletingKey={deletingKey}
					availableFeatures={availableFeatures}
					onCommentGeometryVisibility={onCommentGeometryVisibility}
					onMentionVisibilityToggle={onMentionVisibilityToggle}
					onMentionZoomTo={onMentionZoomTo}
					isMentionVisible={isMentionVisible}
					onZoomToBounds={onZoomToBounds}
					focusCommentId={focusCommentId}
				/>
			)
		}

		if (viewContext) {
			return (
				<GroupViewPanel
					currentUserPubkey={currentUserPubkey}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onInspectDataset={onInspectDataset ?? onLoadDataset}
					onZoomToDataset={onZoomToDataset}
					onZoomTo={
						viewContext.boundingBox && onZoomToBounds
							? () => onZoomToBounds(viewContext.boundingBox as [number, number, number, number])
							: undefined
					}
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
						<p className="text-sm font-medium text-foreground">
							{isEmptyGeometryInspect ? 'No geometry selected' : 'Nothing selected'}
						</p>
						<p className="text-xs text-muted-foreground">
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
			<LocalDraftPersistenceWarning currentUserPubkey={currentUserPubkey ?? null} />
			{/* Header — only rendered when it has content (a fresh draft has neither
			    the View button nor a dataset name, so we skip it to avoid an empty
			    separator above the stats row). */}
			{(activeDataset || activeDatasetInfo) && (
				<div className="flex items-center justify-between gap-2 border-b border-border pb-1">
					<div className="flex items-center gap-2">
						{activeDataset && (
							<Button
								size="sm"
								variant="ghost"
								onClick={handleSwitchToView}
								title="Switch to view mode"
								className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
							>
								<Eye className="mr-1 h-3 w-3" />
								View
							</Button>
						)}
					</div>
					{activeDatasetInfo && (
						<span className="max-w-[100px] truncate text-[10px] text-muted-foreground">
							{activeDatasetInfo.name} {activeDatasetInfo.isOwner ? '' : '(copy)'}
						</span>
					)}
				</div>
			)}

			{/* Stats row - inline (counts + passive measurement totals) */}
			<div className="flex items-center gap-3 text-[10px] text-muted-foreground">
				<span>{stats.points} pts</span>
				<span>{stats.lines} lines</span>
				<span>{stats.polygons} polys</span>
				{datasetMeasurements && datasetMeasurements.totalLengthKm > 0 && (
					<span>{formatLengthKm(datasetMeasurements.totalLengthKm)}</span>
				)}
				{datasetMeasurements && datasetMeasurements.totalAreaKm2 > 0 && (
					<span>{formatAreaKm2(datasetMeasurements.totalAreaKm2)}</span>
				)}
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
				/>
			)}

			{/* Dataset Metadata - collapsible */}
			<Collapsible defaultOpen>
				<CollapsibleTrigger className="text-xs font-medium text-foreground hover:text-foreground w-full text-left py-1">
					Dataset info
				</CollapsibleTrigger>
				<CollapsibleContent>
					<DatasetMetadataSection
						key={activeDataset?.id ?? 'new'}
						availableFeatures={availableFeatures}
					/>
				</CollapsibleContent>
			</Collapsible>

			{/* Contributor attach-to-a-Group lane (GROUP-02/04): picker + inline off-thread
			    advisory warnings + always-available "Publish anyway". The warnings NEVER
			    block a valid standalone publish. */}
			{onPublishNew && (
				<Collapsible defaultOpen={activeDatasetContextRefs.length > 0}>
					<CollapsibleTrigger className="text-xs font-medium text-foreground hover:text-foreground w-full text-left py-1">
						Attach to a Group
					</CollapsibleTrigger>
					<CollapsibleContent>
						<GroupAttachField
							contextRefs={activeDatasetContextRefs}
							onContextRefsChange={setActiveDatasetContextRefs}
							featureProperties={featurePropertiesForGroup}
							onPublish={onPublishNew}
							canPublish={canPublishNew}
							isPublishing={isPublishing}
						/>
					</CollapsibleContent>
				</Collapsible>
			)}

			{/* Blob References - collapsible */}
			<Collapsible defaultOpen={false}>
				<CollapsibleTrigger className="text-xs font-medium text-foreground hover:text-foreground w-full text-left py-1">
					External references
				</CollapsibleTrigger>
				<CollapsibleContent>
					<BlobReferencesSection />
				</CollapsibleContent>
			</Collapsible>

			{/* Geometries table */}
			<div className="flex flex-col min-h-0">
				<div className="text-xs font-medium text-foreground py-1">
					Geometries ({features.length})
				</div>
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
									className="gap-1.5 rounded-none border-border bg-card px-2 text-[11px] text-foreground hover:bg-muted"
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
					{publishMessage && <p className="text-ok">{publishMessage}</p>}
					{publishError && <p className="text-destructive">{publishError}</p>}
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
		<div className={cn('w-80 rounded-xl bg-card p-3 shadow-lg', className)}>
			<GeoEditorInfoPanelContent {...props} />
		</div>
	)
}
