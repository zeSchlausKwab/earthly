import { unixNow } from 'applesauce-core/helpers/time'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { bbox as turfBbox, pointOnFeature } from '@turf/turf'
import { isGeoJsonGeometry } from '@/lib/geo/normalizeGeoJSON'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { dropExpired } from '@/lib/nostr/expiry'
import { beaconState, type LiveBeacon } from '@/lib/nostr/live-beacon'
import {
	classifyObservationState,
	getTemporalSightingContent,
	type TemporalSighting,
} from '@/lib/nostr/temporal-sighting'
import {
	displayIconColorExpression,
	displayIconDiscRadiusExpression,
	displayIconImageExpression,
	displayIconSizeExpression,
	hasDisplayIconFilter,
	pointLabelAnchorExpression,
	pointLabelRadialOffsetExpression,
} from '../icons/displayIcon'
import { LINE_ARROW_IMAGE_ID } from '../icons/registerDisplayIconImages'
import { collectLineArrowFeatures } from '../utils/lineArrows'
import { useEditorStore } from '../store'
import { convertGeoEventsToFeatureCollection } from '../utils'

function isExternalPlaceholder(properties: unknown): boolean {
	if (!properties || typeof properties !== 'object') return false
	return (properties as Record<string, unknown>).externalPlaceholder === true
}

function getDefaultTextFontStack(
	style: maplibregl.StyleSpecification | undefined,
): string[] | null {
	const isStringArray = (value: unknown): value is string[] =>
		Array.isArray(value) && value.every((v) => typeof v === 'string')

	const extract = (value: unknown): string[] | null => {
		if (typeof value === 'string') return [value]
		if (isStringArray(value)) return value
		if (!Array.isArray(value) || value.length === 0) return null

		const [op, ...rest] = value
		if (op === 'literal' && rest.length > 0 && isStringArray(rest[0])) return rest[0]
		if (op === 'case') {
			for (const part of rest) {
				const extracted = extract(part)
				if (extracted) return extracted
			}
		}
		return null
	}

	try {
		const layers = style?.layers ?? []
		for (const layer of layers) {
			const layout = (layer as unknown as { layout?: Record<string, unknown> }).layout
			const textFont = layout?.['text-font']
			const extracted = extract(textFont)
			if (extracted) return extracted
		}
	} catch {
		// ignore
	}

	return null
}

// Layer/Source IDs
const REMOTE_SOURCE_ID = 'geo-editor-remote-datasets'
const REMOTE_FILL_LAYER = 'geo-editor-remote-fill'
const REMOTE_LINE_LAYER = 'geo-editor-remote-line'
const REMOTE_LINE_DASHED_LAYER = 'geo-editor-remote-line-dashed'
const REMOTE_LINE_DOTTED_LAYER = 'geo-editor-remote-line-dotted'
const REMOTE_LINE_ARROW_LAYER = 'geo-editor-remote-line-arrow'
const REMOTE_POINT_LAYER = 'geo-editor-remote-point'
const REMOTE_POINT_ICON_LAYER = 'geo-editor-remote-point-icon'
const REMOTE_LABEL_LAYER = 'geo-editor-remote-label'
const REMOTE_LINE_LABEL_LAYER = 'geo-editor-remote-line-label'
const REMOTE_ANNOTATION_ANCHOR_LAYER = 'geo-editor-remote-annotation-anchor'
const REMOTE_ANNOTATION_LAYER = 'geo-editor-remote-annotation'
const BLOB_PREVIEW_SOURCE_ID = 'geo-editor-blob-preview'
const BLOB_PREVIEW_FILL_LAYER = 'geo-editor-blob-preview-fill'
const BLOB_PREVIEW_LINE_LAYER = 'geo-editor-blob-preview-line'
const REMOTE_POLYGON_PROXY_SOURCE_ID = 'geo-editor-remote-polygon-proxies'
const REMOTE_POLYGON_PROXY_LAYER = 'geo-editor-remote-polygon-proxy'

// Clustering source/layer IDs
const CLUSTERED_SOURCE_ID = 'geo-editor-clustered-points'
const CLUSTER_CIRCLE_LAYER = 'geo-editor-cluster-circles'
const CLUSTER_COUNT_LAYER = 'geo-editor-cluster-count'
const UNCLUSTERED_POINT_LAYER = 'geo-editor-unclustered-point'
const UNCLUSTERED_POINT_ICON_LAYER = 'geo-editor-unclustered-point-icon'

// Temporal Sighting (kind 37522) marker source/layer IDs (D-05/D-06).
const SIGHTING_SOURCE_ID = 'geo-editor-sightings'
// Exported so the map-interaction layer (useMapInteractions) can bind the
// click/hover handlers that turn a Sighting marker into "open + locate in list".
export const SIGHTING_HIT_LAYER = 'geo-editor-sighting-hit'
const SIGHTING_HALO_LAYER = 'geo-editor-sighting-halo'
const SIGHTING_CIRCLE_LAYER = 'geo-editor-sighting-circle'
const SIGHTING_GLYPH_LAYER = 'geo-editor-sighting-glyph'

// Observation-state marker colors. Resolved from the oklch design tokens in
// styles/globals.css (--primary / --secondary / --muted-foreground) to the
// concrete hex the existing map layers use. live-now is the ONE accent focal
// point on the canvas (UI-SPEC §2); upcoming/past recede (no accent).
const SIGHTING_COLOR_LIVE = '#fdc700' // --primary (warm amber/gold) — the focal point
const SIGHTING_COLOR_UPCOMING = '#00bcff' // --secondary (blue)
const SIGHTING_COLOR_PAST = '#737373' // --muted-foreground

// Live Beacon (kind 37521) marker source/layer IDs (BEACON-03, D-07/D-08). A
// SEPARATE source/layer pair from the Sighting marker: a beacon is live PRESENCE
// (someone is here, right now), not an ephemeral observation.
const BEACON_SOURCE_ID = 'geo-editor-beacons'
// Exported so the map-interaction layer (useMapInteractions) can bind the
// click/hover handlers that open + locate a beacon marker (Plan 05 wiring).
export const BEACON_HIT_LAYER = 'geo-editor-beacon-hit'
const BEACON_HALO_LAYER = 'geo-editor-beacon-halo'
const BEACON_CIRCLE_LAYER = 'geo-editor-beacon-circle'
const BEACON_GLYPH_LAYER = 'geo-editor-beacon-glyph'

