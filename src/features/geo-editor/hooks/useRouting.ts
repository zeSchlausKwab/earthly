import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { useEditorStore, type SidebarViewMode } from '../store'

export type { SidebarViewMode }

/** All valid sidebar view mode values */
const SIDEBAR_VIEW_MODES: SidebarViewMode[] = [
	'datasets',
	'map-stack',
	'contexts',
	'context-editor',
	'stories',
	'sightings',
	'beacons',
	'combined',
	'edit',
	'posts',
	'settings',
	'help',
	'user',
	'wallet',
	'chat',
]

/** Aliases for sidebar views (e.g., shoutbox → posts) */
const VIEW_ALIASES: Record<string, SidebarViewMode> = {
	shoutbox: 'posts',
}

export interface RouteState {
	/** Active context scope (when present, all views are scoped) */
	contextNaddr?: string
	/** Active context coordinate derived from naddr */
	contextCoordinate?: string
	/** Focus type for deep-linking to specific content */
	focusType: 'none' | 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon'
	/** Nostr address for focused content */
	naddr?: string
	/** Optional comment d-tag deep-linked beneath the focused entity */
	commentId?: string
	/** Current sidebar view mode */
	sidebarView: SidebarViewMode
	/** User pubkey for user profile routes (hex format) */
	userPubkey?: string
}

/**
 * Check if a string is a valid sidebar view mode
 */
function isSidebarViewMode(value: string): value is SidebarViewMode {
	return SIDEBAR_VIEW_MODES.includes(value as SidebarViewMode)
}

function isFocusType(
	value: string,
): value is 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon' {
	return (
		value === 'geoevent' ||
		value === 'mapcontext' ||
		value === 'story' ||
		value === 'sighting' ||
		value === 'beacon'
	)
}

function decodeContextCoordinateFromNaddr(naddr: string): string | undefined {
	try {
		const decoded = nip19.decode(naddr)
		if (decoded.type !== 'naddr') return undefined
		const { kind, pubkey, identifier } = decoded.data
		return `${kind}:${pubkey}:${identifier}`
	} catch {
		return undefined
	}
}

/**
 * Table-driven share-form dispatch (D-08/XCUT-02): the five per-kind path
 * prefixes each map to a `{focusType, sidebarView}` pair. A single generic
 * dispatch body in `parsePathSegments` reads this table, replacing the five
 * byte-identical per-kind blocks that used to live here (Pitfall P-5). URL
 * shapes are preserved byte-for-byte (D-09): `first` is still matched against
 * the exact same five prefixes, `segments[1]` is still the opaque naddr, and
 * the optional `/comment/:id` suffix parses identically. Because the mapping is
 * a closed `Record` keyed only by these known prefixes, an unknown prefix falls
 * through to the /context and sidebar-tail branches exactly as before — no
 * arbitrary focusType/sidebarView can be injected from the URL (T-13-02-MISROUTE).
 */
const SHARE_ROUTES: Record<
	string,
	{ focusType: RouteState['focusType']; sidebarView: SidebarViewMode }
> = {
	geoevent: { focusType: 'geoevent', sidebarView: 'datasets' },
	mapcontext: { focusType: 'mapcontext', sidebarView: 'contexts' },
	story: { focusType: 'story', sidebarView: 'stories' },
	sighting: { focusType: 'sighting', sidebarView: 'sightings' },
	beacon: { focusType: 'beacon', sidebarView: 'beacons' },
}

/**
 * Parse an already-split path (or legacy hash) into a {@link RouteState}. The
 * naddr in `segments[1]` is treated as an OPAQUE string — it is never decoded
 * here, so a malformed naddr cannot throw in the parser (decode happens
 * downstream in try/catch'd helpers like `decodeContextCoordinateFromNaddr`).
 * Exported for the D-09 byte-for-byte parse tests.
 */
