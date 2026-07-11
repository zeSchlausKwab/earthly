/**
 * Runtime registration of bundled displayIcon images on a MapLibre map.
 *
 * Each bundled Lucide SVG is rasterized once (data URL → Image → 2× canvas)
 * and registered under its full `lucide:<name>` id, together with a
 * synchronously drawn fallback marker under {@link FALLBACK_ICON_IMAGE_ID}.
 * Registration is idempotent and must be re-run after every `style.load` —
 * `setStyle` (theme flips, map-source switches) wipes custom images.
 *
 * Lucide glyphs are 24×24 stroke-based outlines (`stroke="currentColor"`,
 * `fill="none"`, stroke-width 2). Before rasterizing, `currentColor` is
 * substituted with a fixed dark glyph color and the glyph is drawn over a
 * subtle white backing circle so icons stay legible on dark basemaps and
 * satellite imagery.
 *
 * SAFETY: `useStyleImageMissingHandler` registers transparent 1×1 pixels for
 * ANY missing style image, which would make iconed points vanish silently.
 * This module therefore (a) registers everything eagerly, (b) exposes
 * {@link handleMissingDisplayIconImage} so the missing-image handler can serve
 * a VISIBLE fallback dot for icon ids instead of a transparent pixel, and
 * (c) tracks which ids it registered itself so placeholder images are replaced
 * by the real glyph once rasterization completes.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import {
	BUNDLED_DISPLAY_ICON_IDS,
	FALLBACK_ICON_IMAGE_ID,
	LUCIDE_NAMESPACE,
	getDisplayIconSvg,
} from './displayIcon'

/** Icons are rasterized at 2× and registered with this pixelRatio. */
const ICON_PIXEL_RATIO = 2
/** Lucide glyphs are 24×24; pad so the backing circle never clips. */
const ICON_LOGICAL_SIZE = 24
const ICON_LOGICAL_PADDING = 2
/** Glyph + backing colors — dark glyph on a white disc reads on any basemap. */
const ICON_GLYPH_COLOR = '#1f2937'
const ICON_BACKING_COLOR = 'rgba(255, 255, 255, 0.9)'

/** Rasterized-icon cache shared across maps and style reloads. */
const rasterizedIconCache = new Map<string, Promise<ImageData | null>>()

/** Ids THIS module registered per map — placeholders from other handlers are replaced. */
const ownedImageIds = new WeakMap<MapLibreMap, Set<string>>()

let fallbackImageData: ImageData | null | undefined

function canRasterize(): boolean {
	return typeof document !== 'undefined' && typeof Image !== 'undefined'
}

function createCanvas(sizePx: number): {
	canvas: HTMLCanvasElement
	ctx: CanvasRenderingContext2D
} | null {
	const canvas = document.createElement('canvas')
	canvas.width = sizePx
	canvas.height = sizePx
	const ctx = canvas.getContext('2d')
	if (!ctx) return null
	return { canvas, ctx }
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('Failed to decode SVG image'))
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
	})
}

/**
 * Rasterize one bundled SVG: substitute `currentColor` with the fixed dark
 * glyph color, then draw the glyph (native stroke-width 2, at 2×) over a
 * subtle white backing circle on a padded transparent canvas.
 */
async function rasterizeIconSvg(svg: string): Promise<ImageData | null> {
	if (!canRasterize()) return null
	const image = await loadSvgImage(svg.replaceAll('currentColor', ICON_GLYPH_COLOR))

	const glyphSizePx = ICON_LOGICAL_SIZE * ICON_PIXEL_RATIO
	const canvasSizePx = (ICON_LOGICAL_SIZE + ICON_LOGICAL_PADDING * 2) * ICON_PIXEL_RATIO
	const paddingPx = ICON_LOGICAL_PADDING * ICON_PIXEL_RATIO

	const out = createCanvas(canvasSizePx)
	if (!out) return null

	const center = canvasSizePx / 2
	out.ctx.beginPath()
	out.ctx.arc(center, center, canvasSizePx / 2, 0, Math.PI * 2)
	out.ctx.fillStyle = ICON_BACKING_COLOR
	out.ctx.fill()
	out.ctx.drawImage(image, paddingPx, paddingPx, glyphSizePx, glyphSizePx)

	return out.ctx.getImageData(0, 0, canvasSizePx, canvasSizePx)
}

/**
 * Fallback marker: the default point circle (blue dot, white ring), drawn
 * synchronously so it can be registered before any symbol layer needs it.
 * Matches DEFAULT_POINT_STYLE so an unknown icon degrades to a normal point.
 */
