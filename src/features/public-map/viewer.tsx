import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as maplibregl from 'maplibre-gl'
import { pointOnFeature } from '@turf/turf'
import type { Feature, FeatureCollection } from 'geojson'
import { getFeatureCallouts } from '@/lib/geo/callouts'
import { computeBboxFor } from '@/lib/nostr/geo-event/helpers'
import {
	buildEarthlyFeatureLayerBundle,
	getMapStyleTextFont,
	presentationLayerBundleIds,
} from '@/features/geo-editor/map-presentation/layerSpecs'
import {
	handleMissingDisplayIconImage,
	registerDisplayIconImages,
} from '@/features/geo-editor/icons/registerDisplayIconImages'
import { collectLineArrowFeatures } from '@/features/geo-editor/utils/lineArrows'
import { connectMapHost } from './bridge'
import { parseViewOptions, validateMapData, viewOptionsSchema, type MapSnapshot } from './model'
import 'maplibre-gl/dist/maplibre-gl.css'
import './viewer.css'

const rootElement = document.getElementById('root')!
const serverUrl = rootElement.dataset.server!
const isChat = rootElement.dataset.mode === 'mcp'
const isEmbed = rootElement.dataset.mode === 'embed'

function checkedSnapshot(value: unknown): MapSnapshot {
	if (!value || typeof value !== 'object') throw new Error('No map data was returned')
	const snapshot = value as MapSnapshot
	if (typeof snapshot.title !== 'string' || typeof snapshot.description !== 'string')
		throw new Error('Invalid map metadata')
	return {
		...snapshot,
		data: validateMapData(snapshot.data),
		view: viewOptionsSchema.parse(snapshot.view ?? {}),
	}
}

function featureName(feature: Feature) {
	return String(
		feature.properties?.name ?? feature.properties?.label ?? feature.id ?? feature.geometry.type,
	)
}