// Beacon lifecycle-state marker colors (UI-SPEC § Color — mirror the shipped
// Sighting hex). live = --primary accent focal point; stale/ended recede to the
// neutral --muted-foreground grey.
const BEACON_COLOR_LIVE = '#fdc700' // --primary — the live focal point
const BEACON_COLOR_GREY = '#737373' // --muted-foreground — stale/ended
// Tuned down from 48/1600/36: only geometry that is genuinely illegible on
// screen (a couple dozen pixels) collapses — a 40px polygon was still very
// much readable and collapsing it read as "my polygons turn into points".
// The whole behavior is additionally OFF by default behind the
// `geometryPointProxyEnabled` setting (Map settings → tiny-shape simplification).
const GEOMETRY_PROXY_MAX_DIMENSION_PX = 24
const GEOMETRY_PROXY_MAX_AREA_PX = 400
const LINE_PROXY_MAX_LENGTH_PX = 18

export {
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_LINE_DASHED_LAYER,
	REMOTE_LINE_DOTTED_LAYER,
	REMOTE_POINT_LAYER,
	REMOTE_LABEL_LAYER,
	REMOTE_LINE_LABEL_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	REMOTE_POLYGON_PROXY_LAYER,
	CLUSTER_CIRCLE_LAYER,
	UNCLUSTERED_POINT_LAYER,
}

function isPointGeometryType(type: string | undefined): boolean {
	return type === 'Point' || type === 'MultiPoint'
}

function isAnnotationFeature(feature: GeoJSON.Feature): boolean {
	return (feature.properties as Record<string, unknown> | undefined)?.featureType === 'annotation'
}

function shouldRenderGeometryAsPointProxy(feature: GeoJSON.Feature): boolean {
	return !isPointGeometryType(feature.geometry?.type) && !isAnnotationFeature(feature)
}

function getProjectedLineLengthPx(map: maplibregl.Map, coordinates: GeoJSON.Position[]): number {
	let total = 0
	for (let index = 1; index < coordinates.length; index += 1) {
		const previous = coordinates[index - 1]
		const current = coordinates[index]
		if (!previous || !current) continue

		const previousPoint = map.project([previous[0], previous[1]])
		const currentPoint = map.project([current[0], current[1]])
		total += Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y)
	}
	return total
}

function getGeometryProjectedLengthPx(
	map: maplibregl.Map,
	geometry: GeoJSON.Geometry,
): number | null {
	if (geometry.type === 'LineString') {
		return getProjectedLineLengthPx(map, geometry.coordinates)
	}
	if (geometry.type === 'MultiLineString') {
		return geometry.coordinates.reduce(
			(total, line) => total + getProjectedLineLengthPx(map, line),
			0,
		)
	}
	return null
}

function shouldCollapseGeometryToPointProxy(
	map: maplibregl.Map,
	feature: GeoJSON.Feature,
): boolean {
	if (!shouldRenderGeometryAsPointProxy(feature)) return false

	try {
		const [west, south, east, north] = turfBbox(feature)
		if (
			![west, south, east, north].every((value) => Number.isFinite(value)) ||
			east < west ||
			north < south
		) {
			return false
		}

		const northWest = map.project([west, north])
		const southEast = map.project([east, south])
		const width = Math.abs(southEast.x - northWest.x)
		const height = Math.abs(southEast.y - northWest.y)
		const area = width * height
		const maxDimension = Math.max(width, height)
		const projectedLength = feature.geometry
			? getGeometryProjectedLengthPx(map, feature.geometry)
			: null

		if (projectedLength !== null) {
			return (
				Number.isFinite(projectedLength) &&
				projectedLength <= LINE_PROXY_MAX_LENGTH_PX &&
				maxDimension <= GEOMETRY_PROXY_MAX_DIMENSION_PX
			)
		}

		return (
			Number.isFinite(maxDimension) &&
			Number.isFinite(area) &&
			maxDimension <= GEOMETRY_PROXY_MAX_DIMENSION_PX &&
			area <= GEOMETRY_PROXY_MAX_AREA_PX
		)
	} catch {
		return false
	}
}

function buildGeometryProxyFeature(
	feature: GeoJSON.Feature,
): GeoJSON.Feature<GeoJSON.Point> | null {
	if (!shouldRenderGeometryAsPointProxy(feature)) return null

	try {
		const representative = pointOnFeature(feature)
		const sourceBbox = turfBbox(feature)
		const properties = (feature.properties ?? {}) as Record<string, unknown>
		const color =
			typeof properties.color === 'string'
				? properties.color
				: typeof properties.fillColor === 'string'
					? properties.fillColor
					: typeof properties.strokeColor === 'string'
						? properties.strokeColor
						: undefined
		const strokeColor =
			typeof properties.strokeColor === 'string' ? properties.strokeColor : '#ffffff'
		return {
			type: 'Feature',
			id: `${feature.id ?? properties.featureId ?? 'feature'}:geometry-proxy`,
			geometry: representative.geometry,
			properties: {
				...properties,
				...(color ? { color } : {}),
				proxyFeature: true,
				sourceGeometryType: feature.geometry?.type ?? 'Unknown',
				proxySourceBbox: sourceBbox,
				strokeColor,
				radius: typeof properties.radius === 'number' ? properties.radius : 5,
			},
		}
	} catch {
		return null
	}
}

/**
 * Build the Temporal Sighting marker source data (D-05/D-06, SIGHT-03).
 *
 * Expired Sightings are REMOVED via `dropExpired` BEFORE the source is built —
 * never merely styled hidden (Pitfall P-1 / T-11-03-02). The map source is a
 * SEPARATE read path from the `useSightings` subscription, so it applies its own
 * `dropExpired` against `unixNow()` (epoch seconds, UTC — never `Date.now()` ms).
 *
 * Each surviving Sighting contributes one point feature:
 *   - geometry: `content.geometry` represented as a point (precise `Point`, or the
 *     centroid of a Line/Polygon area); legacy geometry-less events fall back to
 *     the lossy `bbox`/`g` centroid. A Sighting that yields no point is skipped —
 *     never crashes the layer (T-11-03-04).
 *   - properties.obsState: 'live' | 'upcoming' | 'past' (drives the data-driven
 *     paint `case`; live → accent).
 *   - properties.agingFactor: a linear 0→1 ramp toward the NIP-40 `expiration`
 *     (1 = fresh, → 0 near expiry) for the optional opacity-aging nice-to-have.
 */