export function parsePathSegments(segments: string[]): RouteState {
	if (segments.length === 0) {
		return { focusType: 'none', sidebarView: 'contexts' }
	}

	const first = segments[0]
	if (!first) {
		return { focusType: 'none', sidebarView: 'contexts' }
	}

	// User profile route: /user/{npub_or_pubkey}
	if (first === 'user' && segments[1]) {
		let userPubkey = segments[1]
		if (userPubkey.startsWith('npub')) {
			try {
				const decoded = nip19.decode(userPubkey)
				if (decoded.type === 'npub') {
					userPubkey = decoded.data
				}
			} catch {
				// Invalid npub, use as-is
			}
		}
		return {
			focusType: 'none',
			sidebarView: 'user',
			userPubkey,
		}
	}

	// Share forms (also what the OG crawler matches): /geoevent/:naddr,
	// /mapcontext/:naddr, /story/:naddr, /sighting/:naddr, /beacon/:naddr, each
	// with an optional /comment/:id suffix. XCUT-02 (D-08): one table-driven
	// dispatch body replaces the five byte-identical per-kind blocks (Pitfall
	// P-5). URL shapes are byte-for-byte identical (D-09): `first` still matches
	// only these five prefixes, `segments[1]` is still the opaque naddr (the
	// throwaway-pubkey beacon naddr resolves because the parse is pubkey-agnostic
	// and never decodes it), and the /comment/:id suffix parses the same. An
	// unknown `first` is not in SHARE_ROUTES, so it falls through to the /context
	// and sidebar-tail branches below exactly as before (T-13-02-MISROUTE).
	const share = SHARE_ROUTES[first]
	if (share && segments[1]) {
		return {
			focusType: share.focusType,
			naddr: segments[1],
			commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
			sidebarView: share.sidebarView,
		}
	}

	// Context routes disambiguate structurally (no longer by hash-vs-pathname):
	//   /context/:naddr               → focused-context share form (2 segments)
	//   /context/:naddr/comment/:id   → focused-context share form + comment
	//   /context/:naddr/:view[/...]   → context SCOPE + sidebar view (+ focus)
	// The OG crawler matches only the 2-segment share form, so in-app scoped
	// routes (always 3+ segments) never collide with it.
	if (first === 'context' && segments[1]) {
		const contextNaddr = segments[1]
		const second = segments[2]
		const isShareForm = !second || second === 'comment'
		if (isShareForm) {
			return {
				focusType: 'mapcontext',
				naddr: contextNaddr,
				commentId: second === 'comment' && segments[3] ? segments[3] : undefined,
				sidebarView: 'contexts',
			}
		}

		const contextCoordinate = decodeContextCoordinateFromNaddr(contextNaddr)
		const resolvedScopedView = VIEW_ALIASES[second] ?? second
		const sidebarView = isSidebarViewMode(resolvedScopedView) ? resolvedScopedView : 'datasets'
		const focusTypeCandidate = isSidebarViewMode(resolvedScopedView) ? segments[3] : segments[2]
		const focusNaddr = isSidebarViewMode(resolvedScopedView) ? segments[4] : segments[3]
		const commentSegment = isSidebarViewMode(resolvedScopedView) ? segments[5] : segments[4]
		const commentId = isSidebarViewMode(resolvedScopedView) ? segments[6] : segments[5]

		if (focusTypeCandidate && focusNaddr && isFocusType(focusTypeCandidate)) {
			return {
				contextNaddr,
				contextCoordinate,
				focusType: focusTypeCandidate,
				naddr: focusNaddr,
				commentId: commentSegment === 'comment' && commentId ? commentId : undefined,
				sidebarView,
			}
		}

		return {
			contextNaddr,
			contextCoordinate,
			focusType: 'none',
			sidebarView,
		}
	}

	const resolvedFirst = VIEW_ALIASES[first] ?? first
	if (isSidebarViewMode(resolvedFirst)) {
		if (segments[1] && segments[2] && isFocusType(segments[1])) {
			return {
				focusType: segments[1],
				naddr: segments[2],
				commentId: segments[3] === 'comment' && segments[4] ? segments[4] : undefined,
				sidebarView: resolvedFirst,
			}
		}

		return { focusType: 'none', sidebarView: resolvedFirst }
	}

	return { focusType: 'none', sidebarView: 'contexts' }
}

/**
 * Round I: clean paths are canonical. Parse the pathname; a legacy `#/…` hash
 * route is accepted as a fallback (and upgraded to a clean path by the shim in
 * `useRouting`). The C.5/D.2 map-stack query params live in `location.search`
 * and are untouched here.
 */
function parseLocation(): RouteState {
	const pathname = window.location.pathname
	if (pathname && pathname !== '/') {
		return parsePathSegments(pathname.split('/').filter(Boolean))
	}

	// Legacy hash route fallback (pre-Round-I links). The redirect shim rewrites
	// these to clean paths on load; this keeps them working in the meantime.
	const hash = window.location.hash.slice(1)
	if (hash && hash !== '/') {
		return parsePathSegments(hash.split('/').filter(Boolean))
	}

	return { focusType: 'none', sidebarView: 'contexts' }
}

