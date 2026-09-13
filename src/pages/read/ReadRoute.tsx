import { useActiveAccount } from 'applesauce-react/hooks'
import type { FeatureCollection } from 'geojson'
import type * as maplibregl from 'maplibre-gl'
import {
	AlertTriangle,
	ChevronLeft,
	ChevronRight,
	Layers3,
	Loader2,
	MapPinned,
	Pause,
	Pencil,
	Play,
} from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import squareLogoRose from '@/assets/square_logo_rose.svg'
import { RichContentRenderer } from '@/components/editor'
import { UserProfile } from '@/components/user-profile'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CommentAnnotationPopup } from '@/features/geo-editor/components/CommentAnnotationPopup'
import { useCommentGeometry } from '@/features/geo-editor/hooks/useCommentGeometry'
import { usePresentationSources } from '@/features/geo-editor/hooks/usePresentationSources'
import type { PresentationLayerMaterializationInput } from '@/features/geo-editor/map-presentation/materialize'
import { CommentsPanel } from '@/features/social/comments'
import { ZapDialogHost } from '@/features/social/comments/GeoSocialActions'
import { CurrentUserReactionSync } from '@/features/social/reactions/CurrentUserReactionSync'
import { parseGeoReference } from '@/lib/geo/reference'
import { useAvailableGeoFeatures } from '@/lib/hooks/useAvailableGeoFeatures'
import { useGeoDatasets } from '@/lib/hooks/useGeoDatasets'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { getArticleMapPresentation, type Article } from '@/lib/nostr/article'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { naddrToCoordinate } from '@/lib/nostr/references'
import { catalogWindows } from '@/lib/nostr/catalogWindow'
import { formatRelativeDate } from '@/lib/nostr/temporal-sighting'
import {
	applyAmbientSourcesToLayers,
	buildFallbackStoryPresentation,
	deriveStoryPresentationAuthorization,
	drivingStoryViewIndexes,
	getPresentationDatasetSource,
	getUsableMapPresentation,
	MAP_PRESENTATION_VERSION,
	parseAmbientOn,
	parseMapPresentationSource,
	reduceStoryMarkdownViews,
	resolveAmbientOn,
	scrollStoryViewIntoView,
	storyViewAtReadingLine,
	type EffectiveStoryViewStateV1,
	type MapPresentationAuthorization,
	type MapPresentationLayerV1,
	type MapPresentationParseResult,
	type MapPresentationSource,
	type PresentationLayerResolution,
	type PresentationSourceAuthorization,
	type StoryViewBlockV1,
	type StoryViewSnapshotV1,
} from '@/lib/map-presentation'
import { navigateEarthly } from '@/router/navigation'
import { useEarthlyRouteState } from '@/router/routeState'
import { PresentationCanvas } from './PresentationCanvas'
import { DeferredMapFigure } from './DeferredMapFigure'
import { useStoryReader } from './useStoryReader'
import './reader.css'

const ABSENT_PRESENTATION: MapPresentationParseResult = Object.freeze({
	status: 'absent',
	issues: [] as const,
})

interface ReaderReferenceLayer {
	readonly key: string
	readonly id: string
	readonly address: string
	readonly featureId?: string
	readonly source: MapPresentationSource
}

function mentionKey(address: string, featureId: string | undefined): string {
	return JSON.stringify([address, featureId ?? null])
}

function articleDate(story: Article): string {
	const timestamp = story.article.publishedAt ?? story.created_at
	const date = new Date(timestamp * 1000)
	return Number.isNaN(date.getTime())
		? formatRelativeDate(story.created_at)
		: date.toLocaleDateString()
}

function layerInputs(
	carrierId: string,
	presentationAuthor: string | undefined,
	layers: readonly PresentationLayerResolution[],
): readonly PresentationLayerMaterializationInput[] {
	return Object.freeze(
		layers.map((resolution) => ({
			carrierId,
			layer: resolution.layer,
			featureCollection: resolution.featureCollection,
			...(resolution.sourceEvent ? { sourceEvent: resolution.sourceEvent } : {}),
			...(presentationAuthor ? { presentationAuthor } : {}),
		})),
	)
}

