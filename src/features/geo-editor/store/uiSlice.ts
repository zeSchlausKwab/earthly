import type { StateCreator } from 'zustand'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
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
	mobileSidebarOpen: false,
	mobileSidebarMode: 'menu',
	mobilePanelResumeOnSidebarClose: null,
	inspectorActive: false,
	sidebarViewMode: DEFAULT_SIDEBAR_VIEW,
	sidebarExpanded: false,
	chatOpen: false,
	chatDock: 'right',
	mapStackOpen: true,
	settingsTab: null,

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
	setMobilePanelOpen: (mobilePanelOpen) => set({ mobilePanelOpen }),
	setMobilePanelTab: (tab) => set({ mobilePanelTab: tab }),
	setMobilePanelSnap: (mobilePanelSnap) => set({ mobilePanelSnap }),
	openMobilePanel: (tab) =>
		set((state) => ({
			mobilePanelOpen: true,
			mobilePanelTab: tab ?? state.mobilePanelTab,
			mobilePanelSnap: tab === 'chat' ? 'full' : 'half',
			mobileSidebarOpen: false,
			mobilePanelResumeOnSidebarClose: null,
		})),
	closeMobilePanel: () => set({ mobilePanelOpen: false }),
	openMobileSidebar: (tab) =>
		set((state) => ({
			mobileSidebarOpen: true,
			mobileSidebarMode: tab ? 'content' : 'menu',
			mobilePanelTab: tab ?? state.mobilePanelTab,
			mobilePanelResumeOnSidebarClose:
				state.mobilePanelResumeOnSidebarClose ??
				(state.mobilePanelOpen ? { tab: state.mobilePanelTab, snap: state.mobilePanelSnap } : null),
			mobilePanelOpen: false,
		})),
	showMobileSidebarMenu: () =>
		set((state) => ({
			mobileSidebarOpen: true,
			mobileSidebarMode: 'menu',
			mobilePanelResumeOnSidebarClose: state.mobilePanelResumeOnSidebarClose,
			mobilePanelOpen: false,
		})),
	selectMobileSidebarDestination: (mobilePanelTab, options) =>
		set((state) => ({
			mobileSidebarOpen: true,
			mobileSidebarMode: 'content',
			mobilePanelTab,
			mobilePanelResumeOnSidebarClose: options?.preserveSuspendedPanel
				? state.mobilePanelResumeOnSidebarClose
				: null,
			mobilePanelOpen: false,
		})),
	closeMobileSidebar: () =>
		set((state) => {
			const resume = state.mobilePanelResumeOnSidebarClose
			return {
				mobileSidebarOpen: false,
				mobileSidebarMode: 'menu',
				mobilePanelResumeOnSidebarClose: null,
				...(resume
					? {
							mobilePanelOpen: true,
							mobilePanelTab: resume.tab,
							mobilePanelSnap: resume.snap,
						}
					: {}),
			}
		}),
	setInspectorActive: (active) => set({ inspectorActive: active }),
	setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
	setSettingsTab: (settingsTab) => set({ settingsTab }),
	setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
	toggleSidebarExpanded: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
	setChatOpen: (chatOpen) => set({ chatOpen }),
	toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
	setChatDock: (chatDock) => set({ chatDock }),
	toggleChatAtDock: (chatDock) =>
		set((state) =>
			state.chatOpen && state.chatDock === chatDock
				? { chatOpen: false }
				: { chatOpen: true, chatDock },
		),
	setMapStackOpen: (mapStackOpen) => set({ mapStackOpen }),
	toggleMapStack: () => set((state) => ({ mapStackOpen: !state.mapStackOpen })),
})