/**
 * Phase 1.2: one-time legacy redirect — upgrade a `#/…` hash route to the
 * equivalent clean path so the rest of the app (and crawlers) see the canonical
 * form. Preserves the map-stack query string.
 *
 * Must run synchronously *before* `createRoot().render` (called from
 * `frontend.tsx`), not inside a React effect: running it outside React means
 * StrictMode can't double-fire it, and the very first `parseLocation()` the app
 * performs already observes the clean path — so a `#/datasets` deep-link boots
 * straight into the datasets view instead of flashing the default contexts view
 * (report 7.5).
 */
export function upgradeLegacyHashRoute(): void {
	if (typeof window === 'undefined') return
	const legacyHash = window.location.hash.slice(1)
	if (legacyHash && legacyHash !== '/' && window.location.pathname === '/') {
		const cleanPath = legacyHash.startsWith('/') ? legacyHash : `/${legacyHash}`
		window.history.replaceState(null, '', `${cleanPath}${window.location.search}`)
	}
}

/** Custom event so in-app `pushState` navigations sync the route (popstate only fires on back/forward). */
const LOCATION_CHANGE_EVENT = 'earthly:locationchange'

/**
 * Build a clean route path from route components. The returned string is an
 * absolute path (no leading `#`) suitable for `history.pushState`.
 */
export function buildRoutePath({
	sidebarView,
	contextNaddr,
	focusType,
	naddr,
	commentId,
}: {
	sidebarView: SidebarViewMode
	contextNaddr?: string
	focusType?: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon'
	naddr?: string
	commentId?: string
}): string {
	const root = contextNaddr ? `/context/${contextNaddr}/${sidebarView}` : `/${sidebarView}`
	if (focusType && naddr) {
		if (commentId) {
			return `${root}/${focusType}/${naddr}/comment/${commentId}`
		}
		return `${root}/${focusType}/${naddr}`
	}
	return root
}

/** @deprecated Round I renamed this to {@link buildRoutePath}; kept as an alias for callers. */
export const buildRouteHash = buildRoutePath

/**
 * Navigate to a clean route path. Preserves `location.search` (the map-stack
 * `?ms=`/`?ex=`/`?iso=` params owned by C.5/D.2) and notifies listeners via a
 * synthetic event, since `pushState` doesn't fire `popstate`.
 */
export function navigateToRoute(routePath: string, options?: { replace?: boolean }): void {
	if (typeof window === 'undefined') return
	const search = window.location.search
	const url = `${routePath}${search}`
	const current = `${window.location.pathname}${window.location.search}`
	if (url === current) return
	if (options?.replace) {
		window.history.replaceState(null, '', url)
	} else {
		window.history.pushState(null, '', url)
	}
	window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT))
}

/**
 * Hook for managing hash-based routing for sidebar views, focused content, and context scope.
 *
 * Supports routes:
 * - #/{sidebarView} → sidebar view, no focus, no context scope
 * - #/{sidebarView}/{focusType}/{naddr} → sidebar view + focus
 * - #/context/{contextNaddr}/{sidebarView?} → context scope + sidebar
 * - #/context/{contextNaddr}/{sidebarView?}/{focusType}/{naddr} → context scope + sidebar + focus
 */
