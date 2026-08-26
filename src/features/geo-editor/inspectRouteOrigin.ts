import type { RouteState } from './hooks/useRouting'

export type EphemeralInspectFocusType = Extract<RouteState['focusType'], 'sighting' | 'beacon'>

/** Stable identity used to distinguish an in-app inspect URL write from a fresh landing. */
export function inspectRouteKey(focusType: EphemeralInspectFocusType, naddr: string): string {
	return `${focusType}:${naddr}`
}

/**
 * Remember a route only when the app is about to create it. Rewriting the URL of
 * an already-open focus (for example while hydrating a shared link) is not an
 * in-app inspect transition and must retain the landing behavior.
 */
export function markInAppInspectRoute(
	pending: { current: string | null },
	currentRouteKey: string | null,
	nextRouteKey: string,
): void {
	pending.current = currentRouteKey === nextRouteKey ? null : nextRouteKey
}

/** Consume exactly one matching in-app transition; unrelated/direct routes pass through. */
export function consumeInAppInspectRoute(
	pending: { current: string | null },
	routeKey: string,
): boolean {
	if (pending.current !== routeKey) {
		// A different route won the navigation race. Fail open to shared-link
		// hydration and forget the obsolete marker so it cannot suppress a later
		// genuine landing on the old key.
		pending.current = null
		return false
	}
	pending.current = null
	return true
}
