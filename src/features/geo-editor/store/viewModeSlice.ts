import type { StateCreator } from 'zustand'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
import { viewToMobileTab } from './mobileTabRoute'
import type { EditorState, ViewModeSlice } from './types'

export const createViewModeSlice: StateCreator<EditorState, [], [], ViewModeSlice> = (set) => ({
	viewMode: 'view',
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

	setViewMode: (viewMode) => set({ viewMode }),
	setViewDataset: (viewDataset) => set({ viewDataset }),
	setViewContext: (viewContext) => set({ viewContext }),
	setViewStory: (viewStory) => set({ viewStory }),
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
			// "Edit session live" = the `draft:active` map-stack entry exists. It is
			// added in exactly one place (applyEditingState) and removed in exactly
			// one (tearDownEditSession) — the Phase 1.4 invariant — so it is the one
			// honest signal that the geometry editor owns a draft. (Note:
			// `activeGeoEditDraftId` is only ever cleared, never assigned, so it
			// cannot serve as this signal.)
			const editSessionLive = state.mapStackEntries['draft:active'] != null
			// The context editor edits metadata, not geometry — treat it as a
			// non-geometry surface so a live geo draft doesn't flip us into 'edit'.
			const inContextEditor = route.sidebarView === 'context-editor'

			// Subjects (the inspector). Clear when the route can't correspond to that
			// subject being open; never *set* here — handlers and the resolver effect
			// own that. This is the Back/Forward stale-inspector fix (report 7.4).
			//
			// The dataset inspector is keyed to a geoevent focus (always
			// URL-derivable). The context inspector is subtler: in-app inspect drives
			// a context *scope* (`/context/:naddr/...`), not a focus, and browsing a
			// catalog within that scope clears viewContext explicitly — so we only
			// drop viewContext when the scope itself is gone (and it isn't a
			// mapcontext share-form focus). Keeping it while the scope is active means
			// an inspected context survives a sidebar-view switch within the scope.
			const viewDataset = route.focusType === 'geoevent' ? state.viewDataset : null
			const viewContext =
				route.focusType === 'mapcontext' || route.contextNaddr != null ? state.viewContext : null
			// The Story inspector is keyed to a `story` focus (always URL-derivable),
			// like the dataset inspector. Drop it whenever the route isn't a story focus.
			const viewStory = route.focusType === 'story' ? state.viewStory : null

			// Inspecting iff a focus route is active or a context inspector is open.
			const inspectingSubject = hasFocus || viewContext != null
			// The geometry editor is the active interaction surface only when a draft
			// is live and we're neither inspecting a subject nor editing a context.
			const editingGeometry = editSessionLive && !inspectingSubject && !inContextEditor

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
			const mobileSheet =
				mobileTab && mobileTab !== state.mobilePanelTab
					? {
							mobilePanelTab: mobileTab,
							// Surface a non-default destination; the default landing view
							// keeps the map in charge at the peek detent. Written directly
							// (not via setMobilePanelOpen, which resets the snap to peek).
							...(route.sidebarView !== DEFAULT_SIDEBAR_VIEW
								? { mobilePanelOpen: true, mobilePanelSnap: 'half' as const }
								: {}),
						}
					: {}

			return {
				sidebarViewMode: route.sidebarView,
				focusedType: hasFocus ? route.focusType : null,
				focusedNaddr: hasFocus ? (route.naddr ?? null) : null,
				activeContextScopeNaddr: route.contextNaddr ?? null,
				activeContextScopeCoordinate: route.contextCoordinate ?? null,
				viewDataset,
				viewContext,
				viewStory,
				viewMode,
				stance,
				...mobileSheet,
			}
		}),
})
