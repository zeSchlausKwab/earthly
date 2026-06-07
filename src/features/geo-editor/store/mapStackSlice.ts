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
				isolated: input.isolated ?? existing?.isolated ?? false,
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

	setMapStackEntryIsolated: (id, isolated) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry) return {}
			// Mutually exclusive: turning isolation ON clears it on all others.
			const nextEntries: Record<string, typeof entry> = {}
			for (const [key, value] of Object.entries(state.mapStackEntries)) {
				if (key === id) {
					nextEntries[key] = { ...value, isolated }
				} else if (isolated && value.isolated) {
					nextEntries[key] = { ...value, isolated: false }
				} else {
					nextEntries[key] = value
				}
			}
			return { mapStackEntries: nextEntries }
		}),

	clearMapStackIsolation: () =>
		set((state) => {
			let anyIsolated = false
			for (const entry of Object.values(state.mapStackEntries)) {
				if (entry.isolated) {
					anyIsolated = true
					break
				}
			}
			if (!anyIsolated) return {}
			const nextEntries: Record<string, (typeof state.mapStackEntries)[string]> = {}
			for (const [key, value] of Object.entries(state.mapStackEntries)) {
				nextEntries[key] = value.isolated ? { ...value, isolated: false } : value
			}
			return { mapStackEntries: nextEntries }
		}),

	clearMapStack: () => set({ mapStackEntries: {}, mapStackOrder: [] }),
})
