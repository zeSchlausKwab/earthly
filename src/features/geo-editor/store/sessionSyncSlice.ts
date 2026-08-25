import type { StateCreator } from 'zustand'
import { setCurrentPubkey } from '@/lib/wallet/currentUser'
import { createDefaultCollectionMeta } from '../utils'
import { readPersistedGeoCollectionDraftState } from './draftSlice'
import {
	flushPersistedGeoCollectionDraftState,
	writePersistedGeoCollectionDraftState,
} from './editorCoreSlice'
import type { EditorState, SessionSyncSlice } from './types'
import {
	readPersistedWorkspaceState,
	repairWorkspaceActiveDraftIds,
	writePersistedWorkspaceState,
} from './workspaceSlice'

export const createSessionSyncSlice: StateCreator<EditorState, [], [], SessionSyncSlice> = (
	set,
	get,
) => ({
	hydrateEditorSessionForPubkey: (pubkey) => {
		// Finish any write owned by the previous account before changing the global
		// scope. The queued snapshot also carries its original scope as a second line
		// of defence against cross-account leakage.
		flushPersistedGeoCollectionDraftState()
		setCurrentPubkey(pubkey)

		const persistedDrafts = readPersistedGeoCollectionDraftState(pubkey)
		const persistedWorkspaces = readPersistedWorkspaceState(pubkey)
		const repairedWorkspaces = repairWorkspaceActiveDraftIds(
			persistedWorkspaces.workspaces,
			persistedDrafts.drafts,
		)
		const repairedActiveDraftId = persistedWorkspaces.activeWorkspaceId
			? (repairedWorkspaces.workspaces[persistedWorkspaces.activeWorkspaceId]?.activeDraftId ??
				null)
			: null
		if (repairedWorkspaces.repaired) {
			writePersistedWorkspaceState(
				repairedWorkspaces.workspaces,
				persistedWorkspaces.activeWorkspaceId,
				pubkey,
			)
		}
		if (persistedDrafts.activeDraftId !== repairedActiveDraftId) {
			writePersistedGeoCollectionDraftState(persistedDrafts.drafts, repairedActiveDraftId)
		}
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
			inspectionSubject: null,
			viewDataset: null,
		})

		editor?.setMode('select')
		editor?.setFeatures([])

		set({
			geoEditDrafts: persistedDrafts.drafts,
			activeGeoEditDraftId: repairedActiveDraftId,
			workspaces: repairedWorkspaces.workspaces,
			activeWorkspaceId: persistedWorkspaces.activeWorkspaceId,
		})
	},
})
