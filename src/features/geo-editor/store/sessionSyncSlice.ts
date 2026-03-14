import type { StateCreator } from 'zustand'
import { setCurrentPubkey } from '@/lib/wallet/currentUser'
import { createDefaultCollectionMeta } from '../utils'
import { readPersistedGeoCollectionDraftState } from './draftSlice'
import type { EditorState, SessionSyncSlice } from './types'
import { readPersistedWorkspaceState } from './workspaceSlice'

export const createSessionSyncSlice: StateCreator<EditorState, [], [], SessionSyncSlice> = (
	set,
	get,
) => ({
	hydrateEditorSessionForPubkey: (pubkey) => {
		setCurrentPubkey(pubkey)

		const persistedDrafts = readPersistedGeoCollectionDraftState(pubkey)
		const persistedWorkspaces = readPersistedWorkspaceState(pubkey)
		const editor = get().editor

		set({
			features: [],
			stats: { points: 0, lines: 0, polygons: 0, total: 0 },
			mode: 'select',
			selectedFeatureIds: [],
			canFinishDrawing: false,
			history: { canUndo: false, canRedo: false },
			geoEditDrafts: {},
			activeGeoEditDraftId: null,
			workspaces: {},
			activeWorkspaceId: null,
			collectionMeta: createDefaultCollectionMeta(),
			activeDataset: null,
			activeDatasetContextRefs: [],
			isPublishing: false,
			publishMessage: null,
			publishError: null,
			blossomUploadDialogOpen: false,
			pendingPublishCollection: null,
			blobReferences: [],
			blobDraftUrl: '',
			blobDraftStatus: 'idle',
			blobDraftError: null,
			previewingBlobReferenceId: null,
			blobPreviewCollection: null,
			viewMode: 'view',
			viewDataset: null,
		})

		editor?.setMode('select')
		editor?.setFeatures([])

		set({
			geoEditDrafts: persistedDrafts.drafts,
			activeGeoEditDraftId: persistedDrafts.activeDraftId,
			workspaces: persistedWorkspaces.workspaces,
			activeWorkspaceId: persistedWorkspaces.activeWorkspaceId,
		})
	},
})
