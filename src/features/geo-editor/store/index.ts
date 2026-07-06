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
import type { EditorState } from './types'

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
}))

// Re-export all types for backwards compatibility
export type {
	EditorState,
	EditorStats,
	AnnouncementSourceMeta,
	MapLayerState,
	MapStackEntry,
	MapStackEntrySource,
	MapStackEntryType,
	MobilePanelTab,
	MobilePanelSnap,
	GeoCollectionEditDraft,
	GeoEditorWorkspace,
	SidebarViewMode,
	Stance,
	RecentEntity,
} from './types'