function buildSightingSource(sightings: TemporalSighting[]): FeatureCollection<Point> {
	const now = unixNow()
	const live = dropExpired(
		sightings.map((sighting) => sighting.event),
		now,
	)
	const liveById = new Set(live.map((event) => event.id))

	const features: Feature<Point>[] = []
	for (const sighting of sightings) {
		if (!liveById.has(sighting.id)) continue
		const content = getTemporalSightingContent(sighting.event)

		// Resolve a representative point: precise geometry first, else bbox centroid.
		let coordinates: [number, number] | null = null
		if (content.geometry) {
			try {
				const point = pointOnFeature({
					type: 'Feature',
					geometry: content.geometry,
					properties: {},
				})
				const coords = point.geometry.coordinates
				if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
					coordinates = [coords[0], coords[1]]
				}
			} catch {
				coordinates = null
			}
		}
		if (!coordinates) {
			const box = sighting.boundingBox
			if (box?.every((value) => Number.isFinite(value))) {
				coordinates = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
			}
		}
		if (!coordinates) continue // skip geometry-less, non-discoverable sightings

		const obsState = classifyObservationState(content.start, content.end, now)

		// agingFactor: 1 when far from expiry, ramping to 0 at the expiration time.
		// Only meaningful within the final quartile of the window; default 1.
		let agingFactor = 1
		const expiresAt = sighting.expiresAt
		if (expiresAt !== undefined) {
			const remaining = expiresAt - now
			const quartile = 7 * 86_400 // ramp over the final week toward expiry
			if (remaining <= 0) agingFactor = 0
			else if (remaining < quartile) agingFactor = remaining / quartile
		}

		features.push({
			type: 'Feature',
			id: sighting.id,
			geometry: { type: 'Point', coordinates },
			properties: {
				obsState,
				agingFactor,
				sightingId: sighting.id,
				sightingDTag: sighting.dTag ?? '',
			},
		})
	}

	return { type: 'FeatureCollection', features }
}

/**
 * Build the Live Beacon marker source data (BEACON-03, D-07/D-08).
 *
 * The map source is a SEPARATE read path from the `useBeacons` subscription, so
 * it applies its own `dropExpired` against `unixNow()` (epoch seconds, UTC —
 * never `Date.now()` ms) BEFORE building the source (Pitfall P-1 / per-read-path
 * discipline; expired beacons are REMOVED, never merely styled hidden).
 *
 * Within the surviving set we keep the FRESHEST cast per `{pubkey,d}` session by
 * `created_at`, breaking a `created_at` tie by the greater `event.id`
 * lexicographically (the research § "seq tag" guard — a deterministic latest-wins
 * de-dup without a clock-skew `seq` tag). A removed/'removed' beacon is excluded.
 *
 * Each surviving beacon contributes one point feature:
 *   - geometry: `content.geometry` (a precise Point), else the lossy `bbox`/`g`
 *     centroid; a beacon that yields no point is skipped — never crashes the layer.
 *   - properties.beaconState: 'live' | 'stale' | 'ended' (drives the data-driven
 *     paint `case`; live → accent).
 *   - properties.lastSeenLabel: the offset "last seen …/ended …" marker label.
 *
 * Re-derived on every `useBeacons` tick (15s) so live→stale→removed flips live.
 */
function buildBeaconSource(beacons: LiveBeacon[]): FeatureCollection<Point> {
	const now = unixNow()
	const live = dropExpired(
		beacons.map((beacon) => beacon.rawEvent()),
		now,
	)
	const liveById = new Set(live.map((event) => event.id))

	// Freshest cast per {pubkey,d} session: latest created_at wins; on a tie the
	// greater event.id (lexicographic) wins — deterministic latest-wins de-dup.
	const freshestByKey = new Map<string, LiveBeacon>()
	for (const beacon of beacons) {
		if (!liveById.has(beacon.id)) continue
		const key = `${beacon.pubkey}:${beacon.dTag ?? beacon.id}`
		const current = freshestByKey.get(key)
		if (!current) {
			freshestByKey.set(key, beacon)
			continue
		}
		const isNewer =
			beacon.created_at > current.created_at ||
			(beacon.created_at === current.created_at && beacon.id > current.id)
		if (isNewer) freshestByKey.set(key, beacon)
	}

	const features: Feature<Point>[] = []
	for (const beacon of freshestByKey.values()) {
		const state = beaconState(beacon, now)
		if (state === 'removed') continue // expired — never rendered (defensive)

		// Resolve a representative point: precise geometry first, else bbox centroid.
		let coordinates: [number, number] | null = null
		const geometry = beacon.geometry
		if (geometry) {
			try {
				const point = pointOnFeature({
					type: 'Feature',
					geometry,
					properties: {},
				})
				const coords = point.geometry.coordinates
				if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
					coordinates = [coords[0], coords[1]]
				}
			} catch {
				coordinates = null
			}
		}
		if (!coordinates) {
			const box = beacon.boundingBox
			if (box?.every((value) => Number.isFinite(value))) {
				coordinates = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
			}
		}
		if (!coordinates) continue // skip geometry-less, non-discoverable beacons

		// Offset marker label: honest last-seen age (live/stale) or terminal "ended".
		const ageMin = Math.max(0, Math.floor((now - beacon.created_at) / 60))
		const lastSeenLabel =
			state === 'ended'
				? ageMin < 1
					? 'ended just now'
					: `ended ${ageMin}m ago`
				: ageMin < 1
					? 'last seen now'
					: `last seen ${ageMin}m ago`

		features.push({
			type: 'Feature',
			id: beacon.id,
			geometry: { type: 'Point', coordinates },
			properties: {
				beaconState: state,
				lastSeenLabel,
				beaconId: beacon.id,
				beaconDTag: beacon.dTag ?? '',
				beaconLabel: beacon.beacon.label ?? '',
			},
		})
	}

	return { type: 'FeatureCollection', features }
}

interface UseMapLayersOptions {
	mapRef: React.MutableRefObject<maplibregl.Map | null>
	mounted: boolean
	visibleGeoEvents: GeoDataset[]
	/** Live Temporal Sightings (kind 37522) to render as observation-state markers. */
	visibleSightings?: TemporalSighting[]
	/** Live Beacons (kind 37521) to render as lifecycle-state presence markers. */
	visibleBeacons?: LiveBeacon[]
	resolvedCollectionResolver: (event: GeoDataset) => FeatureCollection | undefined
	/** Version counter that increments when resolved blob data changes, triggers re-render */
	resolvedCollectionsVersion: number
}

