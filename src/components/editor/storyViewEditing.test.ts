import { afterEach, describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'
import { history, redo, undo } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import {
	parseStoryMarkdown,
	parseStoryViewBlock,
	stringifyStoryViewBlock,
	stringifyStoryViewMarkdownBlock,
	type StoryViewBlockV1,
} from '@/lib/map-presentation'
import {
	GeoMentionNode,
	parseFromText,
	serializeToText,
	StoryViewNode,
} from './GeoMentionExtension'
import {
	acceptStoryViewEdit,
	getStoryViewMoveTarget,
	insertStoryViewAtSelection,
	moveStoryView,
	removeStoryViewLayerPatch,
	updateStoryViewLayerPatch,
	updateStoryViewStyle,
} from './storyViewEditing'

const view: StoryViewBlockV1 = {
	version: 1,
	type: 'view',
	id: 'front-1916',
	title: 'Verdun and the Somme',
	display: 'both',
	caption: 'The line moves.',
	camera: { center: [3.9, 49.7], zoom: 6.6 },
	layers: { 'front-1916': { visible: true }, 'front-1914': { visible: false } },
}
const editors: Editor[] = []
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy()
})

function editorFor(body: string) {
	const editor = new Editor({
		element: null,
		extensions: [StarterKit, GeoMentionNode, StoryViewNode],
		content: parseFromText(body),
	})
	editors.push(editor)
	return editor
}

function viewPosition(editor: Editor) {
	let position = -1
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'storyView') position = pos
	})
	expect(position).toBeGreaterThanOrEqual(0)
	return position
}

describe('manual sparse Story view editing', () => {
	test('rejects an invalid edit instead of silently dropping an existing valid style', () => {
		const styled = updateStoryViewStyle(view, 'front-1916', 'strokeColor', '#225577')
		const invalid = updateStoryViewStyle(styled, 'front-1916', 'strokeColor', '#22')
		// The tolerant reader codec salvages valid fields. The authoring boundary
		// must not mistake that salvage for a successful edit and lose styling.
		expect(parseStoryViewBlock(invalid).status).toBe('valid')
		expect(parseStoryViewBlock(invalid).issues.length).toBeGreaterThan(0)
		expect(acceptStoryViewEdit(invalid)).toBeNull()
		expect(styled.layers?.['front-1916']?.style?.strokeColor).toBe('#225577')
		expect(acceptStoryViewEdit(styled)).toEqual(styled)
		expect(
			acceptStoryViewEdit(updateStoryViewStyle(styled, 'front-1916', 'strokeColor', undefined)),
		).not.toBeNull()
	})
	test('keeps independent visibility, zero opacity and whitelisted style deltas without copying sources', () => {
		let next = updateStoryViewLayerPatch(view, 'battles', 'visible', false)
		next = updateStoryViewLayerPatch(next, 'battles', 'opacityMultiplier', 0)
		next = updateStoryViewStyle(next, 'battles', 'strokeColor', '#225577')
		next = updateStoryViewStyle(next, 'battles', 'arrowEnd', false)
		expect(next.layers?.battles).toEqual({
			visible: false,
			opacityMultiplier: 0,
			style: { strokeColor: '#225577', arrowEnd: false },
		})
		expect(next.layers?.['front-1916']).toEqual(view.layers?.['front-1916'])
		expect(parseStoryViewBlock(next).status).toBe('valid')
		expect(parseStoryViewBlock(JSON.parse(stringifyStoryViewBlock(next)))).toMatchObject({
			status: 'valid',
			value: next,
		})
		expect(view.layers?.battles).toBeUndefined()
	})

	test('inherit removes only the selected override and cleans empty patch objects', () => {
		let next = updateStoryViewStyle(view, 'battles', 'fillColor', '#123456')
		next = updateStoryViewStyle(next, 'battles', 'fillOpacity', 0.4)
		next = updateStoryViewStyle(next, 'battles', 'fillColor', undefined)
		expect(next.layers?.battles).toEqual({ style: { fillOpacity: 0.4 } })
		next = updateStoryViewLayerPatch(next, 'battles', 'style', undefined)
		expect(next.layers?.battles).toBeUndefined()
		next = removeStoryViewLayerPatch(next, 'front-1914')
		next = updateStoryViewLayerPatch(next, 'front-1916', 'visible', undefined)
		expect(next).not.toHaveProperty('layers')
		expect(next.camera).toEqual(view.camera)
		expect(next.caption).toBe(view.caption)
	})
})

