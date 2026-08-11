interface AggregateLayerRoute {
	focusType: 'none' | 'geoevent' | 'mapcontext' | 'story' | 'sighting' | 'beacon'
	naddr?: string
	contextNaddr?: string
}

/**
 * Aggregate sightings and beacons are ambient context for the generic landing,
 * not background noise for an entity deep link. Keep this decision independent
 * from the later stance transition: the parsed route is available on the first
 * render, before a focused entity has finished resolving.
 */
export function shouldSeedAggregateLayers({
	stance,
	stackUrlHydrated,
	hasSharedStack,
	route,
}: {
	stance: 'browse' | 'focus' | 'author'
	stackUrlHydrated: boolean
	hasSharedStack: boolean
	route: AggregateLayerRoute
}): boolean {
	if (stance === 'author' || !stackUrlHydrated || hasSharedStack) return false
	return route.focusType === 'none' && !route.contextNaddr
}
