import type { EarthlyObjectTab } from '@/router/routeContract'
import type { MobileEntitySurface, PublishChannel } from '../store/types'
import type { RouteState } from '../hooks/useRouting'

export function mobileResumeRouteKey(
	route: Pick<
		RouteState,
		'sidebarView' | 'focusType' | 'naddr' | 'tab' | 'edit' | 'privateGroupId' | 'fieldSessionId'
	>,
): string {
	return JSON.stringify([
		route.sidebarView,
		route.focusType,
		route.naddr,
		route.tab,
		Boolean(route.edit),
		route.privateGroupId,
		route.fieldSessionId,
	])
}

export function mobileResumeNavigationStatus(
	current: string,
	origin: string,
	destination: string,
): 'waiting' | 'arrived' | 'cancelled' {
	return current === destination ? 'arrived' : current === origin ? 'waiting' : 'cancelled'
}

/** Resume changes navigation only; the retained editor's live contents stay in place. */
export function mobileResumeDestination(
	surface: Exclude<MobileEntitySurface, 'inspector'>,
	options: {
		storyAddress?: string | null
		atlasAddress?: string | null
		publishChannel?: PublishChannel | null
	} = {},
): string {
	if (surface === 'dataset') {
		if (options.publishChannel?.kind === 'private-group')
			return `/circle/${encodeURIComponent(options.publishChannel.id)}/edit`
		if (options.publishChannel?.kind === 'field-session')
			return `/nearby/${encodeURIComponent(options.publishChannel.id)}/edit`
		return '/edit'
	}
	if (surface === 'story')
		return options.storyAddress
			? `/story/${encodeURIComponent(options.storyAddress)}/edit`
			: '/browse/stories'
	if (surface === 'context')
		return options.atlasAddress
			? `/atlas/${encodeURIComponent(options.atlasAddress)}/edit`
			: '/context-editor'
	if (surface === 'sighting') return '/browse/sightings'
	return '/beacons'
}

/** A retained editor must not inherit the hidden Thread's overflow or conversation slot. */
export function mobileObjectNavigationState(
	inspectorVisible: boolean,
	panel: string,
	routeTab: EarthlyObjectTab,
): { activeTab: EarthlyObjectTab; showThread: boolean } {
	const showThread = inspectorVisible && panel === 'chat' && routeTab === 'thread'
	return {
		activeTab: inspectorVisible && (routeTab !== 'thread' || showThread) ? routeTab : 'details',
		showThread,
	}
}
