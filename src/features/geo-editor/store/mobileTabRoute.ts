import type { MobilePanelTab, SidebarViewMode } from './types'

/**
 * Canonical-router unification (UI/UX audit P1 #6): mobile panel tabs and
 * sidebar view modes are the SAME destinations under two names, so mobile
 * navigation can round-trip through the URL exactly like the desktop rail.
 * The only rename is `profile` (tab) ↔ `user` (view); `combined` has no
 * mobile tab.
 */
export function mobileTabToView(tab: MobilePanelTab): SidebarViewMode {
	return tab === 'profile' ? 'user' : tab
}

/** Null when the view has no mobile tab (`combined`) — callers keep the current tab. */
export function viewToMobileTab(view: SidebarViewMode): MobilePanelTab | null {
	if (view === 'user') return 'profile'
	if (view === 'combined') return null
	return view
}

const MOBILE_MAP_SURFACE_TABS = new Set<MobilePanelTab>(['map-stack', 'context-editor', 'edit'])

/** Map-bound surfaces belong in the vertical sheet. Every other destination is
 * navigation/discovery/account content and belongs in the horizontal drawer. */
export function isMobileMapSurfaceTab(tab: MobilePanelTab): boolean {
	return MOBILE_MAP_SURFACE_TABS.has(tab)
}

export function isMobileSidebarTab(tab: MobilePanelTab): boolean {
	return !isMobileMapSurfaceTab(tab)
}
