import type { StateCreator } from 'zustand'
import { writePersistedGeoCollectionDraftState } from './editorCoreSlice'
import { normalizeDraftContextRefs } from './draftSlice'
import type { EditorState, MetadataSlice } from './types'

function areCollectionMetasEqual(
	left: EditorState['collectionMeta'],
	right: EditorState['collectionMeta'],
): boolean {
	if (
		left.name !== right.name ||
		left.description !== right.description ||
		left.color !== right.color
	) {
		return false
	}

	const leftKeys = Object.keys(left.customProperties)
	const rightKeys = Object.keys(right.customProperties)
	if (leftKeys.length !== rightKeys.length) return false
	return leftKeys.every(
		(key) =>
			Object.hasOwn(right.customProperties, key) &&
			left.customProperties[key] === right.customProperties[key],
	)
}

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
	isDirty: false,
	activeDatasetContextRefs: [],
	resolvingDatasets: new Set<string>(),
	resolvingProgress: new Map<string, { loaded: number; total: number }>(),

	setCollectionMeta: (collectionMeta) => {
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			const activeDraft = activeGeoEditDraftId ? geoEditDrafts[activeGeoEditDraftId] : undefined
			const currentMetaMatches = areCollectionMetasEqual(state.collectionMeta, collectionMeta)
			const activeDraftMatches =
				!activeDraft ||
				(activeDraft.name === collectionMeta.name &&
					activeDraft.description === collectionMeta.description &&
					areCollectionMetasEqual(activeDraft.collectionMeta, collectionMeta))
			if (currentMetaMatches && activeDraftMatches) return state

			if (!activeGeoEditDraftId || !activeDraft) {
				return { collectionMeta }
			}
			const updatedDraft = {
				...activeDraft,
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
				isDirty: true,
				geoEditDrafts: nextDrafts,
			}
		})
	},

	setActiveDataset: (activeDataset) => {
		set({ activeDataset, isDirty: false })
		if (!activeDataset?.dTag) return
		const state = get()
		const workspace = state.activeWorkspaceId ? state.workspaces[state.activeWorkspaceId] : null
		const datasetKey = `${activeDataset.pubkey}:${activeDataset.dTag}`
		if (
			workspace &&
			(workspace.datasetKey === datasetKey || workspace.sourceId === `dataset:${datasetKey}`)
		) {
			state.updateWorkspace(workspace.id, {
				datasetKey,
				baseRevisionId: activeDataset.event.id,
			})
		}
	},
	setIsDirty: (isDirty) => set({ isDirty }),
	setActiveDatasetContextRefs: (references) => {
		const activeDatasetContextRefs = normalizeDraftContextRefs(references)
		const before = get()
		const changed =
			JSON.stringify(activeDatasetContextRefs) !== JSON.stringify(before.activeDatasetContextRefs)
		set({
			activeDatasetContextRefs,
			...(changed && before.activeGeoEditDraftId ? { isDirty: true } : {}),
		})
		const { activeGeoEditDraftId, geoEditDrafts } = get()
		if (!changed) return
		if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) return
		get().saveGeoEditDraft(activeGeoEditDraftId, { contextRefs: activeDatasetContextRefs })
	},
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
