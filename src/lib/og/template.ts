import { createOGImageVersion } from './imageVersion'

export interface OGMeta {
	title: string
	description: string
	image?: string
	/** Clean, crawlable URL used for canonical and Open Graph identity. */
	url: string
	/** Client-side application URL used only for the browser redirect. */
	redirectUrl?: string
	type?: 'website' | 'article'
	siteName?: string
	imageWidth?: number
	imageHeight?: number
	imageType?: string
	imageAlt?: string
}

const DEFAULT_IMAGE = '/static/og-default.png'
const SITE_NAME = 'Earthly'

interface PreparedOGMeta {
	safeTitle: string
	safeDescription: string
	safeUrlAttr: string
	safeRedirectUrlAttr: string
	safeRedirectUrlJs: string
	safeImage: string
	safeImageAttr: string
	safeImageAlt: string
	safeSiteName: string
	type: 'website' | 'article'
	imageWidth?: number
	imageHeight?: number
	imageType?: string
}

function prepareOGMeta(meta: OGMeta): PreparedOGMeta {
	const {
		title,
		description,
		image = DEFAULT_IMAGE,
		url,
		redirectUrl = url,
		type = 'website',
		siteName = SITE_NAME,
		imageWidth,
		imageHeight,
		imageType,
		imageAlt = `${title} — Earthly map preview`,
	} = meta

	const safeTitle = escapeHtml(title)
	const safeDescription = escapeHtml(description)
	const truncatedDescription =
		safeDescription.length > 200 ? `${safeDescription.slice(0, 197)}...` : safeDescription

	// T-10-09: `url` is Host-header-derived and `image` may be fully untrusted
	// (a Story's `content.image`). Both flow into HTML-attribute, http-refresh,
	// <a href>, and a <script> JS-string sink. Validate scheme/shape first
	// (blocks javascript:/data: and protocol-relative tricks), then escape per
	// context: escapeHtml for attribute/text sinks, escapeJsString for the
	// inline-script sink.
	const safeUrl = sanitizeUrl(url, '/')
	const safeRedirectUrl = sanitizeUrl(redirectUrl, safeUrl)
	const safeImage = sanitizeUrl(image, DEFAULT_IMAGE)

	return {
		safeTitle,
		safeDescription: truncatedDescription,
		safeUrlAttr: escapeHtml(safeUrl),
		safeRedirectUrlAttr: escapeHtml(safeRedirectUrl),
		safeRedirectUrlJs: escapeJsString(safeRedirectUrl),
		safeImage,
		safeImageAttr: escapeHtml(safeImage),
		safeImageAlt: escapeHtml(imageAlt),
		safeSiteName: escapeHtml(siteName),
		type,
		imageWidth,
		imageHeight,
		imageType,
	}
}

function renderPreparedOGHead(meta: PreparedOGMeta): string {
	const secureImageMeta = meta.safeImage.startsWith('https:')
		? `\n  <meta property="og:image:secure_url" content="${meta.safeImageAttr}">`
		: ''
	const imageTypeMeta = meta.imageType
		? `\n  <meta property="og:image:type" content="${escapeHtml(meta.imageType)}">`
		: ''
	const imageWidthMeta =
		meta.imageWidth && Number.isFinite(meta.imageWidth) && meta.imageWidth > 0
			? `\n  <meta property="og:image:width" content="${Math.floor(meta.imageWidth)}">`
			: ''
	const imageHeightMeta =
		meta.imageHeight && Number.isFinite(meta.imageHeight) && meta.imageHeight > 0
			? `\n  <meta property="og:image:height" content="${Math.floor(meta.imageHeight)}">`
			: ''

	return `<!-- Primary Meta Tags -->
  <title>${meta.safeTitle} | ${meta.safeSiteName}</title>
  <meta name="title" content="${meta.safeTitle} | ${meta.safeSiteName}">
  <meta name="description" content="${meta.safeDescription}">
  <link rel="canonical" href="${meta.safeUrlAttr}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="${meta.type}">
  <meta property="og:url" content="${meta.safeUrlAttr}">
  <meta property="og:title" content="${meta.safeTitle}">
  <meta property="og:description" content="${meta.safeDescription}">
  <meta property="og:image" content="${meta.safeImageAttr}">${secureImageMeta}${imageTypeMeta}${imageWidthMeta}${imageHeightMeta}
  <meta property="og:image:alt" content="${meta.safeImageAlt}">
  <meta property="og:site_name" content="${meta.safeSiteName}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${meta.safeUrlAttr}">
  <meta name="twitter:title" content="${meta.safeTitle}">
  <meta name="twitter:description" content="${meta.safeDescription}">
  <meta name="twitter:image" content="${meta.safeImageAttr}">
  <meta name="twitter:image:alt" content="${meta.safeImageAlt}">`
}

