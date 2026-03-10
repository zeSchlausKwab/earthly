import { useCallback, useState } from 'react'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { useEditorStore, type SidebarViewMode } from '../store'

interface UseContextEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeContextNaddr: (context: NDKMapContextEvent) => string | null
	navigateToContext: (contextNaddr: string, sidebarView?: SidebarViewMode) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
	handleInspectDataset: (event: NDKGeoEvent) => void
	loadDatasetForEditing: (event: NDKGeoEvent) => void
	startNewDataset: () => void
	switchToWorkspace: (workspaceId: string) => void | Promise<void>
}

export function useContextEditor({
	isMobile,
	ensureInfoPanelVisible,
	encodeContextNaddr,
	navigateToContext,
	navigateToView,
	clearFocus,
	loadDatasetForEditing,
	startNewDataset,
	switchToWorkspace,
	handleInspectDataset,
}: UseContextEditorParams) {
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)

	const [contextEditorMode, setContextEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingContext, setEditingContext] = useState<NDKMapContextEvent | null>(null)

	const prepareNonGeometryEditorWorkspace = useCallback(() => {
		setViewModeState('view')
		setViewDatasetState(null)
		setViewContext(null)
		setViewContextDatasets([])
		clearFocus()
	}, [setViewModeState, setViewDatasetState, setViewContext, setViewContextDatasets, clearFocus])

	const clearEditorModes = useCallback(() => {
		setContextEditorMode('none')
		setEditingContext(null)
	}, [])

	const handleLoadDatasetForEditing = useCallback(
		(event: NDKGeoEvent) => {
			clearEditorModes()
			loadDatasetForEditing(event)
		},
		[loadDatasetForEditing, clearEditorModes],
	)

	const handleInspectContext = useCallback(
		(context: NDKMapContextEvent) => {
			clearEditorModes()
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(context)
			ensureInfoPanelVisible()

			const naddr = encodeContextNaddr(context)
			if (naddr) {
				navigateToContext(naddr, 'contexts')
			}
		},
		[
			clearEditorModes,
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			ensureInfoPanelVisible,
			encodeContextNaddr,
			navigateToContext,
		],
	)

	const handleCreateContext = useCallback(() => {
		clearEditorModes()
		setContextEditorMode('create')
		prepareNonGeometryEditorWorkspace()
		navigateToView('context-editor')
		if (!isMobile) setShowInfoPanel(true)
	}, [clearEditorModes, prepareNonGeometryEditorWorkspace, navigateToView, isMobile, setShowInfoPanel])

	const handleEditContext = useCallback(
		(context: NDKMapContextEvent) => {
			clearEditorModes()
			setContextEditorMode('edit')
			setEditingContext(context)
			prepareNonGeometryEditorWorkspace()
			navigateToView('context-editor')
			if (!isMobile) setShowInfoPanel(true)
		},
		[clearEditorModes, prepareNonGeometryEditorWorkspace, navigateToView, isMobile, setShowInfoPanel],
	)

	const handleSaveContext = useCallback(
		(_context: NDKMapContextEvent) => {
			setContextEditorMode('none')
			setEditingContext(null)
			navigateToView('contexts')
		},
		[navigateToView],
	)

	const handleCloseContextEditor = useCallback(() => {
		setContextEditorMode('none')
		setEditingContext(null)
		navigateToView('contexts')
	}, [navigateToView])

	const handleOpenGeometryEditor = useCallback(() => {
		clearEditorModes()
		if (!activeWorkspaceId || !activeGeoEditDraftId) {
			startNewDataset()
			return
		}
		void switchToWorkspace(activeWorkspaceId)
	}, [clearEditorModes, activeWorkspaceId, activeGeoEditDraftId, startNewDataset, switchToWorkspace])

	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: NDKGeoEvent) => {
			clearEditorModes()
			handleInspectDataset(event)
		},
		[clearEditorModes, handleInspectDataset],
	)

	return {
		contextEditorMode,
		editingContext,
		clearEditorModes,
		handleLoadDatasetForEditing,
		handleInspectContext,
		handleCreateContext,
		handleEditContext,
		handleSaveContext,
		handleCloseContextEditor,
		handleOpenGeometryEditor,
		handleInspectDatasetWithModeSwitch,
	}
}
