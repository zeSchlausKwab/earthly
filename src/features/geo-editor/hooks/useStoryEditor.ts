import { useCallback, useState } from 'react'
import type { Article } from '@/lib/nostr/article'
import { useEditorStore, type SidebarViewMode } from '../store'

interface UseStoryEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeStoryNaddr: (story: Article) => string | null
	navigateTo: (
		focusType: 'geoevent' | 'mapcontext' | 'story',
		naddr: string,
		sidebarView?: SidebarViewMode,
	) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
}

/**
 * Story create/edit/inspect lifecycle (Phase 10, D-01/D-02/D-03). The structural
 * twin of `useContextEditor`: it owns the `storyEditorMode`/`editingStory` local
 * state and the handlers the rail (AppSidebar) + info panel (GeoEditorInfoPanel)
 * thread through. Opening a Story sets `viewStory` and navigates to the
 * `/stories/story/:naddr` focus route; creating/editing opens the StoryEditorPanel.
 */
export function useStoryEditor({
	isMobile,
	ensureInfoPanelVisible,
	encodeStoryNaddr,
	navigateTo,
	navigateToView,
	clearFocus,
}: UseStoryEditorParams) {
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewStory = useEditorStore((state) => state.setViewStory)
	const setStance = useEditorStore((state) => state.setStance)
	const recordRecentEntity = useEditorStore((state) => state.recordRecentEntity)

	const [storyEditorMode, setStoryEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingStory, setEditingStory] = useState<Article | null>(null)

	const clearStoryEditorModes = useCallback(() => {
		setStoryEditorMode('none')
		setEditingStory(null)
	}, [])

	const prepareNonGeometryWorkspace = useCallback(() => {
		setViewModeState('view')
		setViewDatasetState(null)
		setViewContext(null)
		setViewContextDatasets([])
		setViewStory(null)
		clearFocus()
	}, [
		setViewModeState,
		setViewDatasetState,
		setViewContext,
		setViewContextDatasets,
		setViewStory,
		clearFocus,
	])

	const handleInspectStory = useCallback(
		(story: Article) => {
			clearStoryEditorModes()
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewStory(story)
			ensureInfoPanelVisible()
			setStance('focus')

			const storyKey = story.dTag ?? story.id
			if (storyKey) {
				recordRecentEntity(`story:${storyKey}`)
			}

			const naddr = encodeStoryNaddr(story)
			if (naddr) {
				navigateTo('story', naddr, 'stories')
			}
		},
		[
			clearStoryEditorModes,
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewStory,
			ensureInfoPanelVisible,
			setStance,
			recordRecentEntity,
			encodeStoryNaddr,
			navigateTo,
		],
	)

	const handleCreateStory = useCallback(() => {
		clearStoryEditorModes()
		setStoryEditorMode('create')
		prepareNonGeometryWorkspace()
		navigateToView('stories')
		if (!isMobile) setShowInfoPanel(true)
	}, [
		clearStoryEditorModes,
		prepareNonGeometryWorkspace,
		navigateToView,
		isMobile,
		setShowInfoPanel,
	])

	const handleEditStory = useCallback(
		(story: Article) => {
			clearStoryEditorModes()
			setStoryEditorMode('edit')
			setEditingStory(story)
			prepareNonGeometryWorkspace()
			navigateToView('stories')
			if (!isMobile) setShowInfoPanel(true)
		},
		[
			clearStoryEditorModes,
			prepareNonGeometryWorkspace,
			navigateToView,
			isMobile,
			setShowInfoPanel,
		],
	)

	const handleSaveStory = useCallback(
		(story: Article) => {
			setStoryEditorMode('none')
			setEditingStory(null)
			handleInspectStory(story)
		},
		[handleInspectStory],
	)

	const handleCloseStoryEditor = useCallback(() => {
		setStoryEditorMode('none')
		setEditingStory(null)
		navigateToView('stories')
	}, [navigateToView])

	return {
		storyEditorMode,
		editingStory,
		clearStoryEditorModes,
		handleInspectStory,
		handleCreateStory,
		handleEditStory,
		handleSaveStory,
		handleCloseStoryEditor,
	}
}
