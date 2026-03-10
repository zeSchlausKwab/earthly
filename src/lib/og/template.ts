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
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${truncatedDescription}">
  <meta property="og:image" content="${image}">
  <meta property="og:site_name" content="${siteName}">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${url}">
  <meta property="twitter:title" content="${safeTitle}">
  <meta property="twitter:description" content="${truncatedDescription}">
  <meta property="twitter:image" content="${image}">

  <!-- Redirect to SPA after brief delay for non-crawlers that slipped through -->
  <meta http-equiv="refresh" content="0;url=${url}">
</head>
<body>
  <noscript>
    <h1>${safeTitle}</h1>
    <p>${truncatedDescription}</p>
    <p><a href="${url}">View on Earthly</a></p>
  </noscript>
  <script>window.location.href = "${url}";</script>
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
		url: `${baseUrl}/#/geoevent/${naddr}`,
		image: image || `${baseUrl}/static/og-default.png`,
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
