/**
 * Runtime registration of bundled displayIcon images on a MapLibre map.
 *
 * Each bundled Lucide SVG is rasterized once (data URL → Image → alpha mask),
 * converted into a signed distance field (see `sdf.ts`) and registered under
 * its full `lucide:<name>` id with `{ sdf: true }`, together with a
 * synchronously drawn SDF fallback dot under {@link FALLBACK_ICON_IMAGE_ID}.
 * SDF images accept the data-driven `icon-color` paint property, which is how
 * the symbol layers tint glyphs with the feature's `strokeColor` — no color
 * (and no backing disc) is baked into the bitmap; the disc + ring come from
 * the circle layer underneath. Registration is idempotent and must be re-run
 * after every `style.load` — `setStyle` (theme flips, map-source switches)
 * wipes custom images.
 *
 * SAFETY: `useStyleImageMissingHandler` registers transparent 1×1 pixels for
 * ANY missing style image, which would make iconed points vanish silently.
 * This module therefore (a) registers everything eagerly, (b) exposes
 * {@link handleMissingDisplayIconImage} so the missing-image handler can serve
 * a VISIBLE (SDF, tintable) fallback dot for icon ids instead of a transparent
 * pixel, and (c) tracks which ids it registered itself so placeholder images
 * are replaced by the real glyph once rasterization completes.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import {
	BUNDLED_DISPLAY_ICON_IDS,
	DISPLAY_ICON_GLYPH_LOGICAL_PX,
	FALLBACK_ICON_IMAGE_ID,
	LUCIDE_NAMESPACE,
	getDisplayIconSvg,
} from './displayIcon'
import { alphaMaskToSdfData } from './sdf'

/** Icons are rasterized at 2× and registered with this pixelRatio. */
const ICON_PIXEL_RATIO = 2
/**
 * Raster px of the glyph box. Lucide glyphs are 24×24 stroke-width-2 outlines;
 * rasterizing at 96px makes each stroke ~8px wide — plenty for a clean SDF.
 * Registered logical size (÷ pixelRatio) must match
 * {@link DISPLAY_ICON_GLYPH_LOGICAL_PX}, which the shared `icon-size`
 * expression is calibrated against.
 */
const GLYPH_RASTER_PX = DISPLAY_ICON_GLYPH_LOGICAL_PX * ICON_PIXEL_RATIO
/**
 * SDF spread radius in raster px. Kept at the tiny-sdf/glyph convention of
 * ⅓ of the glyph size so MapLibre's SDF shader (tuned for font glyphs)
 * antialiases these icons like text.
 */
const SDF_RADIUS_PX = GLYPH_RASTER_PX / 3
/** Fraction of the SDF range outside the shape edge (glyph convention). */
const SDF_CUTOFF = 0.25
/**
 * Transparent padding around the glyph so the outward SDF spread
 * (radius × (1 − cutoff) = 24px) never clips at the canvas edge.
 */
const CANVAS_PADDING_PX = SDF_RADIUS_PX * (1 - SDF_CUTOFF)
const CANVAS_SIZE_PX = GLYPH_RASTER_PX + CANVAS_PADDING_PX * 2
/** Raster radius of the fallback dot (rendered ≈ 4px at the default radius 6). */
const FALLBACK_DOT_RADIUS_PX = 28

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

/** Convert a drawn alpha mask into an SDF ImageData ready for `addImage`. */
function sdfImageDataFromCanvas(ctx: CanvasRenderingContext2D, sizePx: number): ImageData {
	const mask = ctx.getImageData(0, 0, sizePx, sizePx)
	const sdf = alphaMaskToSdfData(mask.data, sizePx, sizePx, {
		radius: SDF_RADIUS_PX,
		cutoff: SDF_CUTOFF,
	})
	return new ImageData(sdf, sizePx, sizePx)
}

/**
 * Rasterize one bundled SVG to an alpha mask (glyph color is irrelevant —
 * only coverage is read) and convert it into an SDF image. The actual glyph
 * color comes from the symbol layer's data-driven `icon-color`.
 */
async function rasterizeIconSvg(svg: string): Promise<ImageData | null> {
	if (!canRasterize()) return null
	// `currentColor` resolves inconsistently inside <img>-loaded SVGs; pin it.
	const image = await loadSvgImage(svg.replaceAll('currentColor', '#000'))

	const out = createCanvas(CANVAS_SIZE_PX)
	if (!out) return null

	out.ctx.drawImage(image, CANVAS_PADDING_PX, CANVAS_PADDING_PX, GLYPH_RASTER_PX, GLYPH_RASTER_PX)
	return sdfImageDataFromCanvas(out.ctx, CANVAS_SIZE_PX)
}

/**
 * Fallback marker: a plain filled dot, drawn synchronously so it can be
 * registered before any symbol layer needs it. SDF like the real glyphs, so
 * an unknown icon id degrades to a visible dot tinted by the same
 * `icon-color` expression, sitting on the same circle-layer disc.
 */
function getFallbackMarkerImageData(): ImageData | null {
	if (fallbackImageData !== undefined) return fallbackImageData
	if (!canRasterize()) {
		// Do NOT memoize — a later call may run in a real DOM.
		return null
	}

	const drawn = createCanvas(CANVAS_SIZE_PX)
	if (!drawn) return null

	const center = CANVAS_SIZE_PX / 2
	drawn.ctx.beginPath()
	drawn.ctx.arc(center, center, FALLBACK_DOT_RADIUS_PX, 0, Math.PI * 2)
	drawn.ctx.fillStyle = '#000'
	drawn.ctx.fill()

	fallbackImageData = sdfImageDataFromCanvas(drawn.ctx, CANVAS_SIZE_PX)
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
 * Everything this module registers is SDF (a symbol layer cannot mix SDF and
 * non-SDF images).
 */
function addOrReplaceImage(map: MapLibreMap, id: string, data: ImageData, own: boolean): void {
	try {
		const owned = getOwnedIds(map)
		if (map.hasImage(id)) {
			if (owned.has(id)) return
			map.removeImage(id)
		}
		map.addImage(id, data, { pixelRatio: ICON_PIXEL_RATIO, sdf: true })
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
