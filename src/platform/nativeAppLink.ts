import { EARTHLY_PUBLIC_ORIGIN } from './publicUrl'

const MAX_APP_LINK_LENGTH = 32 * 1024
const RUNTIME_OWNED_QUERY_PARAMETERS = new Set(['ms', 'ex', 'iso'])

interface AppLinkNavigationWindow {
	location: Pick<Location, 'pathname' | 'search'>
	history: Pick<History, 'pushState'>
	dispatchEvent(event: Event): boolean
}

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
			url.origin !== EARTHLY_PUBLIC_ORIGIN ||
			url.username !== '' ||
			url.password !== '' ||
			url.hash !== '' ||
			url.pathname.startsWith('//')
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
export function earthlyAppLinkNavigationTarget(value: string, currentRoute: string): string | null {
	const route = earthlyRouteFromAppLink(value)
	if (!route) return null
	try {
		const target = new URL(route, EARTHLY_PUBLIC_ORIGIN)
		const current = new URL(currentRoute, EARTHLY_PUBLIC_ORIGIN)
		if (target.pathname !== current.pathname) return route

		// Earthly adds `ms`/`ex`/`iso` map-stack state after boot. Those parameters
		// may exist only on the current route without making a retained Android
		// launch URL a new destination. Every other current-only parameter is real
		// navigation state: notably, opening the same route without `private-invite`
		// must clear an invitation left by the previous link.
		for (const key of new Set([...target.searchParams.keys(), ...current.searchParams.keys()])) {
			const targetValues = target.searchParams.getAll(key)
			const currentValues = current.searchParams.getAll(key)
			if (targetValues.length === 0 && RUNTIME_OWNED_QUERY_PARAMETERS.has(key)) continue
			if (
				targetValues.length !== currentValues.length ||
				targetValues.some((targetValue, index) => targetValue !== currentValues[index])
			) {
				return route
			}
		}
		return null
	} catch {
		return route !== currentRoute ? route : null
	}
}

/**
 * Apply a warm Android App Link inside the existing WebView.
 *
 * A full `location.assign()` reload re-registers the Tauri deep-link plugin and
 * asks it for the Activity's retained cold-launch URL again. If that retained
 * URL is older than the warm link, it can win the bootstrap race and send the
 * user back to the previous screen. Updating history in place keeps the current
 * bridge subscription alive and lets the canonical router reconcile the route.
 */
export function navigateToEarthlyAppLinkInPlace(
	value: string,
	target: AppLinkNavigationWindow = window,
): boolean {
	const currentRoute = `${target.location.pathname}${target.location.search}`
	const route = earthlyAppLinkNavigationTarget(value, currentRoute)
	if (!route) return false

	try {
		target.history.pushState(null, '', route)
	} catch {
		// A navigation race or an unexpected WebView base URL can make pushState
		// reject an otherwise verified route. Leave the current screen intact.
		return false
	}
	// `pushState` does not emit `popstate`; Earthly's router already treats this
	// event as an external/browser navigation and reconstructs the mobile panel.
	target.dispatchEvent(new Event('popstate'))
	return true
}
