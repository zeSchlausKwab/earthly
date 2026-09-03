import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FeaturePopup, type FeaturePopupData } from '@/features/geo-editor/components/FeaturePopup'
import {
	GeometryChoiceMenu,
	type GeometryChoiceItem,
} from '@/features/geo-editor/components/GeometryChoiceMenu'
import { GeoEditorMap } from '@/features/geo-editor/components/map'
import { usePresentationCamera } from '@/features/geo-editor/hooks/usePresentationCamera'
import { usePresentationMapLayers } from '@/features/geo-editor/hooks/usePresentationMapLayers'
import {
	presentationGeometryChoiceId,
	readPresentationFeatureProvenance,
	type PresentationFeatureProvenance,
} from '@/features/geo-editor/map-presentation/ids'
import {
	materializePresentationLayers,
	type PresentationLayerMaterializationInput,
} from '@/features/geo-editor/map-presentation/materialize'

export interface PresentationCanvasGeometryChoice {
	readonly id: string
	readonly feature: Feature<Geometry>
	readonly provenance: PresentationFeatureProvenance
	readonly entry: PresentationLayerMaterializationInput
}

interface PresentationCanvasGeometryChoiceRequest {
	readonly point: { readonly x: number; readonly y: number }
	readonly choices: readonly PresentationCanvasGeometryChoice[]
}

export function presentationFitCollection(
	layers: readonly PresentationLayerMaterializationInput[],
): FeatureCollection {
	const materialized = materializePresentationLayers(layers)
	return {
		type: 'FeatureCollection',
		features: materialized.flatMap((entry) =>
			entry.layer.visible
				? entry.featureCollection.features.slice(0, entry.sourceFeatureCount)
				: [],
		),
	}
}

/** Collapse duplicate style-sublayer hits, but retain each authored instance. */
export function collectPresentationCanvasGeometryChoices(
	features: readonly Feature<Geometry>[],
	layers: readonly PresentationLayerMaterializationInput[],
): readonly PresentationCanvasGeometryChoice[] {
	const seen = new Set<string>()
	const choices: PresentationCanvasGeometryChoice[] = []
	for (const feature of features) {
		const provenance = readPresentationFeatureProvenance(feature.properties)
		if (!provenance) continue
		const id = presentationGeometryChoiceId(provenance)
		if (seen.has(id)) continue
		const entry = layers.find(
			(candidate) =>
				candidate.carrierId === provenance.carrierId &&
				candidate.layer.id === provenance.layerId &&
				candidate.layer.source === provenance.source &&
				candidate.sourceEvent,
		)
		if (!entry?.sourceEvent) continue
		seen.add(id)
		choices.push({ id, feature, provenance, entry })
	}
	return choices
}

function datasetName(entry: PresentationLayerMaterializationInput): string {
	const collection = entry.sourceEvent
		? (entry.featureCollection as FeatureCollection & {
				name?: string
				properties?: { name?: string }
			})
		: null
	return (
		collection?.name ??
		collection?.properties?.name ??
		entry.sourceEvent?.datasetId ??
		entry.layer.source.split(':').at(-1) ??
		'Map'
	)
}

function featureChoiceName(choice: PresentationCanvasGeometryChoice): string {
	const properties = (choice.feature.properties ?? {}) as Record<string, unknown>
	for (const candidate of [properties.name, properties.title, properties.label, properties.text]) {
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
	}
	return `${choice.feature.geometry.type} · ${choice.provenance.sourceFeatureId.slice(0, 8)}`
}

export interface PresentationCanvasProps {
	readonly carrierId: string
	readonly mapRef: RefObject<maplibregl.Map | null>
	readonly layers: readonly PresentationLayerMaterializationInput[]
	readonly camera?: import('@/lib/map-presentation').MapPresentationCameraV1
	readonly cameraIntentId: string
	readonly interactive?: boolean
	readonly compact?: boolean
	readonly className?: string
	readonly overlay?: ReactNode
	readonly containerRef?: RefObject<HTMLDivElement | null>
	readonly onMapReadyChange?: (ready: boolean) => void
}

