import { booleanPointInPolygon, point, pointOnFeature } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import {
	ChevronDown,
	ExternalLink,
	GripHorizontal,
	MapPin,
	MessageSquarePlus,
	Trash2,
	X,
} from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { GeoRichTextEditor } from '@/components/editor/GeoRichTextEditor'
import { RichContentRenderer } from '@/components/editor/RichContentRenderer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
	createMapCallout,
	getFeatureCallouts,
	type MapCallout,
	type MapCalloutMedia,
	type MapCalloutSide,
} from '@/lib/geo/callouts'
import type { EditorFeature } from '../core/types'
import { resolveCalloutLayout, type ScreenPoint } from './layout'

export interface VisibleCalloutDataset {
	key: string
	collection: FeatureCollection
}

interface MapCalloutsProps {
	mapRef: RefObject<maplibregl.Map | null>
	mounted: boolean
	enabled: boolean
	draftFeatures: EditorFeature[]
	draftVisible: boolean
	selectedFeatureIds: string[]
	authoringFeatureId: string | null
	canAuthor: boolean
	visibleDatasets: VisibleCalloutDataset[]
	availableFeatures?: GeoFeatureItem[]
	onCalloutsChange: (featureId: string, callouts: MapCallout[]) => void
	onComposerComplete?: () => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}

interface CalloutEntry {
	key: string
	featureId: string
	feature: Feature
	callout: MapCallout | null
	editable: boolean
	selected: boolean
}

function positionsInGeometry(geometry: Geometry): Position[] {
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.flatMap(positionsInGeometry)
	}
	const out: Position[] = []
	const visit = (value: unknown): void => {
		if (!Array.isArray(value)) return
		if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
			out.push(value as Position)
			return
		}
		value.forEach(visit)
	}
	visit(geometry.coordinates)
	return out
}

function isInside(pointValue: ScreenPoint, width: number, height: number, margin = 10): boolean {
	return (
		pointValue.x >= -margin &&
		pointValue.y >= -margin &&
		pointValue.x <= width + margin &&
		pointValue.y <= height + margin
	)
}

/** Pick a stable visible portion of the geometry; an offscreen feature stays hidden. */
function screenAnchorForFeature(
	feature: Feature,
	map: maplibregl.Map,
	visibleHeight?: number,
): ScreenPoint | null {
	if (!feature.geometry) return null
	const container = map.getContainer()
	const width = container.clientWidth
	const height = visibleHeight ?? container.clientHeight
	const center = { x: width / 2, y: height / 2 }
	const project = (position: Position): ScreenPoint => {
		const projected = map.project([position[0] ?? 0, position[1] ?? 0])
		return { x: projected.x, y: projected.y }
	}

	const visibleVertices = positionsInGeometry(feature.geometry)
		.map(project)
		.filter((candidate) => isInside(candidate, width, height))
		.sort(
			(a, b) =>
				Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y),
		)
	if (visibleVertices[0]) return visibleVertices[0]

	try {
		const representative = pointOnFeature(feature)
		const anchor = project(representative.geometry.coordinates)
		if (isInside(anchor, width, height)) return anchor
	} catch {
		// Invalid geometry is ignored by the overlay; the map layer owns validation.
	}

	if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
		try {
			const geographicCenter = map.unproject([center.x, center.y])
			if (
				booleanPointInPolygon(point([geographicCenter.lng, geographicCenter.lat]), feature.geometry)
			) {
				return center
			}
		} catch {
			return null
		}
	}

	return null
}

function estimatedFullHeight(callout: MapCallout | null, editing: boolean): number {
	if (editing) return callout ? 268 : 196
	const text = callout?.text ?? ''
	const lines = Math.min(7, Math.max(1, text.split('\n').length + Math.ceil(text.length / 44)))
	return Math.min(268, 52 + lines * 17 + (callout?.media?.length ? 112 : 0))
}

function isVideo(media: MapCalloutMedia): boolean {
	return (
		media.mimeType?.startsWith('video/') === true || /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(media.url)
	)
}

