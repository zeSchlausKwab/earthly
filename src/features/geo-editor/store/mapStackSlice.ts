import type { StateCreator } from 'zustand'
import { resolveActiveDraftMapPresentation } from './activeDraftMapPresentation'
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
			const activeDraftLocked =
				id === 'draft:active' && resolveActiveDraftMapPresentation(state) !== null
			const entry = {
				...input,
				id,
				addedAt: existing?.addedAt ?? input.addedAt ?? Date.now(),
				visible: activeDraftLocked ? true : input.visible,
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

	// The active Dataset edit is an invariant, not an optional layer. Legitimate
	// teardown clears authoring state before removing this row.
	removeMapStackEntry: (id) =>
		set((state) => {
			if (!state.mapStackEntries[id]) return {}
			if (id === 'draft:active' && resolveActiveDraftMapPresentation(state)) return {}
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
			if (id === 'draft:active' && !visible && resolveActiveDraftMapPresentation(state)) return {}
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
			if (id === 'draft:active' && resolveActiveDraftMapPresentation(state)) {
				if (entry.visible) return {}
				return {
					mapStackEntries: {
						...state.mapStackEntries,
						[id]: { ...entry, visible: true },
					},
				}
			}
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
			const activeDraft = resolveActiveDraftMapPresentation(state)
			// Pinned rows survive Clear. Active Dataset authoring additionally keeps
			// its canonical visible draft row and suppresses the published twin.
			const keptIds = state.mapStackOrder.filter((id) => {
				const entry = state.mapStackEntries[id]
				if (!entry?.pinned) return false
				return !(
					activeDraft?.datasetKey &&
					entry.entityType === 'dataset' &&
					entry.entityKey === activeDraft.datasetKey
				)
			})
			const nextEntries: typeof state.mapStackEntries = {}
			for (const id of keptIds) {
				const entry = state.mapStackEntries[id]
				if (entry) nextEntries[id] = entry
			}
			if (activeDraft) {
				nextEntries[activeDraft.entry.id] = activeDraft.entry
				if (!keptIds.includes(activeDraft.entry.id)) keptIds.push(activeDraft.entry.id)
			}
			return { mapStackEntries: nextEntries, mapStackOrder: keptIds }
		}),
})