function inputsForSnapshot(
	carrierId: string,
	presentationAuthor: string,
	state: EffectiveStoryViewStateV1,
	resolved: readonly PresentationLayerResolution[],
): readonly PresentationLayerMaterializationInput[] {
	const resolvedById = new Map(resolved.map((entry) => [entry.layer.id, entry]))
	return state.layers.map((layer) => {
		const source = resolvedById.get(layer.id)
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
	})
}

function ReaderFigure({
	carrierId,
	story,
	snapshot,
	resolved,
}: {
	carrierId: string
	story: Article
	snapshot: StoryViewSnapshotV1
	resolved: readonly PresentationLayerResolution[]
}) {
	const mapRef = useRef<maplibregl.Map | null>(null)
	const inputs = useMemo(
		() => inputsForSnapshot(carrierId, story.pubkey, snapshot.state, resolved),
		[carrierId, resolved, snapshot.state, story.pubkey],
	)
	return (
		<DeferredMapFigure>
		<PresentationCanvas
			carrierId={`${carrierId}:figure:${snapshot.view.id}`}
			mapRef={mapRef}
			layers={inputs}
			camera={snapshot.state.camera}
			cameraIntentId={`figure:${JSON.stringify(snapshot.state)}`}
			compact
			interactive={false}
			className="earthly-reader__figure-map"
		/>
		</DeferredMapFigure>
	)
}

function ReaderState({
	icon,
	title,
	detail,
}: {
	icon: 'loading' | 'warning'
	title: string
	detail: string
}) {
	return (
		<main className="earthly-reader-state">
			<a href="/" className="earthly-reader-state__brand" aria-label="Open Earthly">
				<img src={squareLogoRose} alt="" />
			</a>
			<div className="earthly-reader-state__card" role={icon === 'warning' ? 'alert' : 'status'}>
				{icon === 'loading' ? (
					<Loader2 className="size-5 animate-spin" />
				) : (
					<AlertTriangle className="size-5" />
				)}
				<div>
					<h1>{title}</h1>
					<p>{detail}</p>
				</div>
			</div>
		</main>
	)
}

function mapSourceAddress(datasetId: string, pubkey: string): string | null {
	try {
		return nip19.naddrEncode({ kind: GEO_EVENT_KIND, pubkey, identifier: datasetId })
	} catch {
		return null
	}
}

