export interface FieldSessionEventScopeTransition<T> {
	events: T[]
	sessionId: string | undefined
}

/**
 * Keep the visible records while the same Field session receives refreshed
 * discovery metadata. Records belong to the session identity, not to a
 * particular object snapshot of that session.
 */
export function transitionFieldSessionEventScope<T>(
	events: T[],
	previousSessionId: string | undefined,
	nextSessionId: string | undefined,
): FieldSessionEventScopeTransition<T> {
	return {
		events: previousSessionId === nextSessionId ? events : [],
		sessionId: nextSessionId,
	}
}
