import { useCallback, useEffect, useRef, useState } from 'react'
import type { Article } from '@/lib/nostr/article'
import { useEditorStore, type SidebarViewMode } from '../store'
import { getStoryEditorOpenRequest, subscribeStoryEditorOpenRequests } from '../storyEditorBridge'

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

	// Chat seam: the `write_story_draft` tool cannot reach this hook's local
	// `storyEditorMode`, so it fires a module-level open request instead
	// (storyEditorBridge). Honor each NEW request by opening the Story editor in
	// create mode — StoryEditorPanel pre-fills from the freshly written draft.
	// The consumed-nonce ref starts at the CURRENT nonce so a stale request from
	// a previous mount (e.g. HMR remount) never re-opens the editor.
	const consumedStoryOpenNonceRef = useRef(getStoryEditorOpenRequest()?.nonce ?? 0)
	useEffect(() => {
		return subscribeStoryEditorOpenRequests(() => {
			const request = getStoryEditorOpenRequest()
			if (!request || request.nonce === consumedStoryOpenNonceRef.current) return
			consumedStoryOpenNonceRef.current = request.nonce
			handleCreateStory()
		})
	}, [handleCreateStory])

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
		// Navigation-safe close: only reroute when the editor was actually open —
		// `startCreate` calls this as blanket cleanup for unrelated create flows.
		const wasOpen = storyEditorMode !== 'none'
		setStoryEditorMode('none')
		setEditingStory(null)
		if (wasOpen) navigateToView('stories')
	}, [storyEditorMode, navigateToView])

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
