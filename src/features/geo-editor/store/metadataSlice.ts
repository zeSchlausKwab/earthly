import type { StateCreator } from 'zustand'
import { writePersistedGeoCollectionDraftState } from './editorCoreSlice'
import type { EditorState, MetadataSlice } from './types'

export const createMetadataSlice: StateCreator<EditorState, [], [], MetadataSlice> = (
	set,
	get,
) => ({
	collectionMeta: {
		name: '',
		description: '',
		color: '#3b82f6',
		customProperties: {},
	},
	activeDataset: null,
	activeDatasetContextRefs: [],
	datasetVisibility: {},
	resolvingDatasets: new Set<string>(),
	resolvingProgress: new Map<string, { loaded: number; total: number }>(),

	setCollectionMeta: (collectionMeta) => {
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) {
				return { collectionMeta }
			}
			const updatedDraft = {
				...geoEditDrafts[activeGeoEditDraftId],
				name: collectionMeta.name,
				description: collectionMeta.description,
				collectionMeta,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...geoEditDrafts,
				[activeGeoEditDraftId]: updatedDraft,
			}
			writePersistedGeoCollectionDraftState(nextDrafts, activeGeoEditDraftId)
			return {
				collectionMeta,
				geoEditDrafts: nextDrafts,
			}
		})
		get().touchActiveWorkspace({
			label: collectionMeta.name.trim() || undefined,
		})
	},

	setActiveDataset: (activeDataset) => set({ activeDataset }),
	setActiveDatasetContextRefs: (activeDatasetContextRefs) => set({ activeDatasetContextRefs }),
	setDatasetVisibility: (update) =>
		set((state) => ({
			datasetVisibility: typeof update === 'function' ? update(state.datasetVisibility) : update,
		})),
	setDatasetResolving: (datasetKey, resolving) =>
		set((state) => {
			const next = new Set(state.resolvingDatasets)
			const nextProgress = new Map(state.resolvingProgress)
			if (resolving) {
				next.add(datasetKey)
			} else {
				next.delete(datasetKey)
				nextProgress.delete(datasetKey)
			}
			return { resolvingDatasets: next, resolvingProgress: nextProgress }
		}),
	setDatasetResolvingProgress: (datasetKey, loaded, total) =>
		set((state) => {
			const next = new Map(state.resolvingProgress)
			next.set(datasetKey, { loaded, total })
			return { resolvingProgress: next }
		}),
})
