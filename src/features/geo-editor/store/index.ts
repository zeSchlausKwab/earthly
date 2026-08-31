import { create } from 'zustand'
import { createEditorCoreSlice } from './editorCoreSlice'
import { createDraftSlice } from './draftSlice'
import { createWorkspaceSlice } from './workspaceSlice'
import { createMetadataSlice } from './metadataSlice'
import { createPublishingSlice } from './publishingSlice'
import { createViewModeSlice } from './viewModeSlice'
import { createMapStackSlice } from './mapStackSlice'
import { createUISlice } from './uiSlice'
import { createSearchSlice } from './searchSlice'
import { createMapSourceSlice } from './mapSourceSlice'
import { createSessionSyncSlice } from './sessionSyncSlice'
import { createStanceSlice } from './stanceSlice'
import { createCatalogSlice } from './catalogSlice'
import { createGeoQuerySlice } from './geoQuerySlice'
import type { EditorState } from './types'

export {
	getRetainedDatasetSurfaceTarget,
	hasRetainedDatasetSurface,
	resolveDraftEditorOpenPlan,
	resolveMobileEntitySurface,
} from './mobileEntitySurface'
export type { DraftEditorOpenPlan, RetainedDatasetSurfaceTarget } from './mobileEntitySurface'
export {
	ensureActiveDraftMapPresentation,
	resolveActiveDraftMapPresentation,
} from './activeDraftMapPresentation'
export type { ActiveDraftMapPresentation } from './activeDraftMapPresentation'

export const useEditorStore = create<EditorState>((...a) => ({
	...createEditorCoreSlice(...a),
	...createDraftSlice(...a),
	...createWorkspaceSlice(...a),
	...createMetadataSlice(...a),
	...createPublishingSlice(...a),
	...createViewModeSlice(...a),
	...createMapStackSlice(...a),
	...createUISlice(...a),
	...createSearchSlice(...a),
	...createMapSourceSlice(...a),
	...createSessionSyncSlice(...a),
	...createStanceSlice(...a),
	...createCatalogSlice(...a),
	...createGeoQuerySlice(...a),
}))

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
	// Dev-only debug handle (pairs with __earthlyMap/__earthlyPool/__earthlyEventStore).
	;(window as unknown as Record<string, unknown>).__earthlyEditorStore = useEditorStore
}

// Re-export all types for backwards compatibility
export type {
	EditorState,
	GeoQuerySlice,
	GeoQueryStatus,
	EditorStats,
	AnnouncementSourceMeta,
	MapLayerState,
	MapStackEntry,
	MapStackEntrySource,
	MapStackEntryType,
	MapStackEntryVia,
	MobilePanelTab,
	MobilePanelSnap,
	MobileSidebarMode,
	MobilePanelResume,
	MobileEntitySurface,
	MobileEntitySurfaceAvailability,
	GeoCollectionEditDraft,
	GeoEditorWorkspace,
	PublishChannel,
	SidebarViewMode,
	SettingsTab,
	ChatDock,
	InspectionSubject,
	Stance,
	RecentEntity,
} from './types'
