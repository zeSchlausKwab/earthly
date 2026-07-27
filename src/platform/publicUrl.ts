import { isTauri } from '@/config/platform'

/** Public HTTPS identity used for links that leave a native Earthly WebView. */
export const EARTHLY_PUBLIC_ORIGIN = 'https://earthly.city'

interface EarthlyPublicUrlOptions {
	/** Injectable for tests; defaults to the current window URL. */
	currentUrl?: string
	/** Injectable for tests; defaults to Tauri runtime detection. */
	isNative?: boolean
}

function currentRuntimeUrl(options: EarthlyPublicUrlOptions): URL {
	const value =
		options.currentUrl ??
		(typeof window !== 'undefined' ? window.location.href : `${EARTHLY_PUBLIC_ORIGIN}/`)
	try {
		return new URL(value)
	} catch {
		return new URL(`${EARTHLY_PUBLIC_ORIGIN}/`)
	}
}

/**
 * Resolve the externally meaningful Earthly origin.
 *
 * Browser development keeps its own HTTP(S) origin. Native runtimes always use
 * the public HTTPS origin because `tauri://localhost` / `http://tauri.localhost`
 * only identify the app's private WebView.
 */
export function earthlyPublicOrigin(options: EarthlyPublicUrlOptions = {}): string {
	const current = currentRuntimeUrl(options)
	const native = options.isNative ?? isTauri()
	if (native || (current.protocol !== 'http:' && current.protocol !== 'https:')) {
		return EARTHLY_PUBLIC_ORIGIN
	}
	return current.origin
}

/**
 * Build a shareable Earthly URL. When `route` is omitted, preserve the current
 * path, query, and hash while translating a native WebView origin to HTTPS.
 */
export function earthlyPublicUrl(route?: string, options: EarthlyPublicUrlOptions = {}): string {
	const current = currentRuntimeUrl(options)
	const origin = earthlyPublicOrigin({ ...options, currentUrl: current.toString() })
	if (route !== undefined) return new URL(route, origin).toString()

	return new URL(`${current.pathname}${current.search}${current.hash}`, origin).toString()
}
