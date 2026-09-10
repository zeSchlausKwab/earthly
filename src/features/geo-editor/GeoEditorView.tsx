import { useActiveAccount } from 'applesauce-react/hooks'
import { useCatalogRoutePriority, useCatalogStackPriority } from '@/lib/hooks/useCatalogRoutePriority'
import { castEvent } from 'applesauce-core/casts'
import {
	BookOpen,
	CircleHelp,
	CircleDot,
	Crosshair,
	Database,
	Eye,
	FilePenLine,
	Globe,
	Hexagon,
	Inbox,
	Map as MapIcon,
	MapPin,
	MapPinned,
	Maximize2,
	MessageSquare,
	MessageSquareOff,
	MessageSquarePlus,
	Minimize2,
	PanelTopOpen,
	Plus,
	Radio,
	Search,
	Scissors,
	UserRound,
	X,
} from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import type maplibregl from 'maplibre-gl'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type MouseEvent as ReactMouseEvent,
} from 'react'
import { toast } from 'sonner'
import { AppSidebar } from '@/components/AppSidebar'
import {
	EntitySearchPopover,
	type EntitySearchResult,
	type PlaceSearchEntity,
} from '@/components/entity-search'
import { ReferencePublishDialog } from '@/features/chat/referencePublishing'
import { StoryTargetDialog } from '@/features/chat/storyTargeting'
import { getStoryEditorTarget, subscribeStoryEditorOpenRequests } from './storyEditorBridge'
import { getStoryDraftRevision, subscribeStoryDrafts, listNewStoryDrafts } from '@/lib/nostr/story/draft'
import { config } from '@/config/env.client'
import { EARTHLY_ZAPSTORE_URL } from '@/config/app-downloads'
import type { LocalDraftDestinationOption } from '@/components/WorkspaceDraftNavigator'
import { ControlButton, ControlGroup } from '@/components/ui/map'
import { BlossomUploadDialog } from '@/components/BlossomUploadDialog'
import { DebugDialog } from '@/components/DebugDialog'
import { MapStackPanel } from '@/components/MapStackPanel'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { replaceEarthlySearch } from '@/router/navigation'
import { buildRoutePath, navigateToRoute } from './hooks/useRouting'
import { executeEditorCommand } from './commands'
import {
	DiscoverDialog,
	getDiscoverWelcomeStorage,
	hasSeenDiscoverWelcome,
	isRenderableDiscoveryDataset,
	markDiscoverWelcomeSeen,
	normalizeDiscoveryText,
	selectLatestEligibleDataset,
	selectRecentDiscoveryItems,
	shouldAutoOpenDiscover,
	shouldSeedLandingDataset,
	type DiscoveryItem,
	type DiscoveryItemKind,
} from '@/features/discovery'
import { useTourStore } from '@/features/tour'
import { WelcomeCard } from '../discovery/WelcomeCard.tsx'
import { StudioShell } from './components/StudioShell'
import {
	LensBar,
	ShelfStrip,
	TopBar,
	TopBarActionControl,
	type ActivityTickerItem,
	type ShelfReorderPlacement,
	type ShelfStripItem,
	type TopBarAction,
} from './components/margin-shell'
import { MeMenu } from './components/margin-shell/MeMenu'
import { MobileDrawingChrome } from './components/MobileDrawingChrome'
import { useAvailableGeoFeatures } from '@/lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useGeoDatasets, useMapContexts } from '@/lib/hooks/useGeoDatasets'
import { useGroups } from '@/lib/hooks/useGroups'
import { useStories } from '@/lib/hooks/useStories'
import { useSightings } from '@/lib/hooks/useSightings'
import { useBeacons } from '@/lib/hooks/useBeacons'
import { RunningBeaconBanner } from '@/components/RunningBeaconBanner'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import { formatExpiryCountdown } from '@/lib/nostr/temporal-sighting'
import { nip19, type NostrEvent } from 'nostr-tools'
import { getArticleMapPresentation, type Article } from '@/lib/nostr/article'
import { ARTICLE_KIND, LIVE_BEACON_KIND } from '@/lib/nostr/kinds'
import { isExpired } from '@/lib/nostr/expiry'
import { unixNow } from 'applesauce-core/helpers/time'
import { deleteStory } from '@/lib/nostr/story'
import { deleteSighting, type TemporalSighting } from '@/lib/nostr/temporal-sighting'
import { getGroupMapPresentation } from '@/lib/nostr/group'
import { buildSavedViewAtlasSeed } from '@/features/groups/creationSeed'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { type MapContext, deleteMapContext } from '@/lib/nostr/map-context'
import { accounts, eventStore } from '@/lib/nostr'
import {
	privateWorkspaceIdForDataset,
	projectPrivateWorkspaceDatasets,
} from '@/lib/private-workspace'
import { usePrivateWorkspaceRuntime } from '@/features/private-maps/usePrivateWorkspaceRuntime'
import { normalizePairingInvitation } from '@/features/offline/pairingQr'
import { useSavedRegionDeletionSync } from '@/features/offline/saved-regions/useSavedRegionDeletionSync'
import { useSavedRegionHydration } from '@/features/offline/saved-regions/useSavedRegionHydration'
import type { DeletionTarget } from '@/lib/nostr/deletionCache'
import { navigateToEarthlyAppLinkInPlace } from '@/platform/nativeAppLink'
import { earthlyPublicUrl } from '@/platform/publicUrl'
import { useFieldSessions } from '@/features/field-sessions/model'
import {
	fieldSessionDatasetFactory,
	fieldSessionIdForEvent,
	latestFieldSessionDatasetEvents,
} from '@/features/field-sessions/events'
import { useFieldSessionTransport } from '@/features/field-sessions/useFieldSessionTransport'
import {
	fieldDatasetStackEntryId,
	planFieldDatasetStackReconciliation,
} from '@/features/field-sessions/fieldDatasetStack'
import {
	consumePendingNativeDeepLink,
	getPendingNativeDeepLink,
	NATIVE_DEEP_LINK_EVENT,
	type NativeDeepLinkDetail,
} from '@/platform/registry'
import {
	planPrivateDatasetStackReconciliation,
	privateDatasetStackEntryId,
} from '@/features/private-maps/privateDatasetStack'
import {
	defaultContextFilterMode,
	getContextCoordinate,
	isDatasetAllowedByContextFilter,
	validateDatasetForContext,
} from '@/lib/context/validation'
import { getDefaultContextMapScopeMode, resolveContextMapScope } from '@/lib/context/scope'
import { createAuthoring } from './api'
import { AssistantSidebar } from './components/AssistantSidebar'
import { Editor } from './components/Editor'
import {
	encodeBeaconNaddrPure,
	encodeSightingNaddrPure,
	getBeaconMapStackKey,
	getSightingMapStackKey,
} from './mapStackEntityKeys'
import {
	consumeInAppInspectRoute,
	inspectRouteKey,
	markInAppInspectRoute,
} from './inspectRouteOrigin'
import { isDraftGeometryVisible } from './draftMapVisibility'
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MapFeatureHoverOverlay } from './components/MapFeatureHoverOverlay'
import { mobilePanelHeightPx, MobilePanel, type MobilePanelProps } from './components/MobilePanel'
import { MobileToolMenu } from './components/MobileToolMenu'
import { CommentAnnotationPopup } from './components/CommentAnnotationPopup'
import type { CommentAnnotationPopupData } from './components/CommentAnnotationPopup'
import type { MapPopupPlacement } from './components/map-popup-positioning'
import { UserLocationMarker } from './components/UserLocationMarker'
import { EntityPinBubbles } from './components/map/EntityPinBubbles'
import { MapCallouts } from './callouts/MapCallouts'
import {
	calloutDisplayModeActionLabel,
	nextCalloutDisplayMode,
	type CalloutDisplayMode,
} from './callouts/layout'
import { getFeatureCallouts, withFeatureCallouts, type MapCallout } from '@/lib/geo/callouts'
import { MobileMapActions } from './components/MobileMapActions'
import { SightingPlacementPreview } from './components/SightingPlacementPreview'
import { GeoEditorMap as MapComponent } from './components/map'
import { OsmResultsPanel } from './components/OsmResultsPanel'
import { StudioStatusBar } from './components/StudioStatusBar'
import { Toolbar } from './components/Toolbar'
import { PublishDropdown, type PublishAudienceOption } from './components/toolbar/PublishDropdown'
import {
	canUploadToPublicBlossom,
	publishChannelMatchesDatasetScope,
	resolveAuthoringDestination,
	resolveAuthoringPublishChannel,
} from './components/authoringDestination'
import type { EditorEvent, EditorFeature } from './core'
import {
	MAGNIFIER_SIZE,
	useBlobResolution,
	useContextEditor,
	useStoryEditor,
	useSightingEditor,
	useBeaconController,
	useStoryMapRefs,
	useCommentGeometry,
	useProposalGeometry,
	useDatasetManagement,
	useGeoQueryByView,
	useInspector,
	useMagnifier,
	useMapLayers,
	useMentionActions,
	useOsmQuery,
	usePublishing,
	useRouting,
	usePresentationSources,
	useViewMode,
} from './hooks'
import { usePresentationMapLayers } from './hooks/usePresentationMapLayers'
import { usePresentationCamera } from './hooks/usePresentationCamera'
import type { PresentationLayerMaterializationInput } from './map-presentation/materialize'
import { PresentationCanvas, presentationFitCollection } from '@/pages/read/PresentationCanvas'
import type { StoryViewDraftContext } from '@/components/editor/StoryViewDraftContext'
import {
	applyAmbientSourcesToLayers,
	authorizePresentationLayer,
	buildFallbackAtlasPresentation,
	buildFallbackStoryPresentation,
	deriveAtlasPresentationAuthorization,
	deriveStoryPresentationAuthorization,
	getPresentationDatasetSource,
	getUsableMapPresentation,
	MAP_PRESENTATION_VERSION,
	parseAmbientOn,
	resolveAmbientOn,
	type EffectiveStoryViewStateV1,
	type MapPresentationAuthorization,
	type MapPresentationLayerV1,
	type MapPresentationParseResult,
	type MapPresentationSource,
	type MapPresentationV1,
	type PresentationLayerResolution,
	type PresentationSourceAuthorization,
	type StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import { exportShapefile, importShapefile } from './shapefile'
import { getGeoJsonPasteCandidate } from './geoJsonPaste'
import {
	ensureActiveDraftMapPresentation,
	getRetainedDatasetSurfaceTarget,
	resolveActiveDraftMapPresentation,
	resolveDraftEditorOpenPlan,
	useEditorStore,
	type MapStackEntry,
	type PublishChannel,
	type SidebarViewMode,
} from './store'

function publishChannelOptionId(channel: PublishChannel): string | undefined {
	if (channel.kind === 'public') return 'public'
	if (channel.kind === 'private-group') return `private-group:${channel.id}`
	if (channel.kind === 'field-session') return `field-session:${channel.id}`
	return undefined
}
import { registerChatWorkspaceOpener, registerDatasetDraftEnsurer, type DatasetDraftRequest } from './authoringTaskBridge'
import { registerMapDraftActions, removeDraftEditingAccess } from './draftActions'
import type { MapStackEntryType } from './store/types'
import type { GeoSearchResult } from './types'
import { ensureFeatureCollection, extractCollectionMeta, toEditorFeature } from './utils'
import { isDrawingEditorMode } from './mobileDrawingGuidance'
import { isDatasetMapInteractionEnabled } from './mobileDatasetInteraction'
import { switchWorkspaceFromView } from './workspaceSwitchPresentation'
import type { DatasetEditOptions } from '@/components/info-panel/mapProposalPresentation'
import { deriveReferenceMapRenderState, featureMatchesReferenceSelector } from './referenceMapStack'
import {
	applyShelfRouteIntentToSearch,
	convertLegacyShelfSearch,
	createPublicShelfMap,
	deriveShelfRouteIntent,
	planShelfRouteReconciliation,
	resolveShelfRouteIntent,
	SHELF_ROUTE_ENTRY_PREFIX,
	type ShelfRouteIntent,
} from './shelfRouteState'
import {
	cancelCoordinateReferencePick,
	completeCoordinateReferencePick,
	getCoordinateReferencePickRequest,
	subscribeCoordinateReferencePickRequests,
} from './coordinateReferencePickerBridge'

/**
 * Phase 13 (SPEC §3.2): derive the stack-gated render set for an ephemeral entity
 * kind (sighting/beacon) from Map Stack membership, mirroring `visibleGeoEvents`.
 * Extracted to module scope as a PURE function so the aggregate/individual/
 * isolation/empty behaviors are unit-testable without a live React tree or hooks.
 *
 * Precedence (SPEC §3.2):
 *   1. ISOLATION — if ANY entry is isolated, only that entry renders. If it is this
 *      selector's individual type, return the single matching entity; if it is any
 *      OTHER isolated type (dataset/context/the other kind), return [] (aggregate
 *      layers + this kind are suppressed under isolation).
 *   2. AGGREGATE — a visible `<kind>-layer` entry seeds the result with the full
 *      subscription set (today's always-on behavior, now gated).
 *   3. INDIVIDUAL UNION — union in each visible individual `<kind>` entry resolved
 *      from the subscription by key, de-duped by key (D-04: the buildSource
 *      freshest-per-{pubkey,d} de-dup collapses any residual overlap).
 *
 * `resolveKey(entity)` maps an entity to the stack `entityKey` it is pinned under
 * (naddr or dTag fallback). Expiry is NOT applied here — `buildSightingSource`/
 * `buildBeaconSource` keep their internal `dropExpired`, so this only chooses WHICH
 * entities are candidates (T-13-03-DROPEXPIRED).
 *
 * `individualLookupSet` (optional) is the set used to resolve individual/isolated
 * entries. It defaults to `subscriptionSet`. Beacons pass a SUPERSET here (discovery
 * ∪ routed/viewed/own) so a link-only or deep-linked beacon — which is absent from
 * the `#t:['live']` discovery `subscriptionSet` — still resolves when pinned/isolated
 * on the stack, WITHOUT leaking into the aggregate layer (T-13-03-GPSREGRESS: the
 * aggregate branch only ever seeds from `subscriptionSet`, i.e. discovery).
 */
export function deriveVisibleEntitiesFromStack<T>(
	subscriptionSet: T[],
	entries: Record<string, MapStackEntry>,
	order: string[],
	individualType: MapStackEntryType,
	layerType: MapStackEntryType,
	resolveKey: (entity: T) => string | undefined,
	individualLookupSet: T[] = subscriptionSet,
): T[] {
	// Build the individual-resolution index once (discovery ∪ routed/viewed/own for
	// beacons; just the subscription for sightings).
	const indByKey = new Map<string, T>()
	for (const entity of individualLookupSet) {
		const key = resolveKey(entity)
		if (key !== undefined && !indByKey.has(key)) indByKey.set(key, entity)
	}

	// (1) ISOLATION BRANCH — mirrors visibleGeoEvents L990-1004. First isolated
	// entry in stack order wins; nothing else renders. An isolated individual is
	// resolved against the broader lookup set so a deep-linked link-only beacon
	// (absent from discovery) still renders solo.
	for (const entryId of order) {
		const entry = entries[entryId]
		if (!entry?.isolated) continue
		if (entry.entityType === individualType) {
			const match = indByKey.get(entry.entityKey)
			return match ? [match] : []
		}
		// Any other isolated type (dataset/context/the other kind) suppresses this
		// kind entirely (SPEC §3.2 — aggregate layers off under isolation).
		return []
	}

	// (2) AGGREGATE + (3) INDIVIDUAL UNION — walk visible entries in stack order,
	// seeding the aggregate ONLY from discovery (subscriptionSet), unioning in
	// individual pins resolved from the broader lookup set, de-duped by key.
	const byKey = new Map<string, T>()
	for (const entryId of order) {
		const entry = entries[entryId]
		if (!entry || entry.visible === false) continue
		if (entry.entityType === layerType) {
			for (const entity of subscriptionSet) {
				const key = resolveKey(entity)
				if (key !== undefined && !byKey.has(key)) byKey.set(key, entity)
			}
		} else if (entry.entityType === individualType) {
			const match = indByKey.get(entry.entityKey)
			if (match && !byKey.has(entry.entityKey)) byKey.set(entry.entityKey, match)
		}
	}
	return Array.from(byKey.values())
}

/**
 * Plan 13-06 (UAT test 5b): pure sweep decision for an individual sighting/beacon
 * stack entry, extracted from the expiry-sweep effect so it is unit-testable.
 *
 * An entry is evicted when EITHER it cannot be resolved to any real entity (nothing
 * to render — absent even from the widened added-entity cache), OR the resolved
 * entity is genuinely NIP-40 `expired` (D-02 honesty — a truly-ended beacon/sighting
 * never lingers as a stale marker). A user-added out-of-discovery entry that resolved
 * via the added-entity cache and is NOT expired is KEPT — it stays pinned even though
 * it faded from live-discovery. STALE (beaconState 120s) is NOT expiry and, because
 * this predicate is driven ONLY by `expired`, cannot cause a sweep.
 */
export function shouldSweepStackEntry(status: { resolved: boolean; expired: boolean }): boolean {
	return !status.resolved || status.expired
}

const NO_SAVED_REGION_EVENTS: readonly NostrEvent[] = []

function discoverySummary(...candidates: unknown[]): string | undefined {
	for (const candidate of candidates) {
		const summary = normalizeDiscoveryText(candidate, 280)
		if (summary) return summary
	}
	return undefined
}

function discoveryDate(createdAt: number): string | undefined {
	if (!Number.isFinite(createdAt)) return undefined
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(createdAt * 1000)
	} catch {
		return undefined
	}
}

function naddrTargetsSameEntity(left: string, right: string): boolean {
	if (left === right) return true
	try {
		const decodedLeft = nip19.decode(left)
		const decodedRight = nip19.decode(right)
		if (decodedLeft.type !== 'naddr' || decodedRight.type !== 'naddr') return false
		return (
			decodedLeft.data.kind === decodedRight.data.kind &&
			decodedLeft.data.pubkey === decodedRight.data.pubkey &&
			decodedLeft.data.identifier === decodedRight.data.identifier
		)
	} catch {
		return false
	}
}

const ABSENT_MAP_PRESENTATION: MapPresentationParseResult = Object.freeze({
	status: 'absent',
	issues: [] as const,
})

function storyPresentationCarrier(story: Article): string {
	return `${story.kind}:${story.pubkey}:${story.dTag ?? story.id}`
}

function presentationMaterializationInputs(
	carrierId: string,
	presentationAuthor: string | undefined,
	layers: readonly PresentationLayerResolution[],
	attributedLayerIds?: ReadonlySet<string>,
): readonly PresentationLayerMaterializationInput[] {
	return Object.freeze(
		layers.map((resolution) => {
			const ownsPresentation =
				presentationAuthor &&
				(attributedLayerIds === undefined || attributedLayerIds.has(resolution.layer.id))
			return {
				carrierId,
				layer: resolution.layer,
				featureCollection: resolution.featureCollection,
				...(resolution.sourceEvent ? { sourceEvent: resolution.sourceEvent } : {}),
				...(ownsPresentation ? { presentationAuthor } : {}),
			}
		}),
	)
}

function presentationInputsForStorySnapshot(
	carrierId: string,
	presentationAuthor: string | undefined,
	state: EffectiveStoryViewStateV1,
	resolved: readonly PresentationLayerResolution[],
): readonly PresentationLayerMaterializationInput[] {
	const resolvedByLayer = new Map<string, PresentationLayerResolution>()
	for (const entry of resolved) {
		resolvedByLayer.set(entry.layer.id, entry)
	}
	return Object.freeze(
		state.layers.map((layer) => {
			const entry = resolvedByLayer.get(layer.id)
			const source = entry?.layer.source === layer.source ? entry : undefined
			return {
				carrierId,
				layer,
				featureCollection: source?.featureCollection ?? {
					type: 'FeatureCollection',
					features: [],
				},
				...(source?.sourceEvent ? { sourceEvent: source.sourceEvent } : {}),
				presentationAuthor,
			}
		}),
	)
}

function StoryPresentationFigure({
	carrierId,
	presentationAuthor,
	snapshot,
	resolved,
}: {
	carrierId: string
	presentationAuthor?: string
	snapshot: StoryViewSnapshotV1
	resolved: readonly PresentationLayerResolution[]
}) {
	const figureMapRef = useRef<maplibregl.Map | null>(null)
	const layers = useMemo(
		() =>
			presentationInputsForStorySnapshot(
				`${carrierId}:figure:${snapshot.view.id}`,
				presentationAuthor,
				snapshot.state,
				resolved,
			),
		[carrierId, resolved, snapshot.state, snapshot.view.id, presentationAuthor],
	)
	return (
		<PresentationCanvas
			carrierId={`${carrierId}:figure:${snapshot.view.id}`}
			mapRef={figureMapRef}
			layers={layers}
			camera={snapshot.state.camera}
			cameraIntentId={`figure:${JSON.stringify(snapshot.state)}`}
			compact
			interactive={false}
			className="h-64 min-h-64 w-full border border-border"
		/>
	)
}

/** An unsaved Story has a local draft identity, not a fabricated signed Article. */
function DraftStoryPresentationFigure({
	carrierId,
	presentationAuthor,
	snapshot,
	context,
}: {
	carrierId: string
	presentationAuthor?: string
	snapshot: StoryViewSnapshotV1
	context: StoryViewDraftContext
}) {
	const authorization = useMemo(
		() => deriveStoryPresentationAuthorization(context.body),
		[context.body],
	)
	const presentation = useMemo<MapPresentationParseResult>(
		() => ({
			status: 'valid',
			value: {
				version: 1,
				layers: snapshot.state.layers,
				...(snapshot.state.camera ? { initialView: snapshot.state.camera } : {}),
			},
			issues: [],
		}),
		[snapshot.state],
	)
	const runtime = usePresentationSources({ presentation, authorization })
	return (
		<StoryPresentationFigure
			carrierId={carrierId}
			presentationAuthor={presentationAuthor}
			snapshot={snapshot}
			resolved={runtime.layers}
		/>
	)
}

function SavedRegionDeletionMonitor({
	regionId,
	targets,
}: {
	regionId: string
	targets: readonly DeletionTarget[]
}) {
	const sync = useSavedRegionDeletionSync(NO_SAVED_REGION_EVENTS, targets.length > 0, targets)
	useEffect(() => {
		if (!sync.error) return
		toast.warning('Saved-area deletion monitoring is paused', {
			id: `saved-region-deletion-sync-${regionId}`,
			description: sync.error,
		})
	}, [regionId, sync.error])
	return null
}