function CalloutMediaPreview({ media }: { media: MapCalloutMedia[] }) {
	const first = media[0]
	if (!first) return null
	return (
		<div className="relative mt-2 h-[104px] overflow-hidden rounded-[3px] border border-black/10 bg-muted">
			{isVideo(first) ? (
				<video
					controls
					muted
					preload="metadata"
					poster={first.thumbnailUrl}
					className="h-full w-full object-cover"
					onPointerDown={(event) => event.stopPropagation()}
				>
					<source src={first.url} type={first.mimeType} />
				</video>
			) : (
				<a href={first.url} target="_blank" rel="noreferrer" className="block h-full w-full">
					<img src={first.url} alt={first.alt ?? ''} className="h-full w-full object-cover" />
				</a>
			)}
			{media.length > 1 ? (
				<span className="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
					+{media.length - 1}
				</span>
			) : null}
		</div>
	)
}

function QuickAddCallout({
	onAdd,
	availableFeatures,
}: {
	onAdd: (text: string) => void
	availableFeatures?: GeoFeatureItem[]
}) {
	const [text, setText] = useState('')
	return (
		<div className="flex h-full flex-col p-3" data-testid="map-callout-composer">
			<div className="mb-2 flex items-center gap-2 text-xs font-semibold">
				<MessageSquarePlus className="h-3.5 w-3.5 text-primary" />
				Add map callout
			</div>
			<GeoRichTextEditor
				initialValue={text}
				placeholder="Put context directly on the map… Type $ to reference geometry."
				availableFeatures={availableFeatures}
				onChange={setText}
				rows={3}
				showToolbar={false}
				searchRelayMentions={false}
				className="min-h-0 flex-1 text-xs"
			/>
			<div className="mt-2 flex justify-end">
				<Button size="sm" className="h-7" disabled={!text.trim()} onClick={() => onAdd(text)}>
					Add to map
				</Button>
			</div>
		</div>
	)
}