export function useMapLayers({
	mapRef,
	mounted,
	visibleGeoEvents,
	visibleSightings = [],
	visibleBeacons = [],
	resolvedCollectionResolver,
	resolvedCollectionsVersion,
}: UseMapLayersOptions) {
	const [remoteLayersReady, setRemoteLayersReady] = useState(false)
	const [styleInitVersion, setStyleInitVersion] = useState(0)
	const blobPreviewCollection = useEditorStore((state) => state.blobPreviewCollection)
	const pointClusteringEnabled = useEditorStore((state) => state.pointClusteringEnabled)
	const geometryPointProxyEnabled = useEditorStore((state) => state.geometryPointProxyEnabled)
	const syncRemoteDatasetsRef = useRef<(() => void) | null>(null)
	const zoomSyncFrameRef = useRef<number | null>(null)

	useEffect(() => {
		if (!mapRef.current || !mounted) return
		const mapInstance = mapRef.current

		const scheduleDatasetSync = () => {
			if (zoomSyncFrameRef.current != null) return
			zoomSyncFrameRef.current = window.requestAnimationFrame(() => {
				zoomSyncFrameRef.current = null
				syncRemoteDatasetsRef.current?.()
			})
		}

		scheduleDatasetSync()
		mapInstance.on('zoom', scheduleDatasetSync)

		return () => {
			if (zoomSyncFrameRef.current != null) {
				window.cancelAnimationFrame(zoomSyncFrameRef.current)
				zoomSyncFrameRef.current = null
			}
			try {
				mapInstance.off('zoom', scheduleDatasetSync)
			} catch {
				// Map may have been removed
			}
		}
	}, [mounted, mapRef])

	// Initialize extra layers when map is ready
	useEffect(() => {
		if (!mapRef.current || !mounted) return
		const mapInstance = mapRef.current

		let disposed = false
		let initScheduled = false
		let initTimeoutId: number | null = null

		const initLayers = () => {
			if (disposed) return
			let textFont: string[] | null = null
			try {
				// Check if we can safely access the style
				const style = mapInstance.getStyle()
				if (!style) return
				textFont = getDefaultTextFontStack(style)
			} catch {
				return
			}

			try {
				// Add source if it doesn't exist
				if (!mapInstance.getSource(REMOTE_SOURCE_ID)) {
					mapInstance.addSource(REMOTE_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				// Add layers only if they don't exist
				if (!mapInstance.getLayer(REMOTE_FILL_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_FILL_LAYER,
						type: 'fill',
						source: REMOTE_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'fill-color': ['coalesce', ['get', 'fillColor'], ['get', 'color'], '#1d4ed8'],
							'fill-opacity': [
								'case',
								['boolean', ['get', 'collapseToPointProxy'], false],
								0,
								['coalesce', ['get', 'fillOpacity'], 0.15],
							],
						},
					})
				}
				// Polygon outline layer
				const REMOTE_POLYGON_STROKE_LAYER = 'geo-editor-remote-polygon-stroke'
				if (!mapInstance.getLayer(REMOTE_POLYGON_STROKE_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POLYGON_STROKE_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'line-color': [
								'coalesce',
								['get', 'strokeColor'],
								['get', 'fillColor'],
								['get', 'color'],
								'#1d4ed8',
							],
							'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'line-opacity': ['case', ['boolean', ['get', 'collapseToPointProxy'], false], 0, 1],
						},
					})
				}
				if (!mapInstance.getLayer(REMOTE_LINE_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							[
								'any',
								['==', ['geometry-type'], 'LineString'],
								['==', ['geometry-type'], 'MultiLineString'],
							],
							['any', ['!', ['has', 'lineDash']], ['==', ['get', 'lineDash'], 'solid']],
						],
						paint: {
							'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'color'], '#1d4ed8'],
							'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'line-opacity': [
								'case',
								['boolean', ['get', 'collapseToPointProxy'], false],
								0,
								['coalesce', ['get', 'strokeOpacity'], 1],
							],
						},
					})
				}
				const remotePatternedLinePaint: NonNullable<maplibregl.LineLayerSpecification['paint']> = {
					'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'color'], '#1d4ed8'],
					'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
					'line-opacity': [
						'case',
						['boolean', ['get', 'collapseToPointProxy'], false],
						0,
						['coalesce', ['get', 'strokeOpacity'], 1],
					],
				}
				const remoteLineGeometryFilter: maplibregl.FilterSpecification = [
					'any',
					['==', ['geometry-type'], 'LineString'],
					['==', ['geometry-type'], 'MultiLineString'],
				]
				if (!mapInstance.getLayer(REMOTE_LINE_DASHED_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_DASHED_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: ['all', remoteLineGeometryFilter, ['==', ['get', 'lineDash'], 'dashed']],
						paint: {
							...remotePatternedLinePaint,
							'line-dasharray': [4, 2],
						},
					})
				}
				if (!mapInstance.getLayer(REMOTE_LINE_DOTTED_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_DOTTED_LAYER,
						type: 'line',
						source: REMOTE_SOURCE_ID,
						filter: ['all', remoteLineGeometryFilter, ['==', ['get', 'lineDash'], 'dotted']],
						paint: {
							...remotePatternedLinePaint,
							'line-dasharray': [1, 2],
						},
					})
				}
				if (!mapInstance.getLayer(REMOTE_LINE_ARROW_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_ARROW_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: ['==', ['get', 'meta'], 'arrowhead'],
						layout: {
							'icon-image': LINE_ARROW_IMAGE_ID,
							'icon-size': [
								'interpolate',
								['linear'],
								['coalesce', ['get', 'strokeWidth'], 2],
								1,
								0.48,
								4,
								0.62,
								10,
								0.82,
							],
							'icon-rotate': ['get', 'arrowBearing'],
							'icon-rotation-alignment': 'map',
							'icon-pitch-alignment': 'map',
							'icon-allow-overlap': true,
							'icon-ignore-placement': true,
						},
						paint: {
							'icon-color': ['coalesce', ['get', 'strokeColor'], '#1d4ed8'],
							'icon-opacity': ['coalesce', ['get', 'strokeOpacity'], 1],
						},
					})
				}
				// Point layer (excludes annotations)
				if (!mapInstance.getLayer(REMOTE_POINT_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POINT_LAYER,
						type: 'circle',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
							['!=', ['get', 'featureType'], 'annotation'],
							['!=', ['get', 'meta'], 'arrowhead'],
						],
						paint: {
							// Iconed points reuse this circle as the glyph's backing disc
							// (color fill + strokeColor ring), sized up to fit the glyph.
							'circle-radius': [
								'case',
								hasDisplayIconFilter(),
								displayIconDiscRadiusExpression(),
								['coalesce', ['get', 'radius'], 6],
							],
							'circle-color': ['coalesce', ['get', 'color'], ['get', 'fillColor'], '#1d4ed8'],
							'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
						},
					})
				}

				// Point icon layer — remote dataset points with a `displayIcon` style
				// property render an SDF glyph tinted with the feature's `strokeColor`
				// on top of the circle layer's disc + ring.
				// Unknown icon ids resolve to the always-registered fallback marker
				// (coalesce/image pattern), so points never silently vanish.
				if (!mapInstance.getLayer(REMOTE_POINT_ICON_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POINT_ICON_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
							['!=', ['get', 'featureType'], 'annotation'],
							hasDisplayIconFilter(),
						],
						layout: {
							'icon-image': displayIconImageExpression(),
							'icon-size': displayIconSizeExpression(),
							'icon-allow-overlap': true,
							'icon-ignore-placement': true,
						},
						paint: {
							'icon-color': displayIconColorExpression(),
						},
					})
				}

				// Annotation anchor layer (small circle marker)
				if (!mapInstance.getLayer(REMOTE_ANNOTATION_ANCHOR_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_ANNOTATION_ANCHOR_LAYER,
						type: 'circle',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'featureType'], 'annotation'],
						],
						paint: {
							'circle-radius': 4,
							'circle-color': '#f59e0b', // Amber
							'circle-stroke-width': 2,
							'circle-stroke-color': '#fff',
						},
					})
				}

				// Annotation text layer.
				// NOTE: no `isStyleLoaded()` gate on the text layers — that is the
				// STRICT loaded check (style + all sources/sprites settled) and is
				// routinely false during init while geojson sources stream, which
				// silently skipped these layers with no retry until the next full
				// style reload (labels missing in view mode). `addLayer` only needs
				// the style itself; the too-early case throws, is caught below, and
				// the `style.load` listener re-runs init — same path the non-text
				// layers already rely on.
				if (textFont && !mapInstance.getLayer(REMOTE_ANNOTATION_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_ANNOTATION_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'featureType'], 'annotation'],
						],
						layout: {
							'text-field': ['coalesce', ['get', 'text'], 'Annotation'],
							'text-font': textFont,
							'text-size': ['coalesce', ['get', 'textFontSize'], 14],
							'text-anchor': 'top',
							'text-offset': [0, 0.8],
							'text-allow-overlap': true,
							'text-ignore-placement': true,
						},
						paint: {
							'text-color': ['coalesce', ['get', 'textColor'], '#1f2937'],
							'text-halo-color': ['coalesce', ['get', 'textHaloColor'], '#ffffff'],
							'text-halo-width': ['coalesce', ['get', 'textHaloWidth'], 1.5],
						},
					})
				}

				// Feature label layer (for non-annotation features with labels)
				if (textFont && !mapInstance.getLayer(REMOTE_LABEL_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LABEL_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['has', 'label'],
							['!=', ['get', 'featureType'], 'annotation'],
							['!=', ['geometry-type'], 'LineString'],
							['!=', ['geometry-type'], 'MultiLineString'],
						],
						layout: {
							'text-field': ['get', 'label'],
							'text-font': textFont,
							'text-size': 12,
							// Point labels hang below the marker (clearing the icon disc)
							// so the glyph stays readable; line/polygon labels stay centered.
							'text-anchor': pointLabelAnchorExpression(),
							'text-radial-offset': pointLabelRadialOffsetExpression(12),
							'text-allow-overlap': false,
							'text-ignore-placement': false,
						},
						paint: {
							'text-color': '#374151',
							'text-halo-color': '#ffffff',
							'text-halo-width': 1.5,
							'text-opacity': ['case', ['boolean', ['get', 'collapseToPointProxy'], false], 0, 1],
						},
					})
				}

				if (textFont && !mapInstance.getLayer(REMOTE_LINE_LABEL_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_LINE_LABEL_LAYER,
						type: 'symbol',
						source: REMOTE_SOURCE_ID,
						filter: [
							'all',
							['has', 'label'],
							[
								'any',
								['==', ['geometry-type'], 'LineString'],
								['==', ['geometry-type'], 'MultiLineString'],
							],
						],
						layout: {
							'symbol-placement': 'line-center',
							'text-field': ['get', 'label'],
							'text-font': textFont,
							'text-size': 12,
							'text-rotation-alignment': 'map',
							'text-keep-upright': true,
							'text-allow-overlap': true,
							'text-ignore-placement': true,
						},
						paint: {
							'text-color': '#374151',
							'text-halo-color': '#ffffff',
							'text-halo-width': 1.5,
							'text-opacity': ['case', ['boolean', ['get', 'collapseToPointProxy'], false], 0, 1],
						},
					})
				}

				// Blob preview source/layers
				if (!mapInstance.getSource(BLOB_PREVIEW_SOURCE_ID)) {
					mapInstance.addSource(BLOB_PREVIEW_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				if (!mapInstance.getLayer(BLOB_PREVIEW_FILL_LAYER)) {
					mapInstance.addLayer({
						id: BLOB_PREVIEW_FILL_LAYER,
						type: 'fill',
						source: BLOB_PREVIEW_SOURCE_ID,
						filter: [
							'any',
							['==', ['geometry-type'], 'Polygon'],
							['==', ['geometry-type'], 'MultiPolygon'],
						],
						paint: {
							'fill-color': '#f97316',
							'fill-opacity': 0.2,
						},
					})
				}
				if (!mapInstance.getLayer(BLOB_PREVIEW_LINE_LAYER)) {
					mapInstance.addLayer({
						id: BLOB_PREVIEW_LINE_LAYER,
						type: 'line',
						source: BLOB_PREVIEW_SOURCE_ID,
						paint: {
							'line-color': '#f97316',
							'line-width': 2,
						},
					})
				}

				if (!mapInstance.getSource(REMOTE_POLYGON_PROXY_SOURCE_ID)) {
					mapInstance.addSource(REMOTE_POLYGON_PROXY_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				if (!mapInstance.getLayer(REMOTE_POLYGON_PROXY_LAYER)) {
					mapInstance.addLayer({
						id: REMOTE_POLYGON_PROXY_LAYER,
						type: 'circle',
						source: REMOTE_POLYGON_PROXY_SOURCE_ID,
						paint: {
							'circle-radius': ['coalesce', ['get', 'radius'], 5],
							'circle-color': ['coalesce', ['get', 'color'], ['get', 'fillColor'], '#1d4ed8'],
							'circle-stroke-width': 2,
							'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#ffffff'],
							'circle-opacity': 0.95,
						},
					})
				}

				// Clustered points source
				if (!mapInstance.getSource(CLUSTERED_SOURCE_ID)) {
					mapInstance.addSource(CLUSTERED_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
						cluster: true,
						clusterMaxZoom: 14,
						clusterRadius: 50,
					})
				}

				// Cluster circle layer - styled with size based on point count
				if (!mapInstance.getLayer(CLUSTER_CIRCLE_LAYER)) {
					mapInstance.addLayer({
						id: CLUSTER_CIRCLE_LAYER,
						type: 'circle',
						source: CLUSTERED_SOURCE_ID,
						filter: ['has', 'point_count'],
						paint: {
							// Step expression for circle color based on cluster size
							'circle-color': [
								'step',
								['get', 'point_count'],
								'#60a5fa', // blue-400 for small clusters
								10,
								'#3b82f6', // blue-500 for medium
								50,
								'#2563eb', // blue-600 for large
								100,
								'#1d4ed8', // blue-700 for very large
							],
							// Step expression for circle radius based on cluster size
							'circle-radius': [
								'step',
								['get', 'point_count'],
								16, // base size
								10,
								20,
								50,
								24,
								100,
								28,
							],
							'circle-stroke-width': 2,
							'circle-stroke-color': '#ffffff',
						},
					})
				}

				// Cluster count label layer
				if (textFont && !mapInstance.getLayer(CLUSTER_COUNT_LAYER)) {
					mapInstance.addLayer({
						id: CLUSTER_COUNT_LAYER,
						type: 'symbol',
						source: CLUSTERED_SOURCE_ID,
						filter: ['has', 'point_count'],
						layout: {
							'text-field': ['get', 'point_count_abbreviated'],
							'text-font': textFont,
							'text-size': 12,
							'text-allow-overlap': true,
						},
						paint: {
							'text-color': '#ffffff',
						},
					})
				}

				// Unclustered point layer (individual points when not clustered)
				if (!mapInstance.getLayer(UNCLUSTERED_POINT_LAYER)) {
					mapInstance.addLayer({
						id: UNCLUSTERED_POINT_LAYER,
						type: 'circle',
						source: CLUSTERED_SOURCE_ID,
						filter: [
							'all',
							['!', ['has', 'point_count']],
							['!=', ['get', 'featureType'], 'annotation'],
						],
						paint: {
							// Same disc + ring treatment as the remote point layer.
							'circle-radius': [
								'case',
								hasDisplayIconFilter(),
								displayIconDiscRadiusExpression(),
								['coalesce', ['get', 'radius'], 6],
							],
							'circle-color': ['coalesce', ['get', 'color'], ['get', 'fillColor'], '#1d4ed8'],
							'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
							'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
						},
					})
				}

				// Unclustered point icon layer — same displayIcon treatment as the
				// remote point layer, for the clustering-enabled source.
				if (!mapInstance.getLayer(UNCLUSTERED_POINT_ICON_LAYER)) {
					mapInstance.addLayer({
						id: UNCLUSTERED_POINT_ICON_LAYER,
						type: 'symbol',
						source: CLUSTERED_SOURCE_ID,
						filter: [
							'all',
							['!', ['has', 'point_count']],
							['!=', ['get', 'featureType'], 'annotation'],
							hasDisplayIconFilter(),
						],
						layout: {
							'icon-image': displayIconImageExpression(),
							'icon-size': displayIconSizeExpression(),
							'icon-allow-overlap': true,
							'icon-ignore-placement': true,
						},
						paint: {
							'icon-color': displayIconColorExpression(),
						},
					})
				}

				// ── Temporal Sighting marker source + layers (D-05/D-06) ──────────
				// A distinct, observation-state-aware marker that reads as an
				// ephemeral observation (not a dataset dot). Source data is built
				// from `dropExpired`-filtered Sightings (Pitfall P-1); paint is
				// keyed on the per-feature `obsState` property.
				if (!mapInstance.getSource(SIGHTING_SOURCE_ID)) {
					mapInstance.addSource(SIGHTING_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				// Invisible ≥44px touch hit target (mobile-first; UI-SPEC Spacing).
				if (!mapInstance.getLayer(SIGHTING_HIT_LAYER)) {
					mapInstance.addLayer({
						id: SIGHTING_HIT_LAYER,
						type: 'circle',
						source: SIGHTING_SOURCE_ID,
						paint: {
							'circle-radius': 22,
							'circle-color': '#000000',
							'circle-opacity': 0,
						},
					})
				}
				// Soft accent halo under LIVE sightings only — a wide, low-opacity,
				// blurred disc that makes the focal points glow without shouting.
				// Pure presentation (separate layer beneath the dot; no state logic).
				if (!mapInstance.getLayer(SIGHTING_HALO_LAYER)) {
					mapInstance.addLayer({
						id: SIGHTING_HALO_LAYER,
						type: 'circle',
						source: SIGHTING_SOURCE_ID,
						filter: ['==', ['get', 'obsState'], 'live'],
						paint: {
							'circle-radius': 19,
							'circle-color': SIGHTING_COLOR_LIVE,
							'circle-opacity': 0.18,
							'circle-blur': 0.6,
						},
					})
				}
				// Visible marker: data-driven color keyed on observation state.
				// live → --primary accent (the ONE map focal point); upcoming →
				// --secondary blue; past → --muted-foreground. Optional opacity
				// aging toward NIP-40 expiry via `agingFactor` (D-05 nice-to-have).
				if (!mapInstance.getLayer(SIGHTING_CIRCLE_LAYER)) {
					mapInstance.addLayer({
						id: SIGHTING_CIRCLE_LAYER,
						type: 'circle',
						source: SIGHTING_SOURCE_ID,
						paint: {
							'circle-radius': ['case', ['==', ['get', 'obsState'], 'live'], 10, 7],
							'circle-color': [
								'case',
								['==', ['get', 'obsState'], 'live'],
								SIGHTING_COLOR_LIVE,
								['==', ['get', 'obsState'], 'upcoming'],
								SIGHTING_COLOR_UPCOMING,
								SIGHTING_COLOR_PAST,
							],
							'circle-opacity': [
								'interpolate',
								['linear'],
								['coalesce', ['get', 'agingFactor'], 1],
								0,
								0.35,
								1,
								1,
							],
							// A white contrast ring on every state — separates dense dots
							// from each other and from the basemap; live gets the wider ring.
							'circle-stroke-width': ['case', ['==', ['get', 'obsState'], 'live'], 2.5, 1.5],
							'circle-stroke-color': '#ffffff',
							'circle-stroke-opacity': [
								'interpolate',
								['linear'],
								['coalesce', ['get', 'agingFactor'], 1],
								0,
								0.35,
								1,
								0.9,
							],
						},
					})
				}
				// Eye/observation glyph so the marker reads as an ephemeral sighting,
				// not a dataset dot (UI-SPEC Net-New §2). Uses a unicode observation
				// glyph (no sprite dependency) via a symbol text layer.
				// (No `isStyleLoaded()` gate — see the annotation-text-layer note.)
				if (textFont && !mapInstance.getLayer(SIGHTING_GLYPH_LAYER)) {
					mapInstance.addLayer({
						id: SIGHTING_GLYPH_LAYER,
						type: 'symbol',
						source: SIGHTING_SOURCE_ID,
						layout: {
							'text-field': '◉', // fisheye / observation glyph
							'text-font': textFont,
							'text-size': 12,
							'text-allow-overlap': true,
							'text-ignore-placement': true,
						},
						paint: {
							'text-color': '#ffffff',
							'text-opacity': ['coalesce', ['get', 'agingFactor'], 1],
						},
					})
				}

				// ── Live Beacon marker source + layers (BEACON-03, D-07/D-08) ─────
				// A distinct presence marker (someone is HERE, right now), separate
				// from the Sighting observation marker and the dataset dot. Source
				// data is built from `dropExpired`-filtered, freshest-per-{pubkey,d}
				// beacons; paint is keyed on the per-feature `beaconState` property.
				if (!mapInstance.getSource(BEACON_SOURCE_ID)) {
					mapInstance.addSource(BEACON_SOURCE_ID, {
						type: 'geojson',
						data: { type: 'FeatureCollection', features: [] },
					})
				}
				// Invisible ≥44px touch hit target (mobile-first; UI-SPEC Spacing).
				if (!mapInstance.getLayer(BEACON_HIT_LAYER)) {
					mapInstance.addLayer({
						id: BEACON_HIT_LAYER,
						type: 'circle',
						source: BEACON_SOURCE_ID,
						paint: {
							'circle-radius': 22,
							'circle-color': '#000000',
							'circle-opacity': 0,
						},
					})
				}
				// Soft accent halo under LIVE beacons — same glow treatment as live
				// sightings (pure presentation layer beneath the dot).
				if (!mapInstance.getLayer(BEACON_HALO_LAYER)) {
					mapInstance.addLayer({
						id: BEACON_HALO_LAYER,
						type: 'circle',
						source: BEACON_SOURCE_ID,
						filter: ['==', ['get', 'beaconState'], 'live'],
						paint: {
							'circle-radius': 19,
							'circle-color': BEACON_COLOR_LIVE,
							'circle-opacity': 0.18,
							'circle-blur': 0.6,
						},
					})
				}
				// Visible marker: data-driven paint keyed on beaconState.
				//   live  → solid --primary fill, full opacity, white contrast ring
				//   stale → --muted-foreground fill at 70% opacity, thin white ring
				//   ended → hollow: transparent fill, --muted-foreground outline ring
				if (!mapInstance.getLayer(BEACON_CIRCLE_LAYER)) {
					mapInstance.addLayer({
						id: BEACON_CIRCLE_LAYER,
						type: 'circle',
						source: BEACON_SOURCE_ID,
						paint: {
							'circle-radius': ['case', ['==', ['get', 'beaconState'], 'live'], 10, 8],
							'circle-color': [
								'case',
								['==', ['get', 'beaconState'], 'live'],
								BEACON_COLOR_LIVE,
								['==', ['get', 'beaconState'], 'ended'],
								'rgba(0,0,0,0)', // hollow — transparent fill
								BEACON_COLOR_GREY, // stale
							],
							'circle-opacity': [
								'case',
								['==', ['get', 'beaconState'], 'live'],
								1,
								['==', ['get', 'beaconState'], 'ended'],
								0,
								0.7, // stale at 70%
							],
							'circle-stroke-width': [
								'case',
								['==', ['get', 'beaconState'], 'live'],
								2.5, // white contrast ring
								['==', ['get', 'beaconState'], 'ended'],
								2, // hollow outline ring
								1.5, // stale: thin separation ring
							],
							'circle-stroke-color': [
								'case',
								['==', ['get', 'beaconState'], 'live'],
								'#ffffff',
								['==', ['get', 'beaconState'], 'ended'],
								BEACON_COLOR_GREY,
								'#ffffff',
							],
						},
					})
				}
				// Broadcast/radio glyph so the marker reads as live presence, distinct
				// from the Sighting observation eye. A unicode broadcast glyph for
				// live/stale, a stop square for ended (no sprite dependency).
				// (No `isStyleLoaded()` gate — see the annotation-text-layer note.)
				if (textFont && !mapInstance.getLayer(BEACON_GLYPH_LAYER)) {
					mapInstance.addLayer({
						id: BEACON_GLYPH_LAYER,
						type: 'symbol',
						source: BEACON_SOURCE_ID,
						layout: {
							'text-field': [
								'case',
								['==', ['get', 'beaconState'], 'ended'],
								'■', // stop glyph — clearly terminal
								'((•))', // broadcast/radio motif — live presence
							],
							'text-font': textFont,
							'text-size': ['case', ['==', ['get', 'beaconState'], 'ended'], 11, 9],
							'text-allow-overlap': true,
							'text-ignore-placement': true,
							// Offset "last seen …/ended …" label sits above-leading so a
							// thumb over the dot doesn't cover the honest age (UI-SPEC §5).
							'text-offset': [0, 0],
						},
						paint: {
							'text-color': [
								'case',
								['==', ['get', 'beaconState'], 'live'],
								'#ffffff',
								BEACON_COLOR_GREY,
							],
						},
					})
				}

				setRemoteLayersReady(true)
				setStyleInitVersion((prev) => prev + 1)
			} catch (error) {
				console.warn('Failed to initialize remote map layers:', error)
			}
		}

		const scheduleInitLayers = () => {
			if (disposed) return
			if (initScheduled) return
			initScheduled = true
			setRemoteLayersReady(false)

			// Defer to avoid mutating style during MapLibre's placement/render stack.
			initTimeoutId = window.setTimeout(() => {
				initScheduled = false
				initLayers()
			}, 0)
		}

		// Try to initialize once on mount and on subsequent style reloads (setStyle clears custom layers/sources).
		scheduleInitLayers()
		mapInstance.on('style.load', scheduleInitLayers)

		return () => {
			disposed = true
			if (initTimeoutId != null) {
				try {
					window.clearTimeout(initTimeoutId)
				} catch {
					// ignore
				}
				initTimeoutId = null
			}
			try {
				mapInstance.off('style.load', scheduleInitLayers)
			} catch {
				// Map may have been removed
			}
		}
	}, [mounted, mapRef])

	// Keep zoom-driven geometry proxy updates inside MapLibre instead of React renders.
	useEffect(() => {
		syncRemoteDatasetsRef.current = () => {
			const map = mapRef.current
			if (!map) return
			if (!remoteLayersReady) return
			void resolvedCollectionsVersion
			void styleInitVersion

			try {
				const source = map.getSource(REMOTE_SOURCE_ID) as GeoJSONSource | undefined
				const proxySource = map.getSource(REMOTE_POLYGON_PROXY_SOURCE_ID) as
					| GeoJSONSource
					| undefined
				const clusteredSource = map.getSource(CLUSTERED_SOURCE_ID) as GeoJSONSource | undefined
				if (!source) return

				const collection = convertGeoEventsToFeatureCollection(
					visibleGeoEvents,
					resolvedCollectionResolver,
				)

				// Filter out placeholder features and features with null geometry
				// to prevent MapLibre expression evaluation errors
				const filteredCollection = {
					...collection,
					features: collection.features.filter(
						(f) => f.geometry !== null && !isExternalPlaceholder(f.properties),
					),
				}

				// Ensure MapLibre only receives valid GeoJSON Features with valid Geometry
				const safeFeatures = filteredCollection.features.filter(
					(f) => f.type === 'Feature' && f.geometry !== null && isGeoJsonGeometry(f.geometry),
				)

				// Keep annotations out of clustering so they retain their label/popup behavior.
				const pointFeatures = safeFeatures.filter((f) => {
					if (!isPointGeometryType(f.geometry?.type)) return false
					return !isAnnotationFeature(f)
				})
				const annotationFeatures = safeFeatures.filter(
					(f) => isPointGeometryType(f.geometry?.type) && isAnnotationFeature(f),
				)
				const nonPointFeatures = safeFeatures.filter((f) => !isPointGeometryType(f.geometry?.type))
				const collapseToProxyById = new Set<string>()

				const geometryProxyFeatures = nonPointFeatures
					.map((feature, index) => {
						if (!geometryPointProxyEnabled) return null
						if (!shouldCollapseGeometryToPointProxy(map, feature)) return null
						const featureKey = String(feature.id ?? feature.properties?.featureId ?? index)
						collapseToProxyById.add(featureKey)
						return buildGeometryProxyFeature(feature)
					})
					.filter((feature): feature is NonNullable<typeof feature> => feature !== null)

				const nonPointCollection = {
					type: 'FeatureCollection' as const,
					features: [
						...nonPointFeatures.map((feature, index) =>
							collapseToProxyById.has(String(feature.id ?? feature.properties?.featureId ?? index))
								? {
										...feature,
										properties: {
											...(feature.properties ?? {}),
											collapseToPointProxy: true,
										},
									}
								: feature,
						),
						...collectLineArrowFeatures(
							nonPointFeatures.filter(
								(feature, index) =>
									!collapseToProxyById.has(
										String(feature.id ?? feature.properties?.featureId ?? index),
									),
							),
						),
						...annotationFeatures,
					],
				}

				const pointCollection = {
					type: 'FeatureCollection' as const,
					features: [...pointFeatures, ...geometryProxyFeatures],
				}

				const sourceCollection = pointClusteringEnabled
					? nonPointCollection
					: {
							type: 'FeatureCollection' as const,
							features: [...nonPointCollection.features, ...pointCollection.features],
						}

				source.setData(sourceCollection)

				if (clusteredSource) {
					clusteredSource.setData(
						pointClusteringEnabled ? pointCollection : { type: 'FeatureCollection', features: [] },
					)
				}
				if (proxySource) {
					proxySource.setData({
						type: 'FeatureCollection',
						features: [],
					})
				}
			} catch {
				// Map may have been removed during source switch
			}
		}

		syncRemoteDatasetsRef.current?.()
	}, [
		visibleGeoEvents,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
		remoteLayersReady,
		mapRef,
		pointClusteringEnabled,
		geometryPointProxyEnabled,
		styleInitVersion,
	])

	// Update blob preview layer
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!remoteLayersReady) return
		void styleInitVersion

		try {
			const source = map.getSource(BLOB_PREVIEW_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return
			source.setData(blobPreviewCollection ?? { type: 'FeatureCollection', features: [] })
		} catch {
			// Map may have been removed during source switch
		}
	}, [blobPreviewCollection, remoteLayersReady, mapRef, styleInitVersion])

	// Update the Temporal Sighting marker source (D-05/D-06, SIGHT-03). The source
	// FeatureCollection is rebuilt from the live (dropExpired) Sightings with the
	// observation-state and aging properties; expired markers are absent, not hidden.
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!remoteLayersReady) return
		void styleInitVersion

		try {
			const source = map.getSource(SIGHTING_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return
			source.setData(buildSightingSource(visibleSightings))
		} catch {
			// Map may have been removed during source switch
		}
	}, [visibleSightings, remoteLayersReady, mapRef, styleInitVersion])

	// Update the Live Beacon marker source (BEACON-03, D-07/D-08). The source
	// FeatureCollection is rebuilt from the live (dropExpired), freshest-per-
	// {pubkey,d} beacons with the lifecycle-state + last-seen properties; expired
	// markers are absent, not hidden. Re-runs as `visibleBeacons` ticks (15s) so
	// live→stale→removed flips without a new event.
	useEffect(() => {
		const map = mapRef.current
		if (!map) return
		if (!remoteLayersReady) return
		void styleInitVersion

		try {
			const source = map.getSource(BEACON_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return
			source.setData(buildBeaconSource(visibleBeacons))
		} catch {
			// Map may have been removed during source switch
		}
	}, [visibleBeacons, remoteLayersReady, mapRef, styleInitVersion])

	return {
		remoteLayersReady,
		REMOTE_SOURCE_ID,
		REMOTE_FILL_LAYER,
		REMOTE_LINE_LAYER,
		REMOTE_LINE_DASHED_LAYER,
		REMOTE_LINE_DOTTED_LAYER,
		REMOTE_ANNOTATION_LAYER,
		BLOB_PREVIEW_SOURCE_ID,
		CLUSTERED_SOURCE_ID,
		CLUSTER_CIRCLE_LAYER,
		UNCLUSTERED_POINT_LAYER,
		SIGHTING_SOURCE_ID,
		SIGHTING_HIT_LAYER,
		SIGHTING_CIRCLE_LAYER,
		BEACON_SOURCE_ID,
		BEACON_HIT_LAYER,
		BEACON_CIRCLE_LAYER,
	}
}
