import type { StateCreator } from 'zustand'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
import { isMobileMapSurfaceTab, viewToMobileTab } from './mobileTabRoute'
import { hasRetainedDatasetSurface } from './mobileEntitySurface'
import type { EditorState, ViewModeSlice } from './types'

export const createViewModeSlice: StateCreator<EditorState, [], [], ViewModeSlice> = (
	set,
	get,
) => ({
	viewMode: 'view',
	inspectionSubject: null,
	viewDataset: null,
	viewContext: null,
	viewStory: null,
	viewContextDatasets: [],
	contextFilterMode: 'strict',
	contextMapScopeMode: 'children',
	activeContextScopeNaddr: null,
	activeContextScopeCoordinate: null,

	focusedNaddr: null,
	focusedType: null,
	focusedMapGeometry: null,

	setViewMode: (viewMode) => {
		if (viewMode !== 'edit') get().editor?.setInteractionEnabled(false)
		set({ viewMode })
	},
	setInspectionSubject: (inspectionSubject) => {
		if (inspectionSubject) get().editor?.setInteractionEnabled(false)
		set({
			inspectionSubject,
			viewDataset: inspectionSubject?.kind === 'dataset' ? inspectionSubject.entity : null,
			viewContext: inspectionSubject?.kind === 'context' ? inspectionSubject.entity : null,
			viewStory: inspectionSubject?.kind === 'story' ? inspectionSubject.entity : null,
		})
	},
	setViewDataset: (viewDataset) => {
		if (viewDataset) get().editor?.setInteractionEnabled(false)
		set(
			viewDataset
				? {
						viewDataset,
						viewContext: null,
						viewStory: null,
						inspectionSubject: { kind: 'dataset', entity: viewDataset },
					}
				: { viewDataset: null },
		)
	},
	setViewContext: (viewContext) => {
		if (viewContext) get().editor?.setInteractionEnabled(false)
		set(
			viewContext
				? {
						viewContext,
						viewDataset: null,
						viewStory: null,
						inspectionSubject: { kind: 'context', entity: viewContext },
					}
				: { viewContext: null },
		)
	},
	setViewStory: (viewStory) => {
		if (viewStory) get().editor?.setInteractionEnabled(false)
		set(
			viewStory
				? {
						viewStory,
						viewDataset: null,
						viewContext: null,
						inspectionSubject: { kind: 'story', entity: viewStory },
					}
				: { viewStory: null },
		)
	},
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
	setFocused: (type, naddr) => set({ focusedType: type, focusedNaddr: naddr }),
	clearFocused: () => set({ focusedType: null, focusedNaddr: null }),

	setFocusedMapGeometry: (focusedMapGeometry) => set({ focusedMapGeometry }),
	clearFocusedMapGeometry: () => set({ focusedMapGeometry: null }),

	applyRouteState: (route, options) =>
		set((state) => {
			const hasFocus = route.focusType !== 'none'
			// A retained Dataset editor is a valid workspace -> draft relationship.
			// When the route activates authoring, the editor workflow restores its
			// mandatory visible Map Stack row after this pure route transition.
			const editSessionLive = hasRetainedDatasetSurface(state)
			// The context editor edits metadata, not geometry — treat it as a
			// non-geometry surface so a live geo draft doesn't flip us into 'edit'.
			const inContextEditor = route.sidebarView === 'context-editor'

			// Subjects (the inspector). Clear when the route can't correspond to that
			// subject being open; never *set* here — handlers and the resolver effect
			// own that. This is the Back/Forward stale-inspector fix (report 7.4).
			//
			// Dataset, Context and Story inspectors are all keyed to explicit focus
			// routes. A `/context/:naddr` scope is filtering state, never an implicit
			// request to inspect that Context.
			const viewDataset = route.focusType === 'geoevent' ? state.viewDataset : null
			const viewContext = route.focusType === 'mapcontext' ? state.viewContext : null
			// The Story inspector is keyed to a `story` focus (always URL-derivable),
			// like the dataset inspector. Drop it whenever the route isn't a story focus.
			const viewStory = route.focusType === 'story' ? state.viewStory : null

			const inspectingSubject = hasFocus
			// The geometry editor is the active interaction surface only when a draft
			// is live and we're neither inspecting a subject nor editing a context.
			const editingGeometry =
				editSessionLive &&
				(route.sidebarView === 'edit' || route.sidebarView === 'combined') &&
				!inspectingSubject &&
				!inContextEditor

			const viewMode = editingGeometry ? 'edit' : 'view'
			// stance: author while actively editing geometry; focus while inspecting a
			// subject or editing a context; browse otherwise.
			const stance = editingGeometry
				? 'author'
				: inspectingSubject || inContextEditor
					? 'focus'
					: 'browse'

			// Browser-driven navigation (initial load, Back/Forward): the URL is the
			// only source of truth, so derive the mobile sheet's tab from it — this
			// is what makes reload and deep links restore the mobile destination
			// (audit P1 #6). In-app navigations skip this (syncMobileTab unset):
			// their handlers own the tab (e.g. the `edit` overlay during inspect).
			const mobileTab = options?.syncMobileTab ? viewToMobileTab(route.sidebarView) : null
			const mobileSurface = mobileTab
				? hasFocus || inContextEditor || isMobileMapSurfaceTab(mobileTab)
					? {
							mobilePanelTab: hasFocus ? ('edit' as const) : mobileTab,
							mobilePanelOpen: true,
							mobilePanelSnap: mobileTab === 'chat' ? ('full' as const) : ('half' as const),
							mobileSidebarOpen: false,
							mobilePanelResumeOnSidebarClose: null,
						}
					: route.sidebarView !== DEFAULT_SIDEBAR_VIEW
						? {
								mobilePanelTab: mobileTab,
								mobilePanelOpen: false,
								mobileSidebarOpen: true,
								mobileSidebarMode: 'content' as const,
								mobilePanelResumeOnSidebarClose: null,
							}
						: {
								mobilePanelTab: mobileTab,
								mobilePanelOpen: false,
								mobileSidebarOpen: false,
							}
				: {}

			return {
				sidebarViewMode: route.sidebarView,
				focusedType: route.focusType === 'none' ? null : route.focusType,
				focusedNaddr: hasFocus ? (route.naddr ?? null) : null,
				activeContextScopeNaddr: route.contextNaddr ?? null,
				activeContextScopeCoordinate: route.contextCoordinate ?? null,
				viewDataset,
				viewContext,
				viewStory,
				viewMode,
				stance,
				...mobileSurface,
			}
		}),
})
