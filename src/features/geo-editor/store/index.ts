import { create } from 'zustand'
import { createEditorCoreSlice } from './editorCoreSlice'
import { createDraftSlice } from './draftSlice'
import { createWorkspaceSlice } from './workspaceSlice'
import { createMetadataSlice } from './metadataSlice'
import { createPublishingSlice } from './publishingSlice'
import { createViewModeSlice } from './viewModeSlice'
import { createUISlice } from './uiSlice'
import { createSearchSlice } from './searchSlice'
import { createMapSourceSlice } from './mapSourceSlice'
import type { EditorState } from './types'

export const useEditorStore = create<EditorState>((...a) => ({
	...createEditorCoreSlice(...a),
	...createDraftSlice(...a),
	...createWorkspaceSlice(...a),
	...createMetadataSlice(...a),
	...createPublishingSlice(...a),
	...createViewModeSlice(...a),
	...createUISlice(...a),
	...createSearchSlice(...a),
	...createMapSourceSlice(...a),
}))

// Re-export all types for backwards compatibility
export type {
	EditorState,
	EditorStats,
	AnnouncementSourceMeta,
	MapLayerState,
	MobilePanelTab,
	MobilePanelSnap,
	GeoCollectionEditDraft,
	GeoEditorWorkspace,
	SidebarViewMode,
} from './types'
