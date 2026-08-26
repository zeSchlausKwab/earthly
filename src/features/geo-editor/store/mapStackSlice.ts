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
				exclusions: input.exclusions ?? existing?.exclusions ?? [],
				// Carrier provenance survives a re-add without it (e.g. a catalog
				// "add to map" on a dataset a Story already auto-stacked) — the
				// carrier still references the dataset, so the nested presentation
				// stays truthful until the carrier's own cleanup removes the entry.
				via: input.via ?? existing?.via,
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

	// Map Stack is visibility-only. `draft:active` represents the retained
	// Dataset's rendered geometry, not the lifetime of its workspace/edit task;
	// removing it must therefore have the same narrow semantics as any other row.
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

	toggleMapStackEntryExclusion: (id, datasetKey) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry) return {}
			const exclusions = entry.exclusions ?? []
			const nextExclusions = exclusions.includes(datasetKey)
				? exclusions.filter((key) => key !== datasetKey)
				: [...exclusions, datasetKey]
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: { ...entry, exclusions: nextExclusions },
				},
			}
		}),

	setMapStackEntryExclusions: (id, exclusions) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry) return {}
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: { ...entry, exclusions: [...exclusions] },
				},
			}
		}),

	toggleMapStackEntryPinned: (id) =>
		set((state) => {
			const entry = state.mapStackEntries[id]
			if (!entry) return {}
			return {
				mapStackEntries: {
					...state.mapStackEntries,
					[id]: { ...entry, pinned: !entry.pinned },
				},
			}
		}),

	setMapStackOrder: (order) =>
		set((state) => {
			// Reordering only — membership must be identical to the current stack.
			if (order.length !== state.mapStackOrder.length) return {}
			const incoming = new Set(order)
			if (incoming.size !== order.length) return {}
			for (const id of state.mapStackOrder) {
				if (!incoming.has(id)) return {}
			}
			return { mapStackOrder: order }
		}),

	clearMapStack: () =>
		set((state) => {
			// Pinning is the sole "keep this through a Clear" contract. A draft
			// visibility row is ordinary map presentation state; clearing it hides
			// geometry while the workspace/editor remains retained elsewhere.
			const keptIds = state.mapStackOrder.filter((id) => {
				const entry = state.mapStackEntries[id]
				return entry?.pinned
			})
			const nextEntries: typeof state.mapStackEntries = {}
			for (const id of keptIds) {
				const entry = state.mapStackEntries[id]
				if (entry) nextEntries[id] = entry
			}
			return { mapStackEntries: nextEntries, mapStackOrder: keptIds }
		}),
})
