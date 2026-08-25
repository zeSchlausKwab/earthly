import { useCallback, useState } from 'react'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore, type SidebarViewMode } from '../store'

interface UseContextEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeContextNaddr: (context: MapContext) => string | null
	navigateTo: (focusType: 'mapcontext', naddr: string, sidebarView?: SidebarViewMode) => void
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
	navigateTo,
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
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)
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
			loadDatasetForEditing(event)
		},
		[loadDatasetForEditing],
	)

	const handleInspectContext = useCallback(
		(context: MapContext) => {
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(context)
			ensureInfoPanelVisible()
			setStance('focus')

			const contextKey =
				context.contextCoordinate ?? context.id ?? context.contextId ?? context.dTag
			if (contextKey) {
				// Recent history is metadata only; inspection deliberately does not
				// add the Context to the Map Stack or change browse scope.
				recordRecentEntity(`context:${contextKey}`)
			}

			const naddr = encodeContextNaddr(context)
			if (naddr) {
				navigateTo('mapcontext', naddr, 'contexts')
			}
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			ensureInfoPanelVisible,
			encodeContextNaddr,
			navigateTo,
			setStance,
			recordRecentEntity,
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
		// Navigation-safe close: only reroute when the editor was actually open —
		// `startCreate` calls this as blanket cleanup for unrelated create flows.
		const wasOpen = contextEditorMode !== 'none'
		setContextEditorMode('none')
		setEditingContext(null)
		if (wasOpen) navigateToView('contexts')
	}, [contextEditorMode, navigateToView])

	const handleOpenGeometryEditor = useCallback(() => {
		if (!activeWorkspaceId || !activeGeoEditDraftId) {
			startNewDataset()
			return
		}
		const workspaceId = activeWorkspaceId
		void (async () => {
			await switchToWorkspace(workspaceId)
			const state = useEditorStore.getState()
			if (
				state.activeWorkspaceId !== workspaceId ||
				!state.activeGeoEditDraftId ||
				!state.mapStackEntries['draft:active']
			) {
				return
			}

			// This is the canonical resume transition for a retained Dataset draft.
			// Inspection remains remembered, but it no longer owns the visible route
			// or the GeoEditor interaction boundary.
			setViewDatasetState(null)
			setViewContext(null)
			setViewModeState('edit')
			setStance('author')
			navigateToView('edit')
		})()
	}, [
		activeWorkspaceId,
		activeGeoEditDraftId,
		startNewDataset,
		switchToWorkspace,
		setViewDatasetState,
		setViewContext,
		setViewModeState,
		setStance,
		navigateToView,
	])

	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: GeoDataset) => {
			handleInspectDataset(event)
		},
		[handleInspectDataset],
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
