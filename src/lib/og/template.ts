export interface OGMeta {
	title: string
	description: string
	image?: string
	url: string
	type?: 'website' | 'article'
	siteName?: string
}

const DEFAULT_IMAGE = '/static/og-default.png'
const SITE_NAME = 'Earthly'

/**
 * Generate an HTML page with Open Graph meta tags for social media crawlers
 */
export function generateOGHtml(meta: OGMeta): string {
	const {
		title,
		description,
		image = DEFAULT_IMAGE,
		url,
		type = 'website',
		siteName = SITE_NAME,
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
	const safeUrlAttr = escapeHtml(safeUrl)
	const safeUrlJs = escapeJsString(safeUrl)
	const safeImageAttr = escapeHtml(sanitizeUrl(image, DEFAULT_IMAGE))

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Primary Meta Tags -->
  <title>${safeTitle} | ${siteName}</title>
  <meta name="title" content="${safeTitle} | ${siteName}">
  <meta name="description" content="${truncatedDescription}">

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${safeUrlAttr}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${truncatedDescription}">
  <meta property="og:image" content="${safeImageAttr}">
  <meta property="og:site_name" content="${siteName}">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${safeUrlAttr}">
  <meta property="twitter:title" content="${safeTitle}">
  <meta property="twitter:description" content="${truncatedDescription}">
  <meta property="twitter:image" content="${safeImageAttr}">

  <!-- Redirect to SPA after brief delay for non-crawlers that slipped through -->
  <meta http-equiv="refresh" content="0;url=${safeUrlAttr}">
</head>
<body>
  <noscript>
    <h1>${safeTitle}</h1>
    <p>${truncatedDescription}</p>
    <p><a href="${safeUrlAttr}">View on Earthly</a></p>
  </noscript>
  <script>window.location.href = ${safeUrlJs};</script>
</body>
</html>`
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
): string {
	return generateOGHtml({
		title: title || 'Geographic Dataset',
		description:
			description ||
			'View this geographic dataset on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/#/datasets/geoevent/${naddr}`,
		image: image || `${baseUrl}/og/image/geoevent/${naddr}`,
		type: 'article',
	})
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
): string {
	return generateOGHtml({
		title: title || 'Map Context',
		description:
			description ||
			'Explore this geographic context on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/#/contexts/mapcontext/${naddr}`,
		image: image || `${baseUrl}/og/image/context/${naddr}`,
		type: 'article',
	})
}

/**
 * Generate OG HTML for a Story (kind 37520). The Story title/summary are
 * untrusted author content and the `image` may be a fully attacker-controlled
 * URL from the event body; generateOGHtml escapes every interpolated value and
 * validates `url`/`image` scheme before rendering (T-10-09).
 */
export function generateStoryOGHtml(
	baseUrl: string,
	naddr: string,
	title: string,
	description: string,
	image?: string,
): string {
	return generateOGHtml({
		title: title || 'Story',
		description:
			description || 'Read this story on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/#/stories/story/${naddr}`,
		image: image || `${baseUrl}/og/image/story/${naddr}`,
		type: 'article',
	})
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
): string {
	return generateOGHtml({
		title: title || 'Sighting',
		description:
			description || 'See this sighting on Earthly, a collaborative mapping platform on Nostr.',
		url: `${baseUrl}/#/sightings/sighting/${naddr}`,
		image: `${baseUrl}/og/image/sighting/${naddr}`,
		type: 'article',
	})
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
): string {
	return generateOGHtml({
		title: title || 'Live location',
		description: description || 'Live location — may have ended. Watch it on Earthly.',
		url: `${baseUrl}/#/beacons/beacon/${naddr}`,
		image: `${baseUrl}/og/image/beacon/${naddr}`,
		type: 'article',
	})
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
