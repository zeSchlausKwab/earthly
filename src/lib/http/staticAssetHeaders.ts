const HASHED_ASSET_PATTERN =
	/(?:^|\/)[^/]+-[a-z0-9]{8}\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|png|svg|webmanifest|webp|woff2?|ttf|otf|wasm)$/i
const BROWSER_ASSET_PATTERN =
	/\.(?:avif|css|gif|ico|jpe?g|js|json|map|mjs|otf|png|svg|ttf|wasm|webmanifest|webp|woff2?)$/i

/**
 * Bun emits content-hashed browser assets (for example `chunk-qg227y2w.js`).
 * Those files are safe to cache forever; stable entry documents and worker URLs
 * must be revalidated so a deploy never leaves a browser pointing at stale code.
 */
export function isContentHashedAsset(pathname: string): boolean {
	return HASHED_ASSET_PATTERN.test(pathname)
}

/** Keep a missing browser asset from falling through to the SPA deep-link entry. */
export function isBrowserAssetPath(pathname: string): boolean {
	return pathname.startsWith('/workers/') || BROWSER_ASSET_PATTERN.test(pathname)
}

/** A deploy-time asset miss must never be cached or MIME-sniffed by the browser. */
export function getMissingAssetHeaders(): Record<string, string> {
	return {
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	}
}

export function getBuiltFileHeaders(pathname: string): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Content-Type-Options': 'nosniff',
	}
	// `/static/*` is an explicitly stable public namespace, even if a filename
	// happens to end in eight hash-like characters.
	const immutable = !pathname.startsWith('/static/') && isContentHashedAsset(pathname)

	if (pathname.endsWith('.html')) {
		headers['Content-Type'] = 'text/html; charset=utf-8'
		headers['Cache-Control'] = 'no-store'
		return headers
	}

	if (pathname.endsWith('.wasm')) {
		headers['Content-Type'] = 'application/wasm'
		headers['Cache-Control'] = immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
		return headers
	}

	if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) {
		headers['Content-Type'] = 'text/javascript; charset=utf-8'
	} else if (pathname.endsWith('.css')) {
		headers['Content-Type'] = 'text/css; charset=utf-8'
	}

	headers['Cache-Control'] = immutable ? 'public, max-age=31536000, immutable' : 'no-cache'

	return headers
}
