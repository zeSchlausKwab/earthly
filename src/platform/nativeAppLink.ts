const EARTHLY_APP_LINK_ORIGIN = 'https://earthly.city'
const MAX_APP_LINK_LENGTH = 32 * 1024

/**
 * Convert a verified public Earthly URL into a same-origin WebView route.
 *
 * The native app must never navigate its privileged WebView to the supplied
 * network origin. It keeps only Earthly's path/query and reloads that route
 * under the existing Tauri origin. Android's assetlinks verification decides
 * whether the OS launches Earthly; this remains a second validation boundary.
 */
export function earthlyRouteFromAppLink(value: string): string | null {
	const candidate = value.trim()
	if (!candidate || candidate.length > MAX_APP_LINK_LENGTH) return null
	try {
		const url = new URL(candidate)
		if (
			url.origin !== EARTHLY_APP_LINK_ORIGIN ||
			url.username !== '' ||
			url.password !== '' ||
			url.hash !== ''
		) {
			return null
		}
		return `${url.pathname}${url.search}`
	} catch {
		return null
	}
}

/**
 * Return a route only when an App Link actually changes the current WebView
 * location. Android retains the cold-launch URL for the lifetime of the
 * activity, so reloading an already-open route would otherwise replay the URL
 * during the next frontend bootstrap and create a permanent reload loop.
 */
export function earthlyAppLinkNavigationTarget(
	value: string,
	currentRoute: string,
): string | null {
	const route = earthlyRouteFromAppLink(value)
	return route && route !== currentRoute ? route : null
}
