import { useCallback, useEffect, useRef, useState } from 'react'
import type { Article } from '@/lib/nostr/article'
import { useEditorStore, type SidebarViewMode } from '../store'
import {
	clearStoryEditorTarget,
	getStoryEditorOpenRequest,
	retainStoryEditorTarget,
	subscribeStoryEditorOpenRequests,
} from '../storyEditorBridge'

interface UseStoryEditorParams {
	isMobile: boolean
	ensureInfoPanelVisible: () => void
	encodeStoryNaddr: (story: Article) => string | null
	navigateTo: (
		focusType: 'geoevent' | 'mapcontext' | 'story',
		naddr: string,
		sidebarView?: SidebarViewMode,
		edit?: boolean,
	) => void
	navigateToView: (view: SidebarViewMode) => void
	clearFocus: () => void
	onBeforeAuthoring?: () => void
}

/**
 * Story create/edit/inspect lifecycle (Phase 10, D-01/D-02/D-03). The structural
 * twin of `useContextEditor`: it owns the `storyEditorMode`/`editingStory` local
 * state and the handlers the rail (AppSidebar) + info panel (GeoEditorInfoPanel)
 * thread through. Opening a Story sets `viewStory` and navigates to
 * `/story/:naddr`; editing retains `/story/:naddr/edit` while opening the
 * StoryEditorPanel.
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
	const selectMobileEntitySurface = useEditorStore((state) => state.selectMobileEntitySurface)

	const [storyEditorMode, setStoryEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingStory, setEditingStory] = useState<Article | null>(null)
	// Explicit UI/route entry owns revealing the editor. Background AI writes
	// retain the same draft state but must never manufacture a reveal request.
	const [storyEditorRevealNonce, setStoryEditorRevealNonce] = useState(0)

	const clearStoryEditorModes = useCallback(() => {
		setStoryEditorMode('none')
		setEditingStory(null)
		clearStoryEditorTarget()
	}, [])

	const prepareNonGeometryWorkspace = useCallback(
		({ clearRoute = true }: { clearRoute?: boolean } = {}) => {
			setViewModeState('view')
			setViewDatasetState(null)
			setViewContext(null)
			setViewContextDatasets([])
			setViewStory(null)
			if (clearRoute) clearFocus()
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewContextDatasets,
			setViewStory,
			clearFocus,
		],
	)

	const handleInspectStory = useCallback(
		(story: Article, { preserveRoute = false }: { preserveRoute?: boolean } = {}) => {
			selectMobileEntitySurface('inspector')
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
			if (naddr && !preserveRoute) {
				navigateTo('story', naddr, 'stories')
			}
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewContext,
			setViewStory,
			ensureInfoPanelVisible,
			setStance,
			recordRecentEntity,
			encodeStoryNaddr,
			navigateTo,
			selectMobileEntitySurface,
		],
	)

	const handleCreateStory = useCallback(() => {
		selectMobileEntitySurface('story')
		onBeforeAuthoring?.()
		clearStoryEditorModes()
		setStoryEditorMode('create')
		setStoryEditorRevealNonce((nonce) => nonce + 1)
		retainStoryEditorTarget()
		prepareNonGeometryWorkspace()
		navigateToView('stories')
		if (isMobile) ensureInfoPanelVisible()
		else setShowInfoPanel(true)
	}, [
		clearStoryEditorModes,
		prepareNonGeometryWorkspace,
		navigateToView,
		isMobile,
		setShowInfoPanel,
		onBeforeAuthoring,
		ensureInfoPanelVisible,
		selectMobileEntitySurface,
	])

	const handleEditStory = useCallback(
		(story: Article) => {
			selectMobileEntitySurface('story')
			onBeforeAuthoring?.()
			clearStoryEditorModes()
			setStoryEditorMode('edit')
			setEditingStory(story)
			setStoryEditorRevealNonce((nonce) => nonce + 1)
			retainStoryEditorTarget(story)
			// Keep a direct /story/:naddr/edit request intact while the route
			// controller opens the editor. Clearing focus first would briefly replace
			// it with the Stories catalog and lose the edit intent on re-entry.
			prepareNonGeometryWorkspace({ clearRoute: false })
			const naddr = encodeStoryNaddr(story)
			if (naddr) navigateTo('story', naddr, 'stories', true)
			else navigateToView('stories')
			if (isMobile) ensureInfoPanelVisible()
			else setShowInfoPanel(true)
		},
		[
			clearStoryEditorModes,
			prepareNonGeometryWorkspace,
			encodeStoryNaddr,
			navigateTo,
			navigateToView,
			isMobile,
			setShowInfoPanel,
			onBeforeAuthoring,
			ensureInfoPanelVisible,
			selectMobileEntitySurface,
		],
	)

	// Chat seam: `write_story_draft` can target either a new Story or an existing
	// published Story. Retain the matching editor state without navigating or
	// selecting it; the rail dot/spinner tells the user it is ready, and only an
	// explicit Story-button click reveals it. An already-visible StoryEditorPanel
	// separately observes the same nonce and refreshes its local-draft prefill.
	const consumedStoryOpenNonceRef = useRef(0)
	useEffect(() => {
		const consumeOpenRequest = () => {
			const request = getStoryEditorOpenRequest()
			if (!request || request.nonce === consumedStoryOpenNonceRef.current) return
			consumedStoryOpenNonceRef.current = request.nonce
			if (request.mode === 'edit' && request.story) {
				setStoryEditorMode('edit')
				setEditingStory(request.story)
			} else {
				setStoryEditorMode('create')
				setEditingStory(null)
			}
			if (request.reveal) {
				selectMobileEntitySurface('story')
				prepareNonGeometryWorkspace({ clearRoute: false })
				setStoryEditorRevealNonce((nonce) => nonce + 1)
				navigateToView('stories')
				ensureInfoPanelVisible()
			}
		}
		// Replay the latest request before subscribing so a request fired during
		// mount cannot disappear between render and this effect.
		consumeOpenRequest()
		return subscribeStoryEditorOpenRequests(consumeOpenRequest)
	}, [
		selectMobileEntitySurface,
		prepareNonGeometryWorkspace,
		navigateToView,
		ensureInfoPanelVisible,
	])

	const handleSaveStory = useCallback(
		(story: Article) => {
			setStoryEditorMode('none')
			setEditingStory(null)
			clearStoryEditorTarget()
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
		clearStoryEditorTarget()
		if (wasOpen) navigateToView('stories')
	}, [storyEditorMode, navigateToView])

	return {
		storyEditorMode,
		editingStory,
		storyEditorRevealNonce,
		clearStoryEditorModes,
		handleInspectStory,
		handleCreateStory,
		handleEditStory,
		handleSaveStory,
		handleCloseStoryEditor,
	}
}
