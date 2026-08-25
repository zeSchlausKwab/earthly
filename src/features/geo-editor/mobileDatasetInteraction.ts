import type { MobileEntitySurface, MobilePanelTab, Stance } from './store/types'

export interface DatasetMapInteractionState {
	draftGeometryVisible: boolean
	isMobile: boolean
	mobilePanelOpen: boolean
	mobilePanelTab: MobilePanelTab
	mobileEntitySurface: MobileEntitySurface | null
	viewMode: 'edit' | 'view'
	stance: Stance
}

/**
 * Whether direct map gestures may mutate the retained Dataset draft.
 *
 * The task state (`viewMode`/`stance`) deliberately survives presentation-only
 * mobile tab switches. While the workspace sheet is open, its visible surface
 * therefore provides the final interaction gate: only Dataset under Edit owns
 * geometry gestures. Closing the sheet returns the map to the retained authoring
 * task without rewriting that task, its route, or Map Stack visibility.
 */
export function isDatasetMapInteractionEnabled({
	draftGeometryVisible,
	isMobile,
	mobilePanelOpen,
	mobilePanelTab,
	mobileEntitySurface,
	viewMode,
	stance,
}: DatasetMapInteractionState): boolean {
	if (viewMode !== 'edit' || stance !== 'author' || !draftGeometryVisible) return false
	if (!isMobile || !mobilePanelOpen) return true
	return mobilePanelTab === 'edit' && mobileEntitySurface === 'dataset'
}
