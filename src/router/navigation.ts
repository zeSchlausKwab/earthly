/**
 * Imperative navigation seam for non-route modules.
 *
 * TanStack Router is the only browser-history owner after application boot.
 * Existing controllers can call this small adapter while their React surfaces
 * are being recomposed; no caller is allowed to push/replace history directly.
 */

export interface EarthlyNavigateOptions {
	replace?: boolean
}

export type EarthlyNavigator = (
	href: string,
	options?: EarthlyNavigateOptions,
) => void | Promise<void>

let navigator: EarthlyNavigator | null = null

export function installEarthlyNavigator(nextNavigator: EarthlyNavigator): () => void {
	navigator = nextNavigator
	return () => {
		if (navigator === nextNavigator) navigator = null
	}
}

export function hasEarthlyNavigator(): boolean {
	return navigator !== null
}

/**
 * Navigate within the mounted SPA. React consumers observe the TanStack route
 * context directly; this adapter exists only for non-route controllers.
 */
export function navigateEarthly(href: string, options?: EarthlyNavigateOptions): void {
	if (!navigator) {
		throw new Error('Earthly navigation was used before the client router was installed.')
	}

	void navigator(href, options)
}

/** Update query state in place while preserving the active pathname and hash. */
export function replaceEarthlySearch(update: (search: URLSearchParams) => void): void {
	if (typeof window === 'undefined') return
	const search = new URLSearchParams(window.location.search)
	update(search)
	const query = search.toString()
	navigateEarthly(`${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`, {
		replace: true,
	})
}
