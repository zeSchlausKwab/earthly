import type { StateCreator } from 'zustand'
import { earthlyGeoServer } from '@/ctxcn'
import type { EditorState, SearchSlice } from './types'

export const createSearchSlice: StateCreator<EditorState, [], [], SearchSlice> = (set, get) => ({
	searchQuery: '',
	searchResults: [],
	searchLoading: false,
	searchError: null,
	searchPerformed: false,

	osmQueryMode: 'idle',
	osmQueryFilter: 'highway',
	osmQueryPosition: null,
	osmQueryResults: [],
	osmQueryError: null,
	osmQuerySelectedIds: new Set(),

	// Editing the query invalidates the "we already searched" state so a stale
	// "no results" message clears as the user types (P2.1).
	setSearchQuery: (searchQuery) => set({ searchQuery, searchPerformed: false }),
	setSearchResults: (searchResults) => set({ searchResults }),
	setSearchLoading: (searchLoading) => set({ searchLoading }),
	setSearchError: (searchError) => set({ searchError }),

	performSearch: async () => {
		const { searchQuery } = get()
		const trimmed = searchQuery.trim()
		if (!trimmed) {
			set({ searchError: 'Enter a search query', searchResults: [], searchPerformed: false })
			return
		}

		set({ searchLoading: true, searchError: null })

		try {
			const response = await earthlyGeoServer.SearchLocation(trimmed, 8)
			const rawResults = response.result?.results ?? []
			const normalizedResults = rawResults
				// Defend against malformed backend rows before the UI keys on placeId
				// / renders displayName (report 8.1: validate result shape).
				.filter(
					(result): result is typeof result =>
						Boolean(result) && typeof result.displayName === 'string',
				)
				.map((result) => {
					const bbox = Array.isArray(result.boundingbox) ? result.boundingbox : null
					const normalizedBbox =
						bbox && bbox.length === 4 && bbox.every((value) => typeof value === 'number')
							? (bbox as [number, number, number, number])
							: null
					return {
						...result,
						boundingbox: normalizedBbox,
					}
				})
			set({ searchResults: normalizedResults, searchPerformed: true })
		} catch (error) {
			set({
				searchError: error instanceof Error ? error.message : 'Search failed',
				searchResults: [],
				searchPerformed: true,
			})
		} finally {
			set({ searchLoading: false })
		}
	},

	clearSearch: () =>
		set({ searchQuery: '', searchResults: [], searchError: null, searchPerformed: false }),

	setOsmQueryMode: (mode) => set({ osmQueryMode: mode }),
	setOsmQueryFilter: (filter) => set({ osmQueryFilter: filter }),
	setOsmQueryPosition: (position) => set({ osmQueryPosition: position }),
	setOsmQueryResults: (results) => set({ osmQueryResults: results }),
	setOsmQueryError: (error) => set({ osmQueryError: error }),
	toggleOsmQuerySelection: (id) =>
		set((state) => {
			const newSet = new Set(state.osmQuerySelectedIds)
			if (newSet.has(id)) {
				newSet.delete(id)
			} else {
				newSet.add(id)
			}
			return { osmQuerySelectedIds: newSet }
		}),
	clearOsmQuery: () =>
		set({
			osmQueryMode: 'idle',
			osmQueryPosition: null,
			osmQueryResults: [],
			osmQueryError: null,
			osmQuerySelectedIds: new Set(),
		}),
})
