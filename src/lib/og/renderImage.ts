import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'

const OG_WIDTH = 1200
const OG_HEIGHT = 630

// Cap on a fetched cover image — guards against memory abuse from a hostile
// or accidental multi-hundred-MB response (T-10-15).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

// Common font paths on Linux servers (checked in order)
const SYSTEM_FONT_PATHS = [
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

// ─── WASM + font singleton ────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: resvg dynamic import
let ResvgClass: any = null
let fontBuffer: Uint8Array | null = null
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
			for (const fontPath of SYSTEM_FONT_PATHS) {
				try {
					const f = Bun.file(fontPath)
					if (await f.exists()) {
						fontBuffer = new Uint8Array(await f.arrayBuffer())
						// IN-01: removed the per-font-load console.log (per-crawl noise in
						// production OG-image logs).
						break
					}
				} catch {
					// try next
				}
			}

			if (!fontBuffer) {
				console.warn(
					'[OG] No system font found — text will not render in OG images.\n' +
						'     Install fonts-dejavu-core (apt) or fonts-liberation (apt) on the server.',
				)
			}
		})()
	}
	await initPromise
}

// ─── Image fetching ───────────────────────────────────────────────────────────

/**
 * Reject IPv4 literals in private, loopback, link-local (incl. the
 * 169.254.169.254 cloud-metadata endpoint), CGNAT, or reserved/multicast
 * ranges. (T-10-15)
 */
function isBlockedIPv4(ip: string): boolean {
	const parts = ip.split('.').map(Number)
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
	const [a, b] = parts
	if (a === 0 || a === 10 || a === 127) return true // this-network, private, loopback
	if (a === 169 && b === 254) return true // link-local incl. cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true // private
	if (a === 192 && b === 168) return true // private
	if (a === 192 && b === 0) return true // IETF protocol assignments
	if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
	if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
	if (a >= 224) return true // multicast + reserved
	return false
}

/** Reject IPv6 loopback, ULA (fc00::/7), link-local (fe80::/10), and IPv4-mapped internals. (T-10-15) */
function isBlockedIPv6(ip: string): boolean {
	const addr = ip.toLowerCase().split('%')[0] // strip zone id
	if (addr === '::1' || addr === '::') return true
	const v4mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
	if (v4mapped) return isBlockedIPv4(v4mapped[1])
	const head = addr.split(':')[0]
	if (/^f[cd]/.test(head)) return true // fc00::/7 unique-local
	if (/^fe[89ab]/.test(head)) return true // fe80::/10 link-local
	return false
}

function isBlockedAddress(ip: string): boolean {
	const kind = isIP(ip)
	if (kind === 4) return isBlockedIPv4(ip)
	if (kind === 6) return isBlockedIPv6(ip)
	return true // not a parseable IP → block
}

/**
 * Validate a user-supplied image URL before the server fetches it (SSRF guard,
 * T-10-15). Allows only http(s); resolves the hostname and blocks the request
 * if ANY resolved address is private/loopback/link-local/reserved, which also
 * defeats public-DNS-name → internal-IP tricks. Returns the URL to fetch, or
 * null to skip.
 */
async function assertPublicImageUrl(rawUrl: string): Promise<URL | null> {
	let parsed: URL
	try {
		parsed = new URL(rawUrl)
	} catch {
		return null
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

	const hostname = parsed.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
	try {
		if (isIP(hostname)) {
			if (isBlockedAddress(hostname)) return null
		} else {
			const resolved = await lookup(hostname, { all: true })
			if (resolved.length === 0) return null
			if (resolved.some((r) => isBlockedAddress(r.address))) return null
		}
	} catch {
		return null
	}
	return parsed
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
	const safeUrl = await assertPublicImageUrl(url)
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
		return `data:${contentType.split(';')[0].trim()};base64,${b64}`
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

// ─── SVG composition ──────────────────────────────────────────────────────────

interface RenderOptions {
	title: string
	description: string
	backgroundImageUrl?: string | null
}

async function buildSvg(opts: RenderOptions): Promise<string> {
	const { title, description, backgroundImageUrl } = opts

	const photoBgDataUrl = backgroundImageUrl ? await fetchImageAsBase64(backgroundImageUrl) : null
	const hasPhoto = photoBgDataUrl !== null

	const safeTitle = escapeXml(truncate(title, 58))
	const safeDesc = escapeXml(truncate(description, 95))
	const titleFontSize = safeTitle.length > 42 ? 38 : 46

	const background = hasPhoto
		? `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#111"/>
  <image xlink:href="${photoBgDataUrl}" x="0" y="0" width="${OG_WIDTH}" height="${OG_HEIGHT}" preserveAspectRatio="xMidYMid slice" clip-path="url(#frame)"/>`
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

	// Photo bg needs both top and bottom fade; branded bg only needs top
	const overlays = hasPhoto
		? `<rect width="${OG_WIDTH}" height="90" fill="url(#topFade)"/>
  <rect y="${OG_HEIGHT - 280}" width="${OG_WIDTH}" height="280" fill="url(#bottomFade)"/>`
		: `<rect width="${OG_WIDTH}" height="90" fill="url(#topFade)"/>`

	// On branded bg text sits higher with a subtle divider
	const textY = hasPhoto ? OG_HEIGHT - 100 : OG_HEIGHT - 130
	const descY = hasPhoto ? OG_HEIGHT - 52 : OG_HEIGHT - 76

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
  </defs>

  ${background}
  ${overlays}

  <!-- Earthly brand -->
  <circle cx="30" cy="40" r="11" stroke="white" stroke-width="1.5" fill="none" opacity="0.88"/>
  <line x1="19" y1="40" x2="41" y2="40" stroke="white" stroke-width="1" opacity="0.7"/>
  <ellipse cx="30" cy="40" rx="5.5" ry="11" stroke="white" stroke-width="1" fill="none" opacity="0.7"/>
  <text x="50" y="48" font-size="20" font-weight="bold" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white" opacity="0.9">earthly.city</text>

  ${!hasPhoto ? `<line x1="48" y1="${textY - 28}" x2="${OG_WIDTH - 48}" y2="${textY - 28}" stroke="white" stroke-opacity="0.12" stroke-width="1"/>` : ''}

  <!-- Title -->
  <text x="48" y="${textY}" font-size="${titleFontSize}" font-weight="bold" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" fill="white">${safeTitle}</text>

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

		const svg = await buildSvg(opts)

		const fontOptions = fontBuffer
			? { loadSystemFonts: false, fontBuffers: [fontBuffer] }
			: { loadSystemFonts: true }

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
