import type { StateCreator } from 'zustand'
import type { EditorState, ViewModeSlice } from './types'

export const createViewModeSlice: StateCreator<EditorState, [], [], ViewModeSlice> = (set) => ({
	viewMode: 'view',
	editIsolationEnabled: false,
	viewDataset: null,
	viewContext: null,
	viewContextDatasets: [],
	contextFilterMode: 'strict',
	contextMapScopeMode: 'children',
	activeContextScopeNaddr: null,
	activeContextScopeCoordinate: null,
	landingContextScopeNaddr: null,
	landingContextScopeCoordinate: null,
	landingContextSelectionInitialized: false,

	focusedNaddr: null,
	focusedType: null,
	focusedMapGeometry: null,

	setViewMode: (viewMode) => set({ viewMode }),
	setViewDataset: (viewDataset) => set({ viewDataset }),
	setViewContext: (viewContext) => set({ viewContext }),
	setViewContextDatasets: (viewContextDatasets) => set({ viewContextDatasets }),
	setContextFilterMode: (contextFilterMode) => set({ contextFilterMode }),
	setContextMapScopeMode: (contextMapScopeMode) => set({ contextMapScopeMode }),
	setActiveContextScope: (activeContextScopeNaddr, activeContextScopeCoordinate) =>
		set({ activeContextScopeNaddr, activeContextScopeCoordinate }),
	clearActiveContextScope: () =>
		set({
			activeContextScopeNaddr: null,
			activeContextScopeCoordinate: null,
		}),
	setLandingContextScope: (landingContextScopeNaddr, landingContextScopeCoordinate) =>
		set({ landingContextScopeNaddr, landingContextScopeCoordinate }),
	clearLandingContextScope: () =>
		set({
			landingContextScopeNaddr: null,
			landingContextScopeCoordinate: null,
		}),
	setLandingContextSelectionInitialized: (landingContextSelectionInitialized) =>
		set({ landingContextSelectionInitialized }),
	setEditIsolationEnabled: (editIsolationEnabled) => set({ editIsolationEnabled }),
	toggleEditIsolation: () =>
		set((state) => ({ editIsolationEnabled: !state.editIsolationEnabled })),

	setFocused: (type, naddr) => set({ focusedType: type, focusedNaddr: naddr }),
	clearFocused: () => set({ focusedType: null, focusedNaddr: null }),

	setFocusedMapGeometry: (focusedMapGeometry) => set({ focusedMapGeometry }),
	clearFocusedMapGeometry: () => set({ focusedMapGeometry: null }),
})