/** Render only the metadata nodes, for insertion into the executable SPA shell. */
export function generateOGHeadTags(meta: OGMeta): string {
	return renderPreparedOGHead(prepareOGMeta(meta))
}

/**
 * Generate an HTML page with Open Graph meta tags for social media crawlers
 */
export function generateOGHtml(meta: OGMeta): string {
	const prepared = prepareOGMeta(meta)
	const head = renderPreparedOGHead(prepared)

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  ${head}

  <!-- Redirect to SPA after brief delay for non-crawlers that slipped through -->
  <meta http-equiv="refresh" content="0;url=${prepared.safeRedirectUrlAttr}">
</head>
<body>
  <noscript>
    <h1>${prepared.safeTitle}</h1>
    <p>${prepared.safeDescription}</p>
    <p><a href="${prepared.safeRedirectUrlAttr}">View on Earthly</a></p>
  </noscript>
  <script>window.location.href = ${prepared.safeRedirectUrlJs};</script>
</body>
</html>`
}

function getGeneratedImageUrl(
	baseUrl: string,
	type: string,
	naddr: string,
	eventId?: string,
): string {
	const immutableVersion = createOGImageVersion(eventId)
	return `${baseUrl}/og/image/${type}/${naddr}${immutableVersion ? `/${immutableVersion}` : ''}`
}

function generatedImageMeta() {
	return {
		imageWidth: 1200,
		imageHeight: 630,
		imageType: 'image/png',
	} as const
}

/**
 * Generate OG HTML for the home page
 */
export function generateHomeOGHtml(baseUrl: string): string {
	return generateOGHtml({
		title: 'Earthly',
		description:
			'Collaborative geographic mapping on Nostr. Create, share, and explore GeoJSON datasets with a decentralized community.',
		url: baseUrl,
		image: `${baseUrl}/static/og-default.png`,
		imageWidth: 408,
		imageHeight: 300,
		imageType: 'image/png',
		imageAlt: 'Earthly — collaborative maps on Nostr',
	})
}

/**
 * Generate OG HTML for a geo event (dataset)
 */
export function generateGeoEventOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
	redirectUrl?: string,
): string {
	return generateOGHtml({
		...createGeoEventOGMeta(baseUrl, naddr, title, description, image, eventId),
		redirectUrl: redirectUrl || `${baseUrl}/#/datasets/geoevent/${naddr}`,
	})
}

/** Metadata for a Map app-shell route. The image endpoint remains the existing
 * geoevent renderer; only the browser-facing canonical path changes. */
export function createGeoEventOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
	canonicalPath: 'geoevent' | 'map' = 'geoevent',
): OGMeta {
	return {
		title: title || 'Map',
		description:
			description || 'View this map on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/${canonicalPath}/${naddr}`,
		image: image || getGeneratedImageUrl(baseUrl, 'geoevent', naddr, eventId),
		type: 'article',
		...(image ? {} : generatedImageMeta()),
	}
}

/**
 * Generate OG HTML for a map context (kind 37518)
 */
export function generateContextOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
	redirectUrl?: string,
): string {
	return generateOGHtml({
		...createContextOGMeta(baseUrl, naddr, title, description, image, eventId),
		redirectUrl: redirectUrl || `${baseUrl}/#/contexts/mapcontext/${naddr}`,
	})
}

/** Metadata for an Atlas app-shell route, backed by the existing context image
 * renderer and cache identity. */
export function createContextOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
	canonicalPath: 'context' | 'atlas' = 'context',
): OGMeta {
	return {
		title: title || 'Atlas',
		description:
			description || 'Explore this Atlas on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/${canonicalPath}/${naddr}`,
		image: image || getGeneratedImageUrl(baseUrl, 'context', naddr, eventId),
		type: 'article',
		...(image ? {} : generatedImageMeta()),
	}
}

/**
 * Generate OG HTML for a Story (kind 37520). The Story title/summary are
 * untrusted author content and the `image` may be a fully attacker-controlled
 * URL from the event body; generateOGHtml escapes every interpolated value and
 * validates `url`/`image` scheme before rendering (T-10-09).
 */
