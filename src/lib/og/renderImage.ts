import { join } from 'node:path'
import type { FeatureCollection, Geometry, Position } from 'geojson'

const OG_WIDTH = 1200
const OG_HEIGHT = 630
const TILE_SIZE = 256
const MAX_TILES = 30

// Carto Positron (clean light basemap, no API key needed)
const TILE_URL_TEMPLATE = 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'

// ─── WASM singleton ───────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: resvg dynamic import
let ResvgClass: any = null
let initPromise: Promise<void> | null = null

async function ensureResvg(): Promise<void> {
	if (ResvgClass) return
	if (!initPromise) {
		initPromise = (async () => {
			const { initWasm, Resvg } = await import('@resvg/resvg-wasm')
			const wasmPath = join(process.cwd(), 'node_modules/@resvg/resvg-wasm/index_bg.wasm')
			const wasmData = await Bun.file(wasmPath).arrayBuffer()
			await initWasm(wasmData)
			ResvgClass = Resvg
		})()
	}
	await initPromise
}

// ─── Web Mercator tile math ───────────────────────────────────────────────────

function lngToTileX(lng: number, z: number): number {
	return ((lng + 180) / 360) * 2 ** z
}

function latToTileY(lat: number, z: number): number {
	const latRad = (lat * Math.PI) / 180
	return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 2 ** z
}

/** Find the highest zoom level where the bbox fits within (fraction * OG_WxH) */
function findZoom(west: number, south: number, east: number, north: number): number {
	for (let z = 14; z >= 0; z--) {
		const wPx = (lngToTileX(east, z) - lngToTileX(west, z)) * TILE_SIZE
		const hPx = (latToTileY(south, z) - latToTileY(north, z)) * TILE_SIZE
		const tileCountX = Math.ceil(lngToTileX(east, z)) - Math.floor(lngToTileX(west, z))
		const tileCountY = Math.ceil(latToTileY(south, z)) - Math.floor(latToTileY(north, z))
		if (wPx <= OG_WIDTH * 0.85 && hPx <= OG_HEIGHT * 0.85 && tileCountX * tileCountY <= MAX_TILES) {
			return z
		}
	}
	return 2
}

// ─── Tile fetching ────────────────────────────────────────────────────────────

async function fetchTileBase64(x: number, y: number, z: number): Promise<string | null> {
	try {
		const url = TILE_URL_TEMPLATE.replace('{z}', String(z))
			.replace('{x}', String(x))
			.replace('{y}', String(y))

		const res = await fetch(url, {
			headers: { 'User-Agent': 'Earthly/1.0 (+https://earthly.city) OGImage' },
			signal: AbortSignal.timeout(4000),
		})

		if (!res.ok) return null
		const buf = await res.arrayBuffer()
		const b64 = Buffer.from(buf).toString('base64')
		return `data:image/png;base64,${b64}`
	} catch {
		return null
	}
}

// ─── Viewport calculation ─────────────────────────────────────────────────────

interface Viewport {
	zoom: number
	tileX0: number
	tileY0: number
	/** pixel offset of the tile grid within the OG image */
	offsetX: number
	offsetY: number
}

function buildViewport(west: number, south: number, east: number, north: number): Viewport {
	const zoom = findZoom(west, south, east, north)

	const tileX0 = Math.floor(lngToTileX(west, zoom))
	const tileY0 = Math.floor(latToTileY(north, zoom)) // north = smaller tileY

	// Center the bbox in the image
	const bboxCenterTileX = (lngToTileX(west, zoom) + lngToTileX(east, zoom)) / 2
	const bboxCenterTileY = (latToTileY(north, zoom) + latToTileY(south, zoom)) / 2

	const bboxCenterPxX = (bboxCenterTileX - tileX0) * TILE_SIZE
	const bboxCenterPxY = (bboxCenterTileY - tileY0) * TILE_SIZE

	const offsetX = OG_WIDTH / 2 - bboxCenterPxX
	const offsetY = OG_HEIGHT / 2 - bboxCenterPxY

	return { zoom, tileX0, tileY0, offsetX, offsetY }
}

function projectLngLat(lng: number, lat: number, vp: Viewport): [number, number] {
	const tileX = lngToTileX(lng, vp.zoom)
	const tileY = latToTileY(lat, vp.zoom)
	return [
		(tileX - vp.tileX0) * TILE_SIZE + vp.offsetX,
		(tileY - vp.tileY0) * TILE_SIZE + vp.offsetY,
	]
}