export function GeoEditorView() {
	const savedRegionHydration = useSavedRegionHydration()
	useEffect(() => {
		if (savedRegionHydration.state === 'ready' && savedRegionHydration.missing > 0) {
			toast.warning('Some saved Earthly content is incomplete', {
				id: 'saved-region-content-incomplete',
				description: `${savedRegionHydration.missing} signed ${savedRegionHydration.missing === 1 ? 'record is' : 'records are'} missing or damaged. The saved map remains available; replace the affected saved area while online to restore its content.`,
			})
		} else if (
			savedRegionHydration.state === 'ready' &&
			savedRegionHydration.deferredRegionIds.length > 0
		) {
			toast.info('Some saved Earthly content was left unloaded', {
				id: 'saved-region-content-deferred',
				description: `${savedRegionHydration.deferredRegionIds.length} saved ${savedRegionHydration.deferredRegionIds.length === 1 ? 'area exceeded' : 'areas exceeded'} the safe startup memory budget. Their map files remain available offline.`,
			})
		} else if (savedRegionHydration.state === 'failed') {
			toast.error('Saved Earthly content could not be restored', {
				id: 'saved-region-content-hydration-failed',
				description: savedRegionHydration.message,
			})
		}
	}, [savedRegionHydration])
	const map = useRef<maplibregl.Map | null>(null)
	const [mounted, setMounted] = useState(false)
	const [loadedMap, setLoadedMap] = useState<maplibregl.Map | null>(null)
	const [discoverOpen, setDiscoverOpen] = useState(false)
	const [inboxUnreadCount, setInboxUnreadCount] = useState(0)
	const discoverAutoOpenedRef = useRef(false)
	const discoverOpenedAutomaticallyRef = useRef(false)
	const landingDatasetSeededRef = useRef(false)
	const landingDatasetFitPendingRef = useRef<GeoDataset | null>(null)
	const startTour = useTourStore((state) => state.startTour)
	const {
		route,
		navigateTo,
		navigateToContext,
		navigateToView,
		navigateToTab,
		navigateToUnscopedView,
		navigateHome,
		navigateToPrivateGroup,
		navigateToFieldSession,
		clearFocus,
		clearContextScope,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		isFocused,
		contextNaddr,
		contextCoordinate,
		userPubkey,
		privateGroupId,
		fieldSessionId,
		commentId: focusCommentId,
	} = useRouting({ reconcileStore: true })
	useCatalogRoutePriority(route.naddr, contextNaddr, userPubkey)
	const routedAskOpen = route.sidebarView === 'chat'
	const routedObjectThreadOpen = route.tab === 'thread' && route.focusType !== 'none'
	// Select a primitive here. getRetainedDatasetSurfaceTarget intentionally
	// assembles a fresh { workspace, draft } pair, which is useful for imperative
	// reads but is not a stable useSyncExternalStore snapshot.
	const draftThreadWorkspaceId = useEditorStore(
		(state) => getRetainedDatasetSurfaceTarget(state)?.workspace.id ?? null,
	)
	const routedDraftThreadOpen =
		route.tab === 'thread' &&
		route.focusType === 'none' &&
		route.sidebarView === 'edit' &&
		draftThreadWorkspaceId !== null
	// Thread visibility is independent of the editor currently in the margin.
	// New Story drafts have no published object address yet.
	const routedThreadOpen = route.tab === 'thread'
	const {
		account: privateWorkspaceAccount,
		runtime: privateWorkspaceRuntime,
		snapshot: privateWorkspaceSnapshot,
	} = usePrivateWorkspaceRuntime()

	// Query-by-view (Map Stack header toggle): viewport relay geo queries on
	// pan/zoom feeding the stack's "Geo query" section. Reads its own enabled
	// flag from the store; inert until toggled on.
	useGeoQueryByView(map, mounted)
	const [mapError, _setMapError] = useState<string | null>(null)
	const [deletingKey, setDeletingKey] = useState<string | null>(null)
	const [resolvedCollectionsVersion, setResolvedCollectionsVersion] = useState(0)
	const [mapPopupsEnabled, setMapPopupsEnabled] = useState(true)
	const [calloutDisplayMode, setCalloutDisplayMode] = useState<CalloutDisplayMode>('full')
	const cycleCalloutDisplayMode = useCallback(() => {
		setCalloutDisplayMode(nextCalloutDisplayMode)
	}, [])
	const [mapPopupPlacement, setMapPopupPlacement] = useState<MapPopupPlacement>('dock')
	const [coordinatePickRequestId, setCoordinatePickRequestId] = useState<number | null>(
		() => getCoordinateReferencePickRequest()?.id ?? null,
	)
	useEffect(
		() =>
			subscribeCoordinateReferencePickRequests(() => {
				setCoordinatePickRequestId(getCoordinateReferencePickRequest()?.id ?? null)
			}),
		[],
	)

	// Escape or the banner button cancels without changing the article.
	useEffect(() => {
		if (coordinatePickRequestId === null) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') cancelCoordinateReferencePick()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [coordinatePickRequestId])

	const handleCoordinateReferenceMapClick = useCallback(
		(event: ReactMouseEvent<HTMLButtonElement>) => {
			if (!loadedMap || !getCoordinateReferencePickRequest()) return
			const lngLat =
				event.detail === 0
					? loadedMap.getCenter()
					: (() => {
							const canvasBounds = loadedMap.getCanvas().getBoundingClientRect()
							return loadedMap.unproject([
								event.clientX - canvasBounds.left,
								event.clientY - canvasBounds.top,
							])
						})()
			completeCoordinateReferencePick({ longitude: lngLat.lng, latitude: lngLat.lat })
		},
		[loadedMap],
	)
	// Sighting placement owns its tap behavior separately from Map drawing.
	const sightingPlacementArmedRef = useRef(false)
	// The route is the sole owner of Ask and object Thread visibility. Clear a
	// persisted pre-cutover flag once so an old profile cannot resurrect the
	// retired unbound chat panel.
	const setChatOpen = useEditorStore((state) => state.setChatOpen)
	const compactThreadLayout = useIsMobile(1100)
	useEffect(() => {
		setChatOpen(false)
	}, [setChatOpen])
	const handleToggleThread = useCallback(() => {
		// The public route owns the semantic distinction between an object's Thread
		// and the read-only Ask concierge. Retire any legacy unbound-panel state as
		// soon as the retained toolbar is used.
		setChatOpen(false)
		// The toolbar button explicitly opens/moves to the right. Moving an open
		// left Thread must not toggle its route closed or recreate its session.
		if (!compactThreadLayout) {
			const state = useEditorStore.getState()
			if (routedThreadOpen && state.chatDock === 'left') {
				state.setChatDock('right')
				return
			}
			if (!routedThreadOpen) state.setChatDock('right')
		}
		if (route.focusType !== 'none') {
			navigateToTab(route.tab === 'thread' ? 'details' : 'thread')
			return
		}
		if (draftThreadWorkspaceId) {
			navigateToRoute(route.tab === 'thread' ? '/edit' : '/edit?tab=thread')
			return
		}
		navigateToView(routedAskOpen ? 'datasets' : 'chat')
	}, [
		compactThreadLayout,
		routedThreadOpen,
		draftThreadWorkspaceId,
		navigateToTab,
		navigateToView,
		route.focusType,
		route.tab,
		routedAskOpen,
		setChatOpen,
	])

	const [, setShowToolbar] = useState(true)
	const mapContainerRef = useRef<HTMLDivElement>(null)

	// Extracted hooks
	const {
		magnifierEnabled,
		magnifierVisible,
		magnifierPosition,
		magnifierCenter,
		magnifierZoomOffset,
		toggleMagnifier,
	} = useMagnifier(map)

	const {
		reverseLookupResult,
		setReverseLookupResult,
		reverseLookupStatus,
		reverseLookupError,
		setReverseLookupError,
		inspectorClickPosition,
		setInspectorClickPosition,
		disableInspector,
	} = useInspector(map)

	const {
		handleCommentGeometryVisibility,
		annotationPopupData,
		setAnnotationPopupData,
		pruneCommentGeometry,
	} = useCommentGeometry(map, mounted)
	const { visibleProposalIds, handleToggleProposalOverlay } = useProposalGeometry(map)
	const [displayedAnnotationPopupData, setDisplayedAnnotationPopupData] =
		useState<CommentAnnotationPopupData | null>(null)
	const annotationPopupHoverRef = useRef(false)
	const annotationPopupHideTimeoutRef = useRef<number | null>(null)

	// Zoom helpers (no deps, defined early so hooks can reference them)
	const handleZoomToBounds = useCallback((bounds: [number, number, number, number]) => {
		if (!map.current) return
		const [west, south, east, north] = bounds
		// A zero-area bbox (a single point — e.g. a point Sighting or a one-vertex
		// comment annotation) makes fitBounds zoom to its max; fly to the point at a
		// readable zoom instead.
		if (west === east && south === north) {
			map.current.flyTo({ center: [west, south], zoom: 15, duration: 500 })
			return
		}
		map.current.fitBounds(
			[
				[west, south],
				[east, north],
			],
			{ padding: 50, duration: 500 },
		)
	}, [])

	// Import OSM dialog state
	const [importOsmDialogOpen, setImportOsmDialogOpen] = useState(false)

	// User location tracking state
	const [userLocation, setUserLocation] = useState<{
		lat: number
		lon: number
		accuracy?: number
	} | null>(null)
	const isFirstLocationUpdate = useRef(true)

	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const featuresRef = useRef<EditorFeature[]>([])
	const stats = useEditorStore((state) => state.stats)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const [calloutAuthoringFeatureId, setCalloutAuthoringFeatureId] = useState<string | null>(null)
	const [calloutAnchorDrawing, setCalloutAnchorDrawing] = useState(false)
	const calloutAnchorExistingFeatureIdsRef = useRef<Set<string>>(new Set())
	const calloutsEnabled = useEditorStore((state) => state.calloutsEnabled)
	const setCalloutsEnabled = useEditorStore((state) => state.setCalloutsEnabled)
	const selectionCount = selectedFeatureIds.length
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setSettingsTab = useEditorStore((state) => state.setSettingsTab)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const contextMapScopeMode = useEditorStore((state) => state.contextMapScopeMode)
	const setContextMapScopeMode = useEditorStore((state) => state.setContextMapScopeMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const setActiveDataset = useEditorStore((state) => state.setActiveDataset)
	const setIsDirty = useEditorStore((state) => state.setIsDirty)
	const activeDatasetContextRefs = useEditorStore((state) => state.activeDatasetContextRefs)
	const setActiveDatasetContextRefs = useEditorStore((state) => state.setActiveDatasetContextRefs)
	const activeDraftPublishChannel = useEditorStore((state) => {
		const activeDraftId = state.activeGeoEditDraftId
		return activeDraftId ? (state.geoEditDrafts[activeDraftId]?.publishChannel ?? null) : null
	})
	const activeMapDraft = useEditorStore((state) =>
		state.activeGeoEditDraftId ? state.geoEditDrafts[state.activeGeoEditDraftId] : undefined,
	)
	const pendingHydratedDraftId = useEditorStore((state) => state.pendingHydratedDraftId)
	const activeWorkspaceDatasetKey = useEditorStore((state) => {
		const workspace = state.activeWorkspaceId ? state.workspaces[state.activeWorkspaceId] : null
		return workspace?.datasetKey ?? null
	})
	const stance = useEditorStore((state) => state.stance)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	const mapStackOrder = useEditorStore((state) => state.mapStackOrder)
	useCatalogStackPriority(mapStackEntries, mapStackOrder)
	const retainedMapDraftCount = useEditorStore((state) => Object.keys(state.geoEditDrafts).length)
	useSyncExternalStore(subscribeStoryDrafts, getStoryDraftRevision, () => 0)
	const activeDraftAuthoring = useEditorStore(
		(state) => resolveActiveDraftMapPresentation(state) !== null,
	)
	const draftGeometryVisible = useMemo(
		() =>
			isDraftGeometryVisible(mapStackEntries, mapStackOrder, {
				activeAuthoring: activeDraftAuthoring,
			}),
		[activeDraftAuthoring, mapStackEntries, mapStackOrder],
	)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const setMapStackEntryVisible = useEditorStore((state) => state.setMapStackEntryVisible)
	const setMapStackEntryIsolated = useEditorStore((state) => state.setMapStackEntryIsolated)
	const removeMapStackEntry = useEditorStore((state) => state.removeMapStackEntry)
	const setMapStackOrder = useEditorStore((state) => state.setMapStackOrder)
	const clearMapStack = useEditorStore((state) => state.clearMapStack)
	const dismissedPrivateDatasetIdsByAccountRef = useRef(new Map<string, Set<string>>())
	const dismissedPrivateDatasetIds = useCallback(() => {
		const accountKey = privateWorkspaceAccount?.pubkey ?? 'signed-out'
		let ids = dismissedPrivateDatasetIdsByAccountRef.current.get(accountKey)
		if (!ids) {
			ids = new Set<string>()
			dismissedPrivateDatasetIdsByAccountRef.current.set(accountKey, ids)
		}
		return ids
	}, [privateWorkspaceAccount?.pubkey])
	const dismissedFieldDatasetIdsRef = useRef(new Set<string>())
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const hydrateEditorSessionForPubkey = useEditorStore(
		(state) => state.hydrateEditorSessionForPubkey,
	)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setShowTips = useEditorStore((state) => state.setShowTips)
	// Unified mobile panel state
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const mobileEntitySurface = useEditorStore((state) => state.mobileEntitySurface)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelSnap = useEditorStore((state) => state.setMobilePanelSnap)
	const mobileSidebarOpen = useEditorStore((state) => state.mobileSidebarOpen)
	const selectMobileSidebarDestination = useEditorStore(
		(state) => state.selectMobileSidebarDestination,
	)
	const closeMobileSidebar = useEditorStore((state) => state.closeMobileSidebar)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const setMobileSearchOpen = useEditorStore((state) => state.setMobileSearchOpen)
	// Mobile Tools/Search/Actions toggles are no longer used — the responsive
	// toolbar replaces them. Store fields stay for backward compat.
	const panLocked = useEditorStore((state) => state.panLocked)
	const setPanLocked = useEditorStore((state) => state.setPanLocked)
	const currentMode = useEditorStore((state) => state.mode)
	const geometryOperation = useEditorStore((state) => state.geometryOperation)
	const isDrawingMode = isDrawingEditorMode(currentMode)
	const mapSource = useEditorStore((state) => state.mapSource)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const mapSourceKey = useMemo(() => {
		const file = mapSource.file
		return [
			mapSource.type,
			mapSource.location,
			mapSource.url ?? '',
			mapSource.blossomServer ?? '',
			file ? `${file.name}:${file.size}:${file.lastModified}` : '',
		].join('|')
	}, [mapSource.type, mapSource.location, mapSource.url, mapSource.blossomServer, mapSource.file])

	// External data
	const { events: geoEvents, eose: geoEventsSettled } = useGeoDatasets()
	const fieldSessions = useFieldSessions()
	const localDraftDestinationOptions = useMemo<LocalDraftDestinationOption[]>(
		() => [
			{
				id: 'public',
				label: 'Everyone',
				publishChannel: { kind: 'public' },
			},
			...privateWorkspaceSnapshot.workspaces
				.filter((workspace) => workspace.status === 'active')
				.map((workspace) => ({
					id: `private-group:${workspace.workspaceId}`,
					label: `Circle: ${workspace.metadata?.name || workspace.workspaceId.slice(0, 8)}`,
					publishChannel: {
						kind: 'private-group' as const,
						id: workspace.workspaceId,
					},
				})),
			...fieldSessions
				.filter((session) => session.state === 'active')
				.map((session) => ({
					id: `field-session:${session.id}`,
					label: `Nearby: ${session.name}`,
					publishChannel: { kind: 'field-session' as const, id: session.id },
				})),
		],
		[privateWorkspaceSnapshot.workspaces, fieldSessions],
	)
	const routePublishChannel = useMemo<PublishChannel>(
		() =>
			privateGroupId
				? { kind: 'private-group', id: privateGroupId }
				: fieldSessionId
					? { kind: 'field-session', id: fieldSessionId }
					: { kind: 'public' },
		[privateGroupId, fieldSessionId],
	)
	// Once a local draft exists, its persisted channel is authoritative. The URL
	// only suggests a channel for a draft that has not been created yet.
	const authoringPublishChannel = resolveAuthoringPublishChannel(
		activeDraftPublishChannel,
		routePublishChannel,
	)
	const authoringPrivateGroupId =
		authoringPublishChannel.kind === 'private-group' ? authoringPublishChannel.id : undefined
	const authoringFieldSessionId =
		authoringPublishChannel.kind === 'field-session' ? authoringPublishChannel.id : undefined
	const draftChannelOwnsMapScope = stance === 'author' && Boolean(activeDraftPublishChannel)
	const privateWorkspaceScopeId = draftChannelOwnsMapScope
		? authoringPrivateGroupId
		: privateGroupId
	const fieldSessionScopeId = draftChannelOwnsMapScope ? authoringFieldSessionId : fieldSessionId
	const fieldSession = useMemo(
		() => fieldSessions.find((session) => session.id === fieldSessionScopeId),
		[fieldSessionScopeId, fieldSessions],
	)
	const authoringFieldSession = useMemo(
		() => fieldSessions.find((session) => session.id === authoringFieldSessionId),
		[authoringFieldSessionId, fieldSessions],
	)
	const authoringFieldSessionWritable = Boolean(
		authoringFieldSession &&
			(authoringFieldSession.role !== 'participant' || authoringFieldSession.allowPeerWrites),
	)
	const datasetPublishMode =
		authoringPublishChannel.kind === 'private-group'
			? 'private'
			: authoringPublishChannel.kind === 'field-session'
				? 'field'
				: authoringPublishChannel.kind === 'unresolved'
					? 'private'
					: 'public'
	const fieldTransport = useFieldSessionTransport(fieldSession)
	const fieldGeoEvents = useMemo(
		() =>
			fieldSessionScopeId
				? latestFieldSessionDatasetEvents(fieldTransport.events, fieldSessionScopeId).map((event) =>
						castEvent(event, GeoDataset, eventStore),
					)
				: [],
		[fieldSessionScopeId, fieldTransport.events],
	)
	const privateWorkspace = useMemo(
		() =>
			privateWorkspaceScopeId
				? privateWorkspaceSnapshot.workspaces.find(
						(workspace) => workspace.workspaceId === privateWorkspaceScopeId,
					)
				: undefined,
		[privateWorkspaceScopeId, privateWorkspaceSnapshot.workspaces],
	)
	const authoringPrivateWorkspace = useMemo(
		() =>
			authoringPrivateGroupId
				? privateWorkspaceSnapshot.workspaces.find(
						(workspace) => workspace.workspaceId === authoringPrivateGroupId,
					)
				: undefined,
		[authoringPrivateGroupId, privateWorkspaceSnapshot.workspaces],
	)
	const privateWorkspaceId = privateWorkspace?.workspaceId
	const privateGeoEvents = useMemo(
		() => (privateWorkspace ? projectPrivateWorkspaceDatasets(privateWorkspace) : []),
		[privateWorkspace],
	)
	const mapGeoEvents = useMemo(
		() => [...geoEvents, ...privateGeoEvents, ...fieldGeoEvents],
		[geoEvents, privateGeoEvents, fieldGeoEvents],
	)
	useEffect(() => {
		if (!privateWorkspaceRuntime || !privateWorkspaceScopeId || !privateWorkspaceId) return
		return privateWorkspaceRuntime.watchWorkspace(privateWorkspaceScopeId)
	}, [privateWorkspaceRuntime, privateWorkspaceScopeId, privateWorkspaceId])
	const { events: mapContextEvents, eose: mapContextsSettled } = useMapContexts()
	// Groups (kind 37518, slimmed) the contributor can `c`-attach to (GROUP-02).
	const { events: groups } = useGroups()
	// Stories (kind 37520) — used to resolve a /stories/story/:naddr deep link to the
	// Article cast so the focus-route effect can open it (Phase 10, D-04).
	const { events: stories, eose: storiesSettled } = useStories()
	// Temporal Sightings (kind 37522) — rendered as observation-state markers on the
	// browse map (D-05/D-06) and listed in the Sightings rail (D-07). useSightings
	// already drops expired at the subscription (SIGHT-03 / Pitfall P-1).
	const { events: sightings } = useSightings()
	// Keep the live sighting list in a ref so the map-marker click handler
	// (useMapInteractions) can resolve a clicked dot back to its cast without
	// re-binding the handler on every subscription tick.
	const sightingsRef = useRef<TemporalSighting[]>([])
	useEffect(() => {
		sightingsRef.current = sightings
	}, [sightings])

	// Live Beacons (kind 37521) — rendered as live/stale/ended markers on the browse
	// map and listed in the Beacons rail (Phase 12, D-12). useBeacons drops expired
	// at the subscription on a 15s tick (BEACON-03 / Pitfall P-1) and filters the
	// `#t:['live']` discovery surface (link-only beacons never match — P-6).
	const { events: beacons } = useBeacons()
	const beaconsRef = useRef<LiveBeacon[]>([])
	useEffect(() => {
		beaconsRef.current = beacons
	}, [beacons])
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)
	// "Zoom to on map" for a Sighting: fly the camera to its geometry and focus it.
	// Sightings always render (D-05), so this centers + highlights rather than
	// toggling map-stack membership the way datasets do.
	const handleZoomToSighting = useCallback(
		(sighting: TemporalSighting) => {
			// Derive the zoom target from the precise content geometry — the SAME
			// source the marker uses (pointOnFeature(content.geometry)) — so the camera
			// lands ON the dot. Fall back to the bbox tag only when geometry is absent.
			const geometry = sighting.sighting.geometry
			const bbox = (geometry ? bboxFromGeometry(geometry) : null) ?? sighting.boundingBox
			if (!bbox) return
			handleZoomToBounds(bbox)
			setFocusedMapGeometry({ bbox })
		},
		[handleZoomToBounds, setFocusedMapGeometry],
	)
	// "Watch on map" for a beacon: fly the camera to its geometry and focus it
	// (mirrors handleZoomToSighting).
	const handleZoomToBeacon = useCallback(
		(beacon: LiveBeacon) => {
			const geometry = beacon.geometry
			const bbox = (geometry ? bboxFromGeometry(geometry) : null) ?? beacon.boundingBox
			if (!bbox) return
			handleZoomToBounds(bbox)
			setFocusedMapGeometry({ bbox })
		},
		[handleZoomToBounds, setFocusedMapGeometry],
	)
	// Round C.2 reliability: also fire a targeted subscription for every
	// context entry on the stack. The global subscription above is best-effort
	// — if a read relay was slow or 502 at open time, foreign attachments
	// (datasets with `["c", "37518:…:dTag"]` pointing at the context) might
	// never have streamed in. This explicit `#c` filter guarantees they're
	// fetched whenever a context lands on the stack, and applesauce's shared
	// EventStore deduplicates them straight into the same `geoEvents` array.
	const stackedContextCoordinates = useMemo(() => {
		const coords: string[] = []
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (entry?.entityType === 'context') coords.push(entry.entityKey)
		}
		return coords
	}, [mapStackEntries, mapStackOrder])
	useGeoDatasets(
		stackedContextCoordinates.length > 0 ? [{ '#c': stackedContextCoordinates }] : null,
	)
	const currentUser = useActiveAccount()
	const currentUserPubkey = currentUser?.pubkey ?? null
	const retainedDraftCount = retainedMapDraftCount + listNewStoryDrafts(currentUserPubkey).length
	const isMobile = useIsMobile()
	const mapPopupToolbarOffset = 112

	useEffect(() => {
		if (!isMobile || !isDrawingMode || sightingPlacementArmedRef.current) return
		// Tap places a vertex; dragging still pans. Pan lock remains an optional
		// precision tool in More, not a prerequisite for drawing on a phone.
		editor?.setTouchTapDrawEnabled(true)
		return () => {
			editor?.setTouchTapDrawEnabled(false)
		}
	}, [editor, isDrawingMode, isMobile])

	// Native URLs are navigation, not alternate trust paths. Custom pairing URLs
	// reveal the existing approval UI. A verified public Earthly URL is reduced to
	// its path/query and applied inside the existing Tauri WebView. Keeping the
	// WebView alive prevents Android's retained cold-launch URL from winning a
	// reload race after a newer warm App Link arrives.
	useEffect(() => {
		const openNativeUrl = (url: string) => {
			if (normalizePairingInvitation(url)) {
				setSettingsTab('offline')
				navigateToView('settings')
				if (isMobile) selectMobileSidebarDestination('settings')
				return
			}
			if (navigateToEarthlyAppLinkInPlace(url)) {
				consumePendingNativeDeepLink(url)
				return
			}
			consumePendingNativeDeepLink(url)
		}
		const pending = getPendingNativeDeepLink()
		if (pending) openNativeUrl(pending)
		const onNativeLink = (event: Event) => {
			openNativeUrl((event as CustomEvent<NativeDeepLinkDetail>).detail.url)
		}
		window.addEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
		return () => window.removeEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
	}, [isMobile, navigateToView, selectMobileSidebarDestination, setSettingsTab])

	const clearAnnotationPopupHideTimeout = useCallback(() => {
		if (annotationPopupHideTimeoutRef.current !== null) {
			window.clearTimeout(annotationPopupHideTimeoutRef.current)
			annotationPopupHideTimeoutRef.current = null
		}
	}, [])

	const scheduleAnnotationPopupHide = useCallback(() => {
		clearAnnotationPopupHideTimeout()
		annotationPopupHideTimeoutRef.current = window.setTimeout(() => {
			if (annotationPopupHoverRef.current) return
			setDisplayedAnnotationPopupData(null)
			annotationPopupHideTimeoutRef.current = null
		}, 1200)
	}, [clearAnnotationPopupHideTimeout])

	useEffect(() => {
		if (!mapPopupsEnabled) {
			clearAnnotationPopupHideTimeout()
			setAnnotationPopupData(null)
			setDisplayedAnnotationPopupData(null)
		}
	}, [clearAnnotationPopupHideTimeout, mapPopupsEnabled, setAnnotationPopupData])

	useEffect(() => {
		if (!mapPopupsEnabled) return
		if (annotationPopupData) {
			clearAnnotationPopupHideTimeout()
			setDisplayedAnnotationPopupData(annotationPopupData)
			return
		}
		if (
			mapPopupPlacement === 'dock' &&
			displayedAnnotationPopupData &&
			!displayedAnnotationPopupData.pinned
		) {
			scheduleAnnotationPopupHide()
			return
		}
		setDisplayedAnnotationPopupData(null)
	}, [
		annotationPopupData,
		clearAnnotationPopupHideTimeout,
		displayedAnnotationPopupData,
		mapPopupPlacement,
		mapPopupsEnabled,
		scheduleAnnotationPopupHide,
	])

	useEffect(() => {
		return () => clearAnnotationPopupHideTimeout()
	}, [clearAnnotationPopupHideTimeout])

	const handleAnnotationPopupHoverChange = useCallback(
		(hovered: boolean) => {
			annotationPopupHoverRef.current = hovered
			if (hovered) {
				clearAnnotationPopupHideTimeout()
				return
			}
			if (
				!annotationPopupData &&
				mapPopupPlacement === 'dock' &&
				displayedAnnotationPopupData &&
				!displayedAnnotationPopupData.pinned
			) {
				scheduleAnnotationPopupHide()
			}
		},
		[
			annotationPopupData,
			clearAnnotationPopupHideTimeout,
			displayedAnnotationPopupData,
			mapPopupPlacement,
			scheduleAnnotationPopupHide,
		],
	)

	const handleCloseAnnotationPopup = useCallback(() => {
		clearAnnotationPopupHideTimeout()
		setAnnotationPopupData(null)
		setDisplayedAnnotationPopupData(null)
	}, [clearAnnotationPopupHideTimeout, setAnnotationPopupData])

	const focusHandledRef = useRef<string | null>(null)
	// In-app inspect navigation must not be mistaken for a fresh shared-link
	// landing that adds/isolate entities on the map.
	const inAppDatasetInspectRouteRef = useRef<string | null>(null)
	const inAppEphemeralInspectRouteRef = useRef<string | null>(null)
	useEffect(() => {
		// Account restoration clears transient inspection along with the old
		// account's draft state. Re-resolve the current route after that reset,
		// including when its public event arrived before the signer did.
		focusHandledRef.current = null
		inAppDatasetInspectRouteRef.current = null
		inAppEphemeralInspectRouteRef.current = null
		hydrateEditorSessionForPubkey(currentUserPubkey)
	}, [currentUserPubkey, hydrateEditorSessionForPubkey])

	// Round G.2: catalog favorites/recents are scoped per pubkey too.
	const hydrateCatalogPrefsForPubkey = useEditorStore((state) => state.hydrateCatalogPrefsForPubkey)
	useEffect(() => {
		hydrateCatalogPrefsForPubkey(currentUserPubkey)
	}, [currentUserPubkey, hydrateCatalogPrefsForPubkey])

	// Callback for ensuring info panel is visible
	const openMobilePanel = useEditorStore((state) => state.openMobilePanel)
	const ensureInfoPanelVisible = useCallback(() => {
		if (isMobile) {
			openMobilePanel(route.tab === 'thread' ? 'chat' : 'edit')
		} else {
			setShowInfoPanel(true)
		}
	}, [isMobile, openMobilePanel, route.tab, setShowInfoPanel])

	// A direct map/touch selection explicitly asks to see Dataset properties, so it
	// may surface the Edit sheet. Programmatic selection changes (including AI tool
	// writes and workspace hydration) carry no `user` origin and must never steal
	// the current Chat/Stack surface. Map Stack remains visibility-only.
	useEffect(() => {
		if (!isMobile || !editor) return
		const handleUserSelection = (event: EditorEvent) => {
			if (event.origin !== 'user') return
			const state = useEditorStore.getState()
			if ((event.features?.length ?? 0) > 0) {
				if (!getRetainedDatasetSurfaceTarget(state)) return
				state.selectMobileEntitySurface('dataset')
				state.openMobilePanel('edit')
				state.setMobilePanelSnap('half')
				return
			}
			if (
				state.mobilePanelOpen &&
				state.mobilePanelTab === 'edit' &&
				state.mobileEntitySurface === 'dataset'
			) {
				state.setMobilePanelSnap('peek')
			}
		}
		editor.on('selection.change', handleUserSelection)
		return () => editor.off('selection.change', handleUserSelection)
	}, [editor, isMobile])

	// Keep camera moves and MapLibre attribution above the exact live sheet
	// height. The old percentage approximation disagreed with the fixed peek
	// detent and let the sheet cover both geometry and attribution.
	useEffect(() => {
		const mapInstance = map.current
		const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
		const rawBottom =
			isMobile && mobilePanelOpen
				? Math.round(
						mobilePanelHeightPx(
							mobilePanelSnap,
							window.innerHeight,
							stance === 'author' && mobileEntitySurface === 'dataset',
						),
					)
				: 0
		mapContainerRef.current?.style.setProperty('--mobile-sheet-height', `${rawBottom}px`)
		if (!mapInstance || !mounted) return
		// Never pad away the whole map — keep a usable strip so MapLibre always has
		// a positive padded viewport to center within.
		const bottom = Math.max(0, Math.min(rawBottom, viewportHeight - 80))
		mapInstance.easeTo({ padding: { top: 0, right: 0, bottom, left: 0 }, duration: 200 })
		return () => {
			mapContainerRef.current?.style.setProperty('--mobile-sheet-height', '0px')
		}
	}, [isMobile, mobilePanelOpen, mobilePanelSnap, mounted, stance, mobileEntitySurface])

	// Custom hooks
	const {
		geoEventsRef,
		isMountedRef,
		getDatasetKey,
		getDatasetName,
		resolvedCollectionResolver,
		ensureResolvedFeatureCollection,
		zoomToDataset,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		switchToWorkspace,
		deleteWorkspace,
		createDraftInWorkspace,
		loadDraftInWorkspace,
		deleteDraftInWorkspace,
		tearDownEditSession,
		startNewDataset: startNewDatasetWithOptions,
	} = useDatasetManagement(map, mapGeoEvents)

	useEffect(() => {
		// Restoring saved IDs is not the same as installing their contents in the
		// map editor. Only an unloaded saved draft is hydrated here; ordinary live
		// edits (including intentionally empty Maps) keep their current contents.
		if (
			!editor ||
			!pendingHydratedDraftId ||
			route.focusType !== 'none' ||
			route.sidebarView !== 'edit'
		)
			return
		const state = useEditorStore.getState()
		const retained = getRetainedDatasetSurfaceTarget(state)
		if (!retained || retained.draft.id !== pendingHydratedDraftId) return
		const channel = retained.draft.publishChannel
		if (privateGroupId && (channel.kind !== 'private-group' || channel.id !== privateGroupId))
			return
		if (fieldSessionId && (channel.kind !== 'field-session' || channel.id !== fieldSessionId))
			return
		loadDraftInWorkspace(retained.workspace.id, retained.draft.id)
		state.selectMobileEntitySurface('dataset')
		if (isMobile && route.tab === 'thread') state.openMobilePanel('chat')
	}, [
		editor,
		isMobile,
		pendingHydratedDraftId,
		route.focusType,
		route.sidebarView,
		route.tab,
		privateGroupId,
		fieldSessionId,
		loadDraftInWorkspace,
	])

	const discoverySelectionOptions = useMemo(
		() => ({
			featuredPubkeys: config.discoveryFeaturedPubkeys,
			allowUnfeaturedFallback: !config.isProduction,
		}),
		[],
	)
	const recentDiscoveryDatasets = useMemo(
		() =>
			selectRecentDiscoveryItems(
				geoEvents.filter(isRenderableDiscoveryDataset),
				discoverySelectionOptions,
				3,
			),
		[geoEvents, discoverySelectionOptions],
	)
	const recentDiscoveryStories = useMemo(
		() => selectRecentDiscoveryItems(stories, discoverySelectionOptions, 3),
		[stories, discoverySelectionOptions],
	)
	const recentDiscoveryContexts = useMemo(
		() => selectRecentDiscoveryItems(mapContextEvents, discoverySelectionOptions, 3),
		[mapContextEvents, discoverySelectionOptions],
	)
	const latestDiscoveryDataset = useMemo(
		() => selectLatestEligibleDataset(geoEvents, discoverySelectionOptions),
		[geoEvents, discoverySelectionOptions],
	)
	const discoveryDatasets = useMemo<DiscoveryItem[]>(
		() =>
			recentDiscoveryDatasets.map((event) => {
				const collection = event.featureCollection as FeatureCollection & {
					description?: unknown
					summary?: unknown
					properties?: Record<string, unknown>
				}
				const date = discoveryDate(event.created_at)
				return {
					id: event.id,
					title: getDatasetName(event),
					summary: discoverySummary(
						collection.description,
						collection.summary,
						collection.properties?.description,
						collection.properties?.summary,
					),
					meta: [
						`${collection.features.length} feature${collection.features.length === 1 ? '' : 's'}`,
						date,
					]
						.filter(Boolean)
						.join(' · '),
				}
			}),
		[getDatasetName, recentDiscoveryDatasets],
	)
	const discoveryStories = useMemo<DiscoveryItem[]>(
		() =>
			recentDiscoveryStories.map((story) => ({
				id: story.id,
				title:
					normalizeDiscoveryText(story.article.title, 120) ??
					normalizeDiscoveryText(story.dTag, 120) ??
					'Untitled story',
				summary: discoverySummary(story.article.summary, story.article.content),
				meta: discoveryDate(story.created_at),
			})),
		[recentDiscoveryStories],
	)
	const discoveryContexts = useMemo<DiscoveryItem[]>(
		() =>
			recentDiscoveryContexts.map((context) => ({
				id: context.id,
				title:
					normalizeDiscoveryText(context.context.name, 120) ??
					normalizeDiscoveryText(context.contextId, 120) ??
					'Untitled Atlas',
				summary: discoverySummary(context.context.description),
				meta: discoveryDate(context.created_at),
			})),
		[recentDiscoveryContexts],
	)
	const discoveryLoading = !geoEventsSettled || !storiesSettled || !mapContextsSettled

	const navigateToDraftEditor = useCallback((channel: PublishChannel) => {
		navigateToRoute(
			buildRoutePath({
				sidebarView: 'edit',
				privateGroupId: channel.kind === 'private-group' ? channel.id : undefined,
				fieldSessionId: channel.kind === 'field-session' ? channel.id : undefined,
			}),
			{ preserveThread: true },
		)
	}, [])
	const surfaceDraftEditorOnMobile = useCallback(() => {
		if (!isMobile) return
		const state = useEditorStore.getState()
		const retained = getRetainedDatasetSurfaceTarget(state)
		if (!retained) return
		navigateToDraftEditor(retained.draft.publishChannel)
		state.selectMobileEntitySurface('dataset')
		closeMobileSidebar()
		openMobilePanel('edit')
		setMobilePanelSnap('half')
	}, [closeMobileSidebar, isMobile, navigateToDraftEditor, openMobilePanel, setMobilePanelSnap])

	const startNewDataset = useCallback(() => {
		const workspaceId = startNewDatasetWithOptions({ publishChannel: routePublishChannel })
		if (!workspaceId) return
		if (isMobile) surfaceDraftEditorOnMobile()
		else navigateToDraftEditor(routePublishChannel)
	}, [
		isMobile,
		navigateToDraftEditor,
		routePublishChannel,
		startNewDatasetWithOptions,
		surfaceDraftEditorOnMobile,
	])

	const ensureAiDatasetDraft = useCallback(
		(request?: DatasetDraftRequest) => {
			const state = useEditorStore.getState()
			if (!request?.forceNew && (state.activeGeoEditDraftId || state.features.length > 0)) {
				return state.activeWorkspaceId
			}
			return startNewDatasetWithOptions({
				publishChannel: routePublishChannel,
				chatSessionId: request?.chatSessionId ?? null,
				activate: request?.activate,
			})
		},
		[routePublishChannel, startNewDatasetWithOptions],
	)

	useEffect(() => registerDatasetDraftEnsurer(ensureAiDatasetDraft), [ensureAiDatasetDraft])

	const syncRouteToDraftChannel = useCallback(
		(publishChannel: PublishChannel | null) => {
			if (publishChannel?.kind === 'private-group') {
				if (privateGroupId !== publishChannel.id) {
					navigateToPrivateGroup(publishChannel.id)
				}
				return
			}
			if (publishChannel?.kind === 'field-session') {
				if (fieldSessionId !== publishChannel.id) {
					navigateToFieldSession(publishChannel.id)
				}
				return
			}
			if (privateGroupId || fieldSessionId) {
				navigateToUnscopedView('drafts')
			}
		},
		[
			fieldSessionId,
			navigateToFieldSession,
			navigateToPrivateGroup,
			navigateToUnscopedView,
			privateGroupId,
		],
	)

	const readActiveWorkspaceDraftChannel = useCallback((workspaceId: string) => {
		const state = useEditorStore.getState()
		if (state.activeWorkspaceId !== workspaceId) return null
		const workspace = state.workspaces[workspaceId]
		const draftId = workspace?.activeDraftId ?? state.activeGeoEditDraftId
		return draftId ? (state.geoEditDrafts[draftId]?.publishChannel ?? null) : null
	}, [])

	const handleSwitchWorkspace = useCallback(
		async (workspaceId: string, options?: { preserveMobileRoute?: boolean }) => {
			await switchWorkspaceFromView({
				workspaceId,
				options,
				isMobile,
				routePublishChannel,
				switchToWorkspace,
				readActiveWorkspaceDraftChannel,
				syncRouteToDraftChannel,
				surfaceDraftEditorOnMobile,
			})
		},
		[
			isMobile,
			readActiveWorkspaceDraftChannel,
			routePublishChannel,
			surfaceDraftEditorOnMobile,
			switchToWorkspace,
			syncRouteToDraftChannel,
		],
	)

	const handleAddDraftToWorkspace = useCallback(
		async (workspaceId: string) => {
			await createDraftInWorkspace(workspaceId, { publishChannel: routePublishChannel })
			syncRouteToDraftChannel(readActiveWorkspaceDraftChannel(workspaceId))
			if (readActiveWorkspaceDraftChannel(workspaceId)) surfaceDraftEditorOnMobile()
		},
		[
			createDraftInWorkspace,
			readActiveWorkspaceDraftChannel,
			routePublishChannel,
			surfaceDraftEditorOnMobile,
			syncRouteToDraftChannel,
		],
	)

	const handleLoadDraft = useCallback(
		(workspaceId: string, draftId: string) => {
			loadDraftInWorkspace(workspaceId, draftId)
			syncRouteToDraftChannel(readActiveWorkspaceDraftChannel(workspaceId))
			if (readActiveWorkspaceDraftChannel(workspaceId)) surfaceDraftEditorOnMobile()
		},
		[
			loadDraftInWorkspace,
			readActiveWorkspaceDraftChannel,
			surfaceDraftEditorOnMobile,
			syncRouteToDraftChannel,
		],
	)

	const handleDeleteDraft = useCallback(
		(workspaceId: string, draftId: string) => {
			const before = useEditorStore.getState()
			const workspace = before.workspaces[workspaceId]
			const deletingActiveDraft =
				before.activeWorkspaceId === workspaceId &&
				(workspace?.activeDraftId === draftId || before.activeGeoEditDraftId === draftId)
			deleteDraftInWorkspace(workspaceId, draftId)
			if (workspace?.activeDraftId === draftId) {
				void removeDraftEditingAccess({ kind: 'dataset', workspaceId, title: workspace.label }, accounts.active?.pubkey)
			}
			if (!deletingActiveDraft) return
			syncRouteToDraftChannel(readActiveWorkspaceDraftChannel(workspaceId))
		},
		[deleteDraftInWorkspace, readActiveWorkspaceDraftChannel, syncRouteToDraftChannel],
	)

	const handleDeleteWorkspace = useCallback(
		async (workspaceId: string) => {
			const wasActive = useEditorStore.getState().activeWorkspaceId === workspaceId
			const deletionOwner = accounts.active?.pubkey
			await deleteWorkspace(workspaceId)
			void removeDraftEditingAccess({ kind: 'dataset', workspaceId, title: '' }, deletionOwner)
			if (!wasActive) return
			const nextWorkspaceId = useEditorStore.getState().activeWorkspaceId
			syncRouteToDraftChannel(
				nextWorkspaceId ? readActiveWorkspaceDraftChannel(nextWorkspaceId) : null,
			)
		},
		[deleteWorkspace, readActiveWorkspaceDraftChannel, syncRouteToDraftChannel],
	)

	const handleResolveDraftDestination = useCallback(
		(workspaceId: string, draftId: string, publishChannel: PublishChannel) => {
			const state = useEditorStore.getState()
			const workspace = state.workspaces[workspaceId]
			const draft = state.geoEditDrafts[draftId]
			if (!workspace || !draft || draft.sourceId !== workspace.sourceId) return
			if (draft.authoringIntent === 'propose' && publishChannel.kind !== 'public') {
				toast.error('Proposals target the original public Map. Choose Everyone or start a fork.')
				return
			}
			state.saveGeoEditDraft(draftId, { publishChannel })
			if (
				state.activeWorkspaceId === workspaceId &&
				(workspace.activeDraftId === draftId || state.activeGeoEditDraftId === draftId)
			) {
				syncRouteToDraftChannel(publishChannel)
			}
			toast.success('Draft audience set', {
				description:
					publishChannel.kind === 'public'
						? 'This draft can now be published publicly.'
						: publishChannel.kind === 'private-group'
							? 'This draft will be saved to the selected Circle.'
							: 'This draft will be shared with the selected Nearby session.',
			})
		},
		[syncRouteToDraftChannel],
	)

	const loadDatasetForCurrentChannel = useCallback(
		async (event: GeoDataset, options?: DatasetEditOptions) => {
			const privateWorkspaceId = privateWorkspaceIdForDataset(event)
			const nearbySessionId = fieldSessionIdForEvent(event.event)
			const publishChannel: PublishChannel = privateWorkspaceId
				? { kind: 'private-group', id: privateWorkspaceId }
				: nearbySessionId
					? { kind: 'field-session', id: nearbySessionId }
					: { kind: 'public' }
			const loaded = await loadDatasetForEditing(event, { ...options, publishChannel })
			// Only an explicit entry gesture navigates. Route hydration and Thread
			// binding use the same loader without stealing their current surface.
			if (loaded && options?.intent) {
				useEditorStore.getState().selectMobileEntitySurface('dataset')
				if (options.intent === 'fork') {
					navigateToRoute('/edit')
				} else if (privateWorkspaceId) {
					navigateToRoute(`/circle/${encodeURIComponent(privateWorkspaceId)}/edit`)
				} else if (nearbySessionId) {
					navigateToRoute(`/nearby/${encodeURIComponent(nearbySessionId)}/edit`)
				} else {
					const naddr = nip19.naddrEncode({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: event.datasetId,
					})
					navigateToRoute(`/map/${naddr}/edit`)
				}
			}
			return loaded
		},
		[loadDatasetForEditing],
	)

	const activeDatasetKey = useMemo(
		() => (activeDataset ? getDatasetKey(activeDataset) : null),
		[activeDataset, getDatasetKey],
	)
	const activeDatasetMatchesDraftChannel = useMemo(() => {
		if (!activeDataset || !activeDraftPublishChannel) return false
		return publishChannelMatchesDatasetScope(activeDraftPublishChannel, {
			privateGroupId: privateWorkspaceIdForDataset(activeDataset) ?? undefined,
			fieldSessionId: fieldSessionIdForEvent(activeDataset.event) ?? undefined,
		})
	}, [activeDataset, activeDraftPublishChannel])
	const materializedFork =
		activeMapDraft?.authoringIntent === 'fork' && Boolean(activeMapDraft.sourceDataset)
	const draftSourceNeedsResolution = Boolean(
		activeDraftPublishChannel &&
			activeWorkspaceDatasetKey &&
			(activeDatasetKey !== activeWorkspaceDatasetKey ||
				(!materializedFork && !activeDatasetMatchesDraftChannel)),
	)
	// The fork already owns its local snapshot. Resolving its original Map is
	// useful context, not a requirement for publishing to the selected audience.
	const draftSourceIdentityPending = draftSourceNeedsResolution && !materializedFork
	const draftSourceCandidates = useMemo(() => {
		if (materializedFork) return [...geoEvents, ...privateGeoEvents, ...fieldGeoEvents]
		if (activeDraftPublishChannel?.kind === 'private-group') return privateGeoEvents
		if (activeDraftPublishChannel?.kind === 'field-session') return fieldGeoEvents
		if (activeDraftPublishChannel?.kind === 'public') return geoEvents
		return []
	}, [activeDraftPublishChannel, fieldGeoEvents, geoEvents, privateGeoEvents, materializedFork])

	// Local drafts can be opened from the unscoped /drafts route before their
	// private-group or Field-session event is in the current map collection.
	// Once the persisted channel activates that scope, restore the original
	// dataset identity without replacing the draft's saved geometry or metadata.
	// Publishing stays blocked while the source is unresolved, so an update can
	// never be mistaken for a new dataset during this short hand-off.
	useEffect(() => {
		if (!activeWorkspaceDatasetKey || !draftSourceNeedsResolution) return
		const sourceDataset = draftSourceCandidates.find((event) =>
			materializedFork
				? event.event.id === activeMapDraft?.sourceDataset?.eventId
				: getDatasetKey(event) === activeWorkspaceDatasetKey,
		)
		if (!sourceDataset) return
		setActiveDataset(sourceDataset)
		setIsDirty(true)
	}, [
		activeWorkspaceDatasetKey,
		draftSourceCandidates,
		draftSourceNeedsResolution,
		materializedFork,
		activeMapDraft?.sourceDataset?.eventId,
		getDatasetKey,
		setActiveDataset,
		setIsDirty,
	])

	// Plan 13-06 (UAT test 5b — kill the add-to-stack phantom): a per-entry
	// RESOLVED-ENTITY cache. `addBeaconToMapStack`/`addSightingToMapStack` deposit the
	// actual resolved LiveBeacon/TemporalSighting at ADD TIME, keyed by the SAME
	// entityKey the entry is pinned under. This keeps an explicitly-added
	// out-of-discovery entity (own / link-only / faded-from-live) resolvable by BOTH
	// the render gate and the expiry-sweep WITHOUT tagging it into `#t:['live']`
	// discovery — so the individual pin renders while the aggregate layer stays
	// discovery-only (T-13-06-01 / T-13-03-GPSREGRESS privacy invariant). `addedCacheTick`
	// bumps on every deposit/prune so the selector memos re-derive against the fresh
	// cache (refs alone don't trigger a re-render).
	const addedBeaconCacheRef = useRef<Map<string, LiveBeacon>>(new Map())
	const addedSightingCacheRef = useRef<Map<string, TemporalSighting>>(new Map())
	const [addedCacheTick, setAddedCacheTick] = useState(0)

	const addDatasetToMapStack = useCallback(
		(event: GeoDataset, source: 'manual' | 'route' | 'browse-default' = 'manual') => {
			const datasetKey = getDatasetKey(event)
			addMapStackEntry({
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source,
				visible: true,
				pinned: false,
			})
			if (source === 'manual') {
				toast.success(`Added "${getDatasetName(event)}" to the map.`)
			}
		},
		[addMapStackEntry, getDatasetKey, getDatasetName],
	)

	const addPrivateDatasetToMapStack = useCallback(
		(event: GeoDataset) => {
			const workspaceId = privateWorkspaceIdForDataset(event) ?? privateWorkspaceScopeId
			if (!workspaceId) return
			const datasetKey = getDatasetKey(event)
			const id = privateDatasetStackEntryId(workspaceId, datasetKey)
			dismissedPrivateDatasetIds().delete(id)
			const existing = useEditorStore.getState().mapStackEntries[id]
			addMapStackEntry({
				id,
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source: 'private-group',
				visible: existing?.visible ?? true,
				pinned: existing?.pinned ?? false,
				isolated: existing?.isolated,
				exclusions: existing?.exclusions,
			})
		},
		[
			privateWorkspaceScopeId,
			getDatasetKey,
			getDatasetName,
			addMapStackEntry,
			dismissedPrivateDatasetIds,
		],
	)

	// A private-group route is an encrypted map scope. New decrypted datasets are
	// added once, while existing Map Stack state remains user-owned. Explicitly
	// removed entries stay dismissed until the Geometry tab adds them again.
	useEffect(() => {
		const stack = useEditorStore.getState()
		const plan = planPrivateDatasetStackReconciliation({
			workspaceId: privateWorkspaceScopeId,
			datasets: privateGeoEvents.map((dataset) => ({
				datasetKey: getDatasetKey(dataset),
				title: getDatasetName(dataset),
			})),
			entries: stack.mapStackEntries,
			order: stack.mapStackOrder,
			dismissedIds: dismissedPrivateDatasetIds(),
		})

		for (const id of plan.remove) removeMapStackEntry(id)
		for (const item of plan.upsert) {
			addMapStackEntry({
				id: item.id,
				entityType: 'dataset',
				entityKey: item.datasetKey,
				title: item.title,
				source: 'private-group',
				visible: item.existing?.visible ?? true,
				pinned: item.existing?.pinned ?? false,
				isolated: item.existing?.isolated,
				exclusions: item.existing?.exclusions,
			})
		}
	}, [
		privateWorkspaceScopeId,
		privateGeoEvents,
		getDatasetKey,
		getDatasetName,
		addMapStackEntry,
		removeMapStackEntry,
		dismissedPrivateDatasetIds,
	])

	const addFieldDatasetToMapStack = useCallback(
		(event: GeoDataset) => {
			if (!fieldSessionScopeId) return
			const datasetKey = getDatasetKey(event)
			const id = fieldDatasetStackEntryId(fieldSessionScopeId, datasetKey)
			dismissedFieldDatasetIdsRef.current.delete(id)
			const existing = useEditorStore.getState().mapStackEntries[id]
			addMapStackEntry({
				id,
				entityType: 'dataset',
				entityKey: datasetKey,
				title: getDatasetName(event),
				source: 'field-session',
				visible: existing?.visible ?? true,
				pinned: existing?.pinned ?? false,
				isolated: existing?.isolated,
				exclusions: existing?.exclusions,
			})
		},
		[fieldSessionScopeId, getDatasetKey, getDatasetName, addMapStackEntry],
	)

	// Nearby datasets follow the same non-resurrection contract as private
	// geometry: new records appear once, while an explicit Map Stack removal is
	// remembered until the user adds the dataset again from the Field session.
	useEffect(() => {
		const stack = useEditorStore.getState()
		const plan = planFieldDatasetStackReconciliation({
			sessionId: fieldSessionScopeId,
			datasets: fieldGeoEvents.map((dataset) => ({
				datasetKey: getDatasetKey(dataset),
				title: getDatasetName(dataset),
			})),
			entries: stack.mapStackEntries,
			order: stack.mapStackOrder,
			dismissedIds: dismissedFieldDatasetIdsRef.current,
		})

		for (const id of plan.remove) removeMapStackEntry(id)
		for (const item of plan.upsert) {
			addMapStackEntry({
				id: item.id,
				entityType: 'dataset',
				entityKey: item.datasetKey,
				title: item.title,
				source: 'field-session',
				visible: item.existing?.visible ?? true,
				pinned: item.existing?.pinned ?? false,
				isolated: item.existing?.isolated,
				exclusions: item.existing?.exclusions,
			})
		}
	}, [
		fieldSessionScopeId,
		fieldGeoEvents,
		getDatasetKey,
		getDatasetName,
		addMapStackEntry,
		removeMapStackEntry,
	])

	// Phase 13 (SPEC §3.4): put an individual Sighting on the Map Stack, mirroring
	// addDatasetToMapStack. entityKey = naddr (dTag/id fallback) — the SAME key the
	// stack-derived selector resolves under. A deep link (`source: 'route'`) lands
	// SOLO: `isolated: true` triggers the existing global mutual-exclusion rule in
	// mapStackSlice, suppressing every other entry (T-13-03-FORCEISO — the key comes
	// from the resolved entity, never a raw URL field, so a route can only isolate
	// exactly the entity its naddr resolved to).
	const addSightingToMapStack = useCallback(
		(sighting: TemporalSighting, source: 'manual' | 'route' | 'browse-default' = 'manual') => {
			// Toast-honesty (13-06 Task 2): only proceed if the sighting resolves to a
			// real, keyable entity. `sighting` is already the resolved object the panel
			// is displaying, so resolution "succeeds" when it has a stable entityKey.
			const entityKey = getSightingMapStackKey(sighting)
			if (!entityKey) {
				if (source === 'manual') toast.error("Couldn't add this sighting to the map.")
				return
			}
			// Deposit the resolved entity BEFORE adding the entry so the render gate +
			// sweep can resolve an out-of-subscription sighting from the cache.
			addedSightingCacheRef.current.set(entityKey, sighting)
			setAddedCacheTick((t) => t + 1)
			addMapStackEntry({
				entityType: 'sighting',
				entityKey,
				title: sighting.sighting.title?.trim() || 'Sighting',
				source,
				visible: true,
				pinned: false,
				isolated: source === 'route',
			})
			if (source === 'manual') {
				toast.success('Added sighting to the map.')
			}
		},
		[addMapStackEntry],
	)

	// Phase 13 (SPEC §3.4): put an individual Live Beacon on the Map Stack. Same
	// shape as addSightingToMapStack; deep-link lands SOLO (isolated 'route').
	const addBeaconToMapStack = useCallback(
		(beacon: LiveBeacon, source: 'manual' | 'route' | 'browse-default' | 'own' = 'manual') => {
			// Toast-honesty (13-06 Task 2): only fire success when the beacon resolves to
			// a real, keyable entity. An out-of-discovery beacon (own / link-only / faded
			// from live) IS resolvable — it is the object the inspect panel is showing —
			// so caching it under its entityKey lets the individual pin render without
			// forcing it into discovery.
			const entityKey = getBeaconMapStackKey(beacon)
			if (!entityKey) {
				if (source === 'manual') toast.error("Couldn't add this live position to the map.")
				return
			}
			addedBeaconCacheRef.current.set(entityKey, beacon)
			setAddedCacheTick((t) => t + 1)
			addMapStackEntry({
				entityType: 'beacon',
				entityKey,
				title: beacon.beacon.label?.trim() || 'Live location',
				source,
				visible: true,
				pinned: false,
				isolated: source === 'route',
			})
			if (source === 'manual') {
				toast.success('Added live position to the map.')
			}
		},
		[addMapStackEntry],
	)

	const setMapStackVisibility = useCallback(
		(entry: MapStackEntry, visible: boolean) => {
			setMapStackEntryVisible(entry.id, visible)
		},
		[setMapStackEntryVisible],
	)

	const setMapStackIsolation = useCallback(
		(entry: MapStackEntry, isolated: boolean) => {
			setMapStackEntryIsolated(entry.id, isolated)
			if (isolated && entry.entityType === 'dataset') {
				// Make sure the isolated dataset is visible so the user actually sees it.
				setMapStackEntryVisible(entry.id, true)
			}
		},
		[setMapStackEntryIsolated, setMapStackEntryVisible],
	)

	const removeFromMapStack = useCallback(
		(entry: MapStackEntry) => {
			// Active Dataset drafts are not removable presentation rows. The panel
			// withholds that action and the store guards the invariant as a backstop.
			if (entry.source === 'private-group') {
				dismissedPrivateDatasetIds().add(entry.id)
			}
			if (entry.source === 'field-session') {
				dismissedFieldDatasetIdsRef.current.add(entry.id)
			}
			removeMapStackEntry(entry.id)
		},
		[removeMapStackEntry, dismissedPrivateDatasetIds],
	)

	const removePrivateDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			const workspaceId = privateWorkspaceIdForDataset(event) ?? privateWorkspaceScopeId
			if (!workspaceId) return
			const id = privateDatasetStackEntryId(workspaceId, getDatasetKey(event))
			const entry = useEditorStore.getState().mapStackEntries[id]
			if (entry) removeFromMapStack(entry)
		},
		[privateWorkspaceScopeId, getDatasetKey, removeFromMapStack],
	)

	const removeFieldDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			if (!fieldSessionScopeId) return
			const id = fieldDatasetStackEntryId(fieldSessionScopeId, getDatasetKey(event))
			const entry = useEditorStore.getState().mapStackEntries[id]
			if (entry) removeFromMapStack(entry)
		},
		[fieldSessionScopeId, getDatasetKey, removeFromMapStack],
	)

	/**
	 * Round C: catalog rows toggle stack membership. This thin wrapper finds the
	 * stack entry for a given dataset and removes it (no-op if not present).
	 */
	const removeDatasetFromMapStack = useCallback(
		(event: GeoDataset) => {
			const datasetKey = getDatasetKey(event)
			for (const entryId of mapStackOrder) {
				const entry = mapStackEntries[entryId]
				if (entry?.entityType === 'dataset' && entry.entityKey === datasetKey) {
					removeFromMapStack(entry)
					return
				}
			}
		},
		[getDatasetKey, mapStackOrder, mapStackEntries, removeFromMapStack],
	)

	const clearMapStackAndVisibility = useCallback(() => {
		const stack = useEditorStore.getState()
		for (const id of stack.mapStackOrder) {
			if (stack.mapStackEntries[id]?.source === 'private-group') {
				dismissedPrivateDatasetIds().add(id)
			}
		}
		clearMapStack()
	}, [clearMapStack, dismissedPrivateDatasetIds])

	// The public Shelf is route-local state: exact public Maps live in `on=` and
	// the aggregate sightings/beacons surface lives in `live=1`. The retained Map
	// Stack is only a compatibility render model; adapter-owned rows use a private
	// id prefix so Back/Forward never deletes manual, Story, draft, private, or
	// object-route rows.
	const publicShelfMaps = useMemo(
		() =>
			geoEvents.flatMap((event) => {
				const map = createPublicShelfMap({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier: event.datasetId,
					datasetKey: getDatasetKey(event),
					title: getDatasetName(event),
				})
				return map ? [map] : []
			}),
		[geoEvents, getDatasetKey, getDatasetName],
	)
	const canonicalShelfIntent = useMemo(
		() => resolveShelfRouteIntent(route.on ?? [], publicShelfMaps, route.live === true),
		[publicShelfMaps, route.live, route.on],
	)
	const currentShelfSearch = window.location.search
	const legacyShelfIntent = useMemo(() => {
		const publicMapByDatasetKey = new Map(
			publicShelfMaps.map((publicMap) => [publicMap.datasetKey, publicMap]),
		)
		const contextByKey = new Map<string, MapContext>()
		for (const context of mapContextEvents) {
			const key = context.contextCoordinate ?? context.id ?? context.contextId ?? context.dTag
			if (key) contextByKey.set(key, context)
		}
		return convertLegacyShelfSearch(
			currentShelfSearch,
			publicShelfMaps,
			(contextKey, exclusions) => {
				const context = contextByKey.get(contextKey)
				if (!context) return []
				const excluded = new Set(exclusions)
				return resolveContextMapScope(
					context,
					geoEvents,
					mapContextEvents,
					getDefaultContextMapScopeMode(context),
				).datasets.flatMap(({ dataset }) => {
					const datasetKey = getDatasetKey(dataset)
					if (excluded.has(datasetKey)) return []
					const source = publicMapByDatasetKey.get(datasetKey)?.source
					return source ? [source] : []
				})
			},
		)
	}, [currentShelfSearch, geoEvents, getDatasetKey, mapContextEvents, publicShelfMaps])
	const useLegacyShelfIntent =
		(route.on?.length ?? 0) === 0 && route.live !== true && legacyShelfIntent.hasLegacySearch
	const effectiveShelfIntent = useMemo<ShelfRouteIntent>(
		() =>
			useLegacyShelfIntent
				? { sources: legacyShelfIntent.sources, live: legacyShelfIntent.live }
				: { sources: canonicalShelfIntent.sources, live: canonicalShelfIntent.live },
		[canonicalShelfIntent, legacyShelfIntent, useLegacyShelfIntent],
	)
	const legacyShelfCatalogPending = Boolean(
		useLegacyShelfIntent &&
			(!geoEventsSettled || (legacyShelfIntent.needsContextCatalog && !mapContextsSettled)),
	)
	const canonicalLegacyAliasPending = Boolean(
		!useLegacyShelfIntent && canonicalShelfIntent.hasLegacyTokens && !geoEventsSettled,
	)
	const shelfCatalogPending = legacyShelfCatalogPending || canonicalLegacyAliasPending
	const [stackUrlHydrated, setStackUrlHydrated] = useState(
		() => !new URLSearchParams(window.location.search).has('ms'),
	)
	useEffect(() => {
		if (!shelfCatalogPending) setStackUrlHydrated(true)
	}, [shelfCatalogPending])

	const appliedShelfRouteSignatureRef = useRef<string | null>(null)
	const shelfRouteIntentSourcesRef = useRef(effectiveShelfIntent.sources)
	const skipNextShelfWriteRef = useRef(false)
	const resolvedShelfMapSignature = effectiveShelfIntent.sources
		.map((source) => {
			const map = publicShelfMaps.find((candidate) => candidate.source === source)
			return map ? `${source}:${map.datasetKey}:${map.title}` : `${source}:unresolved`
		})
		.join('\u0000')
	const shelfRouteApplySignature = `${effectiveShelfIntent.live ? 1 : 0}\u0001${resolvedShelfMapSignature}`
	useEffect(() => {
		shelfRouteIntentSourcesRef.current = effectiveShelfIntent.sources
		if (shelfCatalogPending) return
		if (appliedShelfRouteSignatureRef.current === shelfRouteApplySignature) return
		appliedShelfRouteSignatureRef.current = shelfRouteApplySignature
		const state = useEditorStore.getState()
		const plan = planShelfRouteReconciliation(
			effectiveShelfIntent,
			publicShelfMaps,
			state.mapStackEntries,
		)
		let mutated = plan.removeEntryIds.length > 0 || plan.upsertEntries.length > 0
		for (const id of plan.removeEntryIds) removeMapStackEntry(id)
		for (const entry of plan.upsertEntries) addMapStackEntry(entry)
		const reconciled = useEditorStore.getState()
		const nextOrder = [
			...reconciled.mapStackOrder.filter((id) => !id.startsWith(SHELF_ROUTE_ENTRY_PREFIX)),
			...plan.orderedOwnedEntryIds.filter((id) => reconciled.mapStackEntries[id]),
		]
		if (nextOrder.some((id, index) => reconciled.mapStackOrder[index] !== id)) {
			mutated = true
			setMapStackOrder(nextOrder)
		}
		if (mutated) skipNextShelfWriteRef.current = true
	}, [
		addMapStackEntry,
		effectiveShelfIntent,
		publicShelfMaps,
		removeMapStackEntry,
		setMapStackOrder,
		shelfCatalogPending,
		shelfRouteApplySignature,
	])

	// Store-originated Shelf changes replace only `on`/`live`, while also
	// erasing the old public `ms`/`iso`/`ex` surface. A route-originated apply
	// skips this render so its stale pre-reconciliation snapshot cannot win.
	useEffect(() => {
		if (shelfCatalogPending) return
		if (skipNextShelfWriteRef.current) {
			skipNextShelfWriteRef.current = false
			return
		}
		let cancelled = false
		const handle = window.requestAnimationFrame(() => {
			if (cancelled) return
			const nextIntent = deriveShelfRouteIntent(
				mapStackEntries,
				mapStackOrder,
				publicShelfMaps,
				shelfRouteIntentSourcesRef.current,
			)
			const current = new URLSearchParams(window.location.search)
			const next = new URLSearchParams(current)
			applyShelfRouteIntentToSearch(next, nextIntent)
			if (next.toString() === current.toString()) return
			replaceEarthlySearch((params) => applyShelfRouteIntentToSearch(params, nextIntent))
		})
		return () => {
			cancelled = true
			window.cancelAnimationFrame(handle)
		}
	}, [mapStackEntries, mapStackOrder, publicShelfMaps, shelfCatalogPending])
	// A plain, unscoped `/` starts with the newest eligible featured map. The
	// selection waits for relay EOSE so streaming order cannot pin an older map.
	// Restored drafts, shared stacks, scoped routes and explicit catalog routes
	// remain authoritative and are never modified.
	useEffect(() => {
		if (landingDatasetSeededRef.current || !latestDiscoveryDataset || getPendingNativeDeepLink())
			return
		const state = useEditorStore.getState()
		const shouldSeed = shouldSeedLandingDataset({
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash,
			route,
			stance: state.stance,
			stackUrlHydrated,
			catalogSettled: geoEventsSettled,
			activeDraftId: state.activeGeoEditDraftId,
			activeWorkspaceId: state.activeWorkspaceId,
			hasEditorFeatures: state.features.length > 0,
			hasDraftStackEntry: state.mapStackOrder.some(
				(id) => state.mapStackEntries[id]?.entityType === 'draft',
			),
			mapStackSize: state.mapStackOrder.length,
		})
		if (!shouldSeed) return
		addDatasetToMapStack(latestDiscoveryDataset, 'browse-default')
		landingDatasetSeededRef.current = true
		landingDatasetFitPendingRef.current = latestDiscoveryDataset
	}, [addDatasetToMapStack, geoEventsSettled, latestDiscoveryDataset, route, stackUrlHydrated])

	useEffect(() => {
		if (!mounted || !landingDatasetFitPendingRef.current) return
		zoomToDataset(landingDatasetFitPendingRef.current)
		landingDatasetFitPendingRef.current = null
	}, [mounted, zoomToDataset])

	// First-visit welcome is deliberately independent from tour completion. It
	// opens only on the safe plain-root landing and can always be reopened via
	// Discover in the desktop rail or mobile navigation.
	useEffect(() => {
		if (discoverAutoOpenedRef.current || getPendingNativeDeepLink()) return
		const state = useEditorStore.getState()
		if (
			!shouldAutoOpenDiscover({
				pathname: window.location.pathname,
				search: window.location.search,
				hash: window.location.hash,
				route,
				stance: state.stance,
				stackUrlHydrated,
				activeDraftId: state.activeGeoEditDraftId,
				activeWorkspaceId: state.activeWorkspaceId,
				hasEditorFeatures: state.features.length > 0,
				hasDraftStackEntry: state.mapStackOrder.some(
					(id) => state.mapStackEntries[id]?.entityType === 'draft',
				),
			})
		)
			return
		if (hasSeenDiscoverWelcome(getDiscoverWelcomeStorage())) return
		discoverAutoOpenedRef.current = true
		discoverOpenedAutomaticallyRef.current = true
		setDiscoverOpen(true)
	}, [route, stackUrlHydrated])

	// A native cold-launch link can arrive after the first root render. Close
	// only an automatically-opened welcome in that case; a user-invoked Discover
	// modal is intentionally available on every route.
	useEffect(() => {
		if (!discoverOpen || !discoverOpenedAutomaticallyRef.current) return
		const state = useEditorStore.getState()
		const stillSafeToWelcome =
			!getPendingNativeDeepLink() &&
			shouldAutoOpenDiscover({
				pathname: window.location.pathname,
				search: window.location.search,
				hash: window.location.hash,
				route,
				stance: state.stance,
				stackUrlHydrated,
				activeDraftId: state.activeGeoEditDraftId,
				activeWorkspaceId: state.activeWorkspaceId,
				hasEditorFeatures: state.features.length > 0,
				hasDraftStackEntry: state.mapStackOrder.some(
					(id) => state.mapStackEntries[id]?.entityType === 'draft',
				),
			})
		if (stillSafeToWelcome) return
		discoverOpenedAutomaticallyRef.current = false
		setDiscoverOpen(false)
	}, [discoverOpen, route, stackUrlHydrated])

	// Store state for viewMode
	const viewMode = useEditorStore((state) => state.viewMode)

	// Dataset authoring and map presentation are one product state. Repair old or
	// externally-mutated sessions immediately so an editor can never remain open
	// while its geometry is absent from the Map Stack or map.
	useEffect(() => {
		const repair = () => ensureActiveDraftMapPresentation(useEditorStore.getState())
		repair()
		return useEditorStore.subscribe(repair)
	}, [])
	const datasetMapInteractionEnabled = isDatasetMapInteractionEnabled({
		draftGeometryVisible,
		isMobile,
		mobilePanelOpen,
		mobilePanelTab,
		mobileEntitySurface,
		viewMode,
		stance,
	})

	// Direct geometry gestures are owned exclusively by the Dataset authoring
	// surface. The editor keeps its mode (and partial drawing) while the user
	// visits Inspector, a catalog, Story/Context editing, or Chat; its event
	// boundary simply becomes read-only until Dataset authoring is explicitly restored.
	useEffect(() => {
		const sightingSurfaceActive =
			sightingPlacementArmedRef.current && (!isMobile || mobileEntitySurface === 'sighting')
		editor?.setInteractionEnabled(datasetMapInteractionEnabled || sightingSurfaceActive)
	}, [datasetMapInteractionEnabled, editor, isMobile, mobileEntitySurface])

	useEffect(() => {
		if (!calloutAuthoringFeatureId) return
		if (
			selectedFeatureIds.length !== 1 ||
			selectedFeatureIds[0] !== calloutAuthoringFeatureId ||
			stance !== 'author' ||
			viewMode !== 'edit'
		) {
			setCalloutAuthoringFeatureId(null)
		}
	}, [calloutAuthoringFeatureId, selectedFeatureIds, stance, viewMode])

	useEffect(() => {
		if (!calloutAnchorDrawing) return
		const anchor = features.find(
			(feature) =>
				feature.geometry.type === 'Point' &&
				!calloutAnchorExistingFeatureIdsRef.current.has(feature.id),
		)
		if (!anchor) return
		setSelectedFeatureIds([anchor.id])
		setCalloutAuthoringFeatureId(anchor.id)
		setCalloutAnchorDrawing(false)
		executeEditorCommand('set_mode', { mode: 'select' })
	}, [calloutAnchorDrawing, features, setSelectedFeatureIds])

	useEffect(() => {
		if (calloutAnchorDrawing && currentMode !== 'draw_point') {
			setCalloutAnchorDrawing(false)
		}
	}, [calloutAnchorDrawing, currentMode])

	// The viewed Story is also the carrier for the shared presentation runtime.
	// Semantic references are fetched later, once the retained Story editor state
	// is available too, so browse and authoring use the exact same pipeline.
	const viewStory = useEditorStore((state) => state.viewStory)
	const viewContext = useEditorStore((state) => state.viewContext)

	// Blossom upload dialog state
	const blossomUploadDialogOpen = useEditorStore((state) => state.blossomUploadDialogOpen)
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const pendingPublishCollection = useEditorStore((state) => state.pendingPublishCollection)

	const publishPrivateDataset = useCallback(
		async (
			collection: import('geojson').FeatureCollection,
			options?: { datasetId?: string; name?: string },
		) => {
			if (!privateWorkspaceRuntime || !authoringPrivateGroupId) {
				throw new Error('The Circle is not available in this browser profile')
			}
			const envelope = await privateWorkspaceRuntime.perform((service) =>
				service.sendDataset(authoringPrivateGroupId, collection, options),
			)
			const workspace = privateWorkspaceRuntime
				.getSnapshot()
				.workspaces.find((item) => item.workspaceId === authoringPrivateGroupId)
			const dataset = workspace
				? projectPrivateWorkspaceDatasets(workspace).find((item) => item.event.id === envelope.id)
				: undefined
			if (!dataset) throw new Error('The encrypted Map could not be opened after saving')
			return dataset
		},
		[privateWorkspaceRuntime, authoringPrivateGroupId],
	)
	const publishFieldDataset = useCallback(
		async (
			collection: FeatureCollection,
			options?: { datasetId?: string; name?: string; previous?: GeoDataset },
		) => {
			if (!authoringFieldSession || !authoringFieldSessionId) {
				throw new Error('Nearby is not available on this device')
			}
			if (authoringFieldSession.role === 'participant' && !authoringFieldSession.allowPeerWrites) {
				throw new Error('This Nearby session is read-only on participant phones')
			}
			const signer = accounts.signer
			if (!signer) throw new Error('Sign in before saving nearby geometry')

			let factory = fieldSessionDatasetFactory(
				collection,
				authoringFieldSessionId,
				options?.previous,
			)
			if (options?.datasetId && !options.previous) {
				factory = factory.modifyPublicTags((tags) => [
					...tags.filter((tag) => tag[0] !== 'd'),
					['d', options.datasetId as string],
				])
			}
			const signed = (await factory.sign(signer)) as NostrEvent
			if (fieldSessionIdForEvent(signed) !== authoringFieldSessionId) {
				throw new Error('The Nearby Map lost its session scope before signing')
			}
			await fieldTransport.publishEvent(signed)
			return castEvent(signed, GeoDataset, eventStore)
		},
		[authoringFieldSession, authoringFieldSessionId, fieldTransport.publishEvent],
	)
	const navigateToEntityFocus = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext' | 'story',
			naddr: string,
			sidebarView?: SidebarViewMode,
			edit = false,
		) => {
			// Projected private datasets have no public naddr route. Keep inspection
			// inside /privategroup/:id so opening a map row cannot drop the MLS scope.
			if ((privateWorkspaceScopeId || fieldSessionScopeId) && focusType === 'geoevent') return
			if (
				!edit &&
				!route.edit &&
				route.focusType === focusType &&
				route.naddr &&
				naddrTargetsSameEntity(route.naddr, naddr)
			) {
				// Hydrating the routed object must preserve its tab and relay hints.
				// Re-encoding the same address is not a new Details navigation.
				return
			}
			if (focusType === 'geoevent') {
				const nextRouteKey = `${focusType}:${naddr}`
				const currentRouteKey =
					route.focusType !== 'none' && route.naddr ? `${route.focusType}:${route.naddr}` : null
				inAppDatasetInspectRouteRef.current = currentRouteKey === nextRouteKey ? null : nextRouteKey
			}
			navigateTo(focusType, naddr, sidebarView, edit)
		},
		[
			privateWorkspaceScopeId,
			fieldSessionScopeId,
			navigateTo,
			route.edit,
			route.focusType,
			route.naddr,
		],
	)
	const navigateToEphemeralInspectFocus = useCallback(
		(focusType: 'sighting' | 'beacon', naddr: string, sidebarView?: SidebarViewMode) => {
			const nextRouteKey = inspectRouteKey(focusType, naddr)
			const currentRouteKey =
				route.focusType === 'sighting' || route.focusType === 'beacon'
					? route.naddr
						? inspectRouteKey(route.focusType, route.naddr)
						: null
					: null
			markInAppInspectRoute(inAppEphemeralInspectRouteRef, currentRouteKey, nextRouteKey)
			navigateTo(focusType, naddr, sidebarView)
		},
		[navigateTo, route.focusType, route.naddr],
	)

	const {
		handlePublishNew,
		authoringIntent: mapAuthoringIntent,
		handlePublishUpdate,
		handlePublishCopy,
		handleProposeEdit,
		handleDeleteDataset,
		handlePublishWithBlossomUpload,
		buildCollectionFromEditor,
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
		canProposeEdit,
	} = usePublishing({
		currentUserPubkey: currentUserPubkey ?? undefined,
		getDatasetName,
		getDatasetKey,
		groups,
		resolvedCollectionResolver,
		navigateTo,
		encodeGeoEventNaddr,
		privateWorkspaceId: authoringPrivateGroupId,
		publishPrivateDataset:
			authoringPrivateGroupId && authoringPrivateWorkspace && privateWorkspaceRuntime
				? publishPrivateDataset
				: undefined,
		fieldSessionId: authoringFieldSessionId,
		publishFieldDataset:
			authoringFieldSessionId && authoringFieldSessionWritable ? publishFieldDataset : undefined,
		publishBoundaryResolved:
			authoringPublishChannel.kind !== 'unresolved' && !draftSourceIdentityPending,
		publishBoundaryMessage:
			authoringPublishChannel.kind === 'unresolved'
				? 'Choose where to publish this legacy draft.'
				: draftSourceIdentityPending
					? 'Wait for Earthly to restore the original Map before publishing this draft.'
					: undefined,
	})

	/**
	 * Callback for when a Blossom upload completes.
	 * Adds the blob reference to the store WITHOUT publishing.
	 * User must click "Publish" separately to publish the dataset.
	 */
	const handleBlobUploadComplete = useCallback(
		(result: { sha256: string; url: string; size: number }) => {
			const newRef = {
				id: crypto.randomUUID(),
				scope: 'collection' as const,
				url: result.url,
				sha256: result.sha256,
				size: result.size,
				mimeType: 'application/geo+json',
				status: 'ready' as const,
			}
			useEditorStore
				.getState()
				.setBlobReferences([...useEditorStore.getState().blobReferences, newRef])
		},
		[],
	)

	// Memoize the collection to prevent expensive recalculation on every render
	// Only compute when in edit mode to avoid unnecessary work
	const memoizedFeatureCollection = useMemo(() => {
		// Only compute when viewMode is 'edit' - this is when DatasetSizeIndicator is shown
		if (viewMode !== 'edit') return null
		return buildCollectionFromEditor()
	}, [buildCollectionFromEditor, viewMode])

	// Round H.5: the in-edit draft row in the Map Stack gets the usual row
	// actions' analogues. "Open editor panel" activates the validated retained
	// Dataset and writes its authoring route so mobile Resume survives reload.
	// "Zoom to edit" fits the draft geometry.
	// Edit-isolation reuses the row's Focus button (draft.isolated).
	const openDraftEditor = useCallback(
		async (workspaceId?: string): Promise<boolean> => {
			const initialState = useEditorStore.getState()
			const plan = resolveDraftEditorOpenPlan(initialState, workspaceId, isMobile)
			if (!plan) {
				toast.error(
					workspaceId
						? 'This Thread has no retained Map draft to open.'
						: 'No retained Map draft is available to open.',
				)
				return false
			}

			try {
				const retainedDraft = getRetainedDatasetSurfaceTarget(initialState, plan.workspaceId)?.draft
				if (
					plan.switchWorkspace ||
					initialState.activeGeoEditDraftId !== retainedDraft?.id ||
					initialState.pendingHydratedDraftId === retainedDraft?.id
				) {
					// Thread activation may switch only to the validated retained draft.
					await switchToWorkspace(plan.workspaceId)
				}

				const state = useEditorStore.getState()
				if (
					state.activeWorkspaceId !== plan.workspaceId ||
					(state.pendingHydratedDraftId != null &&
						state.pendingHydratedDraftId === state.activeGeoEditDraftId) ||
					!getRetainedDatasetSurfaceTarget(state, plan.workspaceId)
				) {
					toast.error('The Thread\u2019s Map draft could not be opened.')
					return false
				}

				const activated = state.activateMobileEntitySurface('dataset', {
					inspector: state.inspectionSubject != null,
					dataset: true,
					story: false,
					context: false,
					sighting: false,
					beacon: false,
				})
				if (!activated) return false
				ensureActiveDraftMapPresentation(useEditorStore.getState())

				if (!plan.navigateToEditRoute) {
					closeMobileSidebar()
					openMobilePanel('edit')
					setMobilePanelSnap('half')
				}
				const channel = getRetainedDatasetSurfaceTarget(state, plan.workspaceId)?.draft
					.publishChannel
				navigateToRoute(
					channel?.kind === 'private-group'
						? `/circle/${encodeURIComponent(channel.id)}/edit`
						: channel?.kind === 'field-session'
							? `/nearby/${encodeURIComponent(channel.id)}/edit`
							: '/edit',
					{ preserveThread: true },
				)
				return true
			} catch {
				toast.error('The Thread\u2019s Map draft could not be opened.')
				return false
			}
		},
		[closeMobileSidebar, isMobile, openMobilePanel, setMobilePanelSnap, switchToWorkspace],
	)

	useEffect(() => registerChatWorkspaceOpener(async (workspaceId) => {
		if (!await openDraftEditor(workspaceId)) throw new Error('This map draft could not be opened.')
	}), [openDraftEditor])
	useEffect(() => registerMapDraftActions({
		discard: handleDeleteDraft,
		view: async (workspaceId) => {
			if (!await openDraftEditor(workspaceId)) throw new Error('This map draft could not be opened.')
			const state = useEditorStore.getState()
			const draftId = state.workspaces[workspaceId]?.activeDraftId
			const features = draftId ? state.geoEditDrafts[draftId]?.features : null
			if (!features?.length) return
			const { bbox } = await import('@turf/turf')
			const bounds = bbox({ type: 'FeatureCollection', features })
			if (bounds.length === 4 && bounds.every(Number.isFinite)) handleZoomToBounds(bounds as [number, number, number, number])
		},
	}), [handleDeleteDraft, openDraftEditor, handleZoomToBounds])

	const zoomToDraft = useCallback(async () => {
		const drawn = (features ?? []).filter((feature) => feature.geometry !== null)
		if (drawn.length === 0) {
			if (activeDataset) zoomToDataset(activeDataset)
			return
		}
		try {
			const turf = await import('@turf/turf')
			const bbox = turf.bbox({ type: 'FeatureCollection', features: drawn })
			if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((v) => Number.isFinite(v))) {
				handleZoomToBounds(bbox as [number, number, number, number])
			}
		} catch {
			// bbox calc failed — keep the current camera.
		}
	}, [features, activeDataset, zoomToDataset, handleZoomToBounds])

	const {
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleOpenDebug,
	} = useViewMode({
		geoEvents: mapGeoEvents,
		onEnsureInfoPanelVisible: ensureInfoPanelVisible,
		onNavigateToFocus: navigateToEntityFocus,
		onClearRouteFocus: clearFocus,
	})

	// Store focus state
	const focusedType = useEditorStore((state) => state.focusedType)

	// Round C: sidebar filter is sidebar-only (no longer affects map visibility,
	// since visibility = stack membership). Setter is kept so the sidebar can
	// still receive filter callbacks without churn; the value is intentionally
	// unused here.
	const [_filteredDatasetKeys, setFilteredDatasetKeys] = useState<Set<string> | null>(null)
	const handleFilteredDatasetKeysChange = useCallback((keys: Set<string> | null) => {
		setFilteredDatasetKeys(keys ? new Set(keys) : null)
	}, [])

	// Mobile does not always render the datasets panel immediately; avoid getting stuck with stale/empty
	// filter state from a previous desktop session.
	useEffect(() => {
		if (isMobile) {
			setFilteredDatasetKeys(null)
		}
	}, [isMobile])

	const activeContextScope = useMemo(() => {
		if (!contextCoordinate) return null
		return (
			mapContextEvents.find((context) => getContextCoordinate(context) === contextCoordinate) ??
			null
		)
	}, [contextCoordinate, mapContextEvents])

	// Round C: activeContextScopeLabel and toolbarFocusLabel were used by the
	// removed toolbar chips. The MapStackPanel surface now carries the same
	// information via per-row "Isolated" indicators + the header subtitle.
	// Keep the upstream context-scope and focus state as-is — they still
	// drive sidebar/info-panel and routing behaviour — just stop computing
	// the toolbar-specific labels.

	const destinationContextCoordinate =
		authoringPublishChannel.kind === 'public'
			? activeDraftPublishChannel
				? (activeDatasetContextRefs[0] ?? null)
				: (contextCoordinate ?? null)
			: null
	const destinationContext = useMemo(
		() =>
			destinationContextCoordinate
				? (mapContextEvents.find(
						(context) => getContextCoordinate(context) === destinationContextCoordinate,
					) ?? null)
				: null,
		[destinationContextCoordinate, mapContextEvents],
	)
	const destinationContextNaddr = useMemo(() => {
		if (destinationContext) return encodeContextNaddr(destinationContext)
		if (!destinationContextCoordinate) return null
		const [kindValue, pubkey, ...identifierParts] = destinationContextCoordinate.split(':')
		const identifier = identifierParts.join(':')
		const kind = Number.parseInt(kindValue ?? '', 10)
		if (!Number.isFinite(kind) || !pubkey || !identifier) return null
		try {
			return nip19.naddrEncode({ kind, pubkey, identifier })
		} catch {
			return null
		}
	}, [destinationContext, destinationContextCoordinate, encodeContextNaddr])
	const currentDestination = useMemo(() => {
		if (authoringPublishChannel.kind === 'unresolved') {
			return resolveAuthoringDestination({
				publishChannel: 'unresolved',
				reason: authoringPublishChannel.reason,
				canLeave: true,
			})
		}
		if (authoringPublishChannel.kind === 'private-group') {
			return resolveAuthoringDestination({
				publishChannel: 'private-group',
				group: {
					id: authoringPublishChannel.id,
					label: authoringPrivateWorkspace?.metadata?.name,
					availability: authoringPrivateWorkspace ? 'available' : 'unavailable',
				},
				canLeave: true,
			})
		}
		if (authoringPublishChannel.kind === 'field-session') {
			return resolveAuthoringDestination({
				publishChannel: 'field-session',
				session: {
					id: authoringPublishChannel.id,
					label: authoringFieldSession?.name,
					availability: authoringFieldSessionWritable ? 'available' : 'unavailable',
				},
				canLeave: true,
			})
		}

		return resolveAuthoringDestination({
			publishChannel: 'public',
			context: destinationContextCoordinate
				? {
						id: destinationContextCoordinate,
						label: `${
							destinationContext?.context.name ||
							destinationContext?.contextId ||
							destinationContext?.dTag ||
							'Unnamed Atlas'
						}${activeDatasetContextRefs.length > 1 ? ` +${activeDatasetContextRefs.length - 1}` : ''}`,
						availability: destinationContext ? 'available' : 'unavailable',
					}
				: null,
			canLeave: Boolean(destinationContextCoordinate),
		})
	}, [
		authoringPublishChannel,
		authoringPrivateWorkspace,
		authoringFieldSession,
		authoringFieldSessionWritable,
		destinationContextCoordinate,
		destinationContext,
		activeDatasetContextRefs.length,
	])
	const selectedAudienceId = publishChannelOptionId(authoringPublishChannel)
	const publishAudienceOptions = useMemo<PublishAudienceOption[]>(() => {
		if (!activeDraftPublishChannel || mapAuthoringIntent === 'propose') return []
		const options = localDraftDestinationOptions.map((option) => ({ ...option }))
		if (
			selectedAudienceId &&
			!options.some((option) => option.id === selectedAudienceId) &&
			authoringPublishChannel.kind !== 'unresolved'
		) {
			options.push({
				id: selectedAudienceId,
				label: currentDestination.label,
				publishChannel: authoringPublishChannel,
			})
		}
		return options
	}, [
		activeDraftPublishChannel,
		authoringPublishChannel,
		currentDestination.label,
		localDraftDestinationOptions,
		selectedAudienceId,
		mapAuthoringIntent,
	])
	const handleAudienceChange = useCallback(
		(publishChannel: PublishChannel) => {
			const state = useEditorStore.getState()
			const draftId = state.activeGeoEditDraftId
			if (!draftId || !state.geoEditDrafts[draftId]) return
			if (
				state.geoEditDrafts[draftId]?.authoringIntent === 'propose' ||
				mapAuthoringIntent === 'propose'
			) {
				toast.error(
					'A proposal stays with the original Map. Start a fork to choose another audience.',
				)
				return
			}
			state.saveGeoEditDraft(draftId, { publishChannel })
			syncRouteToDraftChannel(publishChannel)
			const optionId = publishChannelOptionId(publishChannel)
			const option = localDraftDestinationOptions.find((candidate) => candidate.id === optionId)
			toast.success('Audience updated', {
				description: option ? `This working copy is now for ${option.label}.` : undefined,
			})
		},
		[localDraftDestinationOptions, syncRouteToDraftChannel, mapAuthoringIntent],
	)

	const openCurrentDestination = useCallback(() => {
		if (currentDestination.kind === 'unresolved') {
			navigateToUnscopedView('drafts')
			if (isMobile) selectMobileSidebarDestination('drafts')
			return
		}
		if (currentDestination.kind === 'private-group') {
			navigateToPrivateGroup(currentDestination.target.id)
			if (isMobile) selectMobileSidebarDestination('private-groups')
			return
		}
		if (currentDestination.kind === 'field-session') {
			navigateToFieldSession(currentDestination.target.id)
			if (isMobile) selectMobileSidebarDestination('field-sessions')
			return
		}
		if (currentDestination.kind === 'public-context' && destinationContextNaddr) {
			navigateToContext(destinationContextNaddr, 'contexts')
			if (isMobile) selectMobileSidebarDestination('contexts')
			return
		}
		navigateToView('contexts')
		if (isMobile) selectMobileSidebarDestination('contexts')
	}, [
		currentDestination,
		destinationContextNaddr,
		isMobile,
		navigateToContext,
		navigateToFieldSession,
		navigateToPrivateGroup,
		navigateToUnscopedView,
		navigateToView,
		selectMobileSidebarDestination,
	])

	const leaveCurrentDestination = useCallback(() => {
		if (
			currentDestination.kind === 'private-group' ||
			currentDestination.kind === 'field-session' ||
			currentDestination.kind === 'unresolved'
		) {
			if (activeDraftPublishChannel) {
				tearDownEditSession()
				toast.success('Draft retained in Local drafts')
			}
			navigateToUnscopedView('datasets')
			if (isMobile) {
				closeMobileSidebar()
				setMobilePanelOpen(false)
			}
			return
		}

		if (currentDestination.kind === 'public-context') {
			setActiveDatasetContextRefs([])
			if (contextNaddr) clearContextScope()
			if (focusedType === 'mapcontext') clearFocus()
		}
	}, [
		activeDraftPublishChannel,
		clearContextScope,
		clearFocus,
		closeMobileSidebar,
		contextNaddr,
		currentDestination,
		focusedType,
		isMobile,
		navigateToUnscopedView,
		setActiveDatasetContextRefs,
		setMobilePanelOpen,
		tearDownEditSession,
	])

	// Note: `focusedDataset` was only ever read by the now-removed toolbar focus
	// label. The focus state itself still drives routing + sidebar — see
	// `focusedType` read below — but the dataset resolution
	// is no longer needed in this scope.

	// Scope and inspection are separate verbs. A focused/inspected Context owns
	// only the read panel; only `/context/:naddr` scope may filter catalogs/map
	// data, reset scope defaults, or seed a new Dataset's context references.
	const mapFilterContext = activeContextScope
	const mapFilterContextCoordinate = useMemo(() => {
		if (activeContextScope && contextCoordinate) return contextCoordinate
		if (!mapFilterContext) return null
		return getContextCoordinate(mapFilterContext)
	}, [activeContextScope, contextCoordinate, mapFilterContext])

	const resolvedActiveContextScope = useMemo(
		() =>
			resolveContextMapScope(mapFilterContext, geoEvents, mapContextEvents, contextMapScopeMode),
		[mapFilterContext, geoEvents, mapContextEvents, contextMapScopeMode],
	)
	const activeContextDatasets = useMemo(
		() => resolvedActiveContextScope.datasets.map((entry) => entry.dataset),
		[resolvedActiveContextScope],
	)
	const mapStackStats = useMemo(() => {
		const entries = mapStackOrder
			.map((entryId) => mapStackEntries[entryId])
			.filter((entry): entry is MapStackEntry => Boolean(entry))
		return {
			total: entries.length,
			visible: entries.filter((entry) => entry.visible).length,
		}
	}, [mapStackEntries, mapStackOrder])

	const validationModeForActiveContext = contextFilterMode === 'off' ? 'warn' : contextFilterMode

	const activeContextValidationByDatasetKey = useMemo(() => {
		const map = new Map<string, ReturnType<typeof validateDatasetForContext>>()
		if (!mapFilterContext || !mapFilterContextCoordinate) return map
		if (mapFilterContext.context.contextUse === 'taxonomy') return map

		activeContextDatasets.forEach((event) => {
			const collection = resolvedCollectionResolver(event) ?? event.featureCollection
			map.set(
				getDatasetKey(event),
				validateDatasetForContext(
					event,
					mapFilterContext,
					collection,
					validationModeForActiveContext,
				),
			)
		})

		return map
	}, [
		mapFilterContext,
		mapFilterContextCoordinate,
		activeContextDatasets,
		resolvedCollectionResolver,
		getDatasetKey,
		validationModeForActiveContext,
	])

	const scopedGeoEvents = useMemo(() => {
		if (!mapFilterContext || !mapFilterContextCoordinate) return mapGeoEvents
		if (mapFilterContext.context.contextUse === 'taxonomy') {
			return activeContextDatasets
		}
		return activeContextDatasets.filter((event) => {
			const key = getDatasetKey(event)
			const validation = activeContextValidationByDatasetKey.get(key)
			if (!validation) {
				return contextFilterMode !== 'strict'
			}
			return isDatasetAllowedByContextFilter(validation, contextFilterMode)
		})
	}, [
		mapFilterContext,
		mapFilterContextCoordinate,
		activeContextDatasets,
		activeContextValidationByDatasetKey,
		getDatasetKey,
		contextFilterMode,
		mapGeoEvents,
	])

	// Stack = visibility. Under the Round C/D invariant, the map renders exactly
	// what's on the map stack — no scope filters, no focus filter, no separate
	// edit-isolation toggle. The active draft replaces its published source even
	// when a stacked Context also curates that source. The other override is
	// map-stack isolation (Round B):
	// when one entry is isolated only its keys render. Draft entries don't
	// contribute keys, so an isolated draft naturally produces []. Context
	// entries (C.2) expand to their curated datasets, minus any keys the user
	// has unchecked in the inline expand panel (`entry.exclusions`).
	const visibleGeoEvents = useMemo(() => {
		const sourceIsReplacedByDraft = (event: GeoDataset) =>
			draftGeometryVisible && activeDatasetKey !== null && getDatasetKey(event) === activeDatasetKey
		const contextByKey = new Map<string, MapContext>()
		for (const ctx of mapContextEvents) {
			const key = ctx.contextCoordinate ?? ctx.id ?? ctx.contextId ?? ctx.dTag
			if (key) contextByKey.set(key, ctx)
		}

		// Compute the curated dataset keys for a context entry, honouring its
		// exclusions. Cheap because the stack is typically a handful of entries.
		const curatedKeysFor = (entry: MapStackEntry): Set<string> => {
			const out = new Set<string>()
			const ctx = contextByKey.get(entry.entityKey)
			if (!ctx) return out
			const scope = resolveContextMapScope(
				ctx,
				geoEvents,
				mapContextEvents,
				getDefaultContextMapScopeMode(ctx),
			)
			const exclusionSet = new Set(entry.exclusions ?? [])
			for (const { dataset } of scope.datasets) {
				const key = getDatasetKey(dataset)
				if (!exclusionSet.has(key)) out.add(key)
			}
			return out
		}

		// Isolation: when one entry is isolated, only its keys render. Dataset
		// entries → the single key; context entries → the curated set minus
		// exclusions.
		const isolatedEntry = (() => {
			for (const entryId of mapStackOrder) {
				const entry = mapStackEntries[entryId]
				if (entry?.isolated) return entry
			}
			return null
		})()
		if (isolatedEntry) {
			const isolatedKeys =
				isolatedEntry.entityType === 'dataset'
					? new Set([isolatedEntry.entityKey])
					: curatedKeysFor(isolatedEntry)
			if (isolatedKeys.size === 0) return []
			return mapGeoEvents.filter(
				(event) => isolatedKeys.has(getDatasetKey(event)) && !sourceIsReplacedByDraft(event),
			)
		}

		// Round G.1: stack order is render order. Each dataset key gets the rank
		// of the first stack entry that contributes it; the filtered result is
		// sorted by rank so entries later in the panel render later (on top).
		const rankByKey = new Map<string, number>()
		let nextRank = 0
		for (const entryId of mapStackOrder) {
			const entry = mapStackEntries[entryId]
			if (!entry || entry.visible === false) continue
			if (entry.entityType === 'dataset') {
				if (!rankByKey.has(entry.entityKey)) rankByKey.set(entry.entityKey, nextRank++)
			} else if (entry.entityType === 'context') {
				for (const key of curatedKeysFor(entry)) {
					if (!rankByKey.has(key)) rankByKey.set(key, nextRank++)
				}
			}
		}
		if (rankByKey.size === 0) return []
		return mapGeoEvents
			.filter((event) => rankByKey.has(getDatasetKey(event)) && !sourceIsReplacedByDraft(event))
			.sort(
				(a, b) => (rankByKey.get(getDatasetKey(a)) ?? 0) - (rankByKey.get(getDatasetKey(b)) ?? 0),
			)
	}, [
		activeDatasetKey,
		draftGeometryVisible,
		geoEvents,
		getDatasetKey,
		mapContextEvents,
		mapGeoEvents,
		mapStackEntries,
		mapStackOrder,
	])
	const referenceMapRenderState = useMemo(
		() => deriveReferenceMapRenderState(mapStackOrder.map((entryId) => mapStackEntries[entryId])),
		[mapStackEntries, mapStackOrder],
	)
	const visibleCalloutDatasets = useMemo(() => {
		// Resolved collections live outside React; this counter invalidates the derived list.
		void resolvedCollectionsVersion
		return visibleGeoEvents.map((event) => {
			const key = getDatasetKey(event)
			const collection = resolvedCollectionResolver(event) ?? event.featureCollection
			const selector = referenceMapRenderState.datasetFeatureSelectors[key]
			return {
				key,
				collection:
					selector === undefined || selector === null
						? collection
						: {
								...collection,
								features: collection.features.filter((feature) =>
									featureMatchesReferenceSelector(feature, selector),
								),
							},
			}
		})
	}, [
		visibleGeoEvents,
		getDatasetKey,
		referenceMapRenderState,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
	])

	// Phase 13 (SPEC §3.2): sightings/beacons render from STACK MEMBERSHIP, not
	// unconditionally. These mirror `visibleGeoEvents` — an aggregate `*-layer`
	// entry seeds the full subscription set; individual `sighting`/`beacon` entries
	// union in one entity each; an isolated entry renders solo (deep-link-solo).
	// The pure derivation lives in `deriveVisibleEntitiesFromStack` (module scope,
	// unit-tested); `buildSightingSource`/`buildBeaconSource` keep their internal
	// `dropExpired` + freshest-per-{pubkey,d} de-dup on whatever set they receive.
	// entityKey resolution mirrors the map render/de-dup key: naddr with a dTag/id
	// fallback (the same key the deep-link handlers pin under, so an isolated route
	// entry resolves to exactly its own entity — T-13-03-FORCEISO).
	// Plan 13-06: individual sighting entries resolve against the discovery
	// subscription UNION the explicitly-added cache, so an out-of-subscription
	// sighting pinned via `addSightingToMapStack` still renders. `addedCacheTick`
	// forces re-derivation when the cache mutates. The FIRST arg (subscriptionSet /
	// aggregate seed) stays discovery-only — an added sighting never leaks into the
	// aggregate `sighting-layer`.
	// biome-ignore lint/correctness/useExhaustiveDependencies: addedCacheTick intentionally gates the ref-cache read.
	const sightingLookupSuperset = useMemo(() => {
		const added = Array.from(addedSightingCacheRef.current.values())
		return added.length ? [...sightings, ...added] : sightings
	}, [sightings, addedCacheTick])
	const visibleSightingsFromStack = useMemo(
		() =>
			deriveVisibleEntitiesFromStack(
				sightings,
				mapStackEntries,
				mapStackOrder,
				'sighting',
				'sighting-layer',
				getSightingMapStackKey,
				sightingLookupSuperset,
			),
		[sightings, mapStackEntries, mapStackOrder, sightingLookupSuperset],
	)
	// A /beacon/:naddr deep link may target a LINK-ONLY beacon, which is absent from
	// the `#t:['live']` discovery surface (`beacons` above). Decode the routed naddr
	// and fire a TARGETED {authors,#d} subscription so a logged-out viewer can open
	// it (account-free, D-11). Resolved up here (Phase 13, moved above useMapLayers)
	// so `visibleBeaconsFromStack` can resolve an isolated/pinned link-only beacon
	// against the discovery ∪ routed superset.
	const routedBeaconAddress = useMemo(() => {
		if (route.focusType !== 'beacon' || !route.naddr) return null
		try {
			const decoded = nip19.decode(route.naddr)
			if (decoded.type !== 'naddr' || decoded.data.kind !== LIVE_BEACON_KIND) return null
			return { pubkey: decoded.data.pubkey, identifier: decoded.data.identifier }
		} catch {
			return null
		}
	}, [route.focusType, route.naddr])
	const { events: routedBeacons } = useBeacons(
		routedBeaconAddress
			? [{ authors: [routedBeaconAddress.pubkey], '#d': [routedBeaconAddress.identifier] }]
			: [],
	)
	// Beacon individual/isolated stack entries resolve against discovery ∪ routed so
	// a link-only or deep-linked beacon (outside `#t:['live']`) still renders when
	// pinned/isolated. The AGGREGATE layer only ever seeds from `beacons` (discovery)
	// inside the helper — a link-only beacon never leaks into the layer
	// (T-13-03-GPSREGRESS).
	const beaconLookupSuperset = useMemo(
		() => (routedBeacons.length ? [...beacons, ...routedBeacons] : beacons),
		[beacons, routedBeacons],
	)
	// Plan 13-06: widen the beacon individual-lookup to (discovery ∪ routed) ∪ the
	// explicitly-added cache, so an own / link-only / faded-from-live beacon pinned via
	// `addBeaconToMapStack` resolves for the render gate AND the sweep. The aggregate
	// `beacon-layer` seed remains `beacons` (discovery only) inside the helper — a
	// cached beacon NEVER reaches the aggregate branch (T-13-06-01 privacy invariant).
	// biome-ignore lint/correctness/useExhaustiveDependencies: addedCacheTick intentionally gates the ref-cache read.
	const addedBeaconLookupSuperset = useMemo(() => {
		const added = Array.from(addedBeaconCacheRef.current.values())
		return added.length ? [...beaconLookupSuperset, ...added] : beaconLookupSuperset
	}, [beaconLookupSuperset, addedCacheTick])
	const visibleBeaconsFromStack = useMemo(
		() =>
			deriveVisibleEntitiesFromStack(
				beacons,
				mapStackEntries,
				mapStackOrder,
				'beacon',
				'beacon-layer',
				getBeaconMapStackKey,
				addedBeaconLookupSuperset,
			),
		[beacons, mapStackEntries, mapStackOrder, addedBeaconLookupSuperset],
	)

	// Phase 13 (D-02): pinned-entry expiry AUTO-REMOVE sweep (dropExpired parity).
	// An individual `sighting`/`beacon` stack entry whose resolved entity has passed
	// its NIP-40 expiration — or has dropped out of the (already dropExpired'd)
	// subscription entirely — has its stack entry removed, so "on the stack = visible"
	// stays honest and no ended tombstone row lingers (matches the Phase-12 beacon
	// honesty posture). Aggregate `*-layer` entries are NOT swept: they gate the whole
	// subscription, which self-drops expired entities inside buildSighting/BeaconSource.
	// Runs on the sighting/beacon subscription tick (the sets update on their own
	// expiry ticks — 60s sightings / 15s beacons — so this re-evaluates as they change).
	useEffect(() => {
		const now = unixNow()
		// Plan 13-06 (Task 2): build the sweep's per-kind lookup from the SAME widened
		// (cache-inclusive) sets the render gate uses, so a user-added out-of-discovery
		// entry resolves here and is judged on EXPIRY ALONE — not on discovery
		// membership. A faded-from-live-but-not-expired entry is therefore KEPT.
		const sightingByKey = new Map<string, TemporalSighting>()
		for (const s of sightingLookupSuperset) {
			const key = getSightingMapStackKey(s)
			if (key) sightingByKey.set(key, s)
		}
		const beaconByKey = new Map<string, LiveBeacon>()
		for (const b of addedBeaconLookupSuperset) {
			const key = getBeaconMapStackKey(b)
			if (key) beaconByKey.set(key, b)
		}
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (!entry) continue
			if (entry.entityType === 'sighting') {
				const resolved = sightingByKey.get(entry.entityKey)
				// Evict only when unresolvable (nothing to render) OR genuinely NIP-40
				// expired (D-02 honesty). STALE is NOT expiry — it never triggers here.
				if (
					shouldSweepStackEntry({
						resolved: !!resolved,
						expired: !!resolved && isExpired(resolved.event, now),
					})
				) {
					addedSightingCacheRef.current.delete(entry.entityKey)
					removeMapStackEntry(id)
				}
			} else if (entry.entityType === 'beacon') {
				const resolved = beaconByKey.get(entry.entityKey)
				if (
					shouldSweepStackEntry({
						resolved: !!resolved,
						expired: !!resolved && isExpired(resolved.event, now),
					})
				) {
					addedBeaconCacheRef.current.delete(entry.entityKey)
					removeMapStackEntry(id)
				}
			}
		}
	}, [
		sightingLookupSuperset,
		addedBeaconLookupSuperset,
		mapStackEntries,
		mapStackOrder,
		removeMapStackEntry,
	])

	// Round F.2: comment/annotation overlays follow the stack. A visible
	// comment overlay stays only while its root entity is still anchored —
	// either a context entry with the same coordinate, or a dataset that is
	// currently rendered (directly stacked or curated by a stacked context).
	// Without this, removing a context left its observations on the map.
	useEffect(() => {
		const stackedContextCoords = new Set<string>()
		for (const id of mapStackOrder) {
			const entry = mapStackEntries[id]
			if (entry?.entityType === 'context') stackedContextCoords.add(entry.entityKey)
		}
		const visibleDatasetKeys = new Set(visibleGeoEvents.map((event) => getDatasetKey(event)))
		pruneCommentGeometry((comment) => {
			const root = comment.rootAddress
			// Overlays without a parent coordinate aren't stack-managed — keep.
			if (!root) return true
			if (stackedContextCoords.has(root)) return true
			// rootAddress is `kind:pubkey:d`; dataset keys are `pubkey:d`.
			const parts = root.split(':')
			const datasetKey = parts.length >= 3 ? parts.slice(1).join(':') : root
			return visibleDatasetKeys.has(datasetKey)
		})
	}, [mapStackEntries, mapStackOrder, visibleGeoEvents, getDatasetKey, pruneCommentGeometry])

	const toolbarMapStackOpen = route.sidebarView === 'map-stack'
	const toggleToolbarMapStack = useCallback(() => {
		navigateToView(toolbarMapStackOpen ? 'datasets' : 'map-stack')
	}, [navigateToView, toolbarMapStackOpen])

	const lastContextCoordinateRef = useRef<string | null>(null)
	useEffect(() => {
		if (!mapFilterContext) {
			lastContextCoordinateRef.current = null
			setViewContextDatasets([])
			return
		}

		const coordinate = getContextCoordinate(mapFilterContext)
		setViewContextDatasets(activeContextDatasets)

		if (coordinate && lastContextCoordinateRef.current !== coordinate) {
			lastContextCoordinateRef.current = coordinate
			setContextFilterMode(defaultContextFilterMode(mapFilterContext))
			setContextMapScopeMode(getDefaultContextMapScopeMode(mapFilterContext))
		}
	}, [
		mapFilterContext,
		activeContextDatasets,
		setViewContextDatasets,
		setContextFilterMode,
		setContextMapScopeMode,
	])

	// Auto-attach scope context for fresh geometry creation only.
	useEffect(() => {
		if (activeDataset) return
		if (features.length > 0) return

		const canAutoAttachToContext = mapFilterContext?.context.allowForeignAttachments ?? false

		if (mapFilterContextCoordinate && canAutoAttachToContext) {
			if (
				activeDatasetContextRefs.length === 1 &&
				activeDatasetContextRefs[0] === mapFilterContextCoordinate
			) {
				return
			}
			setActiveDatasetContextRefs([mapFilterContextCoordinate])
			return
		}

		if (activeDatasetContextRefs.length > 0) {
			setActiveDatasetContextRefs([])
		}
	}, [
		activeDataset,
		features.length,
		mapFilterContextCoordinate,
		mapFilterContext?.context.allowForeignAttachments,
		activeDatasetContextRefs,
		setActiveDatasetContextRefs,
	])

	// Round D.3: visibility derives purely from stack membership. The sidebar
	// uses this map to highlight which catalog rows are "currently on the map"
	// — the answer is exactly "is this dataset in visibleGeoEvents?".
	const effectiveVisibility = useMemo(() => {
		const effectiveMap: Record<string, boolean> = {}
		const visibleKeys = new Set(visibleGeoEvents.map((e) => getDatasetKey(e)))
		geoEvents.forEach((event) => {
			const key = getDatasetKey(event)
			effectiveMap[key] = visibleKeys.has(key)
		})
		return effectiveMap
	}, [geoEvents, visibleGeoEvents, getDatasetKey])

	useEffect(() => {
		featuresRef.current = features
	}, [features])

	// Available features for $ mentions in comments
	// We want to allow mentioning any loaded dataset, not just visible ones
	const geoEventsForMentions = useMemo(() => {
		if (!viewingDataset) return mapGeoEvents
		if (mapGeoEvents.some((ev) => ev.id === viewingDataset.id)) return mapGeoEvents
		return [...mapGeoEvents, viewingDataset]
	}, [mapGeoEvents, viewingDataset])

	const availableFeatures = useAvailableGeoFeatures(
		geoEventsForMentions,
		resolvedCollectionResolver,
		mapContextEvents,
	)

	// Keep the viewport focused on the most recently loaded geometry after map source swaps.
	// We wait for the style to load because setStyle clears sources/layers and they are re-added on events.
	useEffect(() => {
		if (!map.current) return
		const mapInstance = map.current
		void mapSourceKey

		let cancelled = false

		const zoomToCurrentGeometry = async () => {
			if (cancelled) return
			const currentFeatures = (featuresRef.current ?? []).filter(
				(
					feature,
				): feature is EditorFeature & { geometry: NonNullable<EditorFeature['geometry']> } =>
					feature.geometry !== null,
			)
			if (currentFeatures.length === 0) {
				if (activeDataset) zoomToDataset(activeDataset)
				return
			}

			try {
				const turf = await import('@turf/turf')
				const bbox = turf.bbox({
					type: 'FeatureCollection',
					features: currentFeatures,
				})
				if (!Array.isArray(bbox) || bbox.length !== 4) return
				const [west, south, east, north] = bbox
				if (![west, south, east, north].every((v) => Number.isFinite(v))) return
				mapInstance.fitBounds(
					[
						[west, south],
						[east, north],
					],
					{ padding: 60, duration: 450 },
				)
			} catch {
				// If bbox calc fails, keep current camera.
			}
		}

		const handleStyleLoad = () => {
			zoomToCurrentGeometry().catch(() => undefined)
		}

		mapInstance.once('style.load', handleStyleLoad)
		// Fallback: if style.load doesn't fire for a given change, still attempt once.
		const timeoutId = window.setTimeout(() => {
			zoomToCurrentGeometry().catch(() => undefined)
		}, 0)

		return () => {
			cancelled = true
			window.clearTimeout(timeoutId)
			try {
				mapInstance.off('style.load', handleStyleLoad)
			} catch {
				// Map may have been removed
			}
		}
	}, [mapSourceKey, activeDataset, zoomToDataset])

	// Round D.3: the "sync default visibility on geoEvents change" effect
	// is gone — visibility is no longer a separate sticky map. Stack
	// membership is the canonical signal; events that aren't on the stack
	// simply aren't rendered, regardless of how many datasets land in the
	// subscription. This drops O(geoEvents) work on every relay update too.

	// Initialize platform chrome. Mobile starts map-first with both transient
	// surfaces closed; route restoration may still open the appropriate one.
	useEffect(() => {
		if (isMobile) {
			setShowToolbar(false)
			setShowTips(false)
		} else {
			setShowDatasetsPanel(true)
			setShowInfoPanel(true)
			setShowToolbar(true)
			setShowTips(true)
		}
	}, [isMobile, setShowTips, setShowDatasetsPanel, setShowInfoPanel])

	// Handle pmtiles URL param on app load
	const setMapSource = useEditorStore((state) => state.setMapSource)
	useEffect(() => {
		const url = new URL(window.location.href)
		const pmtilesUrl = url.searchParams.get('pmtiles')
		if (pmtilesUrl) {
			setMapSource({
				type: 'pmtiles',
				location: 'remote',
				url: pmtilesUrl,
			})
		}
	}, [setMapSource])

	// Lock document scrolling on mobile to prevent address bar jitter during map gestures.
	useEffect(() => {
		if (!isMobile) return
		const root = document.documentElement
		const body = document.body
		const previous = {
			rootOverflow: root.style.overflow,
			rootOverscroll: root.style.overscrollBehavior,
			bodyOverflow: body.style.overflow,
			bodyOverscroll: body.style.overscrollBehavior,
		}

		root.style.overflow = 'hidden'
		root.style.overscrollBehavior = 'none'
		body.style.overflow = 'hidden'
		body.style.overscrollBehavior = 'none'

		return () => {
			root.style.overflow = previous.rootOverflow
			root.style.overscrollBehavior = previous.rootOverscroll
			body.style.overflow = previous.bodyOverflow
			body.style.overscrollBehavior = previous.bodyOverscroll
		}
	}, [isMobile])

	// Preload blob references for datasets
	useBlobResolution({
		geoEvents,
		ensureResolvedFeatureCollection,
		isMountedRef,
		onResolved: useCallback(() => setResolvedCollectionsVersion((v) => v + 1), []),
	})

	// Handle paste GeoJSON
	const handlePaste = useCallback(
		async (e: ClipboardEvent) => {
			if (!editor) return
			const target = e.target
			if (
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				(target instanceof HTMLElement && target.isContentEditable)
			) {
				return
			}
			const text = e.clipboardData?.getData('text/plain')
			const candidate = getGeoJsonPasteCandidate(text)
			if (!candidate) return

			try {
				const json = JSON.parse(candidate)
				const collection = ensureFeatureCollection(json)
				const newFeatures = collection.features.map((f) => {
					// Ensure ID is a string
					const featureId = f.id != null ? String(f.id) : crypto.randomUUID()

					// Extract known properties, rest go to customProperties
					const { name, description, meta, featureId: _, ...restProperties } = f.properties || {}

					return {
						...f,
						id: featureId,
						properties: {
							name: name ?? f.properties?.name,
							description: description ?? f.properties?.description,
							meta: 'feature',
							featureId,
							customProperties: Object.keys(restProperties).length > 0 ? restProperties : undefined,
						},
					}
				})
				// INFRA-02 / D-08: route geometry writes through the Authoring API — the
				// only caller of editor.addFeature/setFeatures. Append (dedup-by-id).
				createAuthoring(editor).writeGeoJSON(newFeatures as EditorFeature[], { replace: false })
			} catch (error) {
				console.error('Failed to paste GeoJSON:', error)
			}
		},
		[editor],
	)

	useEffect(() => {
		document.addEventListener('paste', handlePaste)
		return () => {
			document.removeEventListener('paste', handlePaste)
		}
	}, [handlePaste])

	// Dataset actions
	const handleDatasetSelect = (event: GeoDataset, options?: DatasetEditOptions) => {
		handleLoadDatasetForEditing(event, options)
	}

	const handleProposalAccepted = useCallback(
		(dataset: GeoDataset) => {
			setViewModeState('view')
			setViewDatasetState(dataset)
		},
		[setViewModeState, setViewDatasetState],
	)

	const getContextKey = useCallback((context: MapContext): string => {
		return context.contextId ?? context.dTag ?? context.id ?? ''
	}, [])

	const handleClear = useCallback(() => {
		if (!editor) return
		const all = editor.getAllFeatures()
		editor.deleteFeatures(all.map((f) => f.id))
		setSelectedFeatureIds([])
	}, [editor, setSelectedFeatureIds])

	const onDeleteDataset = useCallback(
		async (event: GeoDataset) => {
			const key = getDatasetKey(event)
			setDeletingKey(key)
			try {
				await handleDeleteDataset(event, tearDownEditSession)
			} finally {
				setDeletingKey(null)
			}
		},
		[getDatasetKey, handleDeleteDataset, tearDownEditSession],
	)

	const onDeleteContext = useCallback(
		async (context: MapContext) => {
			if (!accounts.signer) {
				toast.error('No active account.')
				return
			}

			const contextId = getContextKey(context)
			if (!contextId) {
				toast.error('Atlas is missing a d tag and cannot be deleted.')
				return
			}

			const targetCoordinate = context.contextCoordinate
			setDeletingKey(`context:${contextId}`)
			try {
				const signer = accounts.signer
				if (!signer) throw new Error('No active account')
				await deleteMapContext(context.event, signer)
				if (targetCoordinate) removeMapStackEntry(`context:${targetCoordinate}`)

				const viewedContext = useEditorStore.getState().viewContext
				const viewedContextId = viewedContext ? getContextKey(viewedContext) : null
				if (viewedContextId === contextId) {
					exitViewMode()
				}
				if (targetCoordinate && contextCoordinate === targetCoordinate) {
					clearContextScope()
				}

				toast.success(`Deleted "${context.context.name || context.contextId || 'Atlas'}".`)
			} catch (error) {
				console.error('Failed to delete context', error)
				toast.error('Failed to delete Atlas. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[getContextKey, exitViewMode, clearContextScope, contextCoordinate, removeMapStackEntry],
	)

	// Export/Import
	const exportGeoJSON = useCallback(() => {
		const geojson = buildCollectionFromEditor()
		if (!geojson) return

		const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = 'features.geojson'
		a.click()
		URL.revokeObjectURL(url)
	}, [buildCollectionFromEditor])

	const exportSHP = useCallback(async () => {
		const collection = buildCollectionFromEditor()
		if (!collection) return

		try {
			const { blob, skippedCount, downloadName } = await exportShapefile(collection, 'features')
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = downloadName
			a.click()
			URL.revokeObjectURL(url)

			if (skippedCount > 0) {
				toast.warning(`Exported SHP ZIP. Skipped ${skippedCount} unsupported feature(s).`)
			} else {
				toast.success('Exported SHP ZIP.')
			}
		} catch (error) {
			console.error('Failed to export SHP:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to export SHP.')
		}
	}, [buildCollectionFromEditor])

	const handleImport = useCallback(
		async (file: File) => {
			if (!editor) return

			const extension = file.name.split('.').pop()?.toLowerCase()
			try {
				let collection: GeoJSON.FeatureCollection
				let importSource = 'geojson'

				if (extension === 'zip' || extension === 'shp') {
					collection = await importShapefile(file)
					importSource = 'shapefile'
				} else if (extension === 'geojson' || extension === 'json') {
					const json = JSON.parse(await file.text())
					collection = ensureFeatureCollection(json)
				} else {
					toast.error('Unsupported import format. Use GeoJSON, zipped SHP, or .shp.')
					return
				}

				const newFeatures = collection.features.map((feature) =>
					toEditorFeature(feature, importSource),
				)

				// INFRA-02 / D-08: route through the Authoring API (preserves importSource
				// already on the normalized features; append with dedup-by-id).
				createAuthoring(editor).writeGeoJSON(newFeatures as EditorFeature[], { replace: false })

				const meta = extractCollectionMeta(collection)
				if (!meta.name) {
					meta.name = file.name.replace(/\.[^.]+$/, '')
				}
				if (meta) setCollectionMeta(meta)
				toast.success(`Imported ${newFeatures.length} feature(s) from ${file.name}.`)
			} catch (e) {
				console.error('Failed to import file:', e)
				toast.error(e instanceof Error ? e.message : 'Failed to import file.')
			}
		},
		[editor, setCollectionMeta],
	)

	// OSM Query hook
	const { handleOsmQueryClick, handleOsmQueryView, handleOsmImport, clearOsmQuery } = useOsmQuery(
		map,
		editor,
	)

	// Context editor hooks
	const {
		contextEditorMode,
		editingContext,
		contextCreationSeed,
		handleLoadDatasetForEditing,
		handleInspectContext,
		handleCreateContext,
		handleEditContext,
		handleSaveContext,
		handleCloseContextEditor,
		handleOpenGeometryEditor,
		handleInspectDatasetWithModeSwitch,
	} = useContextEditor({
		isMobile,
		ensureInfoPanelVisible,
		encodeContextNaddr,
		navigateTo,
		navigateToView,
		clearFocus,
		loadDatasetForEditing: loadDatasetForCurrentChannel,
		startNewDataset,
		switchToWorkspace: handleSwitchWorkspace,
		handleInspectDataset,
	})

	// Story editor hooks (Phase 10, D-01/D-02/D-03).
	const encodeStoryNaddr = useCallback((story: Article): string | null => {
		const identifier = story.dTag
		if (!identifier || !story.pubkey) return null
		try {
			return nip19.naddrEncode({
				kind: ARTICLE_KIND,
				pubkey: story.pubkey,
				identifier,
			})
		} catch {
			return null
		}
	}, [])

	// Sighting naddr encoder — resolves a /sighting/:naddr deep link to the cast so
	// the focus-route effect can open it (Phase 11, Plan 04 / D-08).
	const encodeSightingNaddr = useCallback(
		(sighting: TemporalSighting): string | null => encodeSightingNaddrPure(sighting),
		[],
	)

	// Beacon naddr encoder — resolves a /beacon/:naddr deep link to its cast. The
	// naddr carries the THROWAWAY pubkey (the beacon is not under the user's profile,
	// D-05/D-11).
	const encodeBeaconNaddr = useCallback(
		(beacon: LiveBeacon): string | null => encodeBeaconNaddrPure(beacon),
		[],
	)

	const {
		storyEditorMode,
		storyEditorRevealNonce,
		editingStory,
		handleInspectStory,
		handleCreateStory,
		handleEditStory,
		handleSaveStory,
		handleCloseStoryEditor,
	} = useStoryEditor({
		isMobile,
		ensureInfoPanelVisible,
		encodeStoryNaddr,
		navigateTo: navigateToEntityFocus,
		navigateToView,
		clearFocus,
	})

	// Creating a Story also moves to the Stories route. Route reconciliation owns
	// mobile catalog restoration, so reassert the retained authoring surface after
	// that route settles instead of allowing the catalog drawer to cover the editor.
	const consumedStoryRevealNonceRef = useRef(0)
	useEffect(() => {
		if (!isMobile || storyEditorMode === 'none') {
			consumedStoryRevealNonceRef.current = storyEditorRevealNonce
			return
		}
		if (
			!storyEditorRevealNonce ||
			consumedStoryRevealNonceRef.current === storyEditorRevealNonce ||
			route.sidebarView !== 'stories' ||
			(storyEditorMode === 'create'
				? route.focusType !== 'none'
				: !(
						route.focusType === 'story' &&
						route.edit &&
						editingStory &&
						encodeStoryNaddr(editingStory) === route.naddr
					))
		)
			return
		consumedStoryRevealNonceRef.current = storyEditorRevealNonce
		const state = useEditorStore.getState()
		state.selectMobileEntitySurface('story')
		state.openMobilePanel('edit')
	}, [
		isMobile,
		route.sidebarView,
		route.focusType,
		route.edit,
		route.naddr,
		storyEditorMode,
		storyEditorRevealNonce,
		editingStory,
		encodeStoryNaddr,
	])

	// Retaining a draft (including an AI write) does not select its editor. Only
	// the mounted authoring surface can claim the main presentation; returning to
	// that surface also works without changing the current Atlas/Map route.
	const [foregroundStoryEditor, setForegroundStoryEditor] = useState<{
		owner: 'desktop' | 'mobile'
		draftKey: string
		account: string | null
	} | null>(null)
	const handleDesktopStoryEditorActiveChange = useCallback(
		(draftKey: string, active: boolean) => {
			setForegroundStoryEditor((current) =>
				active
					? { owner: 'desktop', draftKey, account: currentUserPubkey ?? null }
					: current?.owner === 'desktop' && current.draftKey === draftKey
						? null
						: current,
			)
		},
		[currentUserPubkey],
	)
	const handleMobileStoryEditorActiveChange = useCallback(
		(draftKey: string, active: boolean) => {
			setForegroundStoryEditor((current) =>
				active
					? { owner: 'mobile', draftKey, account: currentUserPubkey ?? null }
					: current?.owner === 'mobile' && current.draftKey === draftKey
						? null
						: current,
			)
		},
		[currentUserPubkey],
	)
	const selectedStoryDraftKey = useSyncExternalStore(subscribeStoryEditorOpenRequests, () => getStoryEditorTarget()?.draftKey ?? null, () => null)
	const retainedStoryDraftKey =
		storyEditorMode !== 'none' ? (selectedStoryDraftKey ?? editingStory?.dTag ?? 'new-story') : null
	const storyAuthoringKey =
		foregroundStoryEditor?.draftKey === retainedStoryDraftKey &&
		foregroundStoryEditor.account === (currentUserPubkey ?? null) &&
		foregroundStoryEditor.owner === (isMobile ? 'mobile' : 'desktop')
			? retainedStoryDraftKey
			: null

	// A Story's authored presentation, inline views, and route-local `on=` Maps
	// share one exact-source runtime on the main canvas. The ordinary map renderer
	// remains active for every source not claimed by this composition.
	const presentationStory =
		storyAuthoringKey !== null ? editingStory : route.focusType === 'story' ? viewStory : null
	const presentationAuthor =
		storyAuthoringKey !== null ? (currentUserPubkey ?? undefined) : presentationStory?.pubkey
	const presentationCarrierId = useMemo(
		() =>
			storyAuthoringKey !== null
				? `draft-story:${currentUserPubkey ?? 'anonymous'}:${editingStory?.pubkey ?? ''}:${storyAuthoringKey}`
				: presentationStory
					? storyPresentationCarrier(presentationStory)
					: null,
		[currentUserPubkey, editingStory?.pubkey, presentationStory, storyAuthoringKey],
	)
	const presentationRevisionId =
		storyAuthoringKey !== null ? presentationCarrierId : presentationStory?.id
	const routedLensAtlas = useMemo(
		() =>
			contextCoordinate
				? (groups.find((group) => group.groupCoordinate === contextCoordinate) ?? null)
				: null,
		[contextCoordinate, groups],
	)
	// Story presentation is the foreground narrative whenever one is open. The
	// Atlas lens remains visible as route context, but its canonical layers do not
	// compete with the Story's authored composition.
	const presentationAtlas = presentationCarrierId ? null : routedLensAtlas
	const atlasPresentationCarrierId = presentationAtlas?.groupCoordinate ?? null
	const { isMentionVisible, presentationAuthorization: publishedStoryAuthorization } =
		useStoryMapRefs(presentationStory)
	const storedStoryPresentation = useMemo(
		() =>
			presentationStory
				? getArticleMapPresentation(presentationStory.event)
				: ABSENT_MAP_PRESENTATION,
		[presentationStory],
	)
	const baseStoryPresentation = useMemo(
		() =>
			getUsableMapPresentation(storedStoryPresentation) ??
			buildFallbackStoryPresentation(presentationStory?.article.content),
		[presentationStory?.article.content, storedStoryPresentation],
	)
	const storedAtlasPresentation = useMemo(
		() =>
			presentationAtlas
				? getGroupMapPresentation(presentationAtlas.rawEvent())
				: ABSENT_MAP_PRESENTATION,
		[presentationAtlas],
	)
	const atlasPresentationAuthorization = useMemo(
		() => deriveAtlasPresentationAuthorization(presentationAtlas?.referencedAddresses ?? []),
		[presentationAtlas],
	)
	const [activeStoryView, setActiveStoryView] = useState<{
		carrierId: string
		storyEventId: string
		snapshot: StoryViewSnapshotV1
		index: number
		revision: number
		draftContext?: StoryViewDraftContext
	} | null>(null)
	const activeDraftContext =
		activeStoryView?.carrierId === presentationCarrierId &&
		activeStoryView.storyEventId === presentationRevisionId
			? activeStoryView.draftContext
			: undefined
	const storyPresentationAuthorization = useMemo(
		() =>
			activeDraftContext
				? deriveStoryPresentationAuthorization(activeDraftContext.body)
				: publishedStoryAuthorization,
		[activeDraftContext, publishedStoryAuthorization],
	)
	const [presentationVisibilityOverrides, setPresentationVisibilityOverrides] = useState<
		Readonly<Record<string, boolean>>
	>({})
	const presentationResetKey = `${presentationCarrierId ?? ''}:${presentationRevisionId ?? ''}:${atlasPresentationCarrierId ?? ''}:${presentationAtlas?.id ?? ''}`
	useEffect(() => {
		void presentationResetKey
		setActiveStoryView(null)
		setPresentationVisibilityOverrides({})
	}, [presentationResetKey])

	const effectiveStoryState = useMemo<EffectiveStoryViewStateV1>(() => {
		if (
			activeStoryView &&
			presentationCarrierId &&
			activeStoryView.carrierId === presentationCarrierId &&
			activeStoryView.storyEventId === presentationRevisionId
		) {
			return activeStoryView.snapshot.state
		}
		return Object.freeze({
			...(baseStoryPresentation.initialView ? { camera: baseStoryPresentation.initialView } : {}),
			layers: baseStoryPresentation.layers,
		})
	}, [activeStoryView, baseStoryPresentation, presentationCarrierId, presentationRevisionId])

	const parsedAmbientOn = useMemo(() => parseAmbientOn((route.on ?? []).join(',')), [route.on])
	const resolvedAmbientOn = useMemo(
		() =>
			resolveAmbientOn(
				parsedAmbientOn,
				geoEvents
					.map(getPresentationDatasetSource)
					.filter((source): source is MapPresentationSource => Boolean(source)),
			),
		[geoEvents, parsedAmbientOn],
	)
	const visibleWholeMapSources = useMemo(() => {
		const sources: MapPresentationSource[] = []
		const seen = new Set<MapPresentationSource>()
		for (const event of visibleGeoEvents) {
			const selector = referenceMapRenderState.datasetFeatureSelectors[getDatasetKey(event)]
			if (Array.isArray(selector)) continue
			const source = getPresentationDatasetSource(event)
			if (!source || seen.has(source)) continue
			seen.add(source)
			sources.push(source)
		}
		return Object.freeze(sources)
	}, [getDatasetKey, referenceMapRenderState.datasetFeatureSelectors, visibleGeoEvents])
	const effectiveAmbientSources = useMemo(() => {
		const sources: MapPresentationSource[] = []
		const seen = new Set<MapPresentationSource>()
		for (const source of [...resolvedAmbientOn.sources, ...visibleWholeMapSources]) {
			if (seen.has(source)) continue
			seen.add(source)
			sources.push(source)
		}
		return Object.freeze(sources)
	}, [resolvedAmbientOn.sources, visibleWholeMapSources])
	const selectiveShelfLayers = useMemo<readonly MapPresentationLayerV1[]>(() => {
		const layers: MapPresentationLayerV1[] = []
		for (const event of visibleGeoEvents) {
			const featureIds = referenceMapRenderState.datasetFeatureSelectors[getDatasetKey(event)]
			if (!Array.isArray(featureIds)) continue
			const source = getPresentationDatasetSource(event)
			if (!source) continue
			layers.push(
				Object.freeze({
					id: `shelf-feature-${layers.length + 1}`,
					source,
					featureIds: Object.freeze([...featureIds]),
					visible: true,
					opacityMultiplier: 1,
				}),
			)
		}
		return Object.freeze(layers)
	}, [getDatasetKey, referenceMapRenderState.datasetFeatureSelectors, visibleGeoEvents])
	const authorizedStoryLayerIds = useMemo(
		() =>
			new Set(
				effectiveStoryState.layers
					.filter(
						(layer) =>
							authorizePresentationLayer(layer, storyPresentationAuthorization).status ===
							'authorized',
					)
					.map((layer) => layer.id),
			),
		[effectiveStoryState.layers, storyPresentationAuthorization],
	)
	const composedStoryLayers = useMemo<readonly MapPresentationLayerV1[]>(() => {
		if (!presentationCarrierId) return Object.freeze([])
		// Authorization is evaluated before ambient Shelf grants are added. Otherwise
		// a route-local whole-map overlay could accidentally bless an unauthorized
		// authored selector that happens to target the same source.
		const authorizedBaseLayers = effectiveStoryState.layers.filter((layer) =>
			authorizedStoryLayerIds.has(layer.id),
		)
		const ambient = applyAmbientSourcesToLayers(authorizedBaseLayers, effectiveAmbientSources)
		const usedIds = new Set(ambient.layers.map((layer) => layer.id))
		const appended = selectiveShelfLayers.map((layer, index) => {
			let id = layer.id
			let suffix = index + 1
			while (usedIds.has(id)) {
				suffix += 1
				id = `shelf-feature-${suffix}`
			}
			usedIds.add(id)
			return id === layer.id ? layer : Object.freeze({ ...layer, id })
		})
		return Object.freeze(
			[...ambient.layers, ...appended].map((layer) => {
				const visible = presentationVisibilityOverrides[layer.id]
				return visible === undefined ? layer : Object.freeze({ ...layer, visible })
			}),
		)
	}, [
		effectiveAmbientSources,
		effectiveStoryState.layers,
		presentationCarrierId,
		presentationVisibilityOverrides,
		selectiveShelfLayers,
		authorizedStoryLayerIds,
	])
	const runtimeStoryPresentation = useMemo<MapPresentationParseResult>(
		() =>
			presentationCarrierId
				? Object.freeze({
						status: 'valid' as const,
						value: Object.freeze({
							version: MAP_PRESENTATION_VERSION,
							...(effectiveStoryState.camera ? { initialView: effectiveStoryState.camera } : {}),
							layers: composedStoryLayers,
						}),
						issues: storedStoryPresentation.issues,
					})
				: ABSENT_MAP_PRESENTATION,
		[
			composedStoryLayers,
			effectiveStoryState.camera,
			presentationCarrierId,
			storedStoryPresentation,
		],
	)
	const runtimeStoryAuthorization = useMemo<MapPresentationAuthorization>(() => {
		const authorization = new Map<MapPresentationSource, PresentationSourceAuthorization>(
			storyPresentationAuthorization,
		)
		for (const source of effectiveAmbientSources) {
			authorization.set(source, Object.freeze({ source, scope: 'whole' as const }))
		}
		for (const layer of selectiveShelfLayers) {
			const previous = authorization.get(layer.source)
			if (previous?.scope === 'whole') continue
			const featureIds = [
				...(previous?.scope === 'features' ? previous.featureIds : []),
				...(layer.featureIds ?? []),
			]
			authorization.set(
				layer.source,
				Object.freeze({
					source: layer.source,
					scope: 'features' as const,
					featureIds: Object.freeze([...new Set(featureIds)]),
				}),
			)
		}
		return authorization
	}, [effectiveAmbientSources, selectiveShelfLayers, storyPresentationAuthorization])
	const storyPresentationRuntime = usePresentationSources({
		presentation: runtimeStoryPresentation,
		authorization: runtimeStoryAuthorization,
	})
	const usableStoredAtlasPresentation = useMemo(
		() => getUsableMapPresentation(storedAtlasPresentation),
		[storedAtlasPresentation],
	)
	const canonicalAtlasLayerIds = useMemo(() => {
		if (!usableStoredAtlasPresentation) return new Set<string>()
		return new Set(
			usableStoredAtlasPresentation.layers
				.filter(
					(layer) =>
						authorizePresentationLayer(layer, atlasPresentationAuthorization).status ===
						'authorized',
				)
				.map((layer) => layer.id),
		)
	}, [atlasPresentationAuthorization, usableStoredAtlasPresentation])
	const runtimeAtlasPresentation = useMemo<MapPresentationParseResult>(() => {
		if (!presentationAtlas) return ABSENT_MAP_PRESENTATION
		// A missing, malformed, or future default view falls back to the Atlas's
		// owner-curated lane. This is route-local rendering only: it neither rewrites
		// the stored value nor attributes the fallback styling to the Atlas author.
		const baseLayers = usableStoredAtlasPresentation
			? usableStoredAtlasPresentation.layers
			: buildFallbackAtlasPresentation(presentationAtlas.referencedAddresses).layers
		return Object.freeze({
			status: 'valid' as const,
			value: Object.freeze({
				version: MAP_PRESENTATION_VERSION,
				...(usableStoredAtlasPresentation?.initialView
					? { initialView: usableStoredAtlasPresentation.initialView }
					: {}),
				layers: Object.freeze(
					baseLayers.map((layer) => {
						const visible = presentationVisibilityOverrides[layer.id]
						return visible === undefined ? layer : Object.freeze({ ...layer, visible })
					}),
				),
			}),
			issues: storedAtlasPresentation.issues,
		})
	}, [
		presentationAtlas,
		presentationVisibilityOverrides,
		storedAtlasPresentation.issues,
		usableStoredAtlasPresentation,
	])
	const authorizedAtlasLayerIds = useMemo(() => {
		const presentation = getUsableMapPresentation(runtimeAtlasPresentation)
		if (!presentation) return new Set<string>()
		return new Set(
			presentation.layers
				.filter(
					(layer) =>
						authorizePresentationLayer(layer, atlasPresentationAuthorization).status ===
						'authorized',
				)
				.map((layer) => layer.id),
		)
	}, [atlasPresentationAuthorization, runtimeAtlasPresentation])
	const atlasPresentationRuntime = usePresentationSources({
		presentation: runtimeAtlasPresentation,
		authorization: atlasPresentationAuthorization,
	})
	const usableRuntimeAtlasPresentation = useMemo(
		() => getUsableMapPresentation(runtimeAtlasPresentation),
		[runtimeAtlasPresentation],
	)
	const mapInteractionGeoEventsRef = useRef<GeoDataset[]>([])
	mapInteractionGeoEventsRef.current = [
		...geoEventsRef.current,
		...[...storyPresentationRuntime.sourceEvents, ...atlasPresentationRuntime.sourceEvents].filter(
			(event, index, sourceEvents) =>
				!geoEventsRef.current.some((existing) => existing.id === event.id) &&
				sourceEvents.findIndex((candidate) => candidate.id === event.id) === index,
		),
	]
	const storyPresentationLayers = useMemo(
		() =>
			presentationCarrierId
				? presentationMaterializationInputs(
						presentationCarrierId,
						presentationAuthor,
						storyPresentationRuntime.layers,
						authorizedStoryLayerIds,
					)
				: Object.freeze([]),
		[
			authorizedStoryLayerIds,
			presentationCarrierId,
			presentationAuthor,
			storyPresentationRuntime.layers,
		],
	)
	const atlasPresentationLayers = useMemo(
		() =>
			atlasPresentationCarrierId
				? presentationMaterializationInputs(
						atlasPresentationCarrierId,
						presentationAtlas?.pubkey,
						atlasPresentationRuntime.layers.filter((resolution) =>
							authorizedAtlasLayerIds.has(resolution.layer.id),
						),
						canonicalAtlasLayerIds,
					)
				: Object.freeze([]),
		[
			atlasPresentationCarrierId,
			atlasPresentationRuntime.layers,
			authorizedAtlasLayerIds,
			canonicalAtlasLayerIds,
			presentationAtlas?.pubkey,
		],
	)
	const activePresentationLayers = useMemo(
		() => Object.freeze([...storyPresentationLayers, ...atlasPresentationLayers]),
		[atlasPresentationLayers, storyPresentationLayers],
	)
	const presentationClaimedSources = useMemo(
		() =>
			new Set([
				...composedStoryLayers.map((layer) => layer.source),
				...(usableRuntimeAtlasPresentation?.layers ?? [])
					.filter((layer) => authorizedAtlasLayerIds.has(layer.id))
					.map((layer) => layer.source),
			]),
		[authorizedAtlasLayerIds, composedStoryLayers, usableRuntimeAtlasPresentation?.layers],
	)
	const ordinaryVisibleGeoEvents = useMemo(
		() =>
			presentationClaimedSources.size > 0
				? visibleGeoEvents.filter((event) => {
						const source = getPresentationDatasetSource(event)
						return !source || !presentationClaimedSources.has(source)
					})
				: visibleGeoEvents,
		[presentationClaimedSources, visibleGeoEvents],
	)

	// Existing authored/remote layers stay intact; only sources rendered by the
	// Story runtime are withheld to prevent duplicate whole-Map rendering.
	const { remoteLayersReady, CLUSTERED_SOURCE_ID } = useMapLayers({
		mapRef: map,
		mounted,
		visibleGeoEvents: ordinaryVisibleGeoEvents,
		visibleSightings: visibleSightingsFromStack,
		visibleBeacons: visibleBeaconsFromStack,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
		datasetFeatureSelectors: referenceMapRenderState.datasetFeatureSelectors,
		coordinateReferences: referenceMapRenderState.coordinates,
	})
	const { ready: presentationLayersReady, interactiveLayerIds: presentationLayerIds } =
		usePresentationMapLayers({
			mapRef: map,
			mounted,
			layers: activePresentationLayers,
		})
	const presentationFitFeatureCollection = useMemo(
		() => presentationFitCollection(activePresentationLayers),
		[activePresentationLayers],
	)
	usePresentationCamera({
		mapRef: map,
		mounted,
		intent:
			presentationCarrierId &&
			(storyAuthoringKey === null || activeDraftContext || presentationStory)
				? {
						carrierId: presentationCarrierId,
						intentId: activeStoryView
							? `view:${activeStoryView.snapshot.view.id}:${activeStoryView.revision}`
							: `opening:${presentationRevisionId}`,
						...(effectiveStoryState.camera
							? { camera: effectiveStoryState.camera }
							: { fitFeatureCollection: presentationFitFeatureCollection }),
					}
				: presentationAtlas && atlasPresentationCarrierId
					? {
							carrierId: atlasPresentationCarrierId,
							intentId: `opening:${presentationAtlas.id}`,
							...(usableRuntimeAtlasPresentation?.initialView
								? {
										camera: usableRuntimeAtlasPresentation.initialView,
									}
								: { fitFeatureCollection: presentationFitFeatureCollection }),
						}
					: null,
	})

	const handleStoryViewActivate = useCallback(
		(snapshot: StoryViewSnapshotV1, index: number, draftContext?: StoryViewDraftContext) => {
			if (snapshot.view.display === 'figure') return
			if (!presentationCarrierId || !presentationRevisionId) return
			if (draftContext && draftContext.draftKey !== storyAuthoringKey) return
			setPresentationVisibilityOverrides({})
			setActiveStoryView((current) => ({
				carrierId: presentationCarrierId,
				storyEventId: presentationRevisionId,
				snapshot,
				index,
				revision: (current?.revision ?? 0) + 1,
				...(draftContext ? { draftContext } : {}),
			}))
		},
		[presentationCarrierId, presentationRevisionId, storyAuthoringKey],
	)
	const handleStoryViewPreviewReset = useCallback((draftKey: string) => {
		setActiveStoryView((current) => (current?.draftContext?.draftKey === draftKey ? null : current))
	}, [])
	const captureMapPresentation = useCallback(
		(
			accepted?: readonly MapPresentationSource[] | MapPresentationAuthorization,
		): MapPresentationV1 | null => {
			const mapInstance = map.current
			if (!mapInstance) return null
			const center = mapInstance.getCenter()
			const initialView = {
				center: [center.lng, center.lat] as const,
				zoom: mapInstance.getZoom(),
				bearing: mapInstance.getBearing(),
				pitch: mapInstance.getPitch(),
			}
			const authorization: MapPresentationAuthorization | null =
				accepted && !Array.isArray(accepted) ? (accepted as MapPresentationAuthorization) : null
			const acceptedSources = Array.isArray(accepted)
				? new Set<MapPresentationSource>(accepted)
				: null
			const captureOrdinaryLayers = (events: readonly GeoDataset[]) =>
				events.flatMap((event, index): readonly MapPresentationLayerV1[] => {
					const source = getPresentationDatasetSource(event)
					if (!source) return []
					const selector = referenceMapRenderState.datasetFeatureSelectors[getDatasetKey(event)]
					return [
						Object.freeze({
							id: `captured-${index + 1}`,
							source,
							...(Array.isArray(selector) ? { featureIds: Object.freeze([...selector]) } : {}),
							visible: true,
							opacityMultiplier: 1,
						}),
					]
				})
			const sourceLayers: readonly MapPresentationLayerV1[] = presentationCarrierId
				? composedStoryLayers
				: presentationAtlas && usableRuntimeAtlasPresentation
					? [
							...usableRuntimeAtlasPresentation.layers.filter((layer) =>
								authorizedAtlasLayerIds.has(layer.id),
							),
							...captureOrdinaryLayers(ordinaryVisibleGeoEvents),
						]
					: captureOrdinaryLayers(visibleGeoEvents)
			const layers = sourceLayers.flatMap((layer, index) => {
				if (!layer.visible) return []
				if (acceptedSources && !acceptedSources.has(layer.source)) return []
				const grant = authorization?.get(layer.source)
				if (authorization && !grant) return []
				let featureIds = layer.featureIds
				if (grant?.scope === 'features') {
					const allowed = new Set(grant.featureIds)
					const authorizedFeatureIds = featureIds
						? featureIds.filter((featureId) => allowed.has(featureId))
						: grant.featureIds
					if (authorizedFeatureIds.length === 0) return []
					featureIds = authorizedFeatureIds
				}
				return [
					Object.freeze({
						...layer,
						id: `captured-${index + 1}`,
						...(featureIds !== undefined ? { featureIds: Object.freeze([...featureIds]) } : {}),
					}),
				]
			})
			return Object.freeze({
				version: MAP_PRESENTATION_VERSION,
				initialView: Object.freeze(initialView),
				layers: Object.freeze(layers),
			})
		},
		[
			authorizedAtlasLayerIds,
			composedStoryLayers,
			getDatasetKey,
			ordinaryVisibleGeoEvents,
			presentationAtlas,
			presentationCarrierId,
			referenceMapRenderState.datasetFeatureSelectors,
			usableRuntimeAtlasPresentation,
			visibleGeoEvents,
		],
	)
	const captureStoryView = useCallback(() => {
		const mapInstance = map.current
		if (!mapInstance) return null
		const center = mapInstance.getCenter()
		const layers = Object.fromEntries(
			effectiveStoryState.layers.map((layer) => [
				layer.id,
				{
					visible: presentationVisibilityOverrides[layer.id] ?? layer.visible,
					opacityMultiplier: layer.opacityMultiplier,
					...(layer.style ? { style: layer.style } : {}),
				},
			]),
		)
		return {
			camera: {
				center: [center.lng, center.lat] as const,
				zoom: mapInstance.getZoom(),
				bearing: mapInstance.getBearing(),
				pitch: mapInstance.getPitch(),
			},
			...(Object.keys(layers).length > 0 ? { layers } : {}),
		}
	}, [effectiveStoryState.layers, presentationVisibilityOverrides])
	const renderStoryViewFigure = useCallback(
		(snapshot: StoryViewSnapshotV1, _index: number, draftContext?: StoryViewDraftContext) =>
			draftContext && presentationCarrierId ? (
				<DraftStoryPresentationFigure
					carrierId={presentationCarrierId}
					presentationAuthor={presentationAuthor}
					snapshot={snapshot}
					context={draftContext}
				/>
			) : presentationStory && presentationCarrierId ? (
				<StoryPresentationFigure
					carrierId={presentationCarrierId}
					presentationAuthor={presentationAuthor}
					snapshot={snapshot}
					resolved={storyPresentationRuntime.layers}
				/>
			) : null,
		[presentationCarrierId, presentationAuthor, presentationStory, storyPresentationRuntime.layers],
	)

	const handleDiscoverOpenChange = useCallback((open: boolean) => {
		discoverOpenedAutomaticallyRef.current = false
		setDiscoverOpen(open)
		if (!open) markDiscoverWelcomeSeen(getDiscoverWelcomeStorage())
	}, [])

	const handleOpenDiscover = useCallback(() => {
		discoverOpenedAutomaticallyRef.current = false
		setDiscoverOpen(true)
	}, [])

	const handleSelectDiscoveryItem = useCallback(
		(kind: DiscoveryItemKind, id: string) => {
			if (kind === 'dataset') {
				const dataset = recentDiscoveryDatasets.find((event) => event.id === id)
				if (!dataset) return
				addDatasetToMapStack(dataset, 'manual')
				handleInspectDatasetWithModeSwitch(dataset)
				zoomToDataset(dataset)
				return
			}
			if (kind === 'story') {
				const story = recentDiscoveryStories.find((event) => event.id === id)
				if (story) handleInspectStory(story)
				return
			}
			const context = recentDiscoveryContexts.find((event) => event.id === id)
			if (context) handleInspectContext(context)
		},
		[
			addDatasetToMapStack,
			handleInspectContext,
			handleInspectDatasetWithModeSwitch,
			handleInspectStory,
			recentDiscoveryContexts,
			recentDiscoveryDatasets,
			recentDiscoveryStories,
			zoomToDataset,
		],
	)

	const handleBrowseDiscoverSightings = useCallback(() => {
		const state = useEditorStore.getState()
		if (
			!state.mapStackOrder.some((id) => state.mapStackEntries[id]?.entityType === 'sighting-layer')
		) {
			addMapStackEntry({
				entityType: 'sighting-layer',
				entityKey: 'all',
				title: 'All sightings',
				source: 'manual',
				visible: true,
				pinned: false,
			})
		}
		navigateToUnscopedView('sightings')
		if (isMobile) selectMobileSidebarDestination('sightings')
	}, [addMapStackEntry, isMobile, navigateToUnscopedView, selectMobileSidebarDestination])

	const handleCreateDiscoverPrivateGroup = useCallback(() => {
		navigateToUnscopedView('private-groups')
		if (isMobile) selectMobileSidebarDestination('private-groups')
	}, [isMobile, navigateToUnscopedView, selectMobileSidebarDestination])

	const handleGetEarthlyApp = useCallback(() => {
		window.open(EARTHLY_ZAPSTORE_URL, '_blank', 'noopener,noreferrer')
	}, [])

	const handleTakeDiscoverTour = useCallback(() => {
		window.requestAnimationFrame(() => startTour())
	}, [startTour])

	const handleDeleteStory = useCallback(
		async (story: Article) => {
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account.')
				return
			}
			const storyKey = story.dTag ?? story.id
			if (!storyKey) {
				toast.error('Story is missing a d tag and cannot be deleted.')
				return
			}
			setDeletingKey(`story:${storyKey}`)
			try {
				await deleteStory(story.event, signer)
				const viewedStory = useEditorStore.getState().viewStory
				const viewedKey = viewedStory ? (viewedStory.dTag ?? viewedStory.id) : null
				if (viewedKey === storyKey) {
					exitViewMode()
				}
				toast.success(`Deleted "${story.article.title || 'story'}".`)
			} catch (error) {
				console.error('Failed to delete story', error)
				toast.error('Failed to delete story. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[exitViewMode],
	)

	// ── Temporal Sighting create/edit + map-first pin-drop (Phase 11, D-01/D-02/D-07) ──
	// A ref mirror of `placementArmed` so the editor 'create' listener (registered
	// once) reads the latest armed state without re-subscribing.
	const armSightingPlacement = useCallback(() => {
		sightingPlacementArmedRef.current = true
		// Map-first pin-drop: a single touch tap must place the point even with pan
		// lock off (otherwise touch taps in draw mode are ignored — the tap never
		// drops the pin on mobile). A drag still pans the map.
		editor?.setTouchTapDrawEnabled(true)
		editor?.setTransientDrawingVisible(true)
		editor?.setInteractionEnabled(true)
		editor?.setMode('draw_point')
	}, [editor])
	const disarmSightingPlacement = useCallback(() => {
		sightingPlacementArmedRef.current = false
		editor?.setTouchTapDrawEnabled(false)
		editor?.setTransientDrawingVisible(false)
		editor?.setInteractionEnabled(false)
		// Return the editor to a non-drawing idle mode.
		if (editor && editor.getMode() !== 'select') editor.setMode('select')
	}, [editor])

	const {
		sightingEditorMode,
		editingSighting,
		viewSighting,
		lastInspectedSightingKey,
		sightingFocusCommentId,
		placedGeometry: placedSightingGeometry,
		placementArmed: sightingPlacementArmed,
		rearmPlacement: rearmSightingPlacement,
		clearSightingEditorModes,
		clearSightingView,
		handleInspectSighting,
		handleCreateSighting,
		handleGeometryPlaced,
		cancelPlacement: cancelSightingPlacement,
		handleEditSighting,
		handleSaveSighting,
		handleCloseSightingEditor,
	} = useSightingEditor({
		isMobile,
		ensureInfoPanelVisible,
		navigateToView,
		navigateTo: navigateToEphemeralInspectFocus,
		encodeSightingNaddr,
		clearFocus,
		armPlacement: armSightingPlacement,
		disarmPlacement: disarmSightingPlacement,
	})

	// Keep the ref in sync with the hook's armed state (covers cancel/escape paths).
	useEffect(() => {
		sightingPlacementArmedRef.current = sightingPlacementArmed
	}, [sightingPlacementArmed])

	// Publishing swaps the active draft row for a saved Dataset row. While Dataset
	// authoring is active, the invariant repair above keeps this materialization
	// visible; outside authoring, no stale editor geometry remains behind.
	useEffect(() => {
		editor?.setGeometryVisible(draftGeometryVisible)
		editor?.setTransientDrawingVisible(sightingPlacementArmed)
	}, [draftGeometryVisible, editor, sightingPlacementArmed])

	// The responsive shell can become interactive a moment before the GeoEditor
	// instance finishes mounting. If Sighting creation is armed during that gap,
	// `armSightingPlacement` cannot set a mode yet and the visible map prompt would
	// otherwise accept taps that do nothing. Reconcile the late editor with the
	// already-armed lifecycle state as soon as it exists.
	useEffect(() => {
		if (!editor || !sightingPlacementArmed || (isMobile && mobileEntitySurface !== 'sighting')) {
			return
		}
		sightingPlacementArmedRef.current = true
		editor.setTouchTapDrawEnabled(true)
		editor.setTransientDrawingVisible(true)
		editor.setInteractionEnabled(true)
		if (editor.getMode() !== 'draw_point') editor.setMode('draw_point')
	}, [editor, isMobile, mobileEntitySurface, sightingPlacementArmed])

	// Intercept the GeoEditor 'create' event ONLY while a Sighting placement is
	// armed: capture the placed feature's geometry, open the editor with it, and
	// remove the transient point from the editor's feature set (it isn't a dataset
	// feature — it becomes the Sighting's content.geometry).
	useEffect(() => {
		if (!editor) return
		const handleCreate = (event: EditorEvent) => {
			if (!sightingPlacementArmedRef.current) return
			const feature = event.features?.[0]
			if (!feature?.geometry) return
			if (
				feature.geometry.type !== 'Point' &&
				feature.geometry.type !== 'LineString' &&
				feature.geometry.type !== 'Polygon'
			) {
				return
			}
			sightingPlacementArmedRef.current = false
			handleGeometryPlaced(feature.geometry)
			// Drop the transient draw feature so it doesn't pollute the dataset draft.
			try {
				if (feature.id) editor.deleteFeature(feature.id)
			} catch {
				// best-effort cleanup
			}
		}
		editor.on('create', handleCreate)
		return () => {
			editor.off('create', handleCreate)
		}
	}, [editor, handleGeometryPlaced])

	// Esc cancels an armed placement (D-01 keyboard alternative).
	useEffect(() => {
		if (!sightingPlacementArmed) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') cancelSightingPlacement()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [sightingPlacementArmed, cancelSightingPlacement])

	const handleDeleteSighting = useCallback(
		async (sighting: TemporalSighting) => {
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account.')
				return
			}
			const sightingKey = sighting.dTag ?? sighting.id
			if (!sightingKey) {
				toast.error('Sighting is missing a d tag and cannot be deleted.')
				return
			}
			setDeletingKey(`sighting:${sightingKey}`)
			try {
				await deleteSighting(sighting.event, signer)
				if (viewSighting && (viewSighting.dTag ?? viewSighting.id) === sightingKey) {
					clearSightingEditorModes()
					exitViewMode()
				}
				toast.success(`Deleted "${sighting.sighting.title || 'sighting'}".`)
			} catch (error) {
				console.error('Failed to delete sighting', error)
				toast.error('Failed to delete sighting. Check console for details.')
			} finally {
				setDeletingKey(null)
			}
		},
		[exitViewMode, viewSighting, clearSightingEditorModes],
	)

	// Switch the armed create flow to an area draw (D-02 "Draw an area instead").
	const handleDrawSightingArea = useCallback(() => {
		rearmSightingPlacement()
		sightingPlacementArmedRef.current = true
		editor?.setTouchTapDrawEnabled(true)
		editor?.setTransientDrawingVisible(true)
		editor?.setInteractionEnabled(true)
		editor?.setMode('draw_polygon')
	}, [editor, rearmSightingPlacement])

	// ── Live Beacon Start/Stop/Adjust/inspect (Phase 12, BEACON-01..04, D-12) ──
	// The controller binds the Plan-03 useBeaconPublisher (the live watch loop +
	// throwaway signer) to the UI: the control panel, the read view, the Beacons
	// rail handlers, and the always-on RunningBeaconBanner mounted over the map.
	// No pin-drop — a beacon's position comes from GPS.
	const {
		isLive: beaconIsLive,
		subState: beaconSubState,
		session: beaconSession,
		beaconControlMode,
		adjustingBeacon,
		viewBeacon,
		lastInspectedBeaconKey,
		beaconFocusCommentId,
		handleShareLocation,
		handleStartBeacon,
		handleStopBeacon,
		handleAdjustBeacon,
		handleInspectBeacon,
		handleCloseBeaconControl,
		clearBeaconView,
	} = useBeaconController({
		ensureInfoPanelVisible,
		navigateToView,
		navigateTo: navigateToEphemeralInspectFocus,
		encodeBeaconNaddr,
		clearFocus,
	})

	// Follow mode: while on, keep the map centered on the VIEWED beacon as new
	// positions arrive; auto-off on a manual pan so the user never fights the camera.
	const [followingBeaconKey, setFollowingBeaconKey] = useState<string | null>(null)
	const viewBeaconKey = viewBeacon ? (viewBeacon.dTag ?? viewBeacon.id) : null
	const isFollowingBeacon = !!followingBeaconKey && followingBeaconKey === viewBeaconKey
	const toggleFollowBeacon = useCallback(() => {
		setFollowingBeaconKey((current) =>
			current && current === viewBeaconKey ? null : viewBeaconKey,
		)
	}, [viewBeaconKey])
	// Drop follow when the viewed beacon changes or the detail closes.
	useEffect(() => {
		if (followingBeaconKey && followingBeaconKey !== viewBeaconKey) setFollowingBeaconKey(null)
	}, [followingBeaconKey, viewBeaconKey])
	// Freshest position for the followed beacon (updates live through useBeacons).
	const followedBeaconCoords = useMemo(() => {
		if (!followingBeaconKey) return null
		const match = [...beacons, ...routedBeacons].find(
			(b) => (b.dTag ?? b.id) === followingBeaconKey,
		)
		const geometry = match?.geometry
		if (geometry?.type !== 'Point') return null
		return geometry.coordinates as [number, number]
	}, [followingBeaconKey, beacons, routedBeacons])
	// Recenter on each new position. easeTo does NOT emit 'dragstart', so it never
	// trips the manual-pan auto-off below.
	useEffect(() => {
		if (!followingBeaconKey || !followedBeaconCoords || !map.current) return
		map.current.easeTo({ center: followedBeaconCoords, duration: 600 })
	}, [followingBeaconKey, followedBeaconCoords])

	// Entity handlers own mobile surfacing at the moment of explicit user intent.
	// Do not infer navigation from an editor becoming ready: Story/Context writes
	// may finish in the background while the user is following a Chat run, and a
	// readiness effect would steal that surface.

	// Sighting pin-drop is map-first: when placement arms (create mode, no geometry
	// yet), drop the sheet to peek so the whole map is reachable for dropping the
	// pin. When the pin lands (armed → placed), lift the form to Half + the Editor
	// tab. This is handled here (not via the generic rise-on-ready effect above)
	// because placement completing may not be a rising edge of `mobileEntityEditorReady`
	// if another entity editor was already open — so the placement transition must
	// drive the rise directly. Fires only on the arm/land transitions.
	const sightingPlacementActive = sightingEditorMode === 'create' && placedSightingGeometry == null
	const prevSightingPlacementRef = useRef(false)
	useEffect(() => {
		if (!isMobile) {
			prevSightingPlacementRef.current = sightingPlacementActive
			return
		}
		const wasActive = prevSightingPlacementRef.current
		prevSightingPlacementRef.current = sightingPlacementActive
		if (!wasActive && sightingPlacementActive) {
			setMobilePanelOpen(false)
		} else if (wasActive && !sightingPlacementActive && placedSightingGeometry != null) {
			openMobilePanel('edit')
			setMobilePanelSnap('half')
		}
	}, [
		isMobile,
		sightingPlacementActive,
		placedSightingGeometry,
		openMobilePanel,
		setMobilePanelOpen,
		setMobilePanelSnap,
	])
	// Auto-off on user pan (drag). Programmatic recenters use easeTo, not drag.
	useEffect(() => {
		const m = map.current
		if (!mounted || !m) return
		const stopFollow = () => setFollowingBeaconKey(null)
		m.on('dragstart', stopFollow)
		return () => {
			m.off('dragstart', stopFollow)
		}
	}, [mounted])

	// Phase 13 (SPEC §3.5): the `66a155e` side-channel that fed the viewed/routed/own
	// beacon into the map layer via a merged extras state is DELETED. A deep-linked or
	// viewed beacon now renders because the route/inspect flow puts it on the Map
	// Stack (isolated for a deep link), and `visibleBeaconsFromStack` resolves it
	// against the discovery ∪ routed superset. No merge state, no sync effect.

	// The running banner's countdown reads the user's own live beacon's NIP-40
	// expiration. The publisher session carries the `d`; resolve the matching live
	// cast from the subscription to read its expiry (the freshest own-beacon).
	const ownLiveBeacon = useMemo<LiveBeacon | null>(() => {
		if (!beaconSession || !currentUserPubkey) return null
		const sessionPubkey = beaconSession.sk ? undefined : currentUserPubkey
		return (
			beacons.find(
				(b) =>
					b.dTag === beaconSession.d && (sessionPubkey === undefined || b.pubkey === sessionPubkey),
			) ?? null
		)
	}, [beacons, beaconSession, currentUserPubkey])

	const beaconBannerCountdown = useMemo(() => {
		if (!ownLiveBeacon?.expiresAt) return null
		return formatExpiryCountdown(ownLiveBeacon.expiresAt, Math.floor(Date.now() / 1000))
	}, [ownLiveBeacon])

	// Phase 13 (13-uat, finding A): AUTO-ADD the sharer's OWN live beacon to the Map
	// Stack the first time it appears, so the creator never has to click "Add to map
	// stack" after Start. A link-only own beacon has no `#t:live`, so without this it
	// isn't a stack entry and doesn't render (visibleBeaconsFromStack resolves only
	// discovery ∪ explicit stack entries). We route through addBeaconToMapStack (NOT a
	// raw addMapStackEntry) so the resolved beacon is deposited into addedBeaconCacheRef
	// — that's what lets a link-only own beacon render WITHOUT leaking it into `#t:live`
	// discovery (preserving the T-13-06-01 / T-13-03-GPSREGRESS privacy invariant).
	// Source 'own' is non-toasting (the user didn't click) and non-isolating (doesn't
	// suppress other entries). Keyed once per beacon identity via the stable `d` tag
	// (preserved across 30s heartbeats), so this fires ONCE per session, not per fix.
	const autoAddedOwnBeaconKeyRef = useRef<string | null>(null)
	useEffect(() => {
		if (!ownLiveBeacon) {
			// Stop / expiry: reset so a later new beacon session re-adds.
			autoAddedOwnBeaconKeyRef.current = null
			return
		}
		const key = getBeaconMapStackKey(ownLiveBeacon)
		if (!key || autoAddedOwnBeaconKeyRef.current === key) return
		autoAddedOwnBeaconKeyRef.current = key
		addBeaconToMapStack(ownLiveBeacon, 'own')
	}, [ownLiveBeacon, addBeaconToMapStack])

	// Handle initial route on page load (direct URL navigation)
	useEffect(() => {
		const routeKey =
			route.focusType !== 'none' && route.naddr ? `${route.focusType}:${route.naddr}` : null
		if (!routeKey) {
			focusHandledRef.current = null
			inAppDatasetInspectRouteRef.current = null
			inAppEphemeralInspectRouteRef.current = null
			return
		}
		if (
			inAppEphemeralInspectRouteRef.current &&
			inAppEphemeralInspectRouteRef.current !== routeKey
		) {
			// A different navigation won before the intended entity resolved. Forget
			// the obsolete marker so a later real landing on that key is never skipped.
			inAppEphemeralInspectRouteRef.current = null
		}

		// Skip if no focus route (just sidebar view change)
		// If there's a specific focus route (e.g. /datasets/geoevent/...), handle zoom
		if (route.focusType === 'none' || !route.naddr) return
		// Wait for data to be available
		if (
			geoEvents.length === 0 &&
			mapContextEvents.length === 0 &&
			stories.length === 0 &&
			sightings.length === 0 &&
			beacons.length === 0 &&
			routedBeacons.length === 0
		)
			return

		// Decode the routed naddr ONCE and match by address fields. A shared
		// naddr may carry relay-hint TLVs (other clients, share sheets, chat
		// mentions) — string-comparing it against our locally-encoded bare
		// naddr silently never matches, which is exactly the "landing on a
		// shared route does nothing" failure. Falls back to string comparison
		// when the naddr doesn't decode.
		let routePointer: { kind: number; pubkey: string; identifier: string } | null = null
		try {
			const decoded = nip19.decode(route.naddr)
			if (decoded.type === 'naddr') routePointer = decoded.data
		} catch {
			routePointer = null
		}
		const matchesRoute = (fields: {
			kind?: number
			pubkey?: string
			identifier?: string | null
		}): boolean =>
			routePointer !== null &&
			fields.kind === routePointer.kind &&
			fields.pubkey === routePointer.pubkey &&
			(fields.identifier ?? '') === routePointer.identifier

		if (route.focusType === 'geoevent') {
			// Find the dataset matching the naddr
			const dataset = geoEvents.find(
				(event) =>
					matchesRoute({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: event.datasetId ?? event.dTag,
					}) || encodeGeoEventNaddr(event) === route.naddr,
			)
			if (dataset) {
				const handledKey = `${routeKey}:${route.edit ? 'edit' : 'view'}:${dataset.id}`
				if (focusHandledRef.current === handledKey) return
				if (route.edit) {
					// Claim before loading: restoring the draft changes several store
					// fields and can rerender this effect before the Promise settles.
					focusHandledRef.current = handledKey
					void loadDatasetForCurrentChannel(dataset).then(
						(loaded) => {
							if (focusHandledRef.current !== handledKey) return
							if (!loaded) focusHandledRef.current = null
							else {
								useEditorStore.getState().selectMobileEntitySurface('dataset')
								ensureInfoPanelVisible()
							}
						},
						() => {
							if (focusHandledRef.current === handledKey) focusHandledRef.current = null
						},
					)
					return
				}
				if (inAppDatasetInspectRouteRef.current === routeKey) {
					// `handleInspectDataset` already selected the Inspector. Mark this URL
					// handled without changing Map Stack membership or camera position.
					inAppDatasetInspectRouteRef.current = null
					focusHandledRef.current = handledKey
					return
				}
				addDatasetToMapStack(dataset, 'route')
				handleInspectDataset(dataset)
				// Shared-link contract: landing zooms to the entity, not just
				// stacks it — the recipient should SEE what was shared.
				zoomToDataset(dataset)
				focusHandledRef.current = handledKey
			}
		} else if (route.focusType === 'mapcontext') {
			const context = mapContextEvents.find(
				(ctx) =>
					matchesRoute({
						kind: ctx.kind,
						pubkey: ctx.pubkey,
						identifier: ctx.contextId ?? ctx.dTag,
					}) || encodeContextNaddr(ctx) === route.naddr,
			)
			if (context) {
				const handledKey = `${routeKey}:${route.edit ? 'edit' : 'view'}:${context.id}`
				if (focusHandledRef.current === handledKey) return
				if (route.edit && currentUserPubkey === context.pubkey) {
					if (
						contextEditorMode === 'edit' &&
						editingContext?.pubkey === context.pubkey &&
						(editingContext.contextId ?? editingContext.dTag) ===
							(context.contextId ?? context.dTag)
					)
						ensureInfoPanelVisible()
					else handleEditContext(context)
				} else handleInspectContext(context)
				focusHandledRef.current = handledKey
			}
		} else if (route.focusType === 'story') {
			const story = stories.find(
				(s) =>
					matchesRoute({ kind: s.kind, pubkey: s.pubkey, identifier: s.dTag }) ||
					encodeStoryNaddr(s) === route.naddr,
			)
			if (story) {
				const handledKey = `${routeKey}:${route.edit ? 'edit' : 'view'}:${story.id}`
				if (focusHandledRef.current === handledKey) return
				// Inspection selects the Margin surface. Exact source resolution, feature
				// selection, authored styling, and camera framing are owned by the shared
				// presentation hooks above—this route effect never widens or auto-stacks.
				// Both owner edits and reader proposals use the normal Story editor.
				// Its submit path decides from ownership; entering never publishes.
				if (route.edit) {
					if (
						storyEditorMode === 'edit' &&
						editingStory?.pubkey === story.pubkey &&
						editingStory.dTag === story.dTag
					)
						ensureInfoPanelVisible()
					else handleEditStory(story)
				} else handleInspectStory(story, { preserveRoute: route.edit })
				focusHandledRef.current = handledKey
			}
		} else if (route.focusType === 'sighting') {
			// D-08: resolve the /sighting/:naddr deep link via useSightings (already
			// dropExpired'd at the subscription — an expired sighting won't be found,
			// SIGHT-03) and open the read view.
			const sighting = sightings.find(
				(s) =>
					matchesRoute({ kind: s.kind, pubkey: s.pubkey, identifier: s.dTag }) ||
					encodeSightingNaddr(s) === route.naddr,
			)
			if (sighting) {
				const handledKey = `${routeKey}:${sighting.id}`
				if (focusHandledRef.current === handledKey) return
				if (consumeInAppInspectRoute(inAppEphemeralInspectRouteRef, routeKey)) {
					// The inspect handler already selected this Sighting. Keep its
					// canonical URL without turning inspection into Map Stack mutation.
					focusHandledRef.current = handledKey
					return
				}
				// Phase 13 (D-03/SPEC §2.2): the routed sighting lands on the Map Stack
				// ISOLATED (deep-link-solo), mirroring the dataset route dispatch above
				// (addDatasetToMapStack(dataset, 'route')). This replaces any ambient
				// always-on rendering with explicit stack membership.
				addSightingToMapStack(sighting, 'route')
				// WR-06: thread the OG comment deep link so SightingViewPanel focuses it,
				// mirroring the geoevent/story comment-focus wiring.
				handleInspectSighting(sighting, route.commentId)
				focusHandledRef.current = handledKey
			}
		} else if (route.focusType === 'beacon') {
			// D-11: resolve the /beacon/:naddr deep link (account-free). Check the
			// public discovery surface first, then the targeted {authors,#d}
			// subscription (a link-only beacon only lives there). dropExpired at the
			// subscription means an ended/expired beacon won't resolve — the view
			// panel's isExpired gate then shows the terminal copy. Thin per-kind
			// clone — Phase 13 / XCUT-02 generalizes.
			const matchesBeacon = (b: (typeof beacons)[number]) =>
				matchesRoute({ kind: b.kind, pubkey: b.pubkey, identifier: b.dTag }) ||
				encodeBeaconNaddr(b) === route.naddr
			const beacon = beacons.find(matchesBeacon) ?? routedBeacons.find(matchesBeacon)
			if (beacon) {
				const handledKey = `${routeKey}:${beacon.id}`
				if (focusHandledRef.current === handledKey) return
				if (consumeInAppInspectRoute(inAppEphemeralInspectRouteRef, routeKey)) {
					// In-app inspection is stack-neutral. Only a fresh shared-link route
					// reaches the add/isolate branch below.
					focusHandledRef.current = handledKey
					return
				}
				// Phase 13 (D-03/SPEC §2.2): the routed beacon lands on the Map Stack
				// ISOLATED (deep-link-solo). This is what makes a link-only / deep-linked
				// beacon render now that the `66a155e` side-channel is gone — the isolated
				// entry resolves against the discovery ∪ routed superset in
				// visibleBeaconsFromStack.
				addBeaconToMapStack(beacon, 'route')
				// D-10: thread the OG comment deep link so BeaconViewPanel focuses it,
				// mirroring the Sighting comment-focus wiring above. Closes the
				// beacon /beacon/:naddr/comment/:id gap — parity across all five kinds.
				handleInspectBeacon(beacon, route.commentId)
				focusHandledRef.current = handledKey
			}
		}
	}, [
		route.focusType,
		route.naddr,
		route.commentId,
		route.edit,
		currentUserPubkey,
		contextEditorMode,
		editingContext,
		storyEditorMode,
		editingStory,
		geoEvents,
		mapContextEvents,
		stories,
		sightings,
		beacons,
		routedBeacons,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		encodeStoryNaddr,
		encodeSightingNaddr,
		encodeBeaconNaddr,
		addDatasetToMapStack,
		addSightingToMapStack,
		addBeaconToMapStack,
		handleInspectDataset,
		loadDatasetForCurrentChannel,
		ensureInfoPanelVisible,
		handleInspectContext,
		handleEditContext,
		handleInspectStory,
		handleEditStory,
		handleInspectSighting,
		handleInspectBeacon,
		zoomToDataset,
	])

	// Pan lock and magnifier
	const togglePanLock = useCallback(() => {
		if (!editor) return
		const next = !panLocked
		editor.setPanLocked(next)
		setPanLocked(next)
	}, [editor, panLocked, setPanLocked])

	// Search result handling
	const zoomToSearchResult = useCallback((result: GeoSearchResult) => {
		if (!map.current) return
		if (result.boundingbox) {
			const [west, south, east, north] = result.boundingbox
			map.current.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ padding: 40, duration: 500 },
			)
			return
		}
		map.current.flyTo({
			center: [result.coordinates.lon, result.coordinates.lat],
			zoom: 14,
			duration: 500,
		})
	}, [])

	// Handle locate button - zoom to user's current location and show marker
	const handleLocate = useCallback(
		(coords: { lat: number; lon: number; accuracy?: number } | null) => {
			setUserLocation(coords)

			// Only fly to location on first update (when tracking starts)
			if (coords && isFirstLocationUpdate.current && map.current) {
				map.current.flyTo({
					center: [coords.lon, coords.lat],
					zoom: 15,
					duration: 1000,
				})
				isFirstLocationUpdate.current = false
			}

			// Reset flag when tracking stops
			if (!coords) {
				isFirstLocationUpdate.current = true
			}
		},
		[],
	)

	const handleLocateError = useCallback(
		(error: GeolocationPositionError | Error) => {
			const permissionDenied = 'code' in error && error.code === 1
			toast.error(permissionDenied ? 'Location access blocked' : 'Location unavailable', {
				description: permissionDenied
					? 'Allow location access in your browser or app settings, then retry—or search for a place instead.'
					: 'Earthly could not determine your position. Retry or search for a place instead.',
				duration: 10_000,
				action: isMobile
					? {
							label: 'Search for a place',
							onClick: () => setMobileSearchOpen(true),
						}
					: undefined,
			})
		},
		[isMobile, setMobileSearchOpen],
	)

	const handleSearchResultSelect = useCallback(
		(result: GeoSearchResult) => {
			zoomToSearchResult(result)
		},
		[zoomToSearchResult],
	)

	// Zoom to a single editor feature
	const handleZoomToFeature = useCallback(
		(feature: EditorFeature) => {
			if (!map.current || !feature.geometry) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature as GeoJSON.Feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						handleZoomToBounds(bbox)
					}
				})
				.catch((err) => {
					console.warn('Failed to zoom to feature:', err)
				})
		},
		[handleZoomToBounds],
	)

	// Mention actions (naddr resolution, zoom-to, visibility toggle with focus exit)
	const {
		handleMentionZoomTo,
		handleMentionVisibilityToggle,
		handleToggleVisibilityWithExitFocus,
		handleToggleAllVisibilityWithExitFocus,
	} = useMentionActions({
		geoEvents: mapGeoEvents,
		resolvedCollectionResolver,
		handleZoomToBounds,
		zoomToDataset,
		getDatasetKey,
		isFocused,
		clearFocus,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
	})

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'
	const calloutComposerActive =
		selectedFeatureIds.length === 1 && calloutAuthoringFeatureId === selectedFeatureIds[0]
	const selectedFeatureHasCallout = useMemo(() => {
		if (selectedFeatureIds.length !== 1) return false
		const feature = features.find((item) => item.id === selectedFeatureIds[0])
		return feature ? getFeatureCallouts(feature).length > 0 : false
	}, [features, selectedFeatureIds])
	const handleOpenSelectedCallout = useCallback(() => {
		if (calloutAnchorDrawing) {
			setCalloutAnchorDrawing(false)
			executeEditorCommand('set_mode', { mode: 'select' })
			return
		}
		if (selectedFeatureIds.length === 0) {
			setCalloutsEnabled(true)
			setCalloutAuthoringFeatureId(null)
			calloutAnchorExistingFeatureIdsRef.current = new Set(features.map((feature) => feature.id))
			setCalloutAnchorDrawing(true)
			executeEditorCommand('set_mode', { mode: 'draw_point' })
			toast.info('Place the callout anchor', {
				description: 'Click the map to add a point and write its callout.',
			})
			return
		}
		if (selectedFeatureIds.length > 1) {
			toast.info('Select a single geometry', {
				description: 'A map callout belongs to one geometry.',
			})
			return
		}
		const selectedFeatureId = selectedFeatureIds[0] ?? ''
		const feature = editor?.getFeature(selectedFeatureId)
		if (!feature) return
		if (calloutAuthoringFeatureId === selectedFeatureId) {
			setCalloutAuthoringFeatureId(null)
			return
		}
		setCalloutsEnabled(true)
		executeEditorCommand('set_mode', { mode: 'select' })
		setCalloutAuthoringFeatureId(selectedFeatureId)
		handleZoomToFeature(feature)
	}, [
		calloutAuthoringFeatureId,
		calloutAnchorDrawing,
		editor,
		features,
		handleZoomToFeature,
		selectedFeatureIds,
		setCalloutsEnabled,
	])
	const handleCalloutsChange = useCallback(
		(featureId: string, callouts: MapCallout[]) => {
			const feature = editor?.getFeature(featureId)
			if (!editor || !feature) return
			editor.updateFeature(featureId, withFeatureCallouts(feature, callouts))
		},
		[editor],
	)

	const orderedShelfEntries = useMemo(
		() =>
			mapStackOrder
				.map((id) => mapStackEntries[id])
				.filter((entry): entry is MapStackEntry => Boolean(entry)),
		[mapStackEntries, mapStackOrder],
	)
	const aggregateLiveEntries = useMemo(
		() =>
			orderedShelfEntries.filter(
				(entry) => entry.entityType === 'sighting-layer' || entry.entityType === 'beacon-layer',
			),
		[orderedShelfEntries],
	)
	const shelfEntryById = useMemo(
		() => new Map(orderedShelfEntries.map((entry) => [entry.id, entry] as const)),
		[orderedShelfEntries],
	)
	const isolatedShelfEntry = orderedShelfEntries.find((entry) => entry.isolated) ?? null
	const stackShelfItems = useMemo<readonly ShelfStripItem[]>(() => {
		const resolveTitle = (entry: MapStackEntry): string => {
			if (entry.entityType === 'dataset') {
				const dataset = mapGeoEvents.find((event) => getDatasetKey(event) === entry.entityKey)
				if (dataset) {
					const datasetName = getDatasetName(dataset)
					return entry.featureIds?.length
						? `${entry.title || `${entry.featureIds.length} selected features`} · ${datasetName}`
						: datasetName
				}
			}
			if (entry.entityType === 'context') {
				const context = mapContextEvents.find(
					(candidate) =>
						getContextCoordinate(candidate) === entry.entityKey ||
						candidate.id === entry.entityKey ||
						candidate.contextId === entry.entityKey ||
						candidate.dTag === entry.entityKey,
				)
				if (context) {
					return context.context.name || context.contextId || context.dTag || entry.title
				}
			}
			if (entry.entityType === 'draft') {
				return collectionMeta.name?.trim() || entry.title || 'Working map'
			}
			return entry.title?.trim() || entry.entityKey
		}

		return Object.freeze(
			orderedShelfEntries
				.filter(
					(entry) => entry.entityType !== 'sighting-layer' && entry.entityType !== 'beacon-layer',
				)
				.map((entry) => {
					const isRequiredDraft = entry.entityType === 'draft'
					const isPrivate = entry.source === 'private-group' || entry.source === 'field-session'
					return Object.freeze({
						id: entry.id,
						title: resolveTitle(entry),
						visible: isolatedShelfEntry ? isolatedShelfEntry.id === entry.id : entry.visible,
						active: entry.isolated,
						editing: isRequiredDraft,
						locked: isPrivate,
						...(isPrivate
							? {
									lockLabel:
										entry.source === 'private-group' ? 'Private Circle map' : 'Nearby session map',
								}
							: {}),
						toggleable: !isRequiredDraft,
						removable: !isRequiredDraft,
						...(isRequiredDraft
							? {
									toggleDisabledLabel: 'The active working map stays visible while editing',
									removeDisabledLabel: 'Finish editing before removing this working map',
								}
							: {}),
					}) satisfies ShelfStripItem
				}),
		)
	}, [
		collectionMeta.name,
		getDatasetKey,
		getDatasetName,
		isolatedShelfEntry,
		mapContextEvents,
		mapGeoEvents,
		orderedShelfEntries,
	])
	const storyPresentationShelfItems = useMemo<readonly ShelfStripItem[]>(() => {
		if (!presentationCarrierId) return Object.freeze([])
		const eventBySource = new Map(
			storyPresentationRuntime.sourceEvents.flatMap((event) => {
				const source = getPresentationDatasetSource(event)
				return source ? [[source, event] as const] : []
			}),
		)
		return Object.freeze(
			effectiveStoryState.layers
				.filter((layer) => authorizedStoryLayerIds.has(layer.id))
				.map((layer) => {
					const sourceEvent = eventBySource.get(layer.source)
					const sourceName = sourceEvent
						? getDatasetName(sourceEvent)
						: (layer.source.split(':').at(-1) ?? 'Referenced map')
					const title = layer.featureIds?.length
						? `${sourceName} · ${layer.featureIds.length} selected`
						: sourceName
					return Object.freeze({
						id: `presentation:story:${presentationCarrierId}:${layer.id}`,
						title,
						visible: presentationVisibilityOverrides[layer.id] ?? layer.visible,
						active: activeStoryView?.snapshot.state.layers.some(
							(activeLayer) => activeLayer.id === layer.id,
						),
						reorderable: false,
					}) satisfies ShelfStripItem
				}),
		)
	}, [
		activeStoryView,
		authorizedStoryLayerIds,
		effectiveStoryState.layers,
		getDatasetName,
		presentationCarrierId,
		presentationVisibilityOverrides,
		storyPresentationRuntime.sourceEvents,
	])
	const atlasPresentationShelfItems = useMemo<readonly ShelfStripItem[]>(() => {
		if (!presentationAtlas || !atlasPresentationCarrierId || !usableRuntimeAtlasPresentation) {
			return Object.freeze([])
		}
		const eventBySource = new Map(
			atlasPresentationRuntime.sourceEvents.flatMap((event) => {
				const source = getPresentationDatasetSource(event)
				return source ? [[source, event] as const] : []
			}),
		)
		return Object.freeze(
			usableRuntimeAtlasPresentation.layers
				.filter((layer) => authorizedAtlasLayerIds.has(layer.id))
				.map((layer) => {
					const sourceEvent = eventBySource.get(layer.source)
					const sourceName = sourceEvent
						? getDatasetName(sourceEvent)
						: (layer.source.split(':').at(-1) ?? 'Referenced map')
					return Object.freeze({
						id: `presentation:atlas:${atlasPresentationCarrierId}:${layer.id}`,
						title: layer.featureIds?.length
							? `${sourceName} · ${layer.featureIds.length} selected`
							: sourceName,
						visible: layer.visible,
						reorderable: false,
					}) satisfies ShelfStripItem
				}),
		)
	}, [
		atlasPresentationCarrierId,
		atlasPresentationRuntime.sourceEvents,
		authorizedAtlasLayerIds,
		getDatasetName,
		presentationAtlas,
		usableRuntimeAtlasPresentation,
	])
	const presentationShelfItems = useMemo(
		() => Object.freeze([...storyPresentationShelfItems, ...atlasPresentationShelfItems]),
		[atlasPresentationShelfItems, storyPresentationShelfItems],
	)
	const shelfItems = useMemo(
		() => Object.freeze([...presentationShelfItems, ...stackShelfItems]),
		[presentationShelfItems, stackShelfItems],
	)
	const presentationShelfTargets = useMemo(() => {
		const targets = new Map<
			string,
			{ layer: MapPresentationLayerV1; event: GeoDataset | undefined }
		>()
		if (presentationCarrierId) {
			for (const layer of effectiveStoryState.layers) {
				if (!authorizedStoryLayerIds.has(layer.id)) continue
				targets.set(`presentation:story:${presentationCarrierId}:${layer.id}`, {
					layer,
					event: storyPresentationRuntime.sourceEvents.find(
						(candidate) => getPresentationDatasetSource(candidate) === layer.source,
					),
				})
			}
		}
		if (atlasPresentationCarrierId && usableRuntimeAtlasPresentation) {
			for (const layer of usableRuntimeAtlasPresentation.layers) {
				if (!authorizedAtlasLayerIds.has(layer.id)) continue
				targets.set(`presentation:atlas:${atlasPresentationCarrierId}:${layer.id}`, {
					layer,
					event: atlasPresentationRuntime.sourceEvents.find(
						(candidate) => getPresentationDatasetSource(candidate) === layer.source,
					),
				})
			}
		}
		return targets
	}, [
		atlasPresentationCarrierId,
		atlasPresentationRuntime.sourceEvents,
		authorizedAtlasLayerIds,
		authorizedStoryLayerIds,
		effectiveStoryState.layers,
		presentationCarrierId,
		storyPresentationRuntime.sourceEvents,
		usableRuntimeAtlasPresentation,
	])
	const handleShelfOpenItem = useCallback(
		(item: ShelfStripItem) => {
			if (item.id.startsWith('presentation:')) {
				const event = presentationShelfTargets.get(item.id)?.event
				if (event) {
					handleInspectDatasetWithModeSwitch(event)
					zoomToDataset(event)
				}
				return
			}
			const entry = shelfEntryById.get(item.id)
			if (!entry) return
			switch (entry.entityType) {
				case 'dataset': {
					const dataset = mapGeoEvents.find(
						(candidate) => getDatasetKey(candidate) === entry.entityKey,
					)
					if (dataset) handleInspectDatasetWithModeSwitch(dataset)
					break
				}
				case 'context': {
					const context = mapContextEvents.find(
						(candidate) =>
							getContextCoordinate(candidate) === entry.entityKey ||
							candidate.id === entry.entityKey ||
							candidate.contextId === entry.entityKey ||
							candidate.dTag === entry.entityKey,
					)
					if (context) handleInspectContext(context)
					break
				}
				case 'draft':
					void openDraftEditor()
					break
				case 'sighting': {
					const sighting = sightingLookupSuperset.find(
						(candidate) => getSightingMapStackKey(candidate) === entry.entityKey,
					)
					if (sighting) handleInspectSighting(sighting)
					break
				}
				case 'beacon': {
					const beacon = addedBeaconLookupSuperset.find(
						(candidate) => getBeaconMapStackKey(candidate) === entry.entityKey,
					)
					if (beacon) handleInspectBeacon(beacon)
					break
				}
				case 'coordinate':
					handleMentionZoomTo(entry.entityKey, undefined)
					break
				default:
					navigateToView('map-stack')
			}
		},
		[
			addedBeaconLookupSuperset,
			getDatasetKey,
			handleInspectBeacon,
			handleInspectContext,
			handleInspectDatasetWithModeSwitch,
			handleInspectSighting,
			handleMentionZoomTo,
			mapContextEvents,
			mapGeoEvents,
			navigateToView,
			openDraftEditor,
			presentationShelfTargets,
			shelfEntryById,
			sightingLookupSuperset,
			zoomToDataset,
		],
	)
	const handleShelfToggleItem = useCallback(
		(item: ShelfStripItem, visible: boolean) => {
			if (item.id.startsWith('presentation:')) {
				const layer = presentationShelfTargets.get(item.id)?.layer
				if (!layer) return
				setPresentationVisibilityOverrides((current) => ({
					...current,
					[layer.id]: visible,
				}))
				return
			}
			const entry = shelfEntryById.get(item.id)
			if (!entry || entry.entityType === 'draft') return
			for (const candidate of orderedShelfEntries) {
				if (candidate.isolated) setMapStackEntryIsolated(candidate.id, false)
			}
			setMapStackEntryVisible(entry.id, visible)
		},
		[
			orderedShelfEntries,
			presentationShelfTargets,
			setMapStackEntryIsolated,
			setMapStackEntryVisible,
			shelfEntryById,
		],
	)
	const handleShelfRemoveItem = useCallback(
		(item: ShelfStripItem) => {
			if (item.id.startsWith('presentation:')) {
				handleShelfToggleItem(item, false)
				return
			}
			const entry = shelfEntryById.get(item.id)
			if (entry && entry.entityType !== 'draft') removeFromMapStack(entry)
		},
		[handleShelfToggleItem, removeFromMapStack, shelfEntryById],
	)
	const handleShelfReorderItem = useCallback(
		(draggedId: string, targetId: string, placement: ShelfReorderPlacement) => {
			if (!shelfEntryById.has(draggedId) || !shelfEntryById.has(targetId)) return
			const nextOrder = mapStackOrder.filter((id) => id !== draggedId)
			const targetIndex = nextOrder.indexOf(targetId)
			if (targetIndex < 0) return
			nextOrder.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, draggedId)
			setMapStackOrder(nextOrder)
		},
		[mapStackOrder, setMapStackOrder, shelfEntryById],
	)
	const liveShelfItem = useMemo(
		() => ({
			count: sightings.length + beacons.length,
			visible: isolatedShelfEntry
				? aggregateLiveEntries.some((entry) => entry.id === isolatedShelfEntry.id)
				: aggregateLiveEntries.some((entry) => entry.visible),
			onToggle: () => {
				const currentlyVisible = isolatedShelfEntry
					? aggregateLiveEntries.some((entry) => entry.id === isolatedShelfEntry.id)
					: aggregateLiveEntries.some((entry) => entry.visible)
				for (const entry of orderedShelfEntries) {
					if (entry.isolated) setMapStackEntryIsolated(entry.id, false)
				}
				if (currentlyVisible) {
					for (const entry of aggregateLiveEntries) {
						setMapStackEntryVisible(entry.id, false)
					}
					return
				}
				const existingTypes = new Set(aggregateLiveEntries.map((entry) => entry.entityType))
				for (const entry of aggregateLiveEntries) setMapStackEntryVisible(entry.id, true)
				if (!existingTypes.has('sighting-layer')) {
					addMapStackEntry({
						entityType: 'sighting-layer',
						entityKey: 'all',
						title: 'All sightings',
						source: 'manual',
						visible: true,
						pinned: false,
					})
				}
				if (!existingTypes.has('beacon-layer')) {
					addMapStackEntry({
						entityType: 'beacon-layer',
						entityKey: 'all',
						title: 'All live locations',
						source: 'manual',
						visible: true,
						pinned: false,
					})
				}
			},
		}),
		[
			addMapStackEntry,
			aggregateLiveEntries,
			beacons.length,
			isolatedShelfEntry,
			orderedShelfEntries,
			setMapStackEntryIsolated,
			setMapStackEntryVisible,
			sightings.length,
		],
	)

	const handleGlobalEntitySearchSelect = useCallback(
		(result: EntitySearchResult) => {
			switch (result.type) {
				case 'dataset': {
					const dataset = result.entity as GeoDataset
					addDatasetToMapStack(dataset, 'manual')
					handleInspectDatasetWithModeSwitch(dataset)
					zoomToDataset(dataset)
					break
				}
				case 'context':
					handleInspectContext(result.entity as MapContext)
					break
				case 'story':
					handleInspectStory(result.entity as Article)
					break
				case 'sighting':
					handleInspectSighting(result.entity as TemporalSighting)
					break
				case 'beacon':
					handleInspectBeacon(result.entity as LiveBeacon)
					break
				case 'feature': {
					const feature = result.entity as import('@/components/editor').GeoFeatureItem
					handleMentionZoomTo(feature.address, feature.featureId)
					break
				}
				case 'person':
					if (result.pubkey) navigateToRoute(`/person/${nip19.npubEncode(result.pubkey)}`)
					break
				case 'place': {
					const place = result.entity as PlaceSearchEntity
					zoomToSearchResult({
						...place,
						boundingbox:
							place.boundingbox?.length === 4
								? (place.boundingbox as [number, number, number, number])
								: null,
					})
					break
				}
			}
		},
		[
			addDatasetToMapStack,
			handleInspectBeacon,
			handleInspectContext,
			handleInspectDatasetWithModeSwitch,
			handleInspectSighting,
			handleInspectStory,
			handleMentionZoomTo,
			zoomToSearchResult,
			zoomToDataset,
		],
	)
	const topBarActivityItems = useMemo<readonly ActivityTickerItem[]>(() => {
		const items: ActivityTickerItem[] = []
		if (ownLiveBeacon) {
			items.push({
				id: `live:${ownLiveBeacon.id}`,
				actor: 'You',
				verb: 'are sharing',
				title: ownLiveBeacon.beacon.label?.trim() || 'live location',
				ageLabel: 'now',
				icon: <Radio />,
				live: true,
				onActivate: () => handleInspectBeacon(ownLiveBeacon),
			})
		}
		const latestStory = recentDiscoveryStories[0]
		if (latestStory) {
			items.push({
				id: `story:${latestStory.id}`,
				actor: 'Public',
				verb: 'published',
				title: latestStory.article.title || latestStory.dTag || 'a story',
				ageLabel: discoveryDate(latestStory.created_at) || 'recently',
				icon: <BookOpen />,
				onActivate: () => handleInspectStory(latestStory),
			})
		}
		const latestMap = recentDiscoveryDatasets[0]
		if (latestMap) {
			items.push({
				id: `map:${latestMap.id}`,
				actor: 'Public',
				verb: 'mapped',
				title: getDatasetName(latestMap),
				ageLabel: discoveryDate(latestMap.created_at) || 'recently',
				icon: <Database />,
				onActivate: () => {
					addDatasetToMapStack(latestMap, 'manual')
					handleInspectDatasetWithModeSwitch(latestMap)
					zoomToDataset(latestMap)
				},
			})
		}
		return Object.freeze(items)
	}, [
		addDatasetToMapStack,
		getDatasetName,
		handleInspectBeacon,
		handleInspectDatasetWithModeSwitch,
		handleInspectStory,
		ownLiveBeacon,
		recentDiscoveryDatasets,
		recentDiscoveryStories,
		zoomToDataset,
	])
	const topBarActions: readonly TopBarAction[] = [
		{
			id: 'browse',
			label: 'Browse',
			icon: <Globe />,
			active: ['datasets', 'stories', 'contexts', 'sightings', 'beacons'].includes(
				route.sidebarView,
			),
			onActivate: () => navigateToView('datasets'),
		},
		{
			id: 'drafts',
			label: 'Drafts',
			icon: <FilePenLine />,
			badge: retainedDraftCount,
			active: route.sidebarView === 'drafts',
			onActivate: () => navigateToView('drafts'),
		},
		{
			id: 'inbox',
			label: 'Inbox',
			icon: <Inbox />,
			badge: inboxUnreadCount,
			badgeTone: inboxUnreadCount > 0 ? 'warning' : 'default',
			active: route.sidebarView === 'delivery',
			onActivate: () => navigateToView('delivery'),
		},
		{
			id: 'ask',
			label: 'Ask',
			icon: <MessageSquare />,
			active: route.sidebarView === 'chat',
			onActivate: () => navigateToView('chat'),
		},
		{
			id: 'me',
			label: 'Me',
			icon: <UserRound />,
			active: route.sidebarView === 'user',
			onActivate: () => navigateToView('user'),
		},
		{
			id: 'help',
			label: '?',
			ariaLabel: 'Help',
			icon: <CircleHelp />,
			active: route.sidebarView === 'help',
			onActivate: () => navigateToView('help'),
		},
	]
	const topBarSlot = (
		<TopBar
			search={
				<EntitySearchPopover
					sources={{
						datasets: scopedGeoEvents,
						contexts: mapContextEvents,
						features: availableFeatures,
						stories,
						sightings,
						beacons,
					}}
					entityTypes={[
						'dataset',
						'story',
						'context',
						'sighting',
						'person',
						'place',
						'beacon',
						'feature',
					]}
					onSelect={handleGlobalEntitySearchSelect}
					onAsk={(query) => navigateToRoute(`/ask?q=${encodeURIComponent(query)}`)}
					placeholder={
						routedLensAtlas
							? `Search in ${routedLensAtlas.group.name || 'this atlas'}…`
							: 'Search maps, stories, atlases, places…'
					}
					searchMode="both"
					compact
					getDatasetName={getDatasetName}
				/>
			}
			activityItems={topBarActivityItems}
			navigation={topBarActions.map((action) =>
				action.id === 'me' ? (
					<MeMenu
						key="me"
						currentUserPubkey={currentUserPubkey}
						draftCount={retainedDraftCount}
						unreadCount={inboxUnreadCount}
						onNavigate={navigateToRoute}
						onShareLive={handleShareLocation}
						onDiscover={handleOpenDiscover}
						onTakeTour={handleTakeDiscoverTour}
						trigger={
							<button type="button" className="earthly-topbar__action">
								<UserRound aria-hidden="true" />
								Me
							</button>
						}
					/>
				) : (
					<TopBarActionControl key={action.id} action={action} />
				),
			)}
			onBrandActivate={() => navigateToUnscopedView('datasets')}
		/>
	)
	const lensBarSlot = routedLensAtlas ? (
		<LensBar
			emblem={<Hexagon />}
			title={routedLensAtlas.group.name || routedLensAtlas.groupId || 'Atlas'}
			itemCount={routedLensAtlas.referencedAddresses.length}
			itemNoun="map"
			policyLabel={
				routedLensAtlas.group.governance === 'closed'
					? 'Only the author adds maps'
					: routedLensAtlas.group.governance === 'schema'
						? 'Maps must fit the schema'
						: 'Anyone can add maps'
			}
			authorLabel={`${routedLensAtlas.pubkey.slice(0, 8)}…`}
			onOpenAbout={activeContextScope ? () => handleInspectContext(activeContextScope) : undefined}
			onShare={() => {
				void (async () => {
					try {
						if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
						const atlasAppLink = contextNaddr
							? earthlyPublicUrl(`/in/${encodeURIComponent(contextNaddr)}`)
							: window.location.href
						await navigator.clipboard.writeText(atlasAppLink)
						toast.success('Atlas app link copied.')
					} catch {
						toast.error("Couldn't copy the Atlas link.")
					}
				})()
			}}
			onLeave={clearContextScope}
		/>
	) : null
	const shelfSlot = (
		<ShelfStrip
			items={shelfItems}
			live={liveShelfItem}
			onOpenItem={handleShelfOpenItem}
			onToggleItem={handleShelfToggleItem}
			onRemoveItem={handleShelfRemoveItem}
			onReorderItem={handleShelfReorderItem}
			onOpenShelf={() => navigateToView('map-stack')}
			onSaveView={() => {
				const captured = captureMapPresentation()
				if (!captured) {
					toast.error("Couldn't capture this canvas yet. Wait for the map to finish loading.")
					return
				}
				handleCreateContext(buildSavedViewAtlasSeed(captured))
				toast.success('Canvas captured in a new personal Atlas draft.')
			}}
		/>
	)
	const shelfPanelSlot = (
		<MapStackPanel
			geoEvents={mapGeoEvents}
			mapContextEvents={mapContextEvents}
			getDatasetKey={getDatasetKey}
			getDatasetName={getDatasetName}
			onAddDatasetToMap={addDatasetToMapStack}
			onInspectDataset={handleInspectDatasetWithModeSwitch}
			onZoomToDataset={zoomToDataset}
			onLoadDataset={handleDatasetSelect}
			onInspectContext={handleInspectContext}
			onSetEntryVisible={setMapStackVisibility}
			onSetEntryIsolated={setMapStackIsolation}
			onRemoveEntry={removeFromMapStack}
			onOpenDraftEditor={() => void openDraftEditor()}
			onZoomToDraft={zoomToDraft}
			onClear={clearMapStackAndVisibility}
			onClose={() => navigateToView('datasets')}
		/>
	)
	const canvasToolbarSlot = !isMobile ? (
		<Toolbar
			datasetActions={{
				authoringIntent: mapAuthoringIntent,
				onExportGeoJSON: exportGeoJSON,
				onExportSHP: exportSHP,
				canExport: stats.total > 0,
				onImport: handleImport,
				onClear: handleClear,
				onPublishNew: handlePublishNew,
				canPublishNew,
				onPublishUpdate: handlePublishUpdate,
				canPublishUpdate,
				onPublishCopy: handlePublishCopy,
				canPublishCopy,
				onProposeEdit: handleProposeEdit,
				canProposeEdit,
				publishMode: datasetPublishMode,
				isPublishing,
			}}
			showSidebarTrigger={false}
			onSearchResultSelect={handleSearchResultSelect}
			onInspectorDeactivate={disableInspector}
			onStartNewDataset={startNewDataset}
			onCancelEditing={tearDownEditSession}
			onOsmQueryClick={handleOsmQueryClick}
			onOsmQueryView={handleOsmQueryView}
			onOsmAdvanced={() => setImportOsmDialogOpen(true)}
			mapStackOpen={toolbarMapStackOpen}
			mapStackEntryCount={mapStackStats.total}
			mapStackVisibleCount={mapStackStats.visible}
			chatOpen={routedAskOpen || routedThreadOpen}
			onToggleMapStack={toggleToolbarMapStack}
			onToggleChat={handleToggleThread}
			onOpenSelectedCallout={handleOpenSelectedCallout}
			selectedFeatureCount={selectedFeatureIds.length}
			selectedFeatureHasCallout={selectedFeatureHasCallout}
			calloutComposerActive={calloutComposerActive}
			calloutAnchorDrawing={calloutAnchorDrawing}
			destination={activeDraftPublishChannel ? currentDestination : undefined}
			audienceOptions={publishAudienceOptions}
			selectedAudienceId={selectedAudienceId}
			onAudienceChange={handleAudienceChange}
			onActivateDestination={openCurrentDestination}
			onLeaveDestination={leaveCurrentDestination}
		/>
	) : null

	// Desktop status bar + chat are passed to StudioShell as slots; the shell
	// owns the responsive frame (widths/insets from the --shell-* CSS vars).
	const statusBarSlot = (
		<StudioStatusBar
			mapRef={map}
			mapReady={mounted}
			sightingsCount={sightings.length}
			beaconsCount={beacons.length}
			onRelayClick={() => {
				setSettingsTab('relays')
				navigateToView('settings')
			}}
		/>
	)

	const ensureRouteThreadMapTarget = useCallback(async (): Promise<string | null> => {
		if (routedDraftThreadOpen) {
			const state = useEditorStore.getState()
			const workspaceId = state.activeWorkspaceId
			if (!workspaceId || !getRetainedDatasetSurfaceTarget(state, workspaceId)) return null
			return workspaceId
		}
		if (!routedObjectThreadOpen || route.focusType !== 'geoevent' || !viewingDataset) return null
		const loaded = await loadDatasetForCurrentChannel(viewingDataset)
		if (!loaded) return null
		const state = useEditorStore.getState()
		const workspaceId = state.activeWorkspaceId
		if (!workspaceId) return null
		const workspace = state.workspaces[workspaceId]
		if (!workspace?.activeDraftId || !state.geoEditDrafts[workspace.activeDraftId]) return null
		return workspaceId
	}, [
		loadDatasetForCurrentChannel,
		route.focusType,
		routedDraftThreadOpen,
		routedObjectThreadOpen,
		viewingDataset,
	])

	const objectThreadKind =
		route.focusType === 'geoevent'
			? 'map'
			: route.focusType === 'mapcontext'
				? 'atlas'
				: route.focusType === 'beacon'
					? 'live'
					: route.focusType
	const routeThreadKey = routedAskOpen
		? 'ask'
		: routedDraftThreadOpen && draftThreadWorkspaceId
			? `map-draft:${draftThreadWorkspaceId}`
			: routedThreadOpen && route.naddr
				? `${objectThreadKind}:${route.naddr}`
				: routedThreadOpen ? retainedStoryDraftKey ? `story-draft:${retainedStoryDraftKey}` : 'ask' : undefined
	const routeThreadTitle = routedAskOpen
		? 'Ask Earthly'
		: routedDraftThreadOpen
			? collectionMeta.name?.trim() || 'Untitled Map'
			: route.focusType === 'geoevent'
				? viewingDataset
					? getDatasetName(viewingDataset)
					: 'Map'
				: route.focusType === 'story'
					? viewStory?.article.title || 'Story'
					: route.focusType === 'mapcontext'
						? viewContext?.context.name || 'Atlas'
						: route.focusType === 'sighting'
							? viewSighting?.sighting.title || 'Sighting'
							: route.focusType === 'beacon'
								? viewBeacon?.beacon.label || 'Live location'
								: 'Thread'
	const askInitialPrompt =
		routedAskOpen && typeof window !== 'undefined'
			? (new URLSearchParams(window.location.search).get('q') ?? undefined)
			: undefined

	const chatSlot = !isMobile ? (
		<AssistantSidebar
			open={routedAskOpen || routedThreadOpen}
			placement={routedAskOpen ? 'margin' : 'thread'}
			geoEvents={geoEvents}
			mapContextEvents={mapContextEvents}
			availableFeatures={availableFeatures}
			getDatasetName={getDatasetName}
			onOpenSettings={() => navigateToView('settings')}
			threadKey={routeThreadKey}
			threadTitle={routeThreadTitle}
			readOnly={routedAskOpen || (routedObjectThreadOpen && route.focusType !== 'geoevent')}
			initialPrompt={askInitialPrompt}
			onEnsureAuthoringTarget={
				routedDraftThreadOpen || (routedObjectThreadOpen && route.focusType === 'geoevent')
					? ensureRouteThreadMapTarget
					: undefined
			}
			authoringActionLabel={
				routedDraftThreadOpen
					? 'Send'
					: currentUserPubkey && viewingDataset?.pubkey === currentUserPubkey
						? 'Edit & send'
						: 'Propose & send'
			}
			onClose={() => {
				if (routedAskOpen) navigateToView('datasets')
				else navigateToTab('details')
			}}
		/>
	) : null

	// Mobile browse-rail bundles — the self-subscribing entity lists rendered in the
	// bottom sheet (§14a). Mirror the desktop AppSidebar prop objects, but bound to
	// the raw GeoEditorView handlers (which surface the editor via the mobile 'edit'
	// tab through ensureInfoPanelVisible).
	const mobileSightingsPanelProps = {
		currentUserPubkey: currentUserPubkey ?? undefined,
		onOpenSighting: (sighting) => handleInspectSighting(sighting),
		onCreateSighting: handleCreateSighting,
		onEditSighting: handleEditSighting,
		onDeleteSighting: handleDeleteSighting,
		onZoomToSighting: handleZoomToSighting,
		onAddToMapStack: addSightingToMapStack,
		deletingKey,
		selectedKey: lastInspectedSightingKey ?? null,
	} satisfies NonNullable<MobilePanelProps['sightingsPanelProps']>
	const mobileBeaconsPanelProps = {
		currentUserPubkey: currentUserPubkey ?? undefined,
		onShareLocation: handleShareLocation,
		onOpenBeacon: (beacon) => handleInspectBeacon(beacon),
		onWatchOnMap: handleZoomToBeacon,
		onAddToMapStack: addBeaconToMapStack,
		onStopBeacon: () => void handleStopBeacon(),
		onAdjustBeacon: handleAdjustBeacon,
		selectedKey: lastInspectedBeaconKey ?? null,
	} satisfies NonNullable<MobilePanelProps['beaconsPanelProps']>
	const mobileStoriesPanelProps = {
		currentUserPubkey: currentUserPubkey ?? undefined,
		onOpenStory: (story) => handleInspectStory(story),
		onCreateStory: handleCreateStory,
		onEditStory: handleEditStory,
		onDeleteStory: handleDeleteStory,
		deletingKey,
	} satisfies NonNullable<MobilePanelProps['storiesPanelProps']>
	const privateDatasetActions = {
		getDatasetKey,
		getDatasetName,
		onAddToMap: addPrivateDatasetToMapStack,
		onRemoveFromMap: removePrivateDatasetFromMapStack,
		onZoomTo: zoomToDataset,
		onLoadIntoEditor: handleDatasetSelect,
	}
	const fieldDatasetActions = {
		getDatasetKey,
		getDatasetName,
		onAddToMap: addFieldDatasetToMapStack,
		onRemoveFromMap: removeFieldDatasetFromMapStack,
		onZoomTo: zoomToDataset,
		onLoadIntoEditor: handleDatasetSelect,
	}

	// Starting one entity is explicit, but it does not discard any other retained
	// editor. The persistent rail lets the user return to those states independently.
	const startCreate = (create: () => void) => {
		if (isMobile) {
			closeMobileSidebar()
			setMobilePanelOpen(false)
			setMobileSearchOpen(false)
		}
		create()
	}
	const mobileMapIsCovered = mobileSidebarOpen || mobilePanelOpen || mobileSearchOpen
	const mobileBrowseIsOpen = mobilePanelOpen && route.browseOpen === true && stance === 'browse'
	const mobileMapEditing =
		isMobile &&
		route.sidebarView === 'edit' &&
		(route.focusType === 'none' || (route.focusType === 'geoevent' && route.edit === true)) &&
		stance === 'author' &&
		!routedThreadOpen &&
		mobileEntitySurface === 'dataset' &&
		draftThreadWorkspaceId !== null
	useEffect(() => {
		if (!mobileMapEditing || !draftThreadWorkspaceId) return
		openMobilePanel('edit')
		setMobilePanelSnap('peek')
	}, [mobileMapEditing, draftThreadWorkspaceId, openMobilePanel, setMobilePanelSnap])
	const finishMobileMapEdit = () => {
		editor?.setMode('select')
		useEditorStore.getState().setStance('browse')
		closeMobileSidebar()
		setMobilePanelOpen(false)
		setMobileSearchOpen(false)
		navigateHome()
	}
	const showBareMobileMap = () => {
		// closeMobileSidebar may restore a suspended map sheet, so close it first
		// and then explicitly dismiss the sheet. The working copy and Shelf remain.
		closeMobileSidebar()
		setMobilePanelOpen(false)
		setMobileSearchOpen(false)
		navigateHome()
	}
	const showMobileBrowse = () => {
		closeMobileSidebar()
		setMobileSearchOpen(false)
		navigateToView('datasets')
		openMobilePanel('datasets')
		setMobilePanelSnap('half')
	}
	const navigateFromMobileMe = (href: string) => {
		closeMobileSidebar()
		setMobilePanelOpen(false)
		setMobileSearchOpen(false)
		navigateToRoute(href)
	}
	return (
		<StudioShell
			mapContainerRef={mapContainerRef}
			topBar={topBarSlot}
			banners={lensBarSlot}
			mobileTop={lensBarSlot}
			canvasToolbar={canvasToolbarSlot}
			shelf={shelfSlot}
			statusBar={statusBarSlot}
			chat={routedAskOpen ? undefined : chatSlot}
			threadOpen={routedThreadOpen}
			sidebar={
				routedAskOpen ? (
					chatSlot
				) : (
					<AppSidebar
						isMobile={isMobile}
						mapGroups={groups}
						mapStories={stories}
						layout="margin"
						onInboxUnreadCountChange={setInboxUnreadCount}
						shelfPanel={shelfPanelSlot}
						onOpenDiscover={handleOpenDiscover}
						discoverOpen={discoverOpen}
						geoEvents={scopedGeoEvents}
						mapContextEvents={mapContextEvents}
						activeDataset={activeDataset}
						currentUserPubkey={currentUserPubkey ?? undefined}
						datasetVisibility={effectiveVisibility}
						isPublishing={isPublishing}
						deletingKey={deletingKey}
						onLoadDataset={handleDatasetSelect}
						onStartNewDataset={startNewDataset}
						privateDatasetActions={privateDatasetActions}
						fieldDatasetActions={fieldDatasetActions}
						fieldSessionEvents={fieldTransport.events}
						onPublishFieldSessionEvent={fieldTransport.publishEvent}
						onRefreshFieldSessionEvents={fieldTransport.refresh}
						onSwitchWorkspace={handleSwitchWorkspace}
						onDeleteWorkspace={handleDeleteWorkspace}
						onAddDraftToWorkspace={handleAddDraftToWorkspace}
						onLoadDraft={handleLoadDraft}
						onDeleteDraft={handleDeleteDraft}
						draftDestinationOptions={localDraftDestinationOptions}
						onResolveDraftDestination={handleResolveDraftDestination}
						onToggleVisibility={handleToggleVisibilityWithExitFocus}
						onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
						onZoomToDataset={zoomToDataset}
						onAddDatasetToMap={addDatasetToMapStack}
						onRemoveDatasetFromMap={removeDatasetFromMapStack}
						onDeleteDataset={onDeleteDataset}
						onDeleteContext={onDeleteContext}
						getDatasetKey={getDatasetKey}
						getDatasetName={getDatasetName}
						onOpenGeometryEditor={() => void handleOpenGeometryEditor()}
						onInspectDataset={handleInspectDatasetWithModeSwitch}
						onInspectContext={handleInspectContext}
						onOpenDebug={handleOpenDebug}
						onCreateContext={handleCreateContext}
						onEditContext={handleEditContext}
						isFocused={isFocused}
						onExitFocus={clearFocus}
						multiSelectModifier={multiSelectModifierLabel}
						// Editor panel props
						onCommentGeometryVisibility={handleCommentGeometryVisibility}
						onZoomToBounds={handleZoomToBounds}
						onZoomToSighting={handleZoomToSighting}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={handleMentionVisibilityToggle}
						onMentionZoomTo={handleMentionZoomTo}
						isMentionVisible={isMentionVisible}
						captureMapPresentation={captureMapPresentation}
						captureStoryView={captureStoryView}
						onStoryViewActivate={handleStoryViewActivate}
						onStoryViewPreviewReset={handleStoryViewPreviewReset}
						onStoryEditorActiveChange={isMobile ? undefined : handleDesktopStoryEditorActiveChange}
						renderStoryViewFigure={renderStoryViewFigure}
						activeStoryViewId={activeStoryView?.snapshot.view.id ?? null}
						contextEditorMode={contextEditorMode}
						editingContext={editingContext}
						contextCreationSeed={contextCreationSeed}
						onSaveContext={handleSaveContext}
						onCloseContextEditor={handleCloseContextEditor}
						storyEditorMode={storyEditorMode}
						editingStory={editingStory}
						onCreateStory={handleCreateStory}
						onInspectStory={handleInspectStory}
						onEditStory={handleEditStory}
						onSaveStory={handleSaveStory}
						onCloseStoryEditor={handleCloseStoryEditor}
						onDeleteStory={handleDeleteStory}
						onStoryUpdated={handleInspectStory}
						sightingEditorMode={sightingEditorMode}
						editingSighting={editingSighting}
						viewSighting={viewSighting}
						sightingFocusCommentId={sightingFocusCommentId}
						beaconFocusCommentId={beaconFocusCommentId}
						placedSightingGeometry={placedSightingGeometry}
						onCreateSighting={handleCreateSighting}
						selectedSightingKey={lastInspectedSightingKey}
						onInspectSighting={handleInspectSighting}
						onEditSighting={handleEditSighting}
						onSaveSighting={handleSaveSighting}
						onCloseSightingEditor={handleCloseSightingEditor}
						onDeleteSighting={handleDeleteSighting}
						onDrawSightingArea={handleDrawSightingArea}
						onClearSightingView={clearSightingView}
						beaconControlMode={beaconControlMode}
						adjustingBeacon={adjustingBeacon}
						viewBeacon={viewBeacon}
						isFollowingBeacon={isFollowingBeacon}
						onToggleFollowBeacon={toggleFollowBeacon}
						selectedBeaconKey={lastInspectedBeaconKey}
						beaconIsStarting={beaconSubState === 'searching' && !beaconIsLive}
						onShareLocation={handleShareLocation}
						onStartBeacon={handleStartBeacon}
						onCloseBeaconControl={handleCloseBeaconControl}
						onInspectBeacon={handleInspectBeacon}
						onWatchOnMapBeacon={handleZoomToBeacon}
						onAddBeaconToMapStack={addBeaconToMapStack}
						onAddSightingToMapStack={addSightingToMapStack}
						onStopBeacon={() => handleStopBeacon()}
						onAdjustBeacon={handleAdjustBeacon}
						onClearBeaconView={clearBeaconView}
						onZoomToFeature={handleZoomToFeature}
						onExitViewMode={exitViewMode}
						// Blossom upload props - callback adds blob ref to store, does NOT publish
						featureCollectionForUpload={
							canUploadToPublicBlossom(authoringPublishChannel)
								? memoizedFeatureCollection
								: undefined
						}
						onBlossomUploadComplete={handleBlobUploadComplete}
						// Contributor Group-attach publish wiring (GROUP-02/04)
						onPublishNew={handlePublishNew}
						canPublishNew={canPublishNew}
						// User profile props
						userPubkey={userPubkey}
						focusCommentId={focusCommentId}
						// Filter visibility sync
						onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
						onToggleProposalOverlay={handleToggleProposalOverlay}
						onProposalAccepted={handleProposalAccepted}
						visibleProposalIds={visibleProposalIds}
					/>
				)
			}
		>
			{discoverOpen && discoverOpenedAutomaticallyRef.current && <WelcomeCard
				canCreate={Boolean(editor)}
				onDismiss={() => handleDiscoverOpenChange(false)}
				onBrowse={() => { handleDiscoverOpenChange(false); navigateToUnscopedView('datasets'); if (isMobile) selectMobileSidebarDestination('datasets') }}
				onCreate={() => { handleDiscoverOpenChange(false); startNewDataset() }}
				onTour={() => { handleDiscoverOpenChange(false); handleTakeDiscoverTour() }}
			/>}
			<DiscoverDialog
				open={discoverOpen && !discoverOpenedAutomaticallyRef.current}
				onOpenChange={handleDiscoverOpenChange}
				datasets={discoveryDatasets}
				stories={discoveryStories}
				contexts={discoveryContexts}
				onSelectItem={handleSelectDiscoveryItem}
				onBrowseSightings={handleBrowseDiscoverSightings}
				onCreatePrivateGroup={handleCreateDiscoverPrivateGroup}
				onGetApp={handleGetEarthlyApp}
				onTakeTour={handleTakeDiscoverTour}
				// The tour targets stable editor chrome and filters unavailable steps.
				// Do not make it depend on remote basemap/style completion.
				tourReady
				loading={discoveryLoading}
			/>
			{savedRegionHydration.state === 'ready'
				? Object.entries(savedRegionHydration.regionDeletionTargets).map(([regionId, targets]) => (
						<SavedRegionDeletionMonitor key={regionId} regionId={regionId} targets={targets} />
					))
				: null}
			<MapComponent
				className={cn(
					'w-full h-full touch-none',
					coordinatePickRequestId !== null && 'earthly-coordinate-pick-active',
				)}
				onLoad={(m) => {
					map.current = m
					setLoadedMap(m)
					setMounted(true)
					if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
						// Dev-only debug handle (pairs with __earthlyPool/__earthlyEventStore).
						;(window as unknown as Record<string, unknown>).__earthlyMap = m
					}
				}}
				mapSource={mapSource}
				onLocate={handleLocate}
				onLocateError={handleLocateError}
				attributionCompact
				// On mobile the bottom sheet + tool strip/dock occupy the lower edge,
				// so the control stack lives top-right (clear of the sheet at every
				// detent). Desktop keeps them bottom-right (thumb-free, above the status bar).
				controlsPosition={isMobile && !mobileMapEditing ? 'top-right' : 'bottom-right'}
				controlsClassName={
					!isMobile
						? 'earthly-desktop-map-controls'
						: mobileMapEditing
							? selectionCount > 0
								? 'bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom)+114px)]'
								: 'bottom-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom)+70px)]'
							: undefined
				}
				controlsChildren={
					!isMobile ? (
						<ControlGroup>
							<ControlButton
								onClick={() => setCalloutsEnabled(!calloutsEnabled)}
								label={calloutsEnabled ? 'Hide map callouts' : 'Show map callouts'}
								pressed={calloutsEnabled}
							>
								<MapPin className="h-4 w-4" />
							</ControlButton>
							<ControlButton
								onClick={cycleCalloutDisplayMode}
								label={calloutDisplayModeActionLabel(calloutDisplayMode)}
								disabled={!calloutsEnabled}
							>
								{calloutDisplayMode === 'full' ? (
									<Maximize2 className="h-4 w-4" />
								) : calloutDisplayMode === 'compact' ? (
									<Minimize2 className="h-4 w-4" />
								) : (
									<CircleDot className="h-4 w-4" />
								)}
							</ControlButton>
							<ControlButton
								onClick={() => setMapPopupsEnabled((current) => !current)}
								label={mapPopupsEnabled ? 'Disable map popups' : 'Enable map popups'}
								pressed={mapPopupsEnabled}
							>
								{mapPopupsEnabled ? (
									<MessageSquare className="h-4 w-4" />
								) : (
									<MessageSquareOff className="h-4 w-4" />
								)}
							</ControlButton>
							<ControlButton
								onClick={() =>
									setMapPopupPlacement((current) => (current === 'geometry' ? 'dock' : 'geometry'))
								}
								label={
									mapPopupPlacement === 'geometry'
										? 'Dock popups in the top-right corner'
										: 'Show popups above geometry'
								}
								disabled={!mapPopupsEnabled}
								pressed={mapPopupPlacement === 'dock'}
							>
								{mapPopupPlacement === 'geometry' ? (
									<MapPinned className="h-4 w-4" />
								) : (
									<PanelTopOpen className="h-4 w-4" />
								)}
							</ControlButton>
						</ControlGroup>
					) : stance !== 'author' ? (
						// Mobile browse/inspect: desktop-toolbar parity actions (search,
						// location lookup, theme, share). Hidden while authoring — the
						// edit tool strip + MobileToolMenu own that surface.
						<MobileMapActions
							onSearchResultSelect={handleSearchResultSelect}
							calloutsEnabled={calloutsEnabled}
							calloutDisplayMode={calloutDisplayMode}
							onToggleCallouts={() => setCalloutsEnabled(!calloutsEnabled)}
							onCycleCalloutDisplayMode={cycleCalloutDisplayMode}
						/>
					) : null
				}
			>
				{coordinatePickRequestId !== null && loadedMap && (
					<button
						type="button"
						className="absolute inset-0 z-30 cursor-crosshair border-0 bg-transparent p-0"
						onClick={handleCoordinateReferenceMapClick}
						aria-label="Choose coordinate on map; press Enter to use the map center"
					/>
				)}
				<Editor />
			</MapComponent>
			{coordinatePickRequestId !== null && (
				<div
					role="status"
					aria-live="polite"
					className="pointer-events-auto absolute left-1/2 top-[calc(var(--shell-toolbar-h)+0.75rem)] z-40 flex -translate-x-1/2 items-center gap-2 border border-primary/40 bg-card px-3 py-2 text-xs shadow-lg"
				>
					<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center border border-primary/30 bg-primary/10">
						<Crosshair className="h-4 w-4 text-primary" />
					</span>
					<span className="flex min-w-0 flex-col">
						<span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
							Coordinate reference
						</span>
						<span>
							{loadedMap
								? 'Click the map to insert this coordinate into the article.'
								: 'Preparing the map for coordinate selection…'}
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={cancelCoordinateReferencePick}
						aria-label="Cancel coordinate reference"
						title="Cancel (Esc)"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			)}
			{geometryOperation !== null && coordinatePickRequestId === null && (
				<div
					role="status"
					aria-live="polite"
					className="pointer-events-auto absolute left-1/2 top-[calc(var(--shell-toolbar-h)+0.75rem)] z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-2 border border-primary/40 bg-card px-3 py-2 text-xs shadow-lg"
				>
					<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center border border-primary/30 bg-primary/10">
						<Scissors className="h-4 w-4 text-primary" />
					</span>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
							Geometry operation · {geometryOperation.inputMode === 'drag' ? 'Drag' : 'Draw'}
						</span>
						<span>{geometryOperation.error ?? geometryOperation.instruction}</span>
						{geometryOperation.distanceMeters !== undefined ? (
							<span className="font-mono text-[10px] text-muted-foreground">
								{geometryOperation.kind === 'corridor-drag'
									? `Width ${(geometryOperation.distanceMeters * 2).toFixed(1)} m`
									: `${geometryOperation.distanceMeters.toFixed(1)} m`}
								{geometryOperation.direction ? ` · ${geometryOperation.direction}` : ''}
							</span>
						) : null}
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => executeEditorCommand('cancel_geometry_operation')}
						aria-label="Cancel geometry operation"
						title="Cancel (Esc)"
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			)}
			{/* User location marker - pulsating blue dot */}
			<UserLocationMarker
				map={map.current}
				coordinates={userLocation}
				accuracy={userLocation?.accuracy}
			/>
			{/* Pin bubbles above sighting/beacon points: sighting primary photo,
			    beacon author avatar (SPEC §5.1/§6.1). Overlay only — the circle
			    layers in useMapLayers stay the hit/hover surface and fallback. */}
			<EntityPinBubbles
				mapRef={map}
				mounted={mounted}
				sightings={visibleSightingsFromStack}
				beacons={visibleBeaconsFromStack}
				onInspectSighting={handleInspectSighting}
				onInspectBeacon={handleInspectBeacon}
			/>
			<MapCallouts
				mapRef={map}
				mounted={mounted}
				enabled={calloutsEnabled}
				displayMode={calloutDisplayMode}
				draftFeatures={features}
				draftVisible={draftGeometryVisible}
				selectedFeatureIds={selectedFeatureIds}
				authoringFeatureId={calloutAuthoringFeatureId}
				canAuthor={datasetMapInteractionEnabled}
				visibleDatasets={visibleCalloutDatasets}
				availableFeatures={availableFeatures}
				onCalloutsChange={handleCalloutsChange}
				onComposerComplete={() => setCalloutAuthoringFeatureId(null)}
				onMentionVisibilityToggle={handleMentionVisibilityToggle}
				onMentionZoomTo={handleMentionZoomTo}
			/>
			{/* Amber preview of the Sighting geometry being placed/edited — the
			    transient draw feature is deleted after capture, so this is the only
			    thing on the map showing where the pin/area landed. */}
			<SightingPlacementPreview
				map={map.current}
				geometry={sightingEditorMode !== 'none' ? (placedSightingGeometry ?? null) : null}
				mapReady={mounted}
			/>
			<Magnifier
				enabled={magnifierEnabled}
				visible={magnifierVisible}
				position={magnifierPosition}
				center={magnifierCenter}
				mainMap={map.current}
				size={MAGNIFIER_SIZE}
				zoomOffset={magnifierZoomOffset}
			/>
			{/* Inspector Popup - appears near cursor when inspector is active */}
			<LocationInspectorPopup
				isOpen={inspectorActive && inspectorClickPosition !== null}
				loading={reverseLookupStatus === 'loading'}
				error={reverseLookupError}
				result={reverseLookupResult}
				clickPosition={inspectorClickPosition}
				containerRef={mapContainerRef}
				onClose={() => {
					setInspectorClickPosition(null)
					setReverseLookupResult(null)
					setReverseLookupError(null)
				}}
			/>
			{/* Feature Popup + remote geometry interaction handling */}
			<MapFeatureHoverOverlay
				mapRef={map}
				containerRef={mapContainerRef}
				remoteLayersReady={remoteLayersReady}
				clusteredSourceId={CLUSTERED_SOURCE_ID}
				geoEventsRef={mapInteractionGeoEventsRef}
				currentUserPubkey={currentUser?.pubkey}
				getDatasetName={getDatasetName}
				handleInspectDatasetWithoutFocus={handleInspectDatasetWithoutFocus}
				sightingsRef={sightingsRef}
				onInspectSighting={handleInspectSighting}
				popupsEnabled={mapPopupsEnabled}
				placementMode={mapPopupPlacement}
				toolbarOffset={mapPopupToolbarOffset}
				suppressed={mapPopupPlacement === 'dock' && Boolean(displayedAnnotationPopupData)}
				presentationLayerIds={presentationLayerIds}
				presentationLayersReady={presentationLayersReady}
			/>
			{mapPopupsEnabled && (
				<CommentAnnotationPopup
					data={displayedAnnotationPopupData}
					containerRef={mapContainerRef}
					placementMode={mapPopupPlacement}
					toolbarOffset={mapPopupToolbarOffset}
					onHoverChange={handleAnnotationPopupHoverChange}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					onClose={handleCloseAnnotationPopup}
				/>
			)}
			{isMobile &&
			activeDraftPublishChannel &&
			!mobileMapEditing &&
			mapAuthoringIntent !== 'propose' ? (
				<div className="pointer-events-auto absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] z-30 -translate-x-1/2 md:hidden">
					<PublishDropdown
						authoringIntent={mapAuthoringIntent}
						publishingScope={currentDestination}
						audienceOptions={publishAudienceOptions}
						selectedAudienceId={selectedAudienceId}
						onAudienceChange={handleAudienceChange}
						onOpenPublishingScope={openCurrentDestination}
						onLeavePublishingScope={leaveCurrentDestination}
						small
					/>
				</div>
			) : null}
			{mapError && (
				<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-destructive/10 border border-destructive/40 text-destructive px-4 py-3 rounded z-50">
					<p className="font-bold">Map Error</p>
					<p>{mapError}</p>
				</div>
			)}
			{/* Map-first pin-drop overlay (Phase 11, D-01): shown while a Sighting
					    placement is armed. "Click the map to drop your sighting" + a
					    "Cancel placement" button (Esc is the keyboard alternative). */}
			{sightingPlacementArmed && !mobileSearchOpen && (
				<div
					data-testid="sighting-placement-prompt"
					className="pointer-events-none absolute left-1/2 top-[calc(max(0.5rem,env(safe-area-inset-top))+2.5rem)] z-30 w-[calc(100%-5rem)] max-w-sm -translate-x-1/2"
				>
					<div className="pointer-events-auto flex items-center justify-between gap-2 rounded-full border border-border bg-background/95 py-1.5 pl-3 pr-1.5 text-xs shadow-lg backdrop-blur">
						<span className="text-foreground">Click the map to drop your sighting</span>
						<button
							type="button"
							onClick={cancelSightingPlacement}
							className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
						>
							Cancel placement
						</button>
					</div>
				</div>
			)}
			{/* Always-on "you are live" running banner (Phase 12, BEACON-02,
					    UI-SPEC § Net-New 3). Pinned over the map whenever a publisher
					    session is live, regardless of which panel is open — the one piece
					    of always-on chrome + a one-tap Stop. */}
			{beaconIsLive && (
				<RunningBeaconBanner
					subState={beaconSubState}
					countdown={beaconBannerCountdown}
					onStop={handleStopBeacon}
				/>
			)}
			{/* Desktop: map controls (zoom/compass/locate/pitch/globe/fullscreen
					    + the popup toggles via controlsChildren) live inside mapcn's
					    MapControls — see <MapComponent> above. */}
			{!isMobile && (
				<div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
					<div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-muted-foreground text-center pointer-events-auto">
						Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
						{selectionCount > 0 ? ` • ${selectionCount} selected` : ''}
					</div>
				</div>
			)}
			{/* Mobile Panel - unified tabbed drawer */}
			{isMobile && (
				<MobilePanel
					mapGroups={groups}
					mapStories={stories}
					onPublishNew={handlePublishNew}
					canPublishNew={canPublishNew}
					mapEditPublishAction={
						<PublishDropdown
							authoringIntent={mapAuthoringIntent}
							canPublishNew={canPublishNew}
							canPublishUpdate={canPublishUpdate}
							canPublishCopy={canPublishCopy}
							canProposeEdit={canProposeEdit}
							onPublishNew={handlePublishNew}
							onPublishUpdate={handlePublishUpdate}
							onPublishCopy={handlePublishCopy}
							onProposeEdit={handleProposeEdit}
							isPublishing={isPublishing}
							publishMode={datasetPublishMode}
							publishingScope={currentDestination}
							audienceOptions={publishAudienceOptions}
							selectedAudienceId={selectedAudienceId}
							onAudienceChange={handleAudienceChange}
							onOpenPublishingScope={openCurrentDestination}
							onLeavePublishingScope={leaveCurrentDestination}
						/>
					}
					onOpenDiscover={handleOpenDiscover}
					geoEvents={scopedGeoEvents}
					mapContextEvents={mapContextEvents}
					activeDataset={activeDataset}
					currentUserPubkey={currentUser?.pubkey}
					userPubkey={userPubkey}
					datasetVisibility={effectiveVisibility}
					isPublishing={isPublishing}
					deletingKey={deletingKey}
					isFocused={isFocused}
					multiSelectModifier={multiSelectModifierLabel}
					onLoadDataset={loadDatasetForCurrentChannel}
					onStartNewDataset={startNewDataset}
					privateDatasetActions={privateDatasetActions}
					fieldDatasetActions={fieldDatasetActions}
					fieldSessionEvents={fieldTransport.events}
					onPublishFieldSessionEvent={fieldTransport.publishEvent}
					onRefreshFieldSessionEvents={fieldTransport.refresh}
					onSwitchWorkspace={handleSwitchWorkspace}
					onDeleteWorkspace={handleDeleteWorkspace}
					onAddDraftToWorkspace={handleAddDraftToWorkspace}
					onLoadDraft={handleLoadDraft}
					onDeleteDraft={handleDeleteDraft}
					draftDestinationOptions={localDraftDestinationOptions}
					onResolveDraftDestination={handleResolveDraftDestination}
					onToggleVisibility={handleToggleVisibilityWithExitFocus}
					onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
					onZoomToDataset={zoomToDataset}
					onAddDatasetToMap={addDatasetToMapStack}
					onRemoveDatasetFromMap={removeDatasetFromMapStack}
					onSetMapStackEntryVisible={setMapStackVisibility}
					onSetMapStackEntryIsolated={setMapStackIsolation}
					onRemoveMapStackEntry={removeFromMapStack}
					onOpenDraftEditor={openDraftEditor}
					onZoomToDraft={zoomToDraft}
					onClearMapStack={clearMapStackAndVisibility}
					onDeleteDataset={onDeleteDataset}
					onDeleteContext={onDeleteContext}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onOpenGeometryEditor={handleOpenGeometryEditor}
					onInspectDataset={handleInspectDatasetWithModeSwitch}
					onExitFocus={clearFocus}
					onInspectContext={handleInspectContext}
					onCreateContext={handleCreateContext}
					onEditContext={handleEditContext}
					onOpenDebug={handleOpenDebug}
					onExitViewMode={exitViewMode}
					onCommentGeometryVisibility={handleCommentGeometryVisibility}
					onZoomToBounds={handleZoomToBounds}
					onZoomToSighting={handleZoomToSighting}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					isMentionVisible={isMentionVisible}
					captureMapPresentation={captureMapPresentation}
					captureStoryView={captureStoryView}
					onStoryViewActivate={handleStoryViewActivate}
					onStoryViewPreviewReset={handleStoryViewPreviewReset}
					onStoryEditorActiveChange={isMobile ? handleMobileStoryEditorActiveChange : undefined}
					renderStoryViewFigure={renderStoryViewFigure}
					activeStoryViewId={activeStoryView?.snapshot.view.id ?? null}
					contextEditorMode={contextEditorMode}
					editingContext={editingContext}
					contextCreationSeed={contextCreationSeed}
					onSaveContext={handleSaveContext}
					onCloseContextEditor={handleCloseContextEditor}
					storyEditorMode={storyEditorMode}
					editingStory={editingStory}
					onSaveStory={handleSaveStory}
					onCloseStoryEditor={handleCloseStoryEditor}
					onEditStory={handleEditStory}
					onDeleteStory={handleDeleteStory}
					onStoryUpdated={handleInspectStory}
					sightingEditorMode={sightingEditorMode}
					editingSighting={editingSighting}
					viewSighting={viewSighting}
					sightingFocusCommentId={sightingFocusCommentId}
					beaconFocusCommentId={beaconFocusCommentId}
					placedSightingGeometry={placedSightingGeometry}
					onDrawSightingArea={handleDrawSightingArea}
					onSaveSighting={handleSaveSighting}
					onCloseSightingEditor={handleCloseSightingEditor}
					onEditSighting={handleEditSighting}
					onDeleteSighting={handleDeleteSighting}
					beaconControlMode={beaconControlMode}
					adjustingBeacon={adjustingBeacon}
					viewBeacon={viewBeacon}
					isFollowingBeacon={isFollowingBeacon}
					onToggleFollowBeacon={toggleFollowBeacon}
					beaconIsStarting={beaconSubState === 'searching' && !beaconIsLive}
					onStartBeacon={handleStartBeacon}
					onCloseBeaconControl={handleCloseBeaconControl}
					onWatchOnMapBeacon={handleZoomToBeacon}
					onAddBeaconToMapStack={addBeaconToMapStack}
					onAddSightingToMapStack={addSightingToMapStack}
					onStopBeacon={() => handleStopBeacon()}
					onAdjustBeacon={handleAdjustBeacon}
					onZoomToFeature={handleZoomToFeature}
					featureCollectionForUpload={
						canUploadToPublicBlossom(authoringPublishChannel)
							? memoizedFeatureCollection
							: undefined
					}
					onBlossomUploadComplete={handleBlobUploadComplete}
					focusCommentId={focusCommentId}
					onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
					onToggleProposalOverlay={handleToggleProposalOverlay}
					onProposalAccepted={handleProposalAccepted}
					visibleProposalIds={visibleProposalIds}
					sightingsPanelProps={mobileSightingsPanelProps}
					beaconsPanelProps={mobileBeaconsPanelProps}
					storiesPanelProps={mobileStoriesPanelProps}
				/>
			)}
			{mobileMapEditing && (
				<MobileDrawingChrome
					showStatus={!mobilePanelOpen || mobilePanelSnap === 'peek'}
					onDone={finishMobileMapEdit}
					onAsk={handleToggleThread}
					moreTools={
						<MobileToolMenu
							dock
							additionalActions={
								<DropdownMenuItem onSelect={handleOpenSelectedCallout}>
									<MessageSquarePlus className="h-4 w-4" />
									{calloutAnchorDrawing || calloutComposerActive
										? 'Cancel map callout'
										: 'Add map callout'}
								</DropdownMenuItem>
							}
							panLocked={panLocked}
							onTogglePanLock={togglePanLock}
							magnifierEnabled={magnifierEnabled}
							onToggleMagnifier={toggleMagnifier}
							onExportGeoJSON={exportGeoJSON}
							onExportSHP={exportSHP}
							onImport={handleImport}
							onClear={handleClear}
							onCancelEditing={finishMobileMapEdit}
							canExport={stats.total > 0}
							canClear={stats.total > 0}
							onPublishUpdate={handlePublishUpdate}
							canPublishUpdate={canPublishUpdate}
							onPublishCopy={handlePublishCopy}
							canPublishCopy={canPublishCopy}
							onProposeEdit={handleProposeEdit}
							canProposeEdit={canProposeEdit}
							isPublishing={isPublishing}
							publishMode={datasetPublishMode}
							onOsmClick={handleOsmQueryClick}
							onOsmView={handleOsmQueryView}
							onOsmAdvanced={() => setImportOsmDialogOpen(true)}
							calloutsEnabled={calloutsEnabled}
							calloutDisplayMode={calloutDisplayMode}
							onToggleCallouts={() => setCalloutsEnabled(!calloutsEnabled)}
							onCycleCalloutDisplayMode={cycleCalloutDisplayMode}
						/>
					}
				/>
			)}
			{/* Map-first phone dock: Browse opens the sheet; Me opens an anchored menu. */}
			{isMobile && !mobileMapEditing && (
				<nav
					aria-label="Primary"
					data-tour="mobile-dock"
					className="fixed inset-x-0 bottom-0 z-[60] flex min-h-[calc(var(--mobile-dock-height)+env(safe-area-inset-bottom))] items-stretch justify-around border-t border-border bg-[var(--surface-chrome)] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
				>
					<button
						type="button"
						onClick={showBareMobileMap}
						aria-label={mobileMapIsCovered ? 'Just map' : 'Map'}
						data-tour="mobile-dock-map"
						className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] text-muted-foreground transition-colors hover:text-foreground"
					>
						<MapIcon className="h-5 w-5" />
						{mobileMapIsCovered ? 'Just map' : 'Map'}
					</button>
					<button
						type="button"
						onClick={showMobileBrowse}
						aria-pressed={mobileBrowseIsOpen}
						data-tour="mobile-dock-browse"
						className={cn(
							'flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] transition-colors',
							mobileBrowseIsOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
						)}
					>
						<Search className="h-5 w-5" />
						Browse
					</button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label="Create"
								data-tour="mobile-create"
								className="flex flex-1 flex-col items-center justify-center"
							>
								<span className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-primary text-primary-foreground shadow-sm">
									<Plus className="h-5 w-5" />
								</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							side="top"
							align="center"
							sideOffset={12}
							collisionPadding={12}
							aria-label="Create"
							className="z-[70] w-[calc(100dvw-24px)] max-w-md max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] overscroll-contain rounded-none p-2 [&_[role=menuitem]]:min-h-16 [&_[role=menuitem]]:gap-4 [&_[role=menuitem]]:rounded-none [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:py-3"
						>
							<DropdownMenuLabel className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest">
								Create
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem aria-label="Map" onSelect={() => startCreate(startNewDataset)}>
								<Database className="size-5" />
								<span className="min-w-0">
									<span className="block text-base font-medium">Map</span>
									<span className="block text-xs text-muted-foreground">
										Draw points, lines, and areas
									</span>
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								aria-label="Atlas"
								onSelect={() => startCreate(handleCreateContext)}
							>
								<Globe className="size-5" />
								<span className="min-w-0">
									<span className="block text-base font-medium">Atlas</span>
									<span className="block text-xs text-muted-foreground">
										Organize maps around a topic
									</span>
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem aria-label="Story" onSelect={() => startCreate(handleCreateStory)}>
								<BookOpen className="size-5" />
								<span className="min-w-0">
									<span className="block text-base font-medium">Story</span>
									<span className="block text-xs text-muted-foreground">
										Write with maps and inline views
									</span>
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								aria-label="Sighting"
								onSelect={() => startCreate(handleCreateSighting)}
							>
								<Eye className="size-5" />
								<span className="min-w-0">
									<span className="block text-base font-medium">Sighting</span>
									<span className="block text-xs text-muted-foreground">
										Share something you’ve seen
									</span>
								</span>
							</DropdownMenuItem>
							<DropdownMenuItem
								aria-label="Live beacon"
								onSelect={() => startCreate(handleShareLocation)}
							>
								<Radio className="size-5" />
								<span className="min-w-0">
									<span className="block text-base font-medium">Live beacon</span>
									<span className="block text-xs text-muted-foreground">
										Share your live location
									</span>
								</span>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<MeMenu
						mobile
						currentUserPubkey={currentUserPubkey}
						draftCount={retainedDraftCount}
						unreadCount={inboxUnreadCount}
						onNavigate={navigateFromMobileMe}
						onShareLive={() => startCreate(handleShareLocation)}
						onDiscover={handleOpenDiscover}
						onTakeTour={handleTakeDiscoverTour}
						trigger={
							<button
								type="button"
								data-tour="mobile-dock-me"
								className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] text-muted-foreground hover:text-foreground"
							>
								<UserRound className="h-5 w-5" aria-hidden="true" />
								Me
							</button>
						}
					/>
				</nav>
			)}
			{debugEvent && (
				<DebugDialog event={debugEvent} open={debugDialogOpen} onOpenChange={setDebugDialogOpen} />
			)}
			<ReferencePublishDialog />
			<StoryTargetDialog />
			{/* Blossom Upload Dialog */}
			<BlossomUploadDialog
				open={blossomUploadDialogOpen}
				onOpenChange={setBlossomUploadDialogOpen}
				geojson={pendingPublishCollection ?? memoizedFeatureCollection}
				onUploadComplete={handleBlobUploadComplete}
				onPublishWithUpload={handlePublishWithBlossomUpload}
				onSkip={handlePublishNew}
				allowSkip={false}
				title="Map Size Warning"
			/>
			{/* Import OSM Dialog */}
			<ImportOsmDialog
				open={importOsmDialogOpen}
				onOpenChange={setImportOsmDialogOpen}
				mapCenter={
					map.current
						? (() => {
								const center = map.current.getCenter()
								return { lat: center.lat, lon: center.lng }
							})()
						: undefined
				}
				mapBounds={
					map.current
						? (() => {
								const bounds = map.current.getBounds()
								return {
									west: bounds.getWest(),
									south: bounds.getSouth(),
									east: bounds.getEast(),
									north: bounds.getNorth(),
								}
							})()
						: undefined
				}
				onImport={(features) => {
					if (!editor) return
					// INFRA-02 / D-08: route through the Authoring API (normalizes raw
					// features internally via toEditorFeature; append with dedup-by-id).
					createAuthoring(editor).writeGeoJSON(features, { replace: false })
				}}
			/>
			{/* OSM Query Results Panel (cursor-oriented) */}
			<OsmResultsPanel onImport={handleOsmImport} onClose={clearOsmQuery} />
		</StudioShell>
	)
}
