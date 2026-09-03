import { useCallback, useEffect, useMemo } from 'react'
import { nip19 } from 'nostr-tools'
import { navigateEarthly } from '@/router/navigation'
import type { EarthlyObjectTab, EarthlyRouteState } from '@/router/routeContract'
import { useEarthlyRouteState } from '@/router/routeState'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
import { useEditorStore, type SidebarViewMode } from '../store'

export type { SidebarViewMode }

/** All valid sidebar view mode values */
const SIDEBAR_VIEW_MODES: SidebarViewMode[] = [
	'drafts',
	'datasets',
	'map-stack',
	'contexts',
	'field-sessions',
	'private-groups',
	'context-editor',
	'stories',
	'sightings',
	'beacons',
	'combined',
	'edit',
	'posts',
	'delivery',
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

const BROWSE_VIEW_ALIASES: Record<string, SidebarViewMode> = {
	maps: 'datasets',
	stories: 'stories',
	atlases: 'contexts',
	sightings: 'sightings',
	people: 'user',
}

const CANONICAL_VIEW_PATHS: Partial<Record<SidebarViewMode, string>> = {
	datasets: '/browse/maps',
	stories: '/browse/stories',
	contexts: '/browse/atlases',
	sightings: '/browse/sightings',
	user: '/me',
	'map-stack': '/shelf',
	'private-groups': '/me/circles',
	'field-sessions': '/me/nearby',
	delivery: '/inbox',
	chat: '/ask',
}

const CANONICAL_FOCUS_PATHS: Record<
	'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
	string
> = {
	geoevent: 'map',
	mapcontext: 'atlas',
	story: 'story',
	sighting: 'sighting',
	beacon: 'live',
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
	/** Route-backed object panel selected for the current entity. */
	tab: EarthlyObjectTab
	/** Current sidebar view mode */
	sidebarView: SidebarViewMode
	/** Local MLS workspace identifier for a `/privategroup/:id` detail route. */
	privateGroupId?: string
	/** Local collaboration identifier for a `/fieldsession/:id` detail route. */
	fieldSessionId?: string
	/** User pubkey for user profile routes (hex format) */
	userPubkey?: string
	/** Canonical object edit/proposal intent from the route. */
	edit?: boolean
	/** Ordered, route-local Shelf overlays. */
	on?: readonly string[]
	/** Whether the aggregate Live layer is route-enabled. */
	live?: boolean
}

/** Translate the public route grammar into the retained domain-controller shape. */
export function routeStateFromEarthlyRoute(route: EarthlyRouteState): RouteState {
	const lens = route.in
	const lensFields = lens
		? { contextNaddr: lens, contextCoordinate: decodeContextCoordinateFromNaddr(lens) }
		: {}
	const common = {
		...lensFields,
		...(route.edit ? { edit: true } : {}),
		tab: route.tab,
		on: route.on,
		live: route.live,
	}

	if (route.kind === 'legacy') {
		const legacy = parsePathSegments((route.legacyPath ?? '/').split('/').filter(Boolean))
		return {
			...legacy,
			...lensFields,
			tab: legacy.commentId ? 'comments' : route.tab,
			on: route.on,
			live: route.live,
		}
	}
	if (route.kind === 'browse') {
		return {
			focusType: 'none',
			sidebarView: BROWSE_VIEW_ALIASES[route.browseKind ?? 'maps'] ?? DEFAULT_SIDEBAR_VIEW,
			...common,
		}
	}
	if (route.kind === 'ask') return { focusType: 'none', sidebarView: 'chat', ...common }
	if (route.kind === 'shelf') return { focusType: 'none', sidebarView: 'map-stack', ...common }
	if (route.kind === 'inbox') return { focusType: 'none', sidebarView: 'delivery', ...common }
	if (route.kind === 'me') {
		return {
			focusType: 'none',
			sidebarView:
				route.meSection === 'circles'
					? 'private-groups'
					: route.meSection === 'nearby'
						? 'field-sessions'
						: 'user',
			...common,
		}
	}
	if (route.kind === 'circle') {
		return {
			focusType: 'none',
			sidebarView: route.edit ? 'edit' : 'private-groups',
			privateGroupId: route.id,
			tab: route.tab,
			...(route.edit ? { edit: true } : {}),
			on: route.on,
			live: route.live,
		}
	}
	if (route.kind === 'nearby') {
		return {
			focusType: 'none',
			sidebarView: route.edit ? 'edit' : 'field-sessions',
			fieldSessionId: route.id,
			tab: route.tab,
			...(route.edit ? { edit: true } : {}),
			on: route.on,
			live: route.live,
		}
	}
	if (route.kind === 'person') {
		let userPubkey = route.id
		if (userPubkey?.startsWith('npub')) {
			try {
				const decoded = nip19.decode(userPubkey)
				if (decoded.type === 'npub') userPubkey = decoded.data
			} catch {
				// Preserve an invalid opaque id so the existing panel can show its error.
			}
		}
		return { focusType: 'none', sidebarView: 'user', userPubkey, ...common }
	}

	const focus =
		route.kind === 'map'
			? ({ focusType: 'geoevent', sidebarView: 'datasets' } as const)
			: route.kind === 'atlas'
				? ({ focusType: 'mapcontext', sidebarView: 'contexts' } as const)
				: route.kind === 'story'
					? ({ focusType: 'story', sidebarView: 'stories' } as const)
					: route.kind === 'sighting'
						? ({ focusType: 'sighting', sidebarView: 'sightings' } as const)
						: route.kind === 'live'
							? ({ focusType: 'beacon', sidebarView: 'beacons' } as const)
							: null
	if (focus) {
		return {
			...focus,
			naddr: route.id,
			commentId: route.commentId,
			...common,
		}
	}

	return { focusType: 'none', sidebarView: DEFAULT_SIDEBAR_VIEW, ...common }
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
	map: { focusType: 'geoevent', sidebarView: 'datasets' },
	mapcontext: { focusType: 'mapcontext', sidebarView: 'contexts' },
	atlas: { focusType: 'mapcontext', sidebarView: 'contexts' },
	read: { focusType: 'story', sidebarView: 'stories' },
	story: { focusType: 'story', sidebarView: 'stories' },
	sighting: { focusType: 'sighting', sidebarView: 'sightings' },
	beacon: { focusType: 'beacon', sidebarView: 'beacons' },
	live: { focusType: 'beacon', sidebarView: 'beacons' },
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
		return { focusType: 'none', sidebarView: DEFAULT_SIDEBAR_VIEW, tab: 'details' }
	}

	const first = segments[0]
	if (!first) {
		return { focusType: 'none', sidebarView: DEFAULT_SIDEBAR_VIEW, tab: 'details' }
	}

	if (first === 'browse') {
		return {
			focusType: 'none',
			sidebarView: BROWSE_VIEW_ALIASES[segments[1] ?? 'maps'] ?? DEFAULT_SIDEBAR_VIEW,
			tab: 'details',
		}
	}
	if (first === 'shelf') return { focusType: 'none', sidebarView: 'map-stack', tab: 'details' }
	if (first === 'ask') return { focusType: 'none', sidebarView: 'chat', tab: 'details' }
	if (first === 'inbox') return { focusType: 'none', sidebarView: 'delivery', tab: 'details' }
	if (first === 'me' && segments[1] === 'circles') {
		return { focusType: 'none', sidebarView: 'private-groups', tab: 'details' }
	}
	if (first === 'me' && segments[1] === 'nearby') {
		return { focusType: 'none', sidebarView: 'field-sessions', tab: 'details' }
	}

	// User profile route: /user/{npub_or_pubkey} or canonical /person/:id.
	if ((first === 'user' || first === 'person') && segments[1]) {
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
			tab: 'details',
		}
	}

	// Private groups use the same collection/detail route grammar as Earthly's
	// public entities, but the opaque id addresses local MLS state rather than a
	// public Nostr event: /private-groups and /privategroup/:id. Accept the
	// earlier hyphenated preview route so copied development invites still open.
	if (
		(first === 'privategroup' || first === 'private-group' || first === 'circle') &&
		segments[1]
	) {
		const nestedView = segments[2]
		return {
			focusType: 'none',
			sidebarView: nestedView && isSidebarViewMode(nestedView) ? nestedView : 'private-groups',
			privateGroupId: segments[1],
			tab: 'details',
		}
	}

	if (
		(first === 'fieldsession' || first === 'field-session' || first === 'nearby') &&
		segments[1]
	) {
		const nestedView = segments[2]
		return {
			focusType: 'none',
			sidebarView: nestedView && isSidebarViewMode(nestedView) ? nestedView : 'field-sessions',
			fieldSessionId: segments[1],
			tab: 'details',
		}
	}

	// Share forms (also what the OG crawler matches): /geoevent/:naddr,
	// /mapcontext/:naddr, /read/:naddr, /story/:naddr, /sighting/:naddr,
	// /beacon/:naddr, each
	// with an optional /comment/:id suffix. XCUT-02 (D-08): one table-driven
	// dispatch body replaces the original five byte-identical per-kind blocks (Pitfall
	// P-5). URL shapes are byte-for-byte identical (D-09): `first` still matches
	// only these known prefixes, `segments[1]` is still the opaque naddr (the
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
			tab: segments[2] === 'comment' && segments[3] ? 'comments' : 'details',
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
				tab: second === 'comment' && segments[3] ? 'comments' : 'details',
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
				tab: commentSegment === 'comment' && commentId ? 'comments' : 'details',
			}
		}

		return {
			contextNaddr,
			contextCoordinate,
			focusType: 'none',
			sidebarView,
			tab: 'details',
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
				tab: segments[3] === 'comment' && segments[4] ? 'comments' : 'details',
			}
		}

		return { focusType: 'none', sidebarView: resolvedFirst, tab: 'details' }
	}

	return { focusType: 'none', sidebarView: DEFAULT_SIDEBAR_VIEW, tab: 'details' }
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

	return { focusType: 'none', sidebarView: DEFAULT_SIDEBAR_VIEW, tab: 'details' }
}

