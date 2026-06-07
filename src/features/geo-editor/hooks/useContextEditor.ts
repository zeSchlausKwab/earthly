import { useCallback, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore, type SidebarViewMode } from '../store'

interface UseContextEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeContextNaddr: (context: MapContext) => string | null
	navigateToContext: (contextNaddr: string, sidebarView?: SidebarViewMode) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
	handleInspectDataset: (event: GeoDataset) => void
	loadDatasetForEditing: (event: GeoDataset) => void
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
	const setStance = useEditorStore((state) => state.setStance)
	const addMapStackEntry = useEditorStore((state) => state.addMapStackEntry)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)

	const [contextEditorMode, setContextEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingContext, setEditingContext] = useState<MapContext | null>(null)

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
		(event: GeoDataset) => {
			clearEditorModes()
			loadDatasetForEditing(event)
		},
		[loadDatasetForEditing, clearEditorModes],
	)

	const handleInspectContext = useCallback(
		(context: MapContext) => {
			clearEditorModes()
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(context)
			ensureInfoPanelVisible()
			setStance('focus')

			// Round C: stack = visibility. Add the context as a stack entry so its
			// curated datasets render (C.1 has a transitional rule that catches
			// this; C.2 will turn the entry itself into an expandable macro that
			// renders the curated datasets).
			const contextKey =
				context.contextCoordinate ?? context.id ?? context.contextId ?? context.dTag
			if (contextKey) {
				const title = context.context?.name || `Context ${contextKey.slice(0, 12)}`
				addMapStackEntry({
					entityType: 'context',
					entityKey: contextKey,
					title,
					source: 'manual',
					visible: true,
					pinned: false,
				})
			}

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
			setStance,
			addMapStackEntry,
		],
	)

	const handleCreateContext = useCallback(() => {
		clearEditorModes()
		setContextEditorMode('create')
		prepareNonGeometryEditorWorkspace()
		navigateToView('context-editor')
		if (!isMobile) setShowInfoPanel(true)
	}, [
		clearEditorModes,
		prepareNonGeometryEditorWorkspace,
		navigateToView,
		isMobile,
		setShowInfoPanel,
	])

	const handleEditContext = useCallback(
		(context: MapContext) => {
			clearEditorModes()
			setContextEditorMode('edit')
			setEditingContext(context)
			prepareNonGeometryEditorWorkspace()
			navigateToView('context-editor')
			if (!isMobile) setShowInfoPanel(true)
		},
		[
			clearEditorModes,
			prepareNonGeometryEditorWorkspace,
			navigateToView,
			isMobile,
			setShowInfoPanel,
		],
	)

	const handleSaveContext = useCallback(
		(_context: MapContext) => {
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
	}, [
		clearEditorModes,
		activeWorkspaceId,
		activeGeoEditDraftId,
		startNewDataset,
		switchToWorkspace,
	])

	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: GeoDataset) => {
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