function getFallbackMarkerImageData(): ImageData | null {
	if (fallbackImageData !== undefined) return fallbackImageData
	if (!canRasterize()) {
		// Do NOT memoize — a later call may run in a real DOM.
		return null
	}

	const logicalSize = ICON_LOGICAL_SIZE + ICON_LOGICAL_PADDING * 2
	const sizePx = logicalSize * ICON_PIXEL_RATIO
	const drawn = createCanvas(sizePx)
	if (!drawn) return null

	const center = sizePx / 2
	const radiusPx = 6 * ICON_PIXEL_RATIO
	const strokePx = 2 * ICON_PIXEL_RATIO
	drawn.ctx.beginPath()
	drawn.ctx.arc(center, center, radiusPx, 0, Math.PI * 2)
	drawn.ctx.fillStyle = '#1d4ed8'
	drawn.ctx.fill()
	drawn.ctx.lineWidth = strokePx
	drawn.ctx.strokeStyle = '#ffffff'
	drawn.ctx.stroke()

	fallbackImageData = drawn.ctx.getImageData(0, 0, sizePx, sizePx)
	return fallbackImageData
}

function getOwnedIds(map: MapLibreMap): Set<string> {
	let owned = ownedImageIds.get(map)
	if (!owned) {
		owned = new Set()
		ownedImageIds.set(map, owned)
	}
	return owned
}

/**
 * Register (or replace a foreign placeholder for) an image id. Style reloads
 * wipe images, so ownership alone is not enough — the map is always asked.
 */
function addOrReplaceImage(map: MapLibreMap, id: string, data: ImageData, own: boolean): void {
	try {
		const owned = getOwnedIds(map)
		if (map.hasImage(id)) {
			if (owned.has(id)) return
			map.removeImage(id)
		}
		map.addImage(id, data, { pixelRatio: ICON_PIXEL_RATIO })
		if (own) owned.add(id)
	} catch {
		// Map may have been removed mid-flight.
	}
}

/** Synchronously register the always-available fallback marker. */
export function registerFallbackIconImage(map: MapLibreMap): void {
	const data = getFallbackMarkerImageData()
	if (!data) return
	addOrReplaceImage(map, FALLBACK_ICON_IMAGE_ID, data, true)
}

function rasterizeBundledIcon(id: string): Promise<ImageData | null> {
	let pending = rasterizedIconCache.get(id)
	if (!pending) {
		const svg = getDisplayIconSvg(id)
		pending = svg
			? rasterizeIconSvg(svg).catch(() => null)
			: Promise.resolve<ImageData | null>(null)
		rasterizedIconCache.set(id, pending)
	}
	return pending
}

/**
 * Register the fallback marker (sync) and every bundled `lucide:<name>` icon
 * (async) on the map. Idempotent; call on map load and after each style.load.
 */
export function registerDisplayIconImages(map: MapLibreMap): void {
	registerFallbackIconImage(map)
	if (!canRasterize()) return

	for (const id of BUNDLED_DISPLAY_ICON_IDS) {
		const owned = getOwnedIds(map)
		try {
			if (owned.has(id) && map.hasImage(id)) continue
		} catch {
			return
		}
		void rasterizeBundledIcon(id).then((data) => {
			if (!data) return
			addOrReplaceImage(map, id, data, true)
		})
	}
}

/**
 * Handle a `styleimagemissing` event for icon-namespace ids. Registers a
 * VISIBLE fallback dot under the requested id right away (never a transparent
 * pixel — that is how points vanish) and, for bundled ids, kicks off the real
 * rasterization which replaces the dot once ready. Returns true when the id
 * was handled, false when the generic handler should take over.
 */
export function handleMissingDisplayIconImage(map: MapLibreMap, id: string): boolean {
	if (id !== FALLBACK_ICON_IMAGE_ID && !id.startsWith(`${LUCIDE_NAMESPACE}:`)) return false

	const data = getFallbackMarkerImageData()
	if (data) {
		// Registered UNOWNED so the real glyph replaces it when rasterized.
		addOrReplaceImage(map, id, data, id === FALLBACK_ICON_IMAGE_ID)
	}
	if (id !== FALLBACK_ICON_IMAGE_ID && getDisplayIconSvg(id)) {
		void rasterizeBundledIcon(id).then((iconData) => {
			if (!iconData) return
			addOrReplaceImage(map, id, iconData, true)
		})
	}
	return true
}
