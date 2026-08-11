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
	onBeforeAuthoring?: () => void
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
	onBeforeAuthoring,
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
		onBeforeAuthoring?.()
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
		onBeforeAuthoring,
	])

	const handleEditStory = useCallback(
		(story: Article) => {
			onBeforeAuthoring?.()
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
			onBeforeAuthoring,
		],
	)

	// Chat seam: `write_story_draft` can target either a new Story or an existing
	// published Story. Honor every fresh request by opening the matching editor;
	// StoryEditorPanel then reads the local draft keyed by the target d-tag.
	const consumedStoryOpenNonceRef = useRef(getStoryEditorOpenRequest()?.nonce ?? 0)
	useEffect(() => {
		return subscribeStoryEditorOpenRequests(() => {
			const request = getStoryEditorOpenRequest()
			if (!request || request.nonce === consumedStoryOpenNonceRef.current) return
			consumedStoryOpenNonceRef.current = request.nonce
			if (request.mode === 'edit' && request.story) {
				handleEditStory(request.story)
			} else {
				handleCreateStory()
			}
		})
	}, [handleCreateStory, handleEditStory])

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
