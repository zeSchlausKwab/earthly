import { join } from 'node:path'
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson'
import { bboxClip } from '@turf/bbox-clip'
import { LUCIDE_ICONS } from '@/features/geo-editor/icons/lucideIcons'

export type Bbox = [number, number, number, number]

export interface OGMapOptions {
	featureCollection?: FeatureCollection | null
	bbox?: Bbox | null
}

const WIDTH = 1200
const HEIGHT = 630
const MAX_FEATURES = 600
const MAX_LABELS = 24
const DEFAULT_DATA_COLOR = '#e65f3c'

let landPromise: Promise<FeatureCollection | null> | null = null
let countriesPromise: Promise<FeatureCollection | null> | null = null

async function loadLand(): Promise<FeatureCollection | null> {
	if (!landPromise) {
		landPromise = Bun.file(join(process.cwd(), 'public/static/world/land_110m.json'))
			.json()
			.then((value) => value as FeatureCollection)
			.catch(() => null)
	}
	return landPromise
}

async function loadCountries(): Promise<FeatureCollection | null> {
	if (!countriesPromise) {
		countriesPromise = Bun.file(join(process.cwd(), 'public/static/world/countries_110m.json'))
			.json()
			.then((value) => value as FeatureCollection)
			.catch(() => null)
	}
	return countriesPromise
}

function finitePosition(value: Position): [number, number] | null {
	const x = Number(value[0])
	const y = Number(value[1])
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null
	return [x, y]
}

function forEachPosition(geometry: Geometry | null, visit: (position: [number, number]) => void) {
	if (!geometry) return

	const visitLine = (line: Position[]) => {
		for (const raw of line) {
			const position = finitePosition(raw)
			if (position) visit(position)
		}
	}

	switch (geometry.type) {
		case 'Point': {
			const position = finitePosition(geometry.coordinates)
			if (position) visit(position)
			break
		}
		case 'MultiPoint':
		case 'LineString':
			visitLine(geometry.coordinates)
			break
		case 'MultiLineString':
		case 'Polygon':
			for (const line of geometry.coordinates) visitLine(line)
			break
		case 'MultiPolygon':
			for (const polygon of geometry.coordinates) {
				for (const ring of polygon) visitLine(ring)
			}
			break
		case 'GeometryCollection':
			for (const child of geometry.geometries) forEachPosition(child, visit)
			break
	}
}

function isValidBbox(value: Bbox | null | undefined): value is Bbox {
	if (value?.length !== 4 || value.some((coordinate) => !Number.isFinite(coordinate))) {
		return false
	}
	return value[0] <= value[2] && value[1] <= value[3]
}

export function getFeatureCollectionBbox(
	featureCollection: FeatureCollection | null | undefined,
): Bbox | null {
	if (!featureCollection) return null
	let west = Number.POSITIVE_INFINITY
	let south = Number.POSITIVE_INFINITY
	let east = Number.NEGATIVE_INFINITY
	let north = Number.NEGATIVE_INFINITY

	for (const feature of featureCollection.features) {
		forEachPosition(feature.geometry, ([longitude, latitude]) => {
			west = Math.min(west, longitude)
			south = Math.min(south, latitude)
			east = Math.max(east, longitude)
			north = Math.max(north, latitude)
		})
	}

	const bbox: Bbox = [west, south, east, north]
	return isValidBbox(bbox) ? bbox : null
}

function paddedExtent(raw: Bbox): Bbox {
	let [west, south, east, north] = raw
	const longitudeSpan = Math.max(east - west, 0.25)
	const latitudeSpan = Math.max(north - south, 0.18)
	const centerLongitude = (west + east) / 2
	const centerLatitude = (south + north) / 2

	west = centerLongitude - longitudeSpan / 2
	east = centerLongitude + longitudeSpan / 2
	south = centerLatitude - latitudeSpan / 2
	north = centerLatitude + latitudeSpan / 2

	const horizontalPadding = Math.max(longitudeSpan * 0.24, 0.12)
	const verticalPadding = Math.max(latitudeSpan * 0.28, 0.1)
	return [
		Math.max(-180, west - horizontalPadding),
		Math.max(-88, south - verticalPadding),
		Math.min(180, east + horizontalPadding),
		Math.min(88, north + verticalPadding),
	]
}

interface Projection {
	project(position: Position): [number, number] | null
	extent: Bbox
}

