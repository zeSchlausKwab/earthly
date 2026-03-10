import type { StateCreator } from 'zustand'
import type { EditorState, ViewModeSlice } from './types'

export const createViewModeSlice: StateCreator<EditorState, [], [], ViewModeSlice> = (set) => ({
	viewMode: 'view',
	editIsolationEnabled: false,
	viewDataset: null,
	viewContext: null,
	viewContextDatasets: [],
	contextFilterMode: 'strict',
	activeContextScopeNaddr: null,
	activeContextScopeCoordinate: null,

	focusedNaddr: null,
	focusedType: null,
	focusedMapGeometry: null,

	setViewMode: (viewMode) => set({ viewMode }),
	setViewDataset: (viewDataset) => set({ viewDataset }),
	setViewContext: (viewContext) => set({ viewContext }),
	setViewContextDatasets: (viewContextDatasets) => set({ viewContextDatasets }),
	setContextFilterMode: (contextFilterMode) => set({ contextFilterMode }),
	setActiveContextScope: (activeContextScopeNaddr, activeContextScopeCoordinate) =>
		set({ activeContextScopeNaddr, activeContextScopeCoordinate }),
	clearActiveContextScope: () =>
		set({
			activeContextScopeNaddr: null,
			activeContextScopeCoordinate: null,
		}),
	setEditIsolationEnabled: (editIsolationEnabled) => set({ editIsolationEnabled }),
	toggleEditIsolation: () =>
		set((state) => ({ editIsolationEnabled: !state.editIsolationEnabled })),

	setFocused: (type, naddr) => set({ focusedType: type, focusedNaddr: naddr }),
	clearFocused: () => set({ focusedType: null, focusedNaddr: null }),

	setFocusedMapGeometry: (focusedMapGeometry) => set({ focusedMapGeometry }),
	clearFocusedMapGeometry: () => set({ focusedMapGeometry: null }),
})
