import { describe, expect, test } from 'bun:test'
import type { GeoEditor } from '../core'
import { createEditorCoreSlice } from './editorCoreSlice'
import type { EditorState } from './types'

function createEditorCoreHarness() {
	let state = {} as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state) : update
		state = { ...state, ...partial }
	}
	const get = () => state
	state = createEditorCoreSlice(set as never, get as never, {} as never) as EditorState
	return { getState: () => state }
}

describe('editor pan-lock lifecycle', () => {
	test('leaving a drawing mode restores map panning', () => {
		const harness = createEditorCoreHarness()
		let editorMode = 'select'
		const panLockCalls: boolean[] = []
		const editor = {
			getMode: () => editorMode,
			setMode: (mode: string) => {
				editorMode = mode
			},
			setPanLocked: (locked: boolean) => {
				panLockCalls.push(locked)
			},
		} as unknown as GeoEditor

		harness.getState().setEditor(editor)
		harness.getState().setMode('draw_point')
		harness.getState().setPanLocked(true)
		expect(harness.getState().panLocked).toBe(true)

		harness.getState().setMode('select')

		expect(harness.getState().panLocked).toBe(false)
		expect(panLockCalls.at(-1)).toBe(false)
	})

	test('keeps the pan lock while switching between drawing tools', () => {
		const harness = createEditorCoreHarness()
		harness.getState().setMode('draw_point')
		harness.getState().setPanLocked(true)

		harness.getState().setMode('draw_polygon')

		expect(harness.getState().panLocked).toBe(true)
	})
})