function createProjection(extent: Bbox): Projection {
	const [west, south, east, north] = extent
	const spanX = Math.max(east - west, 0.001)
	const spanY = Math.max(north - south, 0.001)
	const scale = Math.min(WIDTH / spanX, HEIGHT / spanY)
	const renderedWidth = spanX * scale
	const renderedHeight = spanY * scale
	const offsetX = (WIDTH - renderedWidth) / 2
	const offsetY = (HEIGHT - renderedHeight) / 2

	return {
		extent,
		project(position) {
			const finite = finitePosition(position)
			if (!finite) return null
			return [offsetX + (finite[0] - west) * scale, offsetY + (north - finite[1]) * scale]
		},
	}
}

function sampleLine(line: Position[], maxPositions = 700): Position[] {
	if (line.length <= maxPositions) return line
	const step = Math.ceil(line.length / maxPositions)
	const sampled = line.filter((_, index) => index % step === 0)
	const last = line.at(-1)
	if (last && sampled.at(-1) !== last) sampled.push(last)
	return sampled
}

function linePath(line: Position[], projection: Projection, close = false): string {
	const commands: string[] = []
	for (const raw of sampleLine(line)) {
		const point = projection.project(raw)
		if (!point) continue
		commands.push(
			`${commands.length === 0 ? 'M' : 'L'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`,
		)
	}
	if (close && commands.length > 2) commands.push('Z')
	return commands.join(' ')
}

