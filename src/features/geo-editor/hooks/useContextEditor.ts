import { useCallback, useState } from 'react'
import type { DatasetEditOptions } from '@/components/info-panel/mapProposalPresentation'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	ensureActiveDraftMapPresentation,
	getRetainedDatasetSurfaceTarget,
	useEditorStore,
	type SidebarViewMode,
} from '../store'
import {
	shouldOpenMobileEditSheet,
	type MobileWorkspaceOpenOptions,
} from '../components/mobileEditPanelPresentation'
import type { GroupCreationSeed } from '@/features/groups/creationSeed'

interface UseContextEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeContextNaddr: (context: MapContext) => string | null
	navigateTo: (
		focusType: 'mapcontext',
		naddr: string,
		sidebarView?: SidebarViewMode,
		edit?: boolean,
	) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
	handleInspectDataset: (event: GeoDataset) => void
	loadDatasetForEditing: (event: GeoDataset, options?: DatasetEditOptions) => void
	startNewDataset: () => void
	switchToWorkspace: (
		workspaceId: string,
		options?: { preserveMobileRoute?: boolean },
	) => void | Promise<void>
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
	const selectMobileEntitySurface = useEditorStore((state) => state.selectMobileEntitySurface)
	const activateMobileEntitySurface = useEditorStore((state) => state.activateMobileEntitySurface)

	const [contextEditorMode, setContextEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingContext, setEditingContext] = useState<MapContext | null>(null)
	const [contextCreationSeed, setContextCreationSeed] = useState<GroupCreationSeed | null>(null)

	const prepareNonGeometryEditorWorkspace = useCallback(
		({ clearRoute = true }: { clearRoute?: boolean } = {}) => {
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewContextDatasets([])
			if (clearRoute) clearFocus()
		},
		[setViewModeState, setViewDatasetState, setViewContext, setViewContextDatasets, clearFocus],
	)

	const clearEditorModes = useCallback(() => {
		setContextEditorMode('none')
		setEditingContext(null)
		setContextCreationSeed(null)
	}, [])

	const handleLoadDatasetForEditing = useCallback(
		(event: GeoDataset, options?: DatasetEditOptions) => {
			loadDatasetForEditing(event, options)
			selectMobileEntitySurface('dataset')
			if (isMobile) ensureInfoPanelVisible()
		},
		[ensureInfoPanelVisible, isMobile, loadDatasetForEditing, selectMobileEntitySurface],
	)

	const handleInspectContext = useCallback(
		(context: MapContext) => {
			selectMobileEntitySurface('inspector')
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
			selectMobileEntitySurface,
		],
	)

	const handleCreateContext = useCallback(
		(creationSeed?: GroupCreationSeed) => {
			selectMobileEntitySurface('context')
			clearEditorModes()
			setContextCreationSeed(creationSeed ?? null)
			setContextEditorMode('create')
			prepareNonGeometryEditorWorkspace()
			navigateToView('context-editor')
			if (isMobile) ensureInfoPanelVisible()
			else setShowInfoPanel(true)
		},
		[
			clearEditorModes,
			prepareNonGeometryEditorWorkspace,
			navigateToView,
			isMobile,
			ensureInfoPanelVisible,
			selectMobileEntitySurface,
			setShowInfoPanel,
		],
	)

	const handleEditContext = useCallback(
		(context: MapContext) => {
			selectMobileEntitySurface('context')
			clearEditorModes()
			setContextEditorMode('edit')
			setEditingContext(context)
			// Opening the Atlas editor is an object route, not a legacy panel route.
			// Preserve an incoming /atlas/:naddr/edit location and write the same
			// canonical route when editing starts from an inspect surface.
			prepareNonGeometryEditorWorkspace({ clearRoute: false })
			const naddr = encodeContextNaddr(context)
			if (naddr) navigateTo('mapcontext', naddr, 'contexts', true)
			else navigateToView('contexts')
			if (isMobile) ensureInfoPanelVisible()
			else setShowInfoPanel(true)
		},
		[
			clearEditorModes,
			prepareNonGeometryEditorWorkspace,
			encodeContextNaddr,
			navigateTo,
			navigateToView,
			isMobile,
			ensureInfoPanelVisible,
			selectMobileEntitySurface,
			setShowInfoPanel,
		],
	)

	const handleSaveContext = useCallback(
		(_context: MapContext) => {
			setContextEditorMode('none')
			setEditingContext(null)
			setContextCreationSeed(null)
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
		setContextCreationSeed(null)
		if (wasOpen) navigateToView('contexts')
	}, [contextEditorMode, navigateToView])

	const handleOpenGeometryEditor = useCallback(
		async (
			requestedWorkspaceId?: string,
			options?: MobileWorkspaceOpenOptions,
		): Promise<boolean> => {
			let initialState = useEditorStore.getState()
			let retainedTarget = getRetainedDatasetSurfaceTarget(
				initialState,
				requestedWorkspaceId ?? initialState.activeWorkspaceId,
			)
			if (!retainedTarget) {
				// An explicit Chat/run target must fail closed: falling back to the active
				// Dataset (or creating a new one) would silently edit the wrong entity.
				if (requestedWorkspaceId) return false
				startNewDataset()
				initialState = useEditorStore.getState()
				retainedTarget = getRetainedDatasetSurfaceTarget(initialState)
				if (!retainedTarget) return false
			}
			const workspaceId = retainedTarget.workspace.id
			const changingExactTarget =
				requestedWorkspaceId != null && initialState.activeWorkspaceId !== workspaceId
			try {
				if (changingExactTarget) {
					await switchToWorkspace(workspaceId, { preserveMobileRoute: true })
				}
				const state = useEditorStore.getState()
				if (
					state.activeWorkspaceId !== workspaceId ||
					!getRetainedDatasetSurfaceTarget(state, workspaceId)
				) {
					return false
				}
				const activated = activateMobileEntitySurface('dataset', {
					inspector: state.inspectionSubject != null,
					dataset: true,
					story: false,
					context: false,
					sighting: false,
					beacon: false,
				})
				if (!activated) return false
				ensureActiveDraftMapPresentation(useEditorStore.getState(), { reveal: true })

				// Desktop keeps its canonical route. Mobile's map-bound workspace tabs are
				// presentation-only and reveal the sheet without rewriting location state.
				if (!isMobile) navigateToView('edit')
				if (isMobile && shouldOpenMobileEditSheet(options)) {
					ensureInfoPanelVisible()
				}
				return true
			} catch {
				return false
			}
		},
		[
			activateMobileEntitySurface,
			startNewDataset,
			switchToWorkspace,
			navigateToView,
			isMobile,
			ensureInfoPanelVisible,
		],
	)

	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: GeoDataset) => {
			handleInspectDataset(event)
		},
		[handleInspectDataset],
	)

	return {
		contextEditorMode,
		editingContext,
		contextCreationSeed,
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
