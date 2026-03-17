import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { useEditorStore, type SidebarViewMode } from '../store'

export type { SidebarViewMode }

/** All valid sidebar view mode values */
const SIDEBAR_VIEW_MODES: SidebarViewMode[] = [
	'datasets',
	'contexts',
	'context-editor',
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
	focusType: 'none' | 'geoevent' | 'mapcontext'
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

function isFocusType(value: string): value is 'geoevent' | 'mapcontext' {
	return value === 'geoevent' || value === 'mapcontext'
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

function parsePathSegments(segments: string[], source: 'hash' | 'pathname'): RouteState {
	if (segments.length === 0) {
		return { focusType: 'none', sidebarView: 'contexts' }
	}

	const first = segments[0]
	if (!first) {
		return { focusType: 'none', sidebarView: 'contexts' }
	}

	// Handle user profile route: #/user/{npub_or_pubkey}
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

	// Focus aliases used by clean server-side share routes after redirect.
	if (first === 'geoevent' && segments[1]) {
		return {
			focusType: 'geoevent',
			naddr: segments[1],
			commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
			sidebarView: 'datasets',
		}
	}
	if (first === 'mapcontext' && segments[1]) {
		return {
			focusType: 'mapcontext',
			naddr: segments[1],
			commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
			sidebarView: 'contexts',
		}
	}

	// Clean share path: /context/:naddr should behave like a focused context route.
	if (source === 'pathname' && first === 'context' && segments[1]) {
		return {
			focusType: 'mapcontext',
			naddr: segments[1],
			commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
			sidebarView: 'contexts',
		}
	}

	// Scoped context route:
	// #/context/{contextNaddr}/{sidebarView?}/{focusType?}/{focusNaddr?}
	if (first === 'context' && segments[1]) {
		const contextNaddr = segments[1]
		const contextCoordinate = decodeContextCoordinateFromNaddr(contextNaddr)
		const scopedViewCandidate = segments[2]
		const resolvedScopedView = scopedViewCandidate
			? (VIEW_ALIASES[scopedViewCandidate] ?? scopedViewCandidate)
			: 'datasets'
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
	if (first === 'context') {
		return { focusType: 'none', sidebarView: 'contexts' }
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
 * Parse the current location into a RouteState.
 *
 * Hash routes remain canonical inside the SPA. When no hash route is present,
 * we also accept clean pathname share routes like /geoevent/:naddr and /context/:naddr.
 */
function parseLocation(): RouteState {
	const hash = window.location.hash.slice(1)
	if (hash && hash !== '/') {
		return parsePathSegments(hash.split('/').filter(Boolean), 'hash')
	}

	const pathname = window.location.pathname
	if (pathname && pathname !== '/') {
		return parsePathSegments(pathname.split('/').filter(Boolean), 'pathname')
	}

	return { focusType: 'none', sidebarView: 'contexts' }
}

/**
 * Build a hash string from route components
 */
export function buildRouteHash({
	sidebarView,
	contextNaddr,
	focusType,
	naddr,
	commentId,
}: {
	sidebarView: SidebarViewMode
	contextNaddr?: string
	focusType?: 'geoevent' | 'mapcontext'
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

	// Store actions
	const setFocused = useEditorStore((state) => state.setFocused)
	const clearFocused = useEditorStore((state) => state.clearFocused)
	const setSidebarViewMode = useEditorStore((state) => state.setSidebarViewMode)
	const setActiveContextScope = useEditorStore((state) => state.setActiveContextScope)

	// Sync route state on hash change
	useEffect(() => {
		const syncRoute = () => {
			const newRoute = parseLocation()
			setRoute(newRoute)

			// Update store sidebar view mode
			setSidebarViewMode(newRoute.sidebarView)

			// Update store focus state
			if (newRoute.focusType === 'none') {
				clearFocused()
			} else if (newRoute.naddr) {
				setFocused(newRoute.focusType, newRoute.naddr)
			}
			setActiveContextScope(newRoute.contextNaddr ?? null, newRoute.contextCoordinate ?? null)
		}

		window.addEventListener('hashchange', syncRoute)
		window.addEventListener('popstate', syncRoute)

		// Initial sync on mount
		const initialRoute = parseLocation()
		setSidebarViewMode(initialRoute.sidebarView)
		if (initialRoute.focusType !== 'none' && initialRoute.naddr) {
			setFocused(initialRoute.focusType, initialRoute.naddr)
		}
		setActiveContextScope(initialRoute.contextNaddr ?? null, initialRoute.contextCoordinate ?? null)

		return () => {
			window.removeEventListener('hashchange', syncRoute)
			window.removeEventListener('popstate', syncRoute)
		}
	}, [setFocused, clearFocused, setSidebarViewMode, setActiveContextScope])

	/**
	 * Navigate to a sidebar view (without focus)
	 */
	const navigateToView = useCallback((view: SidebarViewMode) => {
		const currentRoute = parseLocation()
		window.location.hash = buildRouteHash({
			sidebarView: view,
			contextNaddr: currentRoute.contextNaddr,
		})
	}, [])

	/**
	 * Navigate to a focused route, preserving or setting sidebar view
	 */
	const navigateTo = useCallback(
		(focusType: 'geoevent' | 'mapcontext', naddr: string, sidebarView?: SidebarViewMode) => {
			const currentRoute = parseLocation()
			const view = sidebarView ?? currentRoute.sidebarView
			window.location.hash = buildRouteHash({
				sidebarView: view,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
			})
		},
		[],
	)

	/**
	 * Set or change active context scope while preserving current sidebar/focus.
	 */
	const navigateToContext = useCallback((contextNaddr: string, sidebarView?: SidebarViewMode) => {
		const currentRoute = parseLocation()
		const view = sidebarView ?? currentRoute.sidebarView
		window.location.hash = buildRouteHash({
			sidebarView: view,
			contextNaddr,
			focusType: currentRoute.focusType !== 'none' ? currentRoute.focusType : undefined,
			naddr: currentRoute.naddr,
			commentId: currentRoute.commentId,
		})
	}, [])

	/**
	 * Clear focus but stay on current sidebar view
	 */
	const clearFocus = useCallback(() => {
		const currentRoute = parseLocation()
		window.location.hash = buildRouteHash({
			sidebarView: currentRoute.sidebarView,
			contextNaddr: currentRoute.contextNaddr,
		})
	}, [])

	/**
	 * Leave context scope while preserving sidebar view and focus.
	 */
	const clearContextScope = useCallback(() => {
		const currentRoute = parseLocation()
		window.location.hash = buildRouteHash({
			sidebarView: currentRoute.sidebarView,
			focusType: currentRoute.focusType !== 'none' ? currentRoute.focusType : undefined,
			naddr: currentRoute.naddr,
			commentId: currentRoute.commentId,
		})
	}, [])

	/**
	 * Navigate to datasets view with no focus (home)
	 */
	const navigateHome = useCallback(() => {
		window.location.hash = buildRouteHash({ sidebarView: 'datasets' })
	}, [])

	const navigateToComment = useCallback(
		(
			focusType: 'geoevent' | 'mapcontext',
			naddr: string,
			commentId: string,
			sidebarView?: SidebarViewMode,
		) => {
			const currentRoute = parseLocation()
			const view = sidebarView ?? currentRoute.sidebarView
			window.location.hash = buildRouteHash({
				sidebarView: view,
				contextNaddr: currentRoute.contextNaddr,
				focusType,
				naddr,
				commentId,
			})
		},
		[],
	)

	/**
	 * Navigate to a user's profile page
	 */
	const navigateToUser = useCallback((pubkey: string) => {
		const npub = nip19.npubEncode(pubkey)
		window.location.hash = `/user/${npub}`
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