export function createStoryOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image: string | undefined,
	eventId: string | undefined,
	canonicalPath: 'story' | 'read',
	redirectUrl?: string,
): OGMeta {
	return {
		title: title || 'Story',
		description:
			description || 'Read this story on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/${canonicalPath}/${naddr}`,
		...(redirectUrl ? { redirectUrl } : {}),
		image: image || getGeneratedImageUrl(baseUrl, 'story', naddr, eventId),
		type: 'article',
		...(image ? {} : generatedImageMeta()),
	}
}

/** Metadata for the canonical, executable Story reader route. */
export function createStoryReadOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
): OGMeta {
	return createStoryOGMeta(baseUrl, naddr, title, description, image, eventId, 'read')
}

export function generateStoryOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
	eventId?: string,
	redirectUrl?: string,
): string {
	return generateOGHtml(
		createStoryOGMeta(
			baseUrl,
			naddr,
			title,
			description,
			image,
			eventId,
			'story',
			redirectUrl || `${baseUrl}/#/stories/story/${naddr}`,
		),
	)
}

/**
 * Generate OG HTML for a Temporal Sighting (kind 37522). The Sighting title/
 * description are untrusted author content; generateOGHtml escapes every
 * interpolated value and validates `url`/`image` scheme before rendering
 * (T-11-04-02, mirrors the audited Story OG path T-10-09). A Sighting has no
 * cover image of its own, so the OG image falls back to the generated card.
 */
export function generateSightingOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	eventId?: string,
	redirectUrl?: string,
): string {
	return generateOGHtml({
		...createSightingOGMeta(baseUrl, naddr, title, description, eventId),
		redirectUrl: redirectUrl || `${baseUrl}/#/sightings/sighting/${naddr}`,
	})
}

/** Metadata for a Sighting app-shell route. */
export function createSightingOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	eventId?: string,
): OGMeta {
	return {
		title: title || 'Sighting',
		description:
			description || 'See this sighting on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/sighting/${naddr}`,
		image: getGeneratedImageUrl(baseUrl, 'sighting', naddr, eventId),
		type: 'article',
		...generatedImageMeta(),
	}
}

/**
 * Generate OG HTML for a Live Beacon (kind 37521). The beacon `label` is
 * untrusted author content; generateOGHtml escapes every interpolated value and
 * validates `url`/`image` scheme before rendering (T-12-05-XSS, mirrors the
 * audited Sighting OG path). The copy is HONEST about staleness: a beacon may have
 * already gone stale or ended by the time the card is fetched/rendered, so the
 * default description reads "Live location — may have ended" (D-11). A beacon has
 * no cover image of its own, so the OG image falls back to the generated card.
 */
export function generateBeaconOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	eventId?: string,
	redirectUrl?: string,
): string {
	return generateOGHtml({
		...createBeaconOGMeta(baseUrl, naddr, title, description, eventId),
		redirectUrl: redirectUrl || `${baseUrl}/#/beacons/beacon/${naddr}`,
	})
}

/** Metadata for a Live app-shell route. */
export function createBeaconOGMeta(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	eventId?: string,
	canonicalPath: 'beacon' | 'live' = 'beacon',
): OGMeta {
	return {
		title: title || 'Live location',
		description: description || 'Live location — may have ended. Watch it on Earthly.',
		url: `${baseUrl}/${canonicalPath}/${naddr}`,
		image: getGeneratedImageUrl(baseUrl, 'beacon', naddr, eventId),
		type: 'article',
		...generatedImageMeta(),
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;')
}

/**
 * Encode a string as a safe JavaScript string literal (including surrounding
 * quotes) for interpolation into an inline <script>. JSON.stringify handles
 * quote/backslash/control-char escaping; the extra replacements neutralise
 * `</script>` breakout and HTML-context confusion. (T-10-09)
 */
function escapeJsString(text: string): string {
	return JSON.stringify(text)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029')
}

/**
 * Validate a URL for safe interpolation into HTML/JS sinks. Returns the
 * normalised href for http(s) absolute URLs and safe site-relative paths
 * ("/path", not "//host" or "/\\host"); otherwise the fallback. Blocks
 * javascript:/data:/vbscript: and other dangerous schemes. (T-10-09)
 */
function sanitizeUrl(raw: string | undefined, fallback: string): string {
	if (!raw) return fallback
	const value = raw.trim()
	// Site-relative path: exactly one leading slash, no protocol-relative or backslash trick.
	if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
		return value
	}
	try {
		const parsed = new URL(value)
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.href
		}
	} catch {
		// not a parseable absolute URL — fall through to fallback
	}
	return fallback
}
