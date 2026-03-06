import { useCallback, useState } from 'react'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { useEditorStore, type SidebarViewMode } from '../store'

interface UseCollectionContextEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeContextNaddr: (context: NDKMapContextEvent) => string | null
	navigateToContext: (contextNaddr: string, sidebarView?: SidebarViewMode) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
	handleInspectDataset: (event: NDKGeoEvent) => void
	handleInspectCollection: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	loadDatasetForEditing: (event: NDKGeoEvent) => void
	startNewDataset: () => void
}

export function useCollectionContextEditor({
	isMobile,
	ensureInfoPanelVisible,
	encodeContextNaddr,
	navigateToContext,
	navigateToView,
	clearFocus,
	loadDatasetForEditing,
	startNewDataset,
	handleInspectDataset,
	handleInspectCollection,
}: UseCollectionContextEditorParams) {
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewCollectionState = useEditorStore((state) => state.setViewCollection)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewContextCollections = useEditorStore((state) => state.setViewContextCollections)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)

	// Collection Editor state
	const [collectionEditorMode, setCollectionEditorMode] = useState<'none' | 'create' | 'edit'>(
		'none',
	)
	const [editingCollection, setEditingCollection] = useState<NDKGeoCollectionEvent | null>(null)
	const [contextEditorMode, setContextEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingContext, setEditingContext] = useState<NDKMapContextEvent | null>(null)

	const prepareNonGeometryEditorWorkspace = useCallback(() => {
		// Keep global view mode out of geometry edit so toolbar stays disabled.
		setViewModeState('view')
		setViewDatasetState(null)
		setViewCollectionState(null)
		setViewContext(null)
		setViewContextDatasets([])
		setViewContextCollections([])
		clearFocus()
	}, [
		setViewModeState,
		setViewDatasetState,
		setViewCollectionState,
		setViewContext,
		setViewContextDatasets,
		setViewContextCollections,
		clearFocus,
	])

	/** Reset both editor modes */
	const clearEditorModes = useCallback(() => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
		setContextEditorMode('none')
		setEditingContext(null)
	}, [])

	// Collection handlers
	const handleCreateCollectionFull = useCallback(() => {
		setCollectionEditorMode('create')
		setEditingCollection(null)
		setContextEditorMode('none')
		setEditingContext(null)
		prepareNonGeometryEditorWorkspace()
		if (!isMobile) setShowInfoPanel(true)
	}, [isMobile, setShowInfoPanel, prepareNonGeometryEditorWorkspace])

	const handleEditCollection = useCallback(
		(collection: NDKGeoCollectionEvent) => {
			setCollectionEditorMode('edit')
			setEditingCollection(collection)
			setContextEditorMode('none')
			setEditingContext(null)
			prepareNonGeometryEditorWorkspace()
			if (!isMobile) setShowInfoPanel(true)
		},
		[isMobile, setShowInfoPanel, prepareNonGeometryEditorWorkspace],
	)

	const handleSaveCollection = useCallback((_collection: NDKGeoCollectionEvent) => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
	}, [])

	const handleCloseCollectionEditor = useCallback(() => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
	}, [])

	// Dataset loading wrapper that clears editor modes
	const handleLoadDatasetForEditing = useCallback(
		(event: NDKGeoEvent) => {
			clearEditorModes()
			loadDatasetForEditing(event)
		},
		[loadDatasetForEditing, clearEditorModes],
	)

	// Context handlers
	const handleInspectContext = useCallback(
		(context: NDKMapContextEvent) => {
			clearEditorModes()
			setViewModeState('view')
			setViewDatasetState(null)
			setViewCollectionState(null)
			setViewContext(context)
			ensureInfoPanelVisible()

			const naddr = encodeContextNaddr(context)
			if (naddr) {
				navigateToContext(naddr, 'contexts')
			}
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewCollectionState,
			setViewContext,
			ensureInfoPanelVisible,
			encodeContextNaddr,
			navigateToContext,
			clearEditorModes,
		],
	)

	const handleCreateContext = useCallback(() => {
		clearEditorModes()
		setContextEditorMode('create')
		prepareNonGeometryEditorWorkspace()
		navigateToView('context-editor')
		if (!isMobile) setShowInfoPanel(true)
	}, [
		isMobile,
		setShowInfoPanel,
		navigateToView,
		clearEditorModes,
		prepareNonGeometryEditorWorkspace,
	])

	const handleEditContext = useCallback(
		(context: NDKMapContextEvent) => {
			clearEditorModes()
			setContextEditorMode('edit')
			setEditingContext(context)
			prepareNonGeometryEditorWorkspace()
			navigateToView('context-editor')
			if (!isMobile) setShowInfoPanel(true)
		},
		[
			isMobile,
			setShowInfoPanel,
			navigateToView,
			clearEditorModes,
			prepareNonGeometryEditorWorkspace,
		],
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
		if (!activeGeoEditDraftId) {
			startNewDataset()
			return
		}
		setViewModeState('edit')
		setViewDatasetState(null)
		setViewCollectionState(null)
		setViewContext(null)
		setViewContextDatasets([])
		setViewContextCollections([])
		clearFocus()
	}, [
		setViewModeState,
		setViewDatasetState,
		setViewCollectionState,
		setViewContext,
		setViewContextDatasets,
		setViewContextCollections,
		clearFocus,
		clearEditorModes,
		activeGeoEditDraftId,
		startNewDataset,
	])

	// Inspect wrappers that clear editor modes
	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: NDKGeoEvent) => {
			clearEditorModes()
			handleInspectDataset(event)
		},
		[handleInspectDataset, clearEditorModes],
	)

	const handleInspectCollectionWithModeSwitch = useCallback(
		(collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => {
			clearEditorModes()
			handleInspectCollection(collection, events)
		},
		[handleInspectCollection, clearEditorModes],
	)

	return {
		collectionEditorMode,
		editingCollection,
		contextEditorMode,
		editingContext,
		clearEditorModes,
		handleCreateCollection: handleCreateCollectionFull,
		handleEditCollection,
		handleSaveCollection,
		handleCloseCollectionEditor,
		handleLoadDatasetForEditing,
		handleInspectContext,
		handleCreateContext,
		handleEditContext,
		handleSaveContext,
		handleCloseContextEditor,
		handleOpenGeometryEditor,
		handleInspectDatasetWithModeSwitch,
		handleInspectCollectionWithModeSwitch,
	}
}
