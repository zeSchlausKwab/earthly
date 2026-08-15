import { beforeEach, describe, expect, test } from 'bun:test'
import { createUISlice } from './uiSlice'
import type { EditorState, UISlice } from './types'

function createUiHarness(): { getState: () => UISlice } {
	let state = {} as UISlice
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state as EditorState) : update
		state = { ...state, ...partial }
	}
	const get = () => state as EditorState
	state = createUISlice(set as never, get as never, {} as never)
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