export function MapCallouts({
	mapRef,
	mounted,
	enabled,
	draftFeatures,
	draftVisible,
	selectedFeatureIds,
	authoringFeatureId,
	canAuthor,
	visibleDatasets,
	availableFeatures,
	onCalloutsChange,
	onComposerComplete,
	onMentionVisibilityToggle,
	onMentionZoomTo,
}: MapCalloutsProps) {
	const [revision, setRevision] = useState(0)
	const [expandedKey, setExpandedKey] = useState<string | null>(null)
	const [dragOffsets, setDragOffsets] = useState<Record<string, [number, number]>>({})
	const frameRef = useRef<number | null>(null)
	const dragCleanupRef = useRef<(() => void) | null>(null)
	const draftFeaturesRef = useRef(draftFeatures)
	draftFeaturesRef.current = draftFeatures

	useEffect(() => {
		const map = mapRef.current
		if (!mounted || !map) return
		const update = () => {
			if (frameRef.current !== null) return
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null
				setRevision((value) => value + 1)
			})
		}
		map.on('move', update)
		map.on('resize', update)
		return () => {
			map.off('move', update)
			map.off('resize', update)
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
		}
	}, [mapRef, mounted])

	useEffect(() => () => dragCleanupRef.current?.(), [])

	const entries = useMemo(() => {
		const result: CalloutEntry[] = []
		const selected = new Set(selectedFeatureIds)
		if (draftVisible) {
			for (const feature of draftFeatures) {
				const featureSelected = selected.has(feature.id)
				const featureComposing = canAuthor && featureSelected && authoringFeatureId === feature.id
				const callouts = getFeatureCallouts(feature)
				for (const callout of callouts) {
					result.push({
						key: `draft:${feature.id}:${callout.id}`,
						featureId: feature.id,
						feature,
						callout,
						// Existing callouts are part of the draft editing surface. Their text,
						// placement, media, and removal controls stay directly available without
						// selecting the anchor or opening a second editor mode.
						editable: canAuthor,
						selected: featureSelected,
					})
				}
				if (featureComposing) {
					result.push({
						key: `draft:${feature.id}:new`,
						featureId: feature.id,
						feature,
						callout: null,
						editable: true,
						selected: true,
					})
				}
			}
		}
		for (const dataset of visibleDatasets) {
			dataset.collection.features.forEach((feature, featureIndex) => {
				const featureId = String(feature.id ?? feature.properties?.featureId ?? featureIndex)
				getFeatureCallouts(feature).forEach((callout) => {
					result.push({
						key: `${dataset.key}:${featureId}:${callout.id}`,
						featureId,
						feature,
						callout,
						editable: false,
						selected: false,
					})
				})
			})
		}
		return result
	}, [
		authoringFeatureId,
		canAuthor,
		draftFeatures,
		draftVisible,
		selectedFeatureIds,
		visibleDatasets,
	])

	const updateCallout = useCallback(
		(entry: CalloutEntry, update: (callout: MapCallout) => MapCallout) => {
			if (!entry.callout) return
			const currentFeature =
				draftFeaturesRef.current.find((feature) => feature.id === entry.featureId) ?? entry.feature
			const callouts = getFeatureCallouts(currentFeature).map((callout) =>
				callout.id === entry.callout?.id ? update(callout) : callout,
			)
			onCalloutsChange(entry.featureId, callouts)
		},
		[onCalloutsChange],
	)
	const currentCalloutsFor = useCallback(
		(entry: CalloutEntry) =>
			getFeatureCallouts(
				draftFeaturesRef.current.find((feature) => feature.id === entry.featureId) ?? entry.feature,
			),
		[],
	)

	const beginDrag = useCallback(
		(event: React.PointerEvent, entry: CalloutEntry) => {
			if (!entry.callout) return
			const target = event.target as HTMLElement
			if (target.closest('button, input, select, textarea, a')) return
			event.preventDefault()
			event.stopPropagation()
			dragCleanupRef.current?.()
			const start = { x: event.clientX, y: event.clientY }
			const initial = entry.callout.placement?.offset ?? [0, 0]
			let nextOffset: [number, number] = initial
			const onMove = (moveEvent: PointerEvent) => {
				nextOffset = [
					Math.round(initial[0] + moveEvent.clientX - start.x),
					Math.round(initial[1] + moveEvent.clientY - start.y),
				]
				setDragOffsets((current) => ({ ...current, [entry.key]: nextOffset }))
			}
			const cleanup = () => {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
				window.removeEventListener('pointercancel', onUp)
				dragCleanupRef.current = null
			}
			const onUp = () => {
				cleanup()
				setDragOffsets((current) => {
					const next = { ...current }
					delete next[entry.key]
					return next
				})
				if (nextOffset[0] !== initial[0] || nextOffset[1] !== initial[1]) {
					updateCallout(entry, (callout) => ({
						...callout,
						placement: { ...callout.placement, offset: nextOffset },
					}))
				}
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
			window.addEventListener('pointercancel', onUp)
			dragCleanupRef.current = cleanup
		},
		[updateCallout],
	)

	const map = mapRef.current
	if (!enabled || !mounted || !map) return null
	void revision
	const container = map.getContainer()
	const bottomInset = Number.parseFloat(
		getComputedStyle(container).getPropertyValue('--mobile-sheet-height'),
	)
	const viewport = {
		width: container.clientWidth,
		height: Math.max(80, container.clientHeight - (Number.isFinite(bottomInset) ? bottomInset : 0)),
	}
	const visibleEntries = entries
		.map((entry) => ({
			entry,
			anchor: screenAnchorForFeature(entry.feature, map, viewport.height),
		}))
		.filter((item): item is { entry: CalloutEntry; anchor: ScreenPoint } => item.anchor !== null)
	const entryByKey = new Map(visibleEntries.map(({ entry }) => [entry.key, entry]))
	const automaticPriorityKey = expandedKey
		? null
		: (visibleEntries.find(({ entry }) => entry.callout === null)?.entry.key ??
			visibleEntries.find(({ entry }) => entry.editable && entry.selected)?.entry.key ??
			visibleEntries.find(({ entry }) => entry.editable)?.entry.key ??
			null)
	const layouts = resolveCalloutLayout(
		visibleEntries.map(({ entry, anchor }) => ({
			key: entry.key,
			anchor,
			preferredSide: entry.callout?.placement?.side ?? 'auto',
			offset: dragOffsets[entry.key] ?? entry.callout?.placement?.offset ?? [0, 0],
			fullSize: {
				width: Math.min(286, Math.max(210, viewport.width - 24)),
				height: estimatedFullHeight(entry.callout, entry.editable),
			},
			priority: automaticPriorityKey === entry.key || expandedKey === entry.key,
		})),
		viewport,
	)

	return (
		<div className="pointer-events-none absolute inset-0 z-[19] overflow-hidden">
			<svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
				{layouts.map((layout) => {
					const entry = entryByKey.get(layout.key)
					if (!entry || entry.callout?.placement?.leader === 'none') return null
					return (
						<line
							key={layout.key}
							x1={layout.anchor.x}
							y1={layout.anchor.y}
							x2={layout.connector.x}
							y2={layout.connector.y}
							className="stroke-foreground/55"
							strokeWidth="1.5"
							vectorEffect="non-scaling-stroke"
						/>
					)
				})}
			</svg>

			{layouts.map((layout) => {
				const entry = entryByKey.get(layout.key)
				if (!entry) return null
				const callout = entry.callout
				const cardStyle = {
					left: layout.card.x,
					top: layout.card.y,
					width: layout.card.width,
					height: layout.card.height,
				}

				if (layout.mode === 'collapsed') {
					return (
						<button
							key={layout.key}
							type="button"
							style={cardStyle}
							onClick={() => setExpandedKey(layout.key)}
							className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-foreground/20 bg-background/95 text-foreground shadow-md backdrop-blur transition-transform hover:scale-105"
							aria-label={`Expand callout${callout?.title ? `: ${callout.title}` : ''}`}
						>
							<MapPin className="h-4 w-4" />
						</button>
					)
				}

				if (layout.mode === 'compact') {
					return (
						<button
							key={layout.key}
							type="button"
							style={cardStyle}
							onClick={() => setExpandedKey(layout.key)}
							className="pointer-events-auto absolute flex items-center gap-2 overflow-hidden rounded-[4px] border border-foreground/15 bg-background/95 px-2.5 text-left shadow-md backdrop-blur"
						>
							<MapPin className="h-4 w-4 shrink-0 text-primary" />
							<span className="min-w-0 flex-1">
								{callout?.title ? (
									<span className="block truncate text-[11px] font-semibold">{callout.title}</span>
								) : null}
								<span className="block truncate text-[11px] text-muted-foreground">
									{callout?.text || 'Map callout'}
								</span>
							</span>
							<ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
						</button>
					)
				}

				return (
					<article
						key={layout.key}
						style={cardStyle}
						data-callout-state="full"
						className={cn(
							'pointer-events-auto absolute overflow-hidden rounded-[5px] border border-foreground/15 bg-background/95 text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-md',
							entry.selected && 'border-primary/55 ring-1 ring-primary/20',
						)}
					>
						{entry.editable ? (
							callout ? (
								<div className="flex h-full flex-col">
									<div
										className="flex h-8 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-border/70 bg-muted/50 px-2 active:cursor-grabbing"
										onPointerDown={(event) => beginDrag(event, entry)}
										title="Drag to position this callout"
									>
										<GripHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
										<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
											Map callout
										</span>
										<div className="flex-1" />
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="h-6 w-6 text-destructive"
											onClick={() =>
												onCalloutsChange(
													entry.featureId,
													currentCalloutsFor(entry).filter((item) => item.id !== callout.id),
												)
											}
											aria-label="Delete callout"
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
									<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
										<Input
											value={callout.title ?? ''}
											placeholder="Optional title"
											onChange={(event) =>
												updateCallout(entry, (item) => ({
													...item,
													title: event.target.value || undefined,
												}))
											}
											className="h-7 font-medium"
										/>
										<GeoRichTextEditor
											initialValue={callout.text}
											placeholder="Callout text… Type $ to reference geometry."
											availableFeatures={availableFeatures}
											searchRelayMentions={false}
											onChange={(text) => updateCallout(entry, (item) => ({ ...item, text }))}
											rows={2}
											showToolbar={false}
											className="min-h-[66px]"
										/>
										<div className="flex items-center gap-1.5">
											<select
												value={callout.placement?.side ?? 'auto'}
												onChange={(event) =>
													updateCallout(entry, (item) => ({
														...item,
														placement: {
															...item.placement,
															side: event.target.value as MapCalloutSide,
														},
													}))
												}
												className="h-7 rounded-[3px] border border-input bg-background px-2 text-[11px]"
												aria-label="Callout placement"
											>
												<option value="auto">Auto place</option>
												<option value="top">Above</option>
												<option value="right">Right</option>
												<option value="bottom">Below</option>
												<option value="left">Left</option>
											</select>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="h-7 px-2 text-[11px]"
												onClick={() =>
													updateCallout(entry, (item) => ({
														...item,
														placement: {
															...item.placement,
															leader: item.placement?.leader === 'none' ? 'line' : 'none',
														},
													}))
												}
											>
												{callout.placement?.leader === 'none' ? 'Add leader' : 'No leader'}
											</Button>
											<BlossomUploaderButton
												onUploaded={(upload) =>
													updateCallout(entry, (item) => ({
														...item,
														media: [
															...(item.media ?? []),
															{
																url: upload.url,
																mimeType: upload.mimeType,
																sha256: upload.sha256,
																size: upload.size,
																alt: upload.fileName,
															},
														],
													}))
												}
												accept="image/*,video/*"
												multiple
												buttonLabel="Add media"
												buttonVariant="outline"
												buttonSize="sm"
												className="h-7"
												iconOnly
											/>
										</div>
										{callout.media?.length ? (
											<div className="flex flex-wrap gap-1">
												{callout.media.map((media) => (
													<span
														key={media.sha256 ?? media.url}
														className="flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-1 text-[10px]"
													>
														<span className="max-w-[150px] truncate">{media.alt || media.url}</span>
														<button
															type="button"
															onClick={() =>
																updateCallout(entry, (item) => ({
																	...item,
																	media: item.media?.filter((candidate) => candidate !== media),
																}))
															}
															aria-label="Remove media"
														>
															<X className="h-3 w-3" />
														</button>
													</span>
												))}
											</div>
										) : null}
									</div>
								</div>
							) : (
								<QuickAddCallout
									onAdd={(text) => {
										onCalloutsChange(entry.featureId, [
											...currentCalloutsFor(entry),
											createMapCallout(text),
										])
										onComposerComplete?.()
									}}
									availableFeatures={availableFeatures}
								/>
							)
						) : (
							<div className="flex h-full flex-col p-3">
								<div className="mb-1 flex items-start gap-2">
									<MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
									<div className="min-w-0 flex-1">
										{callout?.title ? (
											<h3 className="text-xs font-semibold leading-tight">{callout.title}</h3>
										) : null}
									</div>
									{expandedKey === layout.key ? (
										<button
											type="button"
											onClick={() => setExpandedKey(null)}
											className="rounded p-0.5 text-muted-foreground hover:text-foreground"
											aria-label="Close expanded callout"
										>
											<X className="h-3.5 w-3.5" />
										</button>
									) : null}
								</div>
								<div className="min-h-0 flex-1 overflow-y-auto text-xs leading-[1.45]">
									<RichContentRenderer
										content={callout?.text ?? ''}
										availableFeatures={availableFeatures}
										onMentionVisibilityToggle={onMentionVisibilityToggle}
										onMentionZoomTo={onMentionZoomTo}
										className="text-xs"
									/>
									{callout?.media?.length ? <CalloutMediaPreview media={callout.media} /> : null}
								</div>
								{callout?.media?.[0] ? (
									<a
										href={callout.media[0].url}
										target="_blank"
										rel="noreferrer"
										className="mt-1 inline-flex items-center gap-1 self-end text-[10px] text-muted-foreground hover:text-foreground"
									>
										Open media <ExternalLink className="h-3 w-3" />
									</a>
								) : null}
							</div>
						)}
					</article>
				)
			})}
		</div>
	)
}
