import { beforeEach, describe, expect, test } from 'bun:test'
import { createUISlice } from './uiSlice'
import type { EditorState } from './types'

function createUiHarness(seed: Partial<EditorState> = {}): { getState: () => EditorState } {
	let state = { ...seed } as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state) : update
		state = { ...state, ...partial }
	}
	const get = () => state
	state = { ...createUISlice(set as never, get as never, {} as never), ...state }
	return { getState: () => state }
}

describe('mobile surface state machine', () => {
	let harness: ReturnType<typeof createUiHarness>

	beforeEach(() => {
		harness = createUiHarness()
	})

	test('map-bound work opens at half and closes navigation', () => {
		harness.getState().openMobileSidebar()
		harness.getState().openMobilePanel('map-stack')

		const state = harness.getState()
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.mobilePanelTab).toBe('map-stack')
		expect(state.mobilePanelSnap).toBe('half')
		expect(state.mobileSidebarOpen).toBe(false)
	})

	test('AI chat is a map-bound sheet at the largest detent', () => {
		harness.getState().openMobileSidebar()
		harness.getState().openMobilePanel('chat')

		const state = harness.getState()
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.mobilePanelTab).toBe('chat')
		expect(state.mobilePanelSnap).toBe('full')
		expect(state.mobileSidebarOpen).toBe(false)
	})

	test('Edit tab navigation preserves the selected entity and has no authoring side effects', () => {
		Object.assign(harness.getState(), {
			viewMode: 'view',
			stance: 'focus',
			activeWorkspaceId: 'workspace-1',
			mapStackOrder: ['dataset:visible'],
		})
		harness.getState().selectMobileEntitySurface('story')
		harness.getState().openMobilePanel('chat')
		harness.getState().openMobilePanel('edit')

		const state = harness.getState()
		expect(state.mobileEntitySurface).toBe('story')
		expect(state.mobilePanelTab).toBe('edit')
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.viewMode).toBe('view')
		expect(state.stance).toBe('focus')
		expect(state.activeWorkspaceId).toBe('workspace-1')
		expect(state.mapStackOrder).toEqual(['dataset:visible'])
	})

	test('explicit retained surface activation changes interaction stance without retargeting or changing visibility', () => {
		const workspace = {
			id: 'workspace-1',
			sourceId: 'dataset:owner:map',
			activeDraftId: 'draft-1',
		}
		const draft = { id: 'draft-1', sourceId: workspace.sourceId }
		const seeded = createUiHarness({
			activeWorkspaceId: workspace.id,
			activeGeoEditDraftId: draft.id,
			workspaces: { [workspace.id]: workspace },
			geoEditDrafts: { [draft.id]: draft },
			mapStackEntries: {
				'dataset:visible': { id: 'dataset:visible', visible: true },
			},
			mapStackOrder: ['dataset:visible'],
			viewMode: 'view',
			stance: 'focus',
		} as unknown as Partial<EditorState>)
		const availability = {
			inspector: false,
			dataset: true,
			story: true,
			context: true,
			sighting: false,
			beacon: false,
		}

		expect(seeded.getState().activateMobileEntitySurface('dataset', availability)).toBe(true)
		expect(seeded.getState().viewMode).toBe('edit')
		expect(seeded.getState().stance).toBe('author')

		expect(seeded.getState().activateMobileEntitySurface('story', availability)).toBe(true)
		const state = seeded.getState()
		expect(state.mobileEntitySurface).toBe('story')
		expect(state.viewMode).toBe('view')
		expect(state.stance).toBe('focus')
		expect(state.activeWorkspaceId).toBe(workspace.id)
		expect(state.mapStackOrder).toEqual(['dataset:visible'])
	})

	test('explicit activation fails closed when the selected surface is stale', () => {
		const seeded = createUiHarness({
			mobileEntitySurface: 'story',
			viewMode: 'view',
			stance: 'focus',
			activeWorkspaceId: null,
			activeGeoEditDraftId: null,
			workspaces: {},
			geoEditDrafts: {},
			mapStackEntries: {},
			mapStackOrder: [],
		} as Partial<EditorState>)
		const availability = {
			inspector: false,
			dataset: true,
			story: false,
			context: false,
			sighting: false,
			beacon: false,
		}

		expect(seeded.getState().activateMobileEntitySurface('dataset', availability)).toBe(false)
		expect(seeded.getState().activateMobileEntitySurface('story', availability)).toBe(false)
		expect(seeded.getState().mobileEntitySurface).toBe('story')
		expect(seeded.getState().viewMode).toBe('view')
		expect(seeded.getState().stance).toBe('focus')
	})

	test('opening the menu over a map-bound sheet restores the same detent on close', () => {
		harness.getState().openMobilePanel('edit')
		harness.getState().setMobilePanelSnap('full')
		harness.getState().openMobileSidebar()

		expect(harness.getState().mobilePanelOpen).toBe(false)
		expect(harness.getState().mobilePanelResumeOnSidebarClose).toEqual({
			tab: 'edit',
			snap: 'full',
		})

		harness.getState().closeMobileSidebar()
		const state = harness.getState()
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.mobilePanelTab).toBe('edit')
		expect(state.mobilePanelSnap).toBe('full')
	})

	test('choosing navigation content clears the suspended inspector', () => {
		harness.getState().openMobilePanel('edit')
		harness.getState().openMobileSidebar()
		harness.getState().selectMobileSidebarDestination('contexts')
		harness.getState().closeMobileSidebar()

		const state = harness.getState()
		expect(state.mobilePanelOpen).toBe(false)
		expect(state.mobilePanelTab).toBe('contexts')
		expect(state.mobilePanelResumeOnSidebarClose).toBeNull()
	})

	test('authoring can visit navigation content without losing the suspended editor', () => {
		harness.getState().openMobilePanel('edit')
		harness.getState().setMobilePanelSnap('full')
		harness.getState().openMobileSidebar()
		harness.getState().selectMobileSidebarDestination('chat', { preserveSuspendedPanel: true })
		harness.getState().closeMobileSidebar()

		const state = harness.getState()
		expect(state.mobilePanelOpen).toBe(true)
		expect(state.mobilePanelTab).toBe('edit')
		expect(state.mobilePanelSnap).toBe('full')
	})
})

describe('desktop Chat docking', () => {
	test('starts closed on the right and moves without an intermediate close', () => {
		const harness = createUiHarness()
		expect(harness.getState().chatOpen).toBe(false)
		expect(harness.getState().chatDock).toBe('right')

		harness.getState().toggleChatAtDock('left')
		expect(harness.getState().chatOpen).toBe(true)
		expect(harness.getState().chatDock).toBe('left')

		harness.getState().toggleChatAtDock('right')
		expect(harness.getState().chatOpen).toBe(true)
		expect(harness.getState().chatDock).toBe('right')
	})

	test('selecting the currently open dock closes Chat', () => {
		const harness = createUiHarness()
		harness.getState().toggleChatAtDock('right')
		harness.getState().toggleChatAtDock('right')

		expect(harness.getState().chatOpen).toBe(false)
		expect(harness.getState().chatDock).toBe('right')
	})
})
