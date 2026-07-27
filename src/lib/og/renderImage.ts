import { join } from 'node:path'
import type { FeatureCollection } from 'geojson'
import { renderOGMapSvg, type Bbox } from './mapSvg'
import { assertPublicHttpUrl } from './publicRemote'

const OG_WIDTH = 1200
const OG_HEIGHT = 630

// Cap on a fetched cover image — guards against memory abuse from a hostile
// or accidental multi-hundred-MB response (T-10-15).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

// A production dependency supplies deterministic fonts even on a minimal VPS.
// System paths remain as a development/distribution fallback.
const REGULAR_FONT_PATHS = [
	join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf'),
	'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	'/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
	'/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
	'/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf',
	'/usr/share/fonts/noto/NotoSans-Regular.ttf',
	'/usr/share/fonts/truetype/urw-base35/NimbusSans-Regular.ttf',
	// macOS paths (dev)
	'/Library/Fonts/Arial.ttf',
	'/System/Library/Fonts/Supplemental/Arial.ttf',
]
const BOLD_FONT_PATHS = [
	join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'),
	'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]

// ─── WASM + font singleton ────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: resvg dynamic import
let ResvgClass: any = null
const fontBuffers: Uint8Array[] = []
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

			// @resvg/resvg-wasm WASM build ignores loadSystemFonts — must use fontBuffers
			for (const candidates of [REGULAR_FONT_PATHS, BOLD_FONT_PATHS]) {
				for (const fontPath of candidates) {
					try {
						const f = Bun.file(fontPath)
						if (await f.exists()) {
							fontBuffers.push(new Uint8Array(await f.arrayBuffer()))
							break
						}
					} catch {
						// try next
					}
				}
			}

			if (fontBuffers.length === 0) {
				console.warn(
					'[OG] Bundled and system fonts are unavailable — text will not render in OG images.',
				)
			}
		})()
	}
	await initPromise
}

// ─── Image fetching ───────────────────────────────────────────────────────────

async function fetchImageAsBase64(url: string): Promise<string | null> {
	const safeUrl = await assertPublicHttpUrl(url)
	if (!safeUrl) return null
	try {
		const res = await fetch(safeUrl.href, {
			headers: { 'User-Agent': 'Earthly/1.0 (+https://earthly.city) OGImage' },
			signal: AbortSignal.timeout(6000),
			redirect: 'error', // block redirect-based SSRF bypass to an internal target
		})
		if (!res.ok) return null
		const contentType = res.headers.get('content-type') ?? ''
		// Only embed real images — refuse text/JSON internal responses (defense in depth).
		if (!contentType.startsWith('image/')) return null
		const declaredLength = Number(res.headers.get('content-length'))
		if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) return null
		const buf = await res.arrayBuffer()
		if (buf.byteLength > MAX_IMAGE_BYTES) return null
		const b64 = Buffer.from(buf).toString('base64')
		return `data:${(contentType.split(';')[0] ?? 'image/png').trim()};base64,${b64}`
	} catch {
		return null
	}
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	return `${text.slice(0, maxChars - 1)}\u2026`
}

function wrapWords(text: string, maxCharsPerLine: number, maxLines: number): string[] {
	const words = text.trim().split(/\s+/u).filter(Boolean)
	if (words.length === 0) return ['']
	const lines: string[] = []
	let current = ''
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word
		if (candidate.length <= maxCharsPerLine || current.length === 0) {
			current = candidate
			continue
		}
		lines.push(current)
		current = word
		if (lines.length === maxLines - 1) break
	}
	if (current && lines.length < maxLines) {
		const consumed = lines.join(' ').length + (lines.length > 0 ? 1 : 0)
		lines.push(truncate(text.slice(consumed), maxCharsPerLine))
	}
	return lines.slice(0, maxLines)
}

// ─── SVG composition ──────────────────────────────────────────────────────────

interface RenderOptions {
	title: string
	description: string
	backgroundImageUrl?: string | null
	featureCollection?: FeatureCollection | null
	bbox?: Bbox | null
}