export function useRouting() {
	const [route, setRoute] = useState<RouteState>(parseLocation)

	// Phase 1.3: the single atomic reducer that reconciles every piece of
	// navigation-derived store state from a parsed route.
	const applyRouteState = useEditorStore((state) => state.applyRouteState)

	// Sync route state on navigation.
	useEffect(() => {
		const syncRoute = () => {
			const newRoute = parseLocation()
			setRoute(newRoute)
			// Phase 1.3: in-app pushState, Back/Forward (popstate), and hashchange
			// all funnel through one reducer so they share a single reconstruction
			// path. This is what stops Back/Forward from leaving a stale inspector
			// open (report 7.4) — applyRouteState clears the subject when the route
			// it lands on carries no focus.
			applyRouteState(newRoute)
		}

		// Phase 1.2: the legacy `#/…`→clean-path redirect now runs synchronously in
		// `frontend.tsx` via upgradeLegacyHashRoute() before render, so by the time
		// this effect mounts the URL is already canonical.
		window.addEventListener('hashchange', syncRoute)
		window.addEventListener('popstate', syncRoute)
		window.addEventListener(LOCATION_CHANGE_EVENT, syncRoute)

		// Initial sync on mount (the legacy hash redirect already ran in frontend.tsx).
		syncRoute()

		return () => {
			window.removeEventListener('hashchange', syncRoute)
			window.removeEventListener('popstate', syncRoute)
			window.removeEventListener(LOCATION_CHANGE_EVENT, syncRoute)
		}
	}, [applyRouteState])

	/**
	 * Phase 1.3: the single navigation primitive. Every navigate* wrapper builds
	 * its intended route fields and funnels through here, so the path is built and
	 * pushed in exactly one place. The wrappers stay thin and the
	 * preserve-vs-replace decisions live where each verb expresses them.
	 */
	const commit = useCallback((params: Parameters<typeof buildRoutePath>[0]) => {
		navigateToRoute(buildRoutePath(params))
	}, [])

	/**
	 * Navigate to a sidebar view (without focus)
	 */
	const navigateToView = useCallback(
		(view: SidebarViewMode) => {
			const currentRoute = parseLocation()
			commit({ sidebarView: view, contextNaddr: currentRoute.contextNaddr })
		},
		[commit],
	)

	/**
	 * Navigate to a focused route, preserving or setting sidebar view
	 */
	const navigateTo = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
			naddr: string,
			sidebarView?: SidebarViewMode,
		) => {
			const currentRoute = parseLocation()
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
			})
		},
		[commit],
	)

	/**
	 * Set or change active context scope while preserving current sidebar/focus.
	 */
	const navigateToContext = useCallback(
		(contextNaddr: string, sidebarView?: SidebarViewMode) => {
			const currentRoute = parseLocation()
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr,
				focusType: currentRoute.focusType !== 'none' ? currentRoute.focusType : undefined,
				naddr: currentRoute.naddr,
				commentId: currentRoute.commentId,
			})
		},
		[commit],
	)

	/**
	 * Clear focus but stay on current sidebar view
	 */
	const clearFocus = useCallback(() => {
		const currentRoute = parseLocation()
		commit({ sidebarView: currentRoute.sidebarView, contextNaddr: currentRoute.contextNaddr })
	}, [commit])

	/**
	 * Leave context scope while preserving sidebar view and focus.
	 */
	const clearContextScope = useCallback(() => {
		const currentRoute = parseLocation()
		commit({
			sidebarView: currentRoute.sidebarView,
			focusType: currentRoute.focusType !== 'none' ? currentRoute.focusType : undefined,
			naddr: currentRoute.naddr,
			commentId: currentRoute.commentId,
		})
	}, [commit])

	/**
	 * Navigate to datasets view with no focus (home)
	 */
	const navigateHome = useCallback(() => {
		commit({ sidebarView: 'datasets' })
	}, [commit])

	const navigateToComment = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
			naddr: string,
			commentId: string,
			sidebarView?: SidebarViewMode,
		) => {
			const currentRoute = parseLocation()
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
				commentId,
			})
		},
		[commit],
	)

	/**
	 * Navigate to a user's profile page
	 */
	const navigateToUser = useCallback((pubkey: string) => {
		const npub = nip19.npubEncode(pubkey)
		navigateToRoute(`/user/${npub}`)
	}, [])

	/**
	 * Generate naddr for a geo event
	 */
	const encodeGeoEventNaddr = useCallback(
		(event: {
			kind?: number
			pubkey: string
			datasetId?: string
			dTag?: string
		}): string | null => {
			const identifier = event.datasetId ?? event.dTag
			if (!identifier || !event.kind) return null

			try {
				return nip19.naddrEncode({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier,
				})
			} catch {
				return null
			}
		},
		[],
	)

	/**
	 * Generate naddr for a map context
	 */
	const encodeContextNaddr = useCallback(
		(event: {
			kind?: number
			pubkey: string
			contextId?: string
			dTag?: string
		}): string | null => {
			const identifier = event.contextId ?? event.dTag
			if (!identifier || !event.kind) return null

			try {
				return nip19.naddrEncode({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier,
				})
			} catch {
				return null
			}
		},
		[],
	)

	return {
		route,
		navigateToView,
		navigateTo,
		navigateToComment,
		navigateToContext,
		navigateToUser,
		clearFocus,
		clearContextScope,
		navigateHome,
		encodeGeoEventNaddr,
		encodeContextNaddr,
		/** Whether currently focused on a dataset or context */
		isFocused: route.focusType !== 'none',
		/** Current sidebar view mode from the route */
		sidebarView: route.sidebarView,
		/** Active context scope naddr from route, if any */
		contextNaddr: route.contextNaddr,
		/** Active context scope coordinate from route, if any */
		contextCoordinate: route.contextCoordinate,
		/** User pubkey from route (for user profile pages) */
		userPubkey: route.userPubkey,
		/** Comment d-tag deep-linked beneath the focused entity route */
		commentId: route.commentId,
	}
}