function MapViewer() {
	const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null)
	const [error, setError] = useState('')
	const [mapReady, setMapReady] = useState(false)
	const [selected, setSelected] = useState<Feature | null>(null)
	const [notice, setNotice] = useState('')
	const container = useRef<HTMLElement>(null)
	const mapRef = useRef<maplibregl.Map | null>(null)
	const bridge = useRef<ReturnType<typeof connectMapHost> | null>(null)

	useEffect(() => {
		if (isChat) {
			bridge.current = connectMapHost((result) => {
				try {
					const next = (result as { _meta?: { map?: unknown } })?._meta?.map
					setSnapshot(checkedSnapshot(next))
					setError('')
					setSelected(null)
				} catch (failure) {
					setError(String(failure))
				}
			}, setError)
			return () => bridge.current?.dispose()
		}
		const controller = new AbortController()
		void (async () => {
			try {
				const reference = rootElement.dataset.reference
				if (!reference) throw new Error('Open a published Earthly map link to view it here.')
				const response = await fetch(
					new URL(`/api/maps/${encodeURIComponent(reference)}`, serverUrl),
					{ signal: controller.signal },
				)
				const result = await response.json()
				if (!response.ok) throw new Error(result.error ?? 'Map could not be loaded')
				const next = checkedSnapshot(result)
				next.view = parseViewOptions(new URLSearchParams(window.location.search))
				setSnapshot(next)
			} catch (failure) {
				if (!controller.signal.aborted)
					setError(failure instanceof Error ? failure.message : 'Map could not be loaded')
			}
		})()
		return () => controller.abort()
	}, [])

	const select = useCallback(
		(feature: Feature) => {
			setSelected(feature)
			const coords = pointOnFeature(feature).geometry.coordinates
			mapRef.current?.easeTo({ center: [coords[0]!, coords[1]!], duration: 400 })
			if (bridge.current) {
				void bridge.current
					.select({
						reference: snapshot?.reference,
						draftId: snapshot?.draftId,
						revision: snapshot?.revision,
						selectedFeatureId: feature.id,
						selectedFeatureName: featureName(feature),
					})
					.then(() => setNotice('Selection added to the conversation'))
					.catch(() =>
						setNotice('Selected on the map. The chat host could not receive the selection.'),
					)
			}
		},
		[snapshot],
	)

	useEffect(() => {
		if (!snapshot || !container.current) return
		setMapReady(false)
		setSelected(null)
		const { view, data } = snapshot
		const style = `https://tiles.openfreemap.org/styles/${view.theme === 'dark' ? 'dark' : 'liberty'}`
		let map: maplibregl.Map
		try {
			map = new maplibregl.Map({
				container: container.current,
				style,
				center: view.center ?? [0, 15],
				zoom: view.zoom ?? 1,
				scrollZoom: view.scrollZoom,
				attributionControl: { compact: true },
			})
		} catch {
			setError('This browser could not start the interactive map. WebGL is required.')
			return
		}
		mapRef.current = map
		if (view.controls)
			map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
		map.on('styleimagemissing', (event) => {
			handleMissingDisplayIconImage(map, event.id)
		})
		map.on('error', () =>
			setNotice('Some basemap resources could not load. Your map data is still available.'),
		)
		map.on('load', () => {
			registerDisplayIconImages(map)
			const rendered: FeatureCollection = {
				...data,
				features: [...data.features, ...collectLineArrowFeatures(data.features)],
			}
			map.addSource('public-map', { type: 'geojson', data: rendered })
			const ids = presentationLayerBundleIds('public-map', 'dataset')
			for (const layer of buildEarthlyFeatureLayerBundle({
				sourceId: 'public-map',
				ids,
				textFont: getMapStyleTextFont(map.getStyle()),
			}))
				map.addLayer(layer)
			const bounds = computeBboxFor(data)
			if (!view.center && bounds)
				map.fitBounds(
					[
						[bounds[0], bounds[1]],
						[bounds[2], bounds[3]],
					],
					{ padding: 65, maxZoom: view.zoom ?? 13, duration: 0 },
				)
			map.on('click', (event) => {
				const hit = map.queryRenderedFeatures(event.point, {
					layers: [ids.point, ids.fill, ids.line, ids['line-dashed'], ids['line-dotted']],
				})[0]
				const feature =
					hit && data.features.find((candidate) => String(candidate.id) === String(hit.id))
				if (feature) select(feature)
			})
			// Callout text is rendered as text, never as untrusted HTML.
			for (const feature of data.features) {
				for (const callout of getFeatureCallouts(feature).slice(0, 3)) {
					const content = document.createElement('div')
					content.className = 'map-callout'
					if (callout.title) {
						const heading = document.createElement('strong')
						heading.textContent = callout.title
						content.append(heading)
					}
					const text = document.createElement('p')
					text.textContent = callout.text
					content.append(text)
					const coords = pointOnFeature(feature).geometry.coordinates
					new maplibregl.Popup({
						closeButton: false,
						closeOnClick: false,
						maxWidth: '230px',
						offset: 12,
					})
						.setLngLat([coords[0]!, coords[1]!])
						.setDOMContent(content)
						.addTo(map)
				}
			}
			setMapReady(true)
		})
		const observer = new ResizeObserver(() => map.resize())
		observer.observe(container.current)
		return () => {
			observer.disconnect()
			map.remove()
			mapRef.current = null
		}
	}, [snapshot, select])

	return (
		<main
			className={`public-map ${isEmbed ? 'embed' : ''}`}
			data-theme={snapshot?.view.theme ?? 'light'}
		>
			{(!snapshot || snapshot.view.title) && (
				<header>
					<div>
						<span className="wordmark">
							earthly<span>↗</span>
						</span>
						<h1>{snapshot?.title ?? 'Your map'}</h1>
					</div>
					<div className="map-actions">
						{snapshot?.shareUrl && (
							<a href={snapshot.shareUrl} target="_blank" rel="noreferrer">
								Open map ↗
							</a>
						)}
						{isChat && (
							<button
								type="button"
								onClick={() =>
									void bridge.current
										?.fullscreen()
										.catch(() => setNotice('Fullscreen is unavailable in this host.'))
								}
							>
								Expand
							</button>
						)}
					</div>
				</header>
			)}
			<div className="map-stage">
				<section className="map-canvas" ref={container} aria-label="Interactive map" />
				{!mapReady && !error && (
					<div className="map-message" role="status">
						{snapshot ? 'Drawing your map…' : 'Waiting for map data…'}
					</div>
				)}
				{error && (
					<div className="map-message error" role="alert">
						{error}
					</div>
				)}
				{snapshot?.view.legend && (
					<aside className="map-legend" aria-label="Map features">
						<span className="eyebrow">{snapshot.data.features.length} locations & geometries</span>
						{snapshot.data.features.map((feature) => (
							<button
								type="button"
								key={String(feature.id)}
								aria-pressed={selected?.id === feature.id}
								onClick={() => select(feature)}
							>
								<span
									className="feature-dot"
									style={{
										backgroundColor: String(
											feature.properties?.color ??
												feature.properties?.fillColor ??
												feature.properties?.strokeColor ??
												'#1d4ed8',
										),
									}}
								/>
								{featureName(feature)}
							</button>
						))}
					</aside>
				)}
				{selected && (
					<aside className="map-detail" aria-label="Selected feature">
						<button
							type="button"
							className="close-detail"
							aria-label="Close feature details"
							onClick={() => setSelected(null)}
						>
							×
						</button>
						<strong>{featureName(selected)}</strong>
						{typeof selected.properties?.description === 'string' && (
							<p>{selected.properties.description}</p>
						)}
						{typeof selected.properties?.source === 'string' &&
							/^https?:\/\//.test(selected.properties.source) && (
								<a href={selected.properties.source} target="_blank" rel="noreferrer">
									Source ↗
								</a>
							)}
					</aside>
				)}
			</div>
			<footer>
				<span>{snapshot?.reference ? 'Public map' : 'Preview · not published'}</span>
				<span role="status">{notice || (mapReady ? 'Map ready' : '')}</span>
				<a href="https://earthly.city" target="_blank" rel="noreferrer">
					earthly.city ↗
				</a>
			</footer>
		</main>
	)
}

// MCP components have a different origin from their asset server. A fetched,
// local Blob worker avoids cross-origin Worker construction in that sandbox.
try {
	const response = await fetch(new URL('/assets/maplibre-worker.js', serverUrl))
	if (!response.ok) throw new Error('Map worker unavailable')
	const workerUrl = URL.createObjectURL(
		new Blob([await response.text()], { type: 'text/javascript' }),
	)
	maplibregl.setWorkerUrl(workerUrl)
	createRoot(rootElement).render(<MapViewer />)
	window.addEventListener('pagehide', () => URL.revokeObjectURL(workerUrl), { once: true })
} catch {
	rootElement.textContent = 'The map could not start. Reload to try again.'
	rootElement.setAttribute('role', 'alert')
}