/** The shared live presentation canvas used by the large Reader map and in-flow figures. */
export function PresentationCanvas({
	carrierId,
	mapRef,
	layers,
	camera,
	cameraIntentId,
	interactive = true,
	compact = false,
	className = '',
	overlay,
	containerRef,
	onMapReadyChange,
}: PresentationCanvasProps) {
	const internalContainerRef = useRef<HTMLDivElement>(null)
	const popupContainerRef = containerRef ?? internalContainerRef
	const [mounted, setMounted] = useState(false)
	const [featurePopup, setFeaturePopup] = useState<FeaturePopupData | null>(null)
	const [geometryChoice, setGeometryChoice] =
		useState<PresentationCanvasGeometryChoiceRequest | null>(null)
	const { ready, interactiveLayerIds } = usePresentationMapLayers({
		mapRef,
		mounted,
		layers,
	})
	const fitFeatureCollection = useMemo(() => presentationFitCollection(layers), [layers])
	usePresentationCamera({
		mapRef,
		mounted,
		intent: {
			carrierId,
			intentId: cameraIntentId,
			...(camera ? { camera } : { fitFeatureCollection }),
			animated: !compact,
			padding: compact ? 14 : 48,
			fitMaxZoom: compact ? 14 : 16,
		},
	})

	useEffect(() => {
		onMapReadyChange?.(mounted && ready)
		return () => onMapReadyChange?.(false)
	}, [mounted, onMapReadyChange, ready])

	useEffect(() => {
		if (!interactive || !mounted || !ready) return
		const map = mapRef.current
		if (!map) return

		const handleClick = (event: maplibregl.MapMouseEvent) => {
			const liveLayerIds = interactiveLayerIds.filter((id) => map.getLayer(id))
			if (liveLayerIds.length === 0) {
				setFeaturePopup(null)
				setGeometryChoice(null)
				return
			}
			const rendered = map.queryRenderedFeatures(event.point, { layers: liveLayerIds })
			const choices = collectPresentationCanvasGeometryChoices(
				rendered as unknown as Feature<Geometry>[],
				layers,
			)
			if (choices.length === 0) {
				setFeaturePopup(null)
				setGeometryChoice(null)
				return
			}
			if (choices.length > 1) {
				setFeaturePopup(null)
				setGeometryChoice({ point: { x: event.point.x, y: event.point.y }, choices })
				return
			}
			const selected = choices[0]
			if (!selected?.entry.sourceEvent) return
			setGeometryChoice(null)
			setFeaturePopup({
				dataset: selected.entry.sourceEvent as import('@/lib/nostr/geo-event').GeoDataset,
				feature: selected.feature,
				clickPosition: { x: event.point.x, y: event.point.y },
				isOwner: false,
				datasetName: datasetName(selected.entry),
				presentation: selected.provenance,
			})
		}
		const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
			const liveLayerIds = interactiveLayerIds.filter((id) => map.getLayer(id))
			const hit =
				liveLayerIds.length > 0
					? map.queryRenderedFeatures(event.point, { layers: liveLayerIds }).length > 0
					: false
			map.getCanvas().style.cursor = hit ? 'pointer' : ''
		}
		const handleMouseLeave = () => {
			map.getCanvas().style.cursor = ''
		}

		map.on('click', handleClick)
		map.on('mousemove', handleMouseMove)
		map.on('mouseout', handleMouseLeave)
		return () => {
			map.off('click', handleClick)
			map.off('mousemove', handleMouseMove)
			map.off('mouseout', handleMouseLeave)
			map.getCanvas().style.cursor = ''
		}
	}, [interactive, interactiveLayerIds, layers, mapRef, mounted, ready])

	return (
		<div
			ref={popupContainerRef}
			className={`earthly-reader-map relative min-h-0 overflow-hidden bg-muted ${className}`}
			data-presentation-ready={ready ? 'true' : 'false'}
		>
			<GeoEditorMap
				className="h-full w-full"
				showControls={!compact}
				showLocate={!compact}
				showPitch={!compact}
				showGlobe={!compact}
				controlsPosition="bottom-right"
				onLoad={(map) => {
					mapRef.current = map
					setMounted(true)
				}}
			/>
			{interactive ? (
				<>
					<FeaturePopup
						data={featurePopup}
						containerRef={popupContainerRef}
						placementMode="geometry"
						toolbarOffset={12}
						interactive
					/>
					{geometryChoice ? (
						<GeometryChoiceMenu
							items={geometryChoice.choices.map(
								(choice): GeometryChoiceItem => ({
									id: choice.id,
									name: featureChoiceName(choice),
									geometry: choice.feature.geometry,
									context: datasetName(choice.entry),
									presentationLayer: choice.provenance.layerId,
								}),
							)}
							point={geometryChoice.point}
							container={popupContainerRef.current}
							onChoose={(id) => {
								const selected = geometryChoice.choices.find((choice) => choice.id === id)
								setGeometryChoice(null)
								if (!selected?.entry.sourceEvent) return
								setFeaturePopup({
									dataset: selected.entry.sourceEvent as import('@/lib/nostr/geo-event').GeoDataset,
									feature: selected.feature,
									clickPosition: geometryChoice.point,
									isOwner: false,
									datasetName: datasetName(selected.entry),
									presentation: selected.provenance,
								})
							}}
							onClose={() => setGeometryChoice(null)}
						/>
					) : null}
				</>
			) : null}
			{overlay}
		</div>
	)
}