/**
 * Is the CURRENT window location a shared / deep-linked entity route?
 *
 * Returns true when the initial URL either resolves (via the same
 * pathname-then-hash fallback `parseLocation` uses) to an entity focus /
 * context deep-link (`focusType !== 'none'` OR a truthy `contextNaddr`), OR
 * carries a shared Map-Stack `?ms=` query param. Used by TourManager to skip
 * the onboarding auto-start when a fresh recipient lands directly on a shared
 * entity — the boolean is READ-ONLY (no transmit/log/persist) and the caller
 * captures it once at mount so a later in-app navigation cannot retroactively
 * suppress a legitimately-earned tour.
 */
export function isDeepLinkLanding(): boolean {
	if (typeof window === 'undefined') return false

	// (b) shared Shelf overlays use the canonical `on=` query.
	if (new URLSearchParams(window.location.search).has('on')) return true

	// (a) entity/context deep-link — reuse parseLocation's pathname-then-hash
	// fallback so a legacy `#/…` hash deep-link is detected too.
	const route = parseLocation()
	return route.focusType !== 'none' || !!route.contextNaddr
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

export interface UseRoutingOptions {
	/**
	 * Own reconciliation from the browser URL into the global editor store.
	 * GeoEditorView is the single owner; nested panels are route observers only.
	 */
	reconcileStore?: boolean
}

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
	privateGroupId,
	fieldSessionId,
	edit,
	tab = 'details',
}: {
	sidebarView: SidebarViewMode
	contextNaddr?: string
	focusType?: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon'
	naddr?: string
	commentId?: string
	privateGroupId?: string
	fieldSessionId?: string
	edit?: boolean
	tab?: EarthlyObjectTab
}): string {
	if (fieldSessionId) {
		const root = `/nearby/${encodeURIComponent(fieldSessionId)}`
		return sidebarView === 'field-sessions' ? root : `${root}/${sidebarView}`
	}
	if (privateGroupId) {
		const root = `/circle/${encodeURIComponent(privateGroupId)}`
		return sidebarView === 'private-groups' ? root : `${root}/${sidebarView}`
	}
	if (focusType && naddr) {
		const root = `/${CANONICAL_FOCUS_PATHS[focusType]}/${naddr}`
		const objectPath = edit ? `${root}/edit` : commentId ? `${root}/comment/${commentId}` : root
		const search: string[] = []
		if (contextNaddr) search.push(`in=${encodeURIComponent(contextNaddr)}`)
		// A comment suffix already selects Comments canonically; avoid a redundant
		// query key while still serializing standalone Comments and Thread tabs.
		if (!commentId && tab !== 'details') search.push(`tab=${tab}`)
		return search.length > 0 ? `${objectPath}?${search.join('&')}` : objectPath
	}
	const root = CANONICAL_VIEW_PATHS[sidebarView] ?? `/${sidebarView}`
	return contextNaddr ? `${root}?in=${encodeURIComponent(contextNaddr)}` : root
}