/** Canonical, public, half-article/half-map Story reader. */
export function ReadRoute() {
	const route = useEarthlyRouteState()
	const currentUser = useActiveAccount()
	const isMobile = useIsMobile()
	const { story, loading, notFound, invalidAddress } = useStoryReader(route.id)
	const content = story?.article
	const storyPresentation = useMemo(
		() => (story ? getArticleMapPresentation(story.event) : ABSENT_PRESENTATION),
		[story],
	)
	const storyAuthorization = useMemo(
		() => deriveStoryPresentationAuthorization(content?.content),
		[content?.content],
	)
	const basePresentation = useMemo(
		() =>
			getUsableMapPresentation(storyPresentation) ??
			buildFallbackStoryPresentation(content?.content),
		[content?.content, storyPresentation],
	)
	const viewReduction = useMemo(
		() => reduceStoryMarkdownViews(basePresentation, content?.content),
		[basePresentation, content?.content],
	)
	const [activeViewIndex, setActiveViewIndex] = useState<number | null>(null)
	const activeViewIndexRef = useRef<number | null>(null)
	const [cameraRevision, setCameraRevision] = useState(0)
	const [followText, setFollowText] = useState(true)
	const articleScrollRef = useRef<HTMLDivElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const mapContainerRef = useRef<HTMLDivElement>(null)
	const [mapReady, setMapReady] = useState(false)
	const activeStoryRouteRef = useRef(route.id)
	const referenceOrdinalRef = useRef(0)
	const [referenceLayers, setReferenceLayers] = useState<readonly ReaderReferenceLayer[]>([])
	const [pendingReferenceZoom, setPendingReferenceZoom] = useState<string | null>(null)

	const parsedAmbient = useMemo(() => parseAmbientOn(route.on.join(',')), [route.on])
	const needsLegacyAmbientCatalog = parsedAmbient.tokens.some((token) => token.kind === 'legacy')
	useEffect(() => { if (needsLegacyAmbientCatalog) catalogWindows.all(GEO_EVENT_KIND) }, [needsLegacyAmbientCatalog])
	const { events: ambientCatalog } = useGeoDatasets(needsLegacyAmbientCatalog ? [{}] : null)
	const ambient = useMemo(
		() =>
			resolveAmbientOn(
				parsedAmbient,
				ambientCatalog
					.map(getPresentationDatasetSource)
					.filter((source): source is MapPresentationSource => Boolean(source)),
			),
		[ambientCatalog, parsedAmbient],
	)

	const effectiveState =
		activeViewIndex === null
			? viewReduction.initialState
			: (viewReduction.snapshots[activeViewIndex]?.state ?? viewReduction.initialState)
	const composedLayers = useMemo(() => {
		const withAmbient = applyAmbientSourcesToLayers(effectiveState.layers, ambient.sources)
		const usedIds = new Set(withAmbient.layers.map((layer) => layer.id))
		const mentions: MapPresentationLayerV1[] = []
		for (const reference of referenceLayers) {
			if (usedIds.has(reference.id)) continue
			usedIds.add(reference.id)
			mentions.push({
				id: reference.id,
				source: reference.source,
				...(reference.featureId ? { featureIds: [reference.featureId] } : {}),
				visible: true,
				opacityMultiplier: 1,
			})
		}
		return Object.freeze([...withAmbient.layers, ...mentions])
	}, [ambient.sources, effectiveState.layers, referenceLayers])

	const runtimePresentation = useMemo<MapPresentationParseResult>(
		() => ({
			status: 'valid',
			value: {
				version: MAP_PRESENTATION_VERSION,
				...(effectiveState.camera ? { initialView: effectiveState.camera } : {}),
				layers: composedLayers,
			},
			issues: storyPresentation.issues,
		}),
		[composedLayers, effectiveState.camera, storyPresentation.issues],
	)
	const authorization = useMemo<MapPresentationAuthorization>(() => {
		const next = new Map<MapPresentationSource, PresentationSourceAuthorization>(
			story ? storyAuthorization : [],
		)
		for (const source of ambient.sources) {
			next.set(source, Object.freeze({ source, scope: 'whole' as const }))
		}
		return next
	}, [ambient.sources, story, storyAuthorization])
	const runtime = usePresentationSources({
		presentation: runtimePresentation,
		authorization,
	})
	const carrierId = story
		? `${story.kind}:${story.pubkey}:${story.dTag ?? route.id ?? 'story'}`
		: `reader:${route.id ?? 'invalid'}`
	const presentationLayers = useMemo(
		() => layerInputs(carrierId, story?.pubkey, runtime.layers),
		[carrierId, runtime.layers, story?.pubkey],
	)
	const resolvedCollections = useMemo(
		() =>
			new Map(
				runtime.layers.flatMap((entry) =>
					entry.sourceEvent ? [[entry.sourceEvent.event.id, entry.featureCollection] as const] : [],
				),
			),
		[runtime.layers],
	)
	const availableFeatures = useAvailableGeoFeatures(runtime.sourceEvents, (event) =>
		resolvedCollections.get(event.event.id),
	)
	const { annotationPopupData, setAnnotationPopupData, handleCommentGeometryVisibility } =
		useCommentGeometry(mapRef, mapReady)

	const activateView = useCallback((view: StoryViewBlockV1, index: number) => {
		if (view.display === 'figure') return
		activeViewIndexRef.current = index
		setActiveViewIndex(index)
		setCameraRevision((revision) => revision + 1)
	}, [])
	const drivingIndexes = useMemo(
		() => drivingStoryViewIndexes(viewReduction.snapshots),
		[viewReduction.snapshots],
	)
	const presentView = (index: number | undefined) => {
		if (index === undefined) return
		const snapshot = viewReduction.snapshots[index]
		if (!snapshot || snapshot.view.display === 'figure') return
		setFollowText(false)
		activateView(snapshot.view, index)
		scrollStoryViewIntoView(articleScrollRef.current, index)
	}

	useEffect(() => {
		if (activeStoryRouteRef.current === route.id) return
		activeStoryRouteRef.current = route.id
		activeViewIndexRef.current = null
		setActiveViewIndex(null)
		setCameraRevision(0)
		setReferenceLayers([])
		setPendingReferenceZoom(null)
	}, [route.id])

	useEffect(() => {
		if (!followText || !articleScrollRef.current || drivingIndexes.length === 0) return
		const root = articleScrollRef.current
		let frame: number | undefined
		const update = () => {
			frame = undefined
			const bounds = root.getBoundingClientRect()
			const positions = drivingIndexes.flatMap((index) => {
				const element = root.querySelector<HTMLElement>(`[data-story-view-index="${index}"]`)
				return element ? [{ index, top: element.getBoundingClientRect().top }] : []
			})
			const index = storyViewAtReadingLine(
				positions,
				bounds.top + Math.min(bounds.height * 0.2, 120),
			)
			// Font/figure layout and scroll events can repeat without changing the
			// effective stage. Never take the camera back on those notifications.
			if (index === activeViewIndexRef.current) return
			activeViewIndexRef.current = index
			setActiveViewIndex(index)
			setCameraRevision((revision) => revision + 1)
		}
		const schedule = () => {
			if (frame === undefined) frame = window.requestAnimationFrame(update)
		}
		root.addEventListener('scroll', schedule, { passive: true })
		const observer = new ResizeObserver(schedule)
		observer.observe(root)
		const body = root.querySelector('.earthly-reader__body')
		if (body) observer.observe(body)
		schedule()
		return () => {
			root.removeEventListener('scroll', schedule)
			observer.disconnect()
			if (frame !== undefined) window.cancelAnimationFrame(frame)
		}
	}, [followText, drivingIndexes])

	const ensureReferenceLayer = useCallback(
		(address: string, featureId: string | undefined) => {
			const source = parseMapPresentationSource(naddrToCoordinate(address))?.coordinate
			if (!source) return null
			const key = mentionKey(address, featureId)
			const existing = referenceLayers.find((entry) => entry.key === key)
			if (existing) return existing.id
			referenceOrdinalRef.current += 1
			const id = `reader-reference-${referenceOrdinalRef.current}`
			setReferenceLayers((current) =>
				current.some((entry) => entry.key === key)
					? current
					: Object.freeze([...current, { key, id, address, featureId, source }]),
			)
			return id
		},
		[referenceLayers],
	)

	const handleMentionVisibilityToggle = useCallback(
		(address: string, featureId: string | undefined, visible: boolean) => {
			const key = mentionKey(address, featureId)
			if (!visible) {
				setReferenceLayers((current) => current.filter((entry) => entry.key !== key))
				return
			}
			ensureReferenceLayer(address, featureId)
		},
		[ensureReferenceLayer],
	)

	const handleMentionZoomTo = useCallback(
		(address: string, featureId: string | undefined) => {
			const reference = parseGeoReference(
				address.startsWith('naddr1')
					? `nostr:${address}${featureId ? `#${encodeURIComponent(featureId)}` : ''}`
					: address,
			)
			if (reference?.kind === 'coordinate') {
				mapRef.current?.flyTo({
					center: [reference.longitude, reference.latitude],
					zoom: 15,
					duration: 500,
				})
				return
			}
			const layerId = ensureReferenceLayer(address, featureId)
			if (layerId) setPendingReferenceZoom(layerId)
		},
		[ensureReferenceLayer],
	)

	useEffect(() => {
		if (!pendingReferenceZoom || !mapReady || !mapRef.current) return
		const resolved = runtime.layers.find((entry) => entry.layer.id === pendingReferenceZoom)
		if (!resolved || resolved.featureCollection.features.length === 0) return
		void import('@turf/turf').then(({ bbox }) => {
			const bounds = bbox(resolved.featureCollection)
			if (!mapRef.current || bounds.length !== 4) return
			const [west, south, east, north] = bounds
			if ([west, south, east, north].some((value) => !Number.isFinite(value))) return
			if (west === east && south === north) {
				mapRef.current.flyTo({ center: [west, south], zoom: 15, duration: 500 })
			} else {
				mapRef.current.fitBounds(
					[
						[west, south],
						[east, north],
					],
					{ padding: 48, duration: 500 },
				)
			}
			setPendingReferenceZoom(null)
		})
	}, [mapReady, pendingReferenceZoom, runtime.layers])

	const isMentionVisible = useCallback(
		(address: string, featureId: string | undefined) =>
			referenceLayers.some((entry) => entry.key === mentionKey(address, featureId)),
		[referenceLayers],
	)

	const handleZoomToBounds = useCallback((bounds: [number, number, number, number]) => {
		const map = mapRef.current
		if (!map) return
		const [west, south, east, north] = bounds
		if (west === east && south === north) map.flyTo({ center: [west, south], zoom: 15 })
		else
			map.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ padding: 48, duration: 500 },
			)
	}, [])

	if (invalidAddress) {
		return (
			<ReaderState
				icon="warning"
				title="This Story address is not valid"
				detail="The reading route needs a kind-37520 naddr. Check the copied link and try again."
			/>
		)
	}
	if (loading) {
		return (
			<ReaderState
				icon="loading"
				title="Opening the Story"
				detail="Resolving the exact Story address and its referenced Maps…"
			/>
		)
	}
	if (notFound || !story || !content) {
		return (
			<ReaderState
				icon="warning"
				title="Story not found"
				detail="No current Story was available for this address. It may have been removed or its relay may be offline."
			/>
		)
	}

	const currentDrivingPosition =
		activeViewIndex === null ? -1 : drivingIndexes.indexOf(activeViewIndex)
	const activeSnapshot =
		activeViewIndex === null ? null : (viewReduction.snapshots[activeViewIndex] ?? null)
	const runtimeProblems = runtime.layers.filter(
		(entry) => entry.status !== 'resolved' && entry.status !== 'loading',
	)
	const allIssues = [
		...runtime.issues,
		...viewReduction.issues,
		...ambient.issues.map((issue) => ({ path: 'on=', message: issue.message })),
	]
	const editLabel = currentUser?.pubkey === story.pubkey ? 'Edit Story' : 'Propose a Story edit'

	return (
		<TooltipProvider>
			<main className="earthly-reader" data-earthly-route-surface="reader">
				<section ref={articleScrollRef} className="earthly-reader__article" aria-label="Story">
					<div className="earthly-reader__chrome">
						<a href="/" className="earthly-reader__mark" aria-label="Open Earthly">
							<img src={squareLogoRose} alt="" />
						</a>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							className="earthly-reader__edit"
							onClick={() => navigateEarthly(`/story/${route.id}/edit`)}
							aria-label={editLabel}
							title={editLabel}
						>
							<Pencil className="size-3.5" />
						</Button>
					</div>

					<article className="earthly-reader__prose">
						<header className="earthly-reader__header">
							<p className="earthly-reader__kicker">Story · {articleDate(story)}</p>
							<h1>{content.title?.trim() || story.dTag || 'Untitled Story'}</h1>
							{content.summary?.trim() ? (
								<p className="earthly-reader__dek">{content.summary}</p>
							) : null}
							<div className="earthly-reader__byline">
								<UserProfile pubkey={story.pubkey} mode="avatar-name" size="sm" />
								<span>{formatRelativeDate(story.created_at)}</span>
								{viewReduction.snapshots.length > 0 ? (
									<span className="earthly-reader__map-hint">
										<MapPinned className="size-3" /> The map follows the Story
									</span>
								) : null}
							</div>
						</header>

						{content.image?.trim() ? (
							<img className="earthly-reader__cover" src={content.image} alt="" loading="eager" />
						) : null}

						{drivingIndexes.length > 0 ? (
							<nav className="earthly-reader__presenter" aria-label="Story map presentation">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="rounded-none"
									onClick={() => setFollowText((value) => !value)}
									aria-pressed={followText}
								>
									{followText ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
									{followText ? 'Pause follow' : 'Follow text'}
								</Button>
								<span className="earthly-reader__presenter-rule" />
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="rounded-none"
									disabled={currentDrivingPosition <= 0}
									onClick={() => presentView(drivingIndexes[currentDrivingPosition - 1])}
									aria-label="Previous map view"
								>
									<ChevronLeft className="size-3.5" />
								</Button>
								<span className="earthly-reader__presenter-count">
									{currentDrivingPosition < 0 ? 'Opening' : currentDrivingPosition + 1} /{' '}
									{drivingIndexes.length}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="rounded-none"
									disabled={currentDrivingPosition >= drivingIndexes.length - 1}
									onClick={() => presentView(drivingIndexes[currentDrivingPosition + 1])}
								>
									{currentDrivingPosition < 0 ? 'Present' : 'Next'}{' '}
									<ChevronRight className="size-3.5" />
								</Button>
							</nav>
						) : null}
						{drivingIndexes.length > 0 && (
							<ol className="earthly-reader__timeline" aria-label="Story timeline">
								{drivingIndexes.map((index, step) => (
									<li key={viewReduction.snapshots[index]?.view.id}>
										<button
											type="button"
											onClick={() => presentView(index)}
											aria-current={index === activeViewIndex ? 'step' : undefined}
										>
											<span>{step + 1}</span>
											{viewReduction.snapshots[index]?.view.title}
										</button>
									</li>
								))}
							</ol>
						)}

						<RichContentRenderer
							content={content.content ?? ''}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={handleMentionVisibilityToggle}
							onMentionZoomTo={handleMentionZoomTo}
							isMentionVisible={isMentionVisible}
							onStoryViewActivate={activateView}
							activeStoryViewId={activeSnapshot?.view.id}
							renderStoryViewFigure={(_, index) => {
								const snapshot = viewReduction.snapshots[index]
								return snapshot ? (
									<ReaderFigure
										carrierId={carrierId}
										story={story}
										snapshot={snapshot}
										resolved={runtime.layers}
									/>
								) : null
							}}
							emptyState="This Story has no narrative yet."
							className="earthly-reader__body"
						/>

						{runtime.sourceEvents.length > 0 ? (
							<footer className="earthly-reader__sources">
								<h2>
									<Layers3 className="size-4" /> Maps in this Story
								</h2>
								<div>
									{runtime.sourceEvents.map((dataset) => {
										const address = mapSourceAddress(dataset.datasetId, dataset.pubkey)
										const collection = dataset.featureCollection as FeatureCollection & {
											name?: string
											properties?: { name?: string }
										}
										return (
											<a
												key={dataset.event.id}
												href={address ? `/map/${address}` : undefined}
												className="earthly-reader__source"
											>
												<strong>
													{collection.name ?? collection.properties?.name ?? dataset.datasetId}
												</strong>
												<span>{dataset.featureCollection.features.length} features</span>
											</a>
										)
									})}
								</div>
							</footer>
						) : null}

						{runtimeProblems.length > 0 || allIssues.length > 0 ? (
							<aside className="earthly-reader__diagnostics" aria-label="Map presentation notices">
								<AlertTriangle className="size-4" />
								<div>
									<strong>Some map material could not be shown.</strong>
									{runtimeProblems.map((problem) => (
										<p key={problem.layer.id}>{problem.error ?? problem.status}</p>
									))}
									{allIssues.slice(0, 4).map((issue) => (
										<p key={`${issue.path}:${issue.message}`}>{issue.message}</p>
									))}
								</div>
							</aside>
						) : null}

						<section className="earthly-reader__comments" aria-labelledby="reader-comments-title">
							<h2 id="reader-comments-title">Discussion</h2>
							<p>Comments and attached places stay rooted to this Story.</p>
							<CommentsPanel
								layout="flow"
								target={story}
								focusCommentId={route.commentId}
								availableFeatures={availableFeatures}
								onCommentGeojsonVisibilityChange={(comment: GeoComment, visible) =>
									handleCommentGeometryVisibility(comment, visible)
								}
								onZoomToCommentGeojson={(comment) => {
									if (comment.boundingBox) handleZoomToBounds(comment.boundingBox)
								}}
								onMentionVisibilityToggle={handleMentionVisibilityToggle}
								onMentionZoomTo={handleMentionZoomTo}
							/>
						</section>
					</article>
				</section>

				<PresentationCanvas
					carrierId={carrierId}
					mapRef={mapRef}
					containerRef={mapContainerRef}
					layers={presentationLayers}
					camera={effectiveState.camera}
					cameraIntentId={`${activeSnapshot?.view.id ?? 'opening'}:${cameraRevision}`}
					onMapReadyChange={setMapReady}
					className="earthly-reader__canvas"
					overlay={
						<CommentAnnotationPopup
							data={annotationPopupData}
							containerRef={mapContainerRef}
							placementMode={isMobile ? 'dock' : 'geometry'}
							toolbarOffset={12}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={handleMentionVisibilityToggle}
							onMentionZoomTo={handleMentionZoomTo}
							onClose={() => setAnnotationPopupData(null)}
						/>
					}
				/>
			</main>
			<CurrentUserReactionSync />
			<ZapDialogHost />
			<Toaster position={isMobile ? 'top-center' : 'bottom-center'} />
		</TooltipProvider>
	)
}