// ─── GeoJSON → SVG paths ──────────────────────────────────────────────────────

function positionsToD(coords: Position[], vp: Viewport, close = false): string {
	if (coords.length === 0) return ''
	const parts: string[] = []
	for (let i = 0; i < coords.length; i++) {
		const [x, y] = projectLngLat(coords[i][0], coords[i][1], vp)
		parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
	}
	if (close) parts.push('Z')
	return parts.join(' ')
}

function geometryToSvgElements(geom: Geometry, vp: Viewport): string {
	const strokeColor = '#2563eb'
	const fillColor = 'rgba(37,99,235,0.18)'
	const strokeWidth = 2.5

	switch (geom.type) {
		case 'Point': {
			const [x, y] = projectLngLat(geom.coordinates[0], geom.coordinates[1], vp)
			return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${strokeColor}" stroke="white" stroke-width="1.5" opacity="0.9"/>`
		}
		case 'MultiPoint':
			return geom.coordinates
				.map((c) => {
					const [x, y] = projectLngLat(c[0], c[1], vp)
					return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${strokeColor}" stroke="white" stroke-width="1.5" opacity="0.9"/>`
				})
				.join('')
		case 'LineString':
			return `<path d="${positionsToD(geom.coordinates, vp)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`
		case 'MultiLineString':
			return geom.coordinates
				.map(
					(ring) =>
						`<path d="${positionsToD(ring, vp)}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`,
				)
				.join('')
		case 'Polygon': {
			const d = geom.coordinates.map((ring) => positionsToD(ring, vp, true)).join(' ')
			return `<path d="${d}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fillColor}" opacity="0.85"/>`
		}
		case 'MultiPolygon': {
			const d = geom.coordinates
				.flatMap((poly) => poly.map((ring) => positionsToD(ring, vp, true)))
				.join(' ')
			return `<path d="${d}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fillColor}" opacity="0.85"/>`
		}
		case 'GeometryCollection':
			return geom.geometries.map((g) => geometryToSvgElements(g, vp)).join('')
		default:
			return ''
	}
}

function featureCollectionToSvg(fc: FeatureCollection, vp: Viewport): string {
	return fc.features
		.filter((f) => f.geometry != null)
		.map((f) => geometryToSvgElements(f.geometry, vp))
		.join('\n    ')
}

// ─── SVG text helpers ─────────────────────────────────────────────────────────

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Truncate text to fit within maxChars, appending ellipsis if needed */
function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	return `${text.slice(0, maxChars - 1)}…`
}

// ─── SVG composition ──────────────────────────────────────────────────────────

interface RenderOptions {
	title: string
	description: string
	bbox?: [number, number, number, number]
	featureCollection?: FeatureCollection | null
}