/** @deprecated Round I renamed this to {@link buildRoutePath}; kept as an alias for callers. */
export const buildRouteHash = buildRoutePath

/**
 * Navigate through TanStack Router. The public route-local composition keys
 * survive navigation unless the destination explicitly sets (or empties) one.
 */
export function navigateToRoute(routePath: string, options?: { replace?: boolean }): void {
	if (typeof window === 'undefined') return
	const destination = new URL(routePath, window.location.origin)
	const currentSearch = new URLSearchParams(window.location.search)
	for (const key of ['on', 'live', 'in'] as const) {
		if (!destination.searchParams.has(key) && currentSearch.has(key)) {
			destination.searchParams.set(key, currentSearch.get(key) ?? '')
		}
	}
	const url = `${destination.pathname}${destination.search}${destination.hash}`
	const current = `${window.location.pathname}${window.location.search}`
	if (url === current) return
	navigateEarthly(url, options)
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
export function useRouting({ reconcileStore = false }: UseRoutingOptions = {}) {
	const earthlyRoute = useEarthlyRouteState()
	const route = useMemo(() => routeStateFromEarthlyRoute(earthlyRoute), [earthlyRoute])

	// Phase 1.3: the single atomic reducer that reconciles every piece of
	// navigation-derived store state from a parsed route.
	const applyRouteState = useEditorStore((state) => state.applyRouteState)

	// TanStack is the only navigation observer; reconcile its state into the
	// retained editor controller once per committed route.
	useEffect(() => {
		if (!reconcileStore) return
		applyRouteState(route, { syncMobileTab: true })
	}, [applyRouteState, reconcileStore, route])

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
			const currentRoute = route
			commit({
				sidebarView: view,
				// Private groups are their own encrypted scope; a public Context filter
				// must not leak into or wrap their route.
				contextNaddr:
					view === 'drafts' || view === 'private-groups' || view === 'field-sessions'
						? undefined
						: currentRoute.contextNaddr,
				privateGroupId:
					view === 'drafts' || view === 'private-groups' ? undefined : currentRoute.privateGroupId,
				fieldSessionId:
					view === 'drafts' || view === 'field-sessions' ? undefined : currentRoute.fieldSessionId,
			})
		},
		[commit, route],
	)

	/** Leave every private/nearby/context route boundary and open a root catalog. */
	const navigateToUnscopedView = useCallback((view: SidebarViewMode) => {
		const path = buildRoutePath({ sidebarView: view })
		navigateToRoute(`${path}${path.includes('?') ? '&' : '?'}in=`)
	}, [])

	const navigateToPrivateGroup = useCallback(
		(privateGroupId: string) => {
			commit({ sidebarView: 'private-groups', privateGroupId })
		},
		[commit],
	)

	const navigateToFieldSession = useCallback(
		(fieldSessionId: string) => {
			commit({ sidebarView: 'field-sessions', fieldSessionId })
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
			edit = false,
		) => {
			const currentRoute = route
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
				edit,
				tab: 'details',
			})
		},
		[commit, route],
	)

	/**
	 * Set or change the Atlas lens while preserving current sidebar/focus.
	 */
	const navigateToContext = useCallback(
		(contextNaddr: string, sidebarView?: SidebarViewMode) => {
			const currentRoute = route
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr,
				focusType: currentRoute.focusType !== 'none' ? currentRoute.focusType : undefined,
				naddr: currentRoute.naddr,
				commentId: currentRoute.commentId,
				tab: currentRoute.tab,
			})
		},
		[commit, route],
	)

	/**
	 * Clear focus but stay on current sidebar view
	 */
	const clearFocus = useCallback(() => {
		commit({ sidebarView: route.sidebarView, contextNaddr: route.contextNaddr })
	}, [commit, route])

	/**
	 * Leave context scope while preserving sidebar view and focus.
	 */
	const clearContextScope = useCallback(() => {
		const path = buildRoutePath({
			sidebarView: route.sidebarView,
			focusType: route.focusType !== 'none' ? route.focusType : undefined,
			naddr: route.naddr,
			commentId: route.commentId,
			tab: route.tab,
		})
		// An explicit empty value tells navigateToRoute not to inherit the lens;
		// TanStack's search validator removes it from the committed URL.
		navigateToRoute(`${path}${path.includes('?') ? '&' : '?'}in=`)
	}, [route])

	/**
	 * Navigate to the default landing view with no focus (home)
	 */
	const navigateHome = useCallback(() => {
		navigateToRoute('/')
	}, [])

	const navigateToComment = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon',
			naddr: string,
			commentId: string,
			sidebarView?: SidebarViewMode,
		) => {
			const currentRoute = route
			commit({
				sidebarView: sidebarView ?? currentRoute.sidebarView,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
				commentId,
				tab: 'comments',
			})
		},
		[commit, route],
	)

	/** Select a panel on the current object without changing its composition. */
	const navigateToTab = useCallback(
		(tab: EarthlyObjectTab) => {
			if (route.focusType === 'none' || !route.naddr) return
			commit({
				sidebarView: route.sidebarView,
				contextNaddr: route.contextNaddr,
				focusType: route.focusType,
				naddr: route.naddr,
				commentId: tab === 'comments' ? route.commentId : undefined,
				edit: route.edit,
				tab,
			})
		},
		[commit, route],
	)

	/**
	 * Navigate to a user's profile page
	 */
	const navigateToUser = useCallback((pubkey: string) => {
		const npub = nip19.npubEncode(pubkey)
		navigateToRoute(`/person/${npub}`)
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
		/** Canonical TanStack route, retained when legacy controller fields collapse distinctions. */
		publicRoute: earthlyRoute,
		route,
		navigateToView,
		navigateToUnscopedView,
		navigateToPrivateGroup,
		navigateToFieldSession,
		navigateTo,
		navigateToComment,
		navigateToTab,
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
		/** Selected local MLS workspace from `/privategroup/:id`. */
		privateGroupId: route.privateGroupId,
		/** Selected nearby collaboration space from `/fieldsession/:id`. */
		fieldSessionId: route.fieldSessionId,
		/** Comment d-tag deep-linked beneath the focused entity route */
		commentId: route.commentId,
		/** Active route-backed object panel. */
		tab: route.tab,
	}
}