describe('physical Story view document transactions', () => {
	test('inserts at the prose cursor rather than appending, keeping both sides and references', () => {
		const editor = editorFor('The line freezes. Then it moves.\n\nA source at geo:49.7,3.9')
		editor.commands.setTextSelection(18)
		expect(insertStoryViewAtSelection(editor, view)).toBe(true)
		const body = serializeToText(editor.getJSON())
		expect(body.indexOf('The line freezes.')).toBeLessThan(body.indexOf('```earthly-view'))
		expect(body.indexOf('Then it moves.')).toBeGreaterThan(body.indexOf('```earthly-view'))
		expect(body).toContain('geo:49.7,3.9')
		expect(serializeToText(parseFromText(body))).toBe(body)
	})

	test('inserting while prose is selected never deletes the selection', () => {
		const editor = editorFor('Keep every word in this paragraph.')
		editor.commands.setTextSelection({ from: 1, to: 16 })
		insertStoryViewAtSelection(editor, view)
		expect(editor.state.doc.textContent).toBe('Keep every word in this paragraph.')
		expect(editor.state.doc.child(0).textContent).toBe('Keep every word')
	})

	test('edits, moves both directions, saves/reloads and removes a block without rewriting surrounding prose', () => {
		const before =
			'# A long front\n\n![Archive image](https://example.test/front.jpg)\n\n| Year | Line |\n| --- | --- |\n| 1916 | Somme |'
		const after = 'A referenced place geo:49.7,3.9 remains in the prose.'
		const editor = editorFor(`${before}\n\n${stringifyStoryViewMarkdownBlock(view)}\n\n${after}`)
		let position = viewPosition(editor)
		const edited: StoryViewBlockV1 = {
			...updateStoryViewStyle(view, 'front-1916', 'lineDash', 'dotted'),
			title: 'A figure at Verdun',
			caption: 'A new caption',
			display: 'figure',
			camera: { center: [4.4, 49.6], zoom: 7, bearing: 20, pitch: 30 },
		}
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(position, undefined, {
				value: stringifyStoryViewBlock(edited),
			}),
		)
		const editedBody = serializeToText(editor.getJSON())
		expect(editedBody).toContain(before)
		expect(editedBody).toContain(after)
		const down = moveStoryView(editor.state.tr, position, 1)
		expect(down).not.toBeNull()
		if (down) editor.view.dispatch(down)
		position = viewPosition(editor)
		expect(serializeToText(editor.getJSON()).indexOf(after)).toBeLessThan(
			serializeToText(editor.getJSON()).indexOf('```earthly-view'),
		)
		const up = moveStoryView(editor.state.tr, position, -1)
		if (up) editor.view.dispatch(up)
		expect(serializeToText(editor.getJSON())).toBe(editedBody)
		const restored = editorFor(editedBody)
		expect(parseStoryMarkdown(serializeToText(restored.getJSON())).views).toHaveLength(1)
		const restoredPosition = viewPosition(restored)
		expect(JSON.parse(restored.state.doc.nodeAt(restoredPosition)?.attrs.value)).toEqual(edited)
		restored.view.dispatch(restored.state.tr.delete(restoredPosition, restoredPosition + 1))
		// Remove only the node; retain the author's surrounding blank paragraphs.
		expect(serializeToText(restored.getJSON())).toBe(`${before}\n\n\n${after}`)
	})

	test('stops at document boundaries and ignores non-view positions', () => {
		const editor = editorFor(`${stringifyStoryViewMarkdownBlock(view)}\n\nProse`)
		expect(getStoryViewMoveTarget(editor.state.doc, 0, -1)).toBeNull()
		expect(getStoryViewMoveTarget(editor.state.doc, 1, 1)).toBeNull()
		const down = moveStoryView(editor.state.tr, 0, 1)
		if (down) editor.view.dispatch(down)
		expect(getStoryViewMoveTarget(editor.state.doc, viewPosition(editor), 1)).toBeNull()
	})

	test('moving a view is one undoable action with the complete prose order restored', () => {
		const original = `Before\n\n${stringifyStoryViewMarkdownBlock(view)}\n\nAfter`
		const editor = editorFor(original)
		// Unmounted TipTap editors do not install view plugins. Install the same
		// ProseMirror history plugin explicitly for this transaction-level check.
		let state = EditorState.create({ doc: editor.state.doc, plugins: [history()] })
		const move = moveStoryView(state.tr, viewPosition(editor), -1)
		if (!move) throw new Error('Expected an upward move')
		state = state.apply(move)
		const moved = serializeToText(state.doc.toJSON())
		expect(moved.indexOf('```earthly-view')).toBeLessThan(moved.indexOf('Before'))
		expect(
			undo(state, (transaction) => {
				state = state.apply(transaction)
			}),
		).toBe(true)
		expect(serializeToText(state.doc.toJSON())).toBe(original)
		expect(
			redo(state, (transaction) => {
				state = state.apply(transaction)
			}),
		).toBe(true)
		expect(serializeToText(state.doc.toJSON())).toBe(moved)
	})
})