async function buildSvg(opts: RenderOptions): Promise<string> {
	const { title, description, bbox, featureCollection } = opts

	// Tile layer
	let tileImages = ''
	let geometryPaths = ''

	if (bbox) {
		const [west, south, east, north] = bbox
		const vp = buildViewport(west, south, east, north)

		const tileX0 = Math.floor(lngToTileX(west, vp.zoom))
		const tileX1 = Math.ceil(lngToTileX(east, vp.zoom))
		const tileY0 = Math.floor(latToTileY(north, vp.zoom))
		const tileY1 = Math.ceil(latToTileY(south, vp.zoom))

		// Fetch tiles in parallel
		const tileJobs: Array<{ tx: number; ty: number; px: number; py: number }> = []
		for (let ty = tileY0; ty < tileY1; ty++) {
			for (let tx = tileX0; tx < tileX1; tx++) {
				const px = (tx - vp.tileX0) * TILE_SIZE + vp.offsetX
				const py = (ty - vp.tileY0) * TILE_SIZE + vp.offsetY
				tileJobs.push({ tx, ty, px, py })
			}
		}

		const fetchedTiles = await Promise.all(
			tileJobs.map(async ({ tx, ty, px, py }) => {
				const dataUrl = await fetchTileBase64(tx, ty, vp.zoom)
				return dataUrl ? { px, py, dataUrl } : null
			}),
		)

		tileImages = fetchedTiles
			.filter(Boolean)
			.map(
				(t) =>
					`<image href="${t!.dataUrl}" x="${t!.px.toFixed(1)}" y="${t!.py.toFixed(1)}" width="${TILE_SIZE}" height="${TILE_SIZE}"/>`,
			)
			.join('\n    ')

		if (featureCollection) {
			geometryPaths = featureCollectionToSvg(featureCollection, vp)
		}
	}

	const hasTiles = tileImages.length > 0
	const bgColor = hasTiles ? 'transparent' : '#e8f4f0'

	const safeTitle = escapeXml(truncate(title, 60))
	const safeDesc = escapeXml(truncate(description, 100))

	// Adjust title font size for length
	const titleFontSize = safeTitle.length > 40 ? 40 : 48

	return `<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="30%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.82"/>
    </linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="frame">
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${hasTiles ? '#f5f0eb' : bgColor}"/>

  <!-- Map tiles -->
  <g clip-path="url(#frame)">
    ${tileImages}
  </g>

  <!-- GeoJSON geometry -->
  <g clip-path="url(#frame)">
    ${geometryPaths}
  </g>

  <!-- Top vignette (branding area) -->
  <rect width="${OG_WIDTH}" height="80" fill="url(#topFade)"/>

  <!-- Bottom gradient for text readability -->
  <rect y="${OG_HEIGHT - 240}" width="${OG_WIDTH}" height="240" fill="url(#bottomFade)"/>

  <!-- Earthly brand (top-left) -->
  <text x="40" y="48" font-size="22" font-weight="600" font-family="Arial, Helvetica, sans-serif" fill="white" opacity="0.92" letter-spacing="0.5">
    earthly.city
  </text>

  <!-- Globe icon placeholder (simple circle) -->
  <circle cx="29" cy="40" r="10" stroke="white" stroke-width="1.5" fill="none" opacity="0.85"/>
  <line x1="19" y1="40" x2="39" y2="40" stroke="white" stroke-width="1" opacity="0.7"/>
  <ellipse cx="29" cy="40" rx="5" ry="10" stroke="white" stroke-width="1" fill="none" opacity="0.7"/>

  <!-- Title -->
  <text x="48" y="${OG_HEIGHT - 100}" font-size="${titleFontSize}" font-weight="700" font-family="Arial, Helvetica, sans-serif" fill="white" dominant-baseline="auto">
    ${safeTitle}
  </text>

  <!-- Description -->
  <text x="48" y="${OG_HEIGHT - 52}" font-size="26" font-family="Arial, Helvetica, sans-serif" fill="white" opacity="0.82" dominant-baseline="auto">
    ${safeDesc}
  </text>

  <!-- Nostr pill badge -->
  <rect x="${OG_WIDTH - 160}" y="${OG_HEIGHT - 68}" width="120" height="36" rx="18" fill="white" fill-opacity="0.15"/>
  <text x="${OG_WIDTH - 100}" y="${OG_HEIGHT - 44}" font-size="16" font-family="Arial, Helvetica, sans-serif" fill="white" text-anchor="middle" opacity="0.9">
    on Nostr
  </text>
</svg>`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OGImageOptions {
	title: string
	description: string
	bbox?: [number, number, number, number]
	featureCollectionJson?: string | null
}

/**
 * Generate a 1200×630 PNG for use as an OG image.
 * Returns null if rendering fails.
 */
export async function generateOGImagePNG(opts: OGImageOptions): Promise<Uint8Array | null> {
	try {
		await ensureResvg()
		if (!ResvgClass) return null

		let featureCollection: FeatureCollection | null = null
		if (opts.featureCollectionJson) {
			try {
				const parsed = JSON.parse(opts.featureCollectionJson)
				if (parsed?.type === 'FeatureCollection') featureCollection = parsed
			} catch {
				// ignore
			}
		}

		const svg = await buildSvg({
			title: opts.title,
			description: opts.description,
			bbox: opts.bbox,
			featureCollection,
		})

		const resvg = new ResvgClass(svg, {
			fitTo: { mode: 'width', value: OG_WIDTH },
			font: { loadSystemFonts: true },
		})

		const pngData = resvg.render()
		return pngData.asPng()
	} catch (err) {
		console.error('[OG renderImage] Failed to generate PNG:', err)
		return null
	}
}
