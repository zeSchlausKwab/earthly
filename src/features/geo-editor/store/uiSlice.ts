import type { StateCreator } from 'zustand'
import type { EditorState, UISlice } from './types'

export const createUISlice: StateCreator<EditorState, [], [], UISlice> = (set) => ({
	newCollectionProp: { key: '', value: '' },
	newFeatureProp: { key: '', value: '' },

	showTips: true,
	showDatasetsPanel: false,
	showInfoPanel: false,
	mobileDatasetsOpen: false,
	mobileInfoOpen: false,
	mobileToolsOpen: false,
	mobileSearchOpen: false,
	mobileActionsOpen: false,
	mobilePanelOpen: false,
	mobilePanelTab: 'datasets',
	mobilePanelSnap: 'peek',
	inspectorActive: false,
	sidebarViewMode: 'contexts',
	sidebarExpanded: false,
	settingsTab: null,
	draftEditorSlot: null,

	setNewCollectionProp: (newCollectionProp) => set({ newCollectionProp }),
	setNewFeatureProp: (newFeatureProp) => set({ newFeatureProp }),

	setShowTips: (showTips) =>
		set((state) => ({
			showTips: typeof showTips === 'function' ? showTips(state.showTips) : showTips,
		})),
	setShowDatasetsPanel: (show) =>
		set((state) => ({
			showDatasetsPanel: typeof show === 'function' ? show(state.showDatasetsPanel) : show,
		})),
	setShowInfoPanel: (show) =>
		set((state) => ({
			showInfoPanel: typeof show === 'function' ? show(state.showInfoPanel) : show,
		})),
	setMobileDatasetsOpen: (open) => set({ mobileDatasetsOpen: open }),
	setMobileInfoOpen: (open) => set({ mobileInfoOpen: open }),
	setMobileToolsOpen: (open) => set({ mobileToolsOpen: open }),
	setMobileSearchOpen: (open) => set({ mobileSearchOpen: open }),
	setMobileActionsOpen: (open) => set({ mobileActionsOpen: open }),
	setMobileActiveState: (state) =>
		set({
			mobileDatasetsOpen: state === 'datasets',
			mobileInfoOpen: state === 'info',
			mobileToolsOpen: state === 'tools',
			mobileSearchOpen: state === 'search',
			mobileActionsOpen: state === 'actions',
		}),
	setMobilePanelOpen: (open) =>
		set((state) => ({
			mobilePanelOpen: open,
			mobilePanelSnap: open ? 'peek' : state.mobilePanelSnap,
		})),
	setMobilePanelTab: (tab) => set({ mobilePanelTab: tab }),
	setMobilePanelSnap: (mobilePanelSnap) => set({ mobilePanelSnap }),
	openMobilePanel: (tab) =>
		set((state) => ({
			mobilePanelOpen: true,
			mobilePanelTab: tab ?? state.mobilePanelTab,
			mobilePanelSnap: 'peek',
		})),
	closeMobilePanel: () => set({ mobilePanelOpen: false }),
	setInspectorActive: (active) => set({ inspectorActive: active }),
	setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
	setSettingsTab: (settingsTab) => set({ settingsTab }),
	setDraftEditorSlot: (draftEditorSlot) => set({ draftEditorSlot }),
	setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
	toggleSidebarExpanded: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
})