function geometryPath(geometry: Geometry, projection: Projection): string {
	switch (geometry.type) {
		case 'LineString':
			return linePath(geometry.coordinates, projection)
		case 'MultiLineString':
			return geometry.coordinates.map((line) => linePath(line, projection)).join(' ')
		case 'Polygon':
			return geometry.coordinates.map((ring) => linePath(ring, projection, true)).join(' ')
		case 'MultiPolygon':
			return geometry.coordinates
				.flatMap((polygon) => polygon.map((ring) => linePath(ring, projection, true)))
				.join(' ')
		case 'GeometryCollection':
			return geometry.geometries.map((child) => geometryPath(child, projection)).join(' ')
		default:
			return ''
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/gu, '&amp;')
		.replace(/</gu, '&lt;')
		.replace(/>/gu, '&gt;')
		.replace(/"/gu, '&quot;')
}

function numberProperty(
	properties: GeoJsonProperties,
	key: string,
	fallback: number,
	min: number,
	max: number,
): number {
	const value = Number(properties?.[key])
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function colorProperty(properties: GeoJsonProperties, keys: string[], fallback: string): string {
	for (const key of keys) {
		const value = properties?.[key]
		if (
			typeof value === 'string' &&
			(/^#[0-9a-f]{3,8}$/iu.test(value) ||
				/^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/iu.test(value) ||
				/^[a-z]{3,20}$/iu.test(value))
		) {
			return value
		}
	}
	return fallback
}

function dashProperty(properties: GeoJsonProperties): string | undefined {
	const raw = properties?.lineDash
	const values = Array.isArray(raw)
		? raw.map(Number)
		: typeof raw === 'string'
			? raw.split(/[,\s]+/u).map(Number)
			: []
	const safe = values
		.filter((value) => Number.isFinite(value) && value > 0 && value <= 40)
		.slice(0, 8)
	return safe.length > 0 ? safe.join(' ') : undefined
}

function featureLabel(feature: Feature): string | null {
	const raw = feature.properties?.label ?? feature.properties?.name
	if (typeof raw !== 'string') return null
	const trimmed = raw.trim()
	return trimmed ? trimmed.slice(0, 48) : null
}

function featureAnchor(feature: Feature, projection: Projection): [number, number] | null {
	if (feature.geometry?.type === 'Point') return projection.project(feature.geometry.coordinates)
	const bbox = getFeatureCollectionBbox({
		type: 'FeatureCollection',
		features: [feature],
	})
	if (!bbox) return null
	return projection.project([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])
}

function iconMarkup(displayIcon: unknown, x: number, y: number, size: number): string {
	if (typeof displayIcon !== 'string' || !displayIcon.startsWith('lucide:')) return ''
	const name = displayIcon.slice('lucide:'.length)
	const raw = (LUCIDE_ICONS as Record<string, string>)[name]
	if (!raw) return ''
	const body = raw.replace(/^<svg[^>]*>/u, '').replace(/<\/svg>$/u, '')
	const scale = size / 24
	return `<g transform="translate(${(x - size / 2).toFixed(1)} ${(y - size / 2).toFixed(1)}) scale(${scale.toFixed(3)})" fill="none" stroke="white" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
}

function renderPoint(
	position: Position,
	properties: GeoJsonProperties,
	projection: Projection,
): string {
	const projected = projection.project(position)
	if (!projected) return ''
	const [x, y] = projected
	const fill = colorProperty(properties, ['fillColor', 'color'], DEFAULT_DATA_COLOR)
	const stroke = colorProperty(properties, ['strokeColor'], '#ffffff')
	const radius = numberProperty(properties, 'radius', 7, 3, 18)
	const hasIcon = typeof properties?.displayIcon === 'string'
	const discRadius = hasIcon ? Math.max(radius * 1.55, 11) : radius
	const icon = iconMarkup(properties?.displayIcon, x, y, discRadius * 1.35)
	return `<g data-og-feature="point"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${discRadius.toFixed(1)}" fill="${fill}" fill-opacity="${numberProperty(properties, 'fillOpacity', 0.9, 0, 1)}" stroke="${stroke}" stroke-width="2"/>${icon}</g>`
}

function lineEndpoints(geometry: Geometry): {
	start?: [Position, Position]
	end?: [Position, Position]
} {
	const lines =
		geometry.type === 'LineString'
			? [geometry.coordinates]
			: geometry.type === 'MultiLineString'
				? geometry.coordinates
				: []
	const first = lines.find((line) => line.length >= 2)
	const last = [...lines].reverse().find((line) => line.length >= 2)
	if (!first || !last) return {}
	const firstPosition = first[0]
	const secondPosition = first[1]
	const lastPosition = last.at(-1)
	const penultimatePosition = last.at(-2)
	if (!firstPosition || !secondPosition || !lastPosition || !penultimatePosition) return {}
	return {
		start: [firstPosition, secondPosition],
		end: [lastPosition, penultimatePosition],
	}
}

function arrowMarkup(
	tipRaw: Position,
	adjacentRaw: Position,
	projection: Projection,
	color: string,
	position: 'start' | 'end',
	strokeWidth: number,
): string {
	const tip = projection.project(tipRaw)
	const adjacent = projection.project(adjacentRaw)
	if (!tip || !adjacent) return ''
	const dx = tip[0] - adjacent[0]
	const dy = tip[1] - adjacent[1]
	const length = Math.hypot(dx, dy)
	if (length < 0.01) return ''
	const ux = dx / length
	const uy = dy / length
	const arrowLength = Math.max(13, strokeWidth * 3.2)
	const halfWidth = arrowLength * 0.48
	const baseX = tip[0] - ux * arrowLength
	const baseY = tip[1] - uy * arrowLength
	const px = -uy * halfWidth
	const py = ux * halfWidth
	return `<polygon data-og-arrow="${position}" points="${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${(baseX + px).toFixed(1)},${(baseY + py).toFixed(1)} ${(baseX - px).toFixed(1)},${(baseY - py).toFixed(1)}" fill="${color}"/>`
}

function renderFeature(feature: Feature, projection: Projection): string {
	if (!feature.geometry) return ''
	const properties = feature.properties

	if (feature.geometry.type === 'Point') {
		return renderPoint(feature.geometry.coordinates, properties, projection)
	}
	if (feature.geometry.type === 'MultiPoint') {
		return feature.geometry.coordinates
			.map((position) => renderPoint(position, properties, projection))
			.join('')
	}

	const path = geometryPath(feature.geometry, projection)
	if (!path) return ''

	const color = colorProperty(properties, ['color', 'strokeColor'], DEFAULT_DATA_COLOR)
	const fill = colorProperty(properties, ['fillColor', 'color'], DEFAULT_DATA_COLOR)
	const strokeWidth = numberProperty(properties, 'strokeWidth', 4, 1, 16)
	const strokeOpacity = numberProperty(properties, 'strokeOpacity', 0.92, 0, 1)
	const fillOpacity = numberProperty(properties, 'fillOpacity', 0.24, 0, 0.9)
	const dash = dashProperty(properties)
	const isArea = feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
	const arrowStart = properties?.arrowStart === true
	const arrowEnd = properties?.arrowEnd === true
	const endpoints = lineEndpoints(feature.geometry)
	const startArrow =
		arrowStart && endpoints.start
			? arrowMarkup(endpoints.start[0], endpoints.start[1], projection, color, 'start', strokeWidth)
			: ''
	const endArrow =
		arrowEnd && endpoints.end
			? arrowMarkup(endpoints.end[0], endpoints.end[1], projection, color, 'end', strokeWidth)
			: ''

	return `<path data-og-feature="${isArea ? 'area' : 'line'}" d="${path}" fill="${isArea ? fill : 'none'}" fill-opacity="${fillOpacity}" fill-rule="evenodd" stroke="${color}" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${startArrow}${endArrow}`
}

function renderLabels(features: Feature[], projection: Projection): string {
	const labelled = features
		.map((feature) => ({ feature, label: featureLabel(feature) }))
		.filter((item): item is { feature: Feature; label: string } => item.label !== null)
		.slice(0, MAX_LABELS)

	const occupied: [number, number][] = []
	return labelled
		.map(({ feature, label }) => {
			const anchor = featureAnchor(feature, projection)
			if (!anchor) return ''
			const isPoint = feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint'
			const x = anchor[0]
			const y = anchor[1] + (isPoint ? 25 : 0)
			if (occupied.some(([otherX, otherY]) => Math.hypot(x - otherX, y - otherY) < 52)) {
				return ''
			}
			occupied.push([x, y])
			return `<text data-og-label="true" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="15" font-weight="600" fill="#16241d" stroke="#f4f7f2" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${escapeXml(label)}</text>`
		})
		.join('')
}

function renderWorld(land: FeatureCollection | null, projection: Projection): string {
	if (!land) return ''
	return land.features
		.map((feature) => {
			if (
				!feature.geometry ||
				(feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')
			) {
				return ''
			}
			try {
				// Clipping is important for local extents: a large land polygon may
				// contain the whole viewport without having any of its original
				// Natural Earth vertices inside it. Feeding that unbounded path to
				// resvg can otherwise leave an apparently blank basemap.
				const clipped = bboxClip(feature.geometry, projection.extent)
				return geometryPath(clipped.geometry, projection)
			} catch {
				return ''
			}
		})
		.filter(Boolean)
		.map((path) => `<path d="${path}" fill="#f2efe6" stroke="none"/>`)
		.join('')
}

function bboxIntersects(a: Bbox, b: Bbox): boolean {
	return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

function renderCountryBoundaries(
	countries: FeatureCollection | null,
	projection: Projection,
): string {
	if (!countries) return ''
	return countries.features
		.filter((feature) => {
			const bbox = getFeatureCollectionBbox({ type: 'FeatureCollection', features: [feature] })
			return bbox ? bboxIntersects(bbox, projection.extent) : false
		})
		.map((feature) => (feature.geometry ? geometryPath(feature.geometry, projection) : ''))
		.filter(Boolean)
		.map(
			(path) =>
				`<path d="${path}" fill="none" stroke="#9cae9f" stroke-width="1.05" vector-effect="non-scaling-stroke"/>`,
		)
		.join('')
}

/**
 * Render an intentionally small, deterministic geographic layer. It uses the
 * bundled Natural Earth land polygons, never external tiles, so OG generation
 * has no API cost and no network dependency.
 */
export async function renderOGMapSvg(options: OGMapOptions): Promise<string> {
	const featureCollection = options.featureCollection ?? null
	const rawExtent =
		(isValidBbox(options.bbox) && options.bbox) ||
		getFeatureCollectionBbox(featureCollection) ||
		([-180, -82, 180, 85] as Bbox)
	const extent = paddedExtent(rawExtent)
	const projection = createProjection(extent)
	const [land, countries] = await Promise.all([loadLand(), loadCountries()])
	const features = (featureCollection?.features ?? []).slice(0, MAX_FEATURES)
	const world = `${renderWorld(land, projection)}${renderCountryBoundaries(countries, projection)}`
	const data = features.map((feature) => renderFeature(feature, projection)).join('')
	const labels = renderLabels(features, projection)

	const extentHint =
		features.length === 0 && isValidBbox(options.bbox)
			? (() => {
					const [west, south, east, north] = options.bbox
					const topLeft = projection.project([west, north])
					const bottomRight = projection.project([east, south])
					if (!topLeft || !bottomRight) return ''
					return `<rect data-og-feature="extent" x="${topLeft[0].toFixed(1)}" y="${topLeft[1].toFixed(1)}" width="${Math.max(4, bottomRight[0] - topLeft[0]).toFixed(1)}" height="${Math.max(4, bottomRight[1] - topLeft[1]).toFixed(1)}" rx="8" fill="${DEFAULT_DATA_COLOR}" fill-opacity="0.14" stroke="${DEFAULT_DATA_COLOR}" stroke-width="4" stroke-dasharray="10 7"/>`
				})()
			: ''

	return `<g data-og-map="true" clip-path="url(#map-frame)">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#dcebf1"/>
  <g opacity="0.98">${world}</g>
  <g>${extentHint}${data}${labels}</g>
</g>`
}
