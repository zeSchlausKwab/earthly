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

/**
 * Parse the current hash into a RouteState
 *
 * URL patterns:
 * - #/ or #/contexts → contexts view, no focus, no context scope
 * - #/{sidebarView} → specified sidebar view, no focus, no context scope
 * - #/{sidebarView}/{focusType}/{naddr} → specified sidebar + focus, no context scope
 * - #/{sidebarView}/{focusType}/{naddr}/comment/{commentId} → specified sidebar + focus + comment
 * - #/context/{contextNaddr}/{sidebarView?} → context scope + sidebar
 * - #/context/{contextNaddr}/{sidebarView?}/{focusType}/{naddr} → context scope + sidebar + focus
 * - #/context/{contextNaddr}/{sidebarView?}/{focusType}/{naddr}/comment/{commentId} → scoped focus + comment
 */
function parseHash(): RouteState {
	const hash = window.location.hash.slice(1) // Remove leading #
	if (!hash || hash === '/') {
		return { focusType: 'none', sidebarView: 'contexts' }
	}

	// Split path segments: /segment1/segment2/segment3...
	const segments = hash.split('/').filter(Boolean)

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
		// Decode npub to hex if needed
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

	// Resolve alias (e.g., shoutbox → posts)
	const resolvedFirst = VIEW_ALIASES[first] ?? first

	// Check if first segment is a sidebar view mode
	if (isSidebarViewMode(resolvedFirst)) {
		// Check for focus in remaining segments: #/{sidebarView}/{focusType}/{naddr}
		if (segments[1] && segments[2] && isFocusType(segments[1])) {
			return {
				focusType: segments[1],
				naddr: segments[2],
				commentId: segments[3] === 'comment' && segments[4] ? segments[4] : undefined,
				sidebarView: resolvedFirst,
			}
		}

		// Just sidebar view, no focus
		return { focusType: 'none', sidebarView: resolvedFirst }
	}

	// Unknown route, default to contexts
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
	const [route, setRoute] = useState<RouteState>(parseHash)

	// Store actions
	const setFocused = useEditorStore((state) => state.setFocused)
	const clearFocused = useEditorStore((state) => state.clearFocused)
	const setSidebarViewMode = useEditorStore((state) => state.setSidebarViewMode)
	const setActiveContextScope = useEditorStore((state) => state.setActiveContextScope)

	// Sync route state on hash change
	useEffect(() => {
		const handleHashChange = () => {
			const newRoute = parseHash()
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

		window.addEventListener('hashchange', handleHashChange)

		// Initial sync on mount
		const initialRoute = parseHash()
		setSidebarViewMode(initialRoute.sidebarView)
		if (initialRoute.focusType !== 'none' && initialRoute.naddr) {
			setFocused(initialRoute.focusType, initialRoute.naddr)
		}
		setActiveContextScope(initialRoute.contextNaddr ?? null, initialRoute.contextCoordinate ?? null)

		return () => window.removeEventListener('hashchange', handleHashChange)
	}, [setFocused, clearFocused, setSidebarViewMode, setActiveContextScope])

	/**
	 * Navigate to a sidebar view (without focus)
	 */
	const navigateToView = useCallback((view: SidebarViewMode) => {
		const currentRoute = parseHash()
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
			const currentRoute = parseHash()
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
		const currentRoute = parseHash()
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
		const currentRoute = parseHash()
		window.location.hash = buildRouteHash({
			sidebarView: currentRoute.sidebarView,
			contextNaddr: currentRoute.contextNaddr,
		})
	}, [])

	/**
	 * Leave context scope while preserving sidebar view and focus.
	 */
	const clearContextScope = useCallback(() => {
		const currentRoute = parseHash()
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
			const currentRoute = parseHash()
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