export async function generateOGImageSvg(opts: RenderOptions): Promise<string> {
	const { title, description, backgroundImageUrl, featureCollection, bbox } = opts

	const photoBgDataUrl = backgroundImageUrl ? await fetchImageAsBase64(backgroundImageUrl) : null
	const hasPhoto = photoBgDataUrl !== null
	const hasMap = !hasPhoto && Boolean(featureCollection || bbox)
	const map = hasMap ? await renderOGMapSvg({ featureCollection, bbox }) : ''

	const titleLines = wrapWords(truncate(title, 88), 45, 2).map(escapeXml)
	const safeDesc = escapeXml(truncate(description, 86))
	const titleFontSize = titleLines.length > 1 || title.length > 42 ? 38 : 46

	const background = hasPhoto
		? `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#111"/>
  <image xlink:href="${photoBgDataUrl}" x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#frame)"/>`
		: hasMap
			? map
			: `<defs>
    <linearGradient id="brandBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d2b1e"/>
      <stop offset="50%" stop-color="#102840"/>
      <stop offset="100%" stop-color="#0a1f16"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#brandBg)"/>
  <g stroke="white" stroke-opacity="0.04" stroke-width="1">
    ${Array.from({ length: 7 }, (_, i) => `<line x1="${(i + 1) * 150}" y1="0" x2="${(i + 1) * 150}" y2="${OG_HEIGHT}"/>`).join('')}
    ${Array.from({ length: 5 }, (_, i) => `<line x1="0" y1="${(i + 1) * 105}" x2="${OG_WIDTH}" y2="${(i + 1) * 105}"/>`).join('')}
  </g>
  <circle cx="960" cy="180" r="280" fill="white" fill-opacity="0.025"/>
  <circle cx="960" cy="180" r="160" fill="white" fill-opacity="0.025"/>`

	// Map/photo backgrounds need a bottom readability scrim; the branded
	// fallback already has enough contrast.
	const overlays =
		hasPhoto || hasMap
			? `<rect width="${OG_WIDTH}" height="90" fill="url(#topFade)"/>
  <rect y="${OG_HEIGHT - 260}" width="${OG_WIDTH}" height="260" fill="url(#bottomFade)"/>`
			: `<rect width="${OG_WIDTH}" height="90" fill="url(#topFade)"/>`

	// On branded bg text sits higher with a subtle divider
	const hasTwoTitleLines = titleLines.length > 1
	const textY =
		hasPhoto || hasMap
			? OG_HEIGHT - (hasTwoTitleLines ? 146 : 100)
			: OG_HEIGHT - (hasTwoTitleLines ? 174 : 130)
	const descY = hasPhoto || hasMap ? OG_HEIGHT - 52 : OG_HEIGHT - 76
	const titleMarkup = titleLines
		.map((line, index) => `<tspan x="48" y="${textY + index * 44}">${line}</tspan>`)
		.join('')

	return `<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="black" stop-opacity="0.85"/>
    </linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="black" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="black" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="frame">
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}"/>
    </clipPath>
    <clipPath id="map-frame">
      <rect width="${OG_WIDTH}" height="${OG_HEIGHT}"/>
    </clipPath>
  </defs>

  ${background}
  ${overlays}

  <!-- Earthly brand -->
  <circle cx="30" cy="40" r="11" stroke="white" stroke-width="1.5" fill="none" opacity="0.88"/>
  <line x1="19" y1="40" x2="41" y2="40" stroke="white" stroke-width="1" opacity="0.7"/>
  <ellipse cx="30" cy="40" rx="5.5" ry="11" stroke="white" stroke-width="1" fill="none" opacity="0.7"/>
  <text x="50" y="48" font-size="20" font-weight="bold" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white" opacity="0.9">earthly.city</text>

  ${!hasPhoto && !hasMap ? `<line x1="48" y1="${textY - 28}" x2="${OG_WIDTH - 48}" y2="${textY - 28}" stroke="white" stroke-opacity="0.12" stroke-width="1"/>` : ''}

  <!-- Title -->
  <text font-size="${titleFontSize}" font-weight="bold" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white">${titleMarkup}</text>

  <!-- Description -->
  <text x="48" y="${descY}" font-size="24" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white" opacity="0.75">${safeDesc}</text>

  <!-- Nostr badge -->
  <rect x="${OG_WIDTH - 156}" y="${OG_HEIGHT - 66}" width="108" height="32" rx="16" fill="white" fill-opacity="0.12"/>
  <text x="${OG_WIDTH - 102}" y="${OG_HEIGHT - 43}" font-size="15" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white" text-anchor="middle" opacity="0.85">on Nostr</text>
</svg>`
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OGImageOptions {
	title: string
	description: string
	backgroundImageUrl?: string | null
	featureCollection?: FeatureCollection | null
	bbox?: Bbox | null
}

/**
 * Generate a 1200×630 PNG for use as an OG image.
 * Uses backgroundImageUrl as a full-bleed cover photo if provided,
 * otherwise renders the branded fallback. Returns null if rendering fails.
 */
export async function generateOGImagePNG(opts: OGImageOptions): Promise<Uint8Array | null> {
	try {
		await ensureResvg()
		if (!ResvgClass) return null

		const svg = await generateOGImageSvg(opts)

		const fontOptions =
			fontBuffers.length > 0 ? { loadSystemFonts: false, fontBuffers } : { loadSystemFonts: true }

		const resvg = new ResvgClass(svg, {
			fitTo: { mode: 'width', value: OG_WIDTH },
			font: fontOptions,
		})

		return resvg.render().asPng()
	} catch (err) {
		console.error('[OG renderImage] Failed to generate PNG:', err)
		return null
	}
}
