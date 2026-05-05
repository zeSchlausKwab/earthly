import type { StateCreator } from 'zustand'
import type { EditorState, MapStackSlice } from './types'

function createMapStackEntryId(entityType: string, entityKey: string) {
	return `${entityType}:${entityKey}`
}

export const createMapStackSlice: StateCreator<EditorState, [], [], MapStackSlice> = (set) => ({
	mapStackEntries: {},
	mapStackOrder: [],

	addMapStackEntry: (input) => {
		const id = input.id ?? createMapStackEntryId(input.entityType, input.entityKey)
		set((state) => {
			const existing = state.mapStackEntries[id]
			const entry = {
				...input,
				id,
				addedAt: existing?.addedAt ?? input.addedAt ?? Date.now(),
				visible: input.visible,
				pinned: input.pinned,
			}
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: entry,
				},
				mapStackOrder: state.mapStackOrder.includes(id)
					? state.mapStackOrder
					: [...state.mapStackOrder, id],
			}
		})
		return id
	},

	removeMapStackEntry: (id) =>
		set((state) => {
			if (!state.mapStackEntries[id]) return {}
			const nextEntries = { ...state.mapStackEntries }
			delete nextEntries[id]
			return {
				mapStackEntries: nextEntries,
				mapStackOrder: state.mapStackOrder.filter((entryId) => entryId !== id),
			}
		}),

	setMapStackEntryVisible: (id, visible) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry || entry.visible === visible) return {}
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: { ...entry, visible },
				},
			}
		}),

	toggleMapStackEntryVisible: (id) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry) return {}
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: { ...entry, visible: !entry.visible },
				},
			}
		}),

	clearMapStack: () => set({ mapStackEntries: {}, mapStackOrder: [] }),
})
