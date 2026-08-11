import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from './core/test-harness'
import {
	type EditorCommandExecutionResult,
	executeEditorCommand,
	getEditorAiToolDefinitions,
	getEditorCommands,
} from './commands'
import { useEditorStore } from './store'
import { singlePointCollection } from '@/lib/test-fixtures/geo'

// Characterization: editor commands must still produce the same
// EditorCommandExecutionResult after self-registration into the unified
// chat-tools registry (Plan 04). The registry must NOT alter command behavior.

function loadFeatures(editor: ReturnType<typeof createHeadlessEditor>) {
	const features = singlePointCollection.features.map((f, i) => ({
		id: `feat-${i}`,
		type: 'Feature' as const,
		geometry: f.geometry,
		properties: f.properties ?? {},
	}))
	editor.setFeatures(features as never)
	return features
}

describe('editor commands (characterization, post-registration)', () => {
	beforeEach(() => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
	})

	afterEach(() => {
		useEditorStore.getState().setEditor(null)
	})

	it('duplicate_selected_features returns the structured result shape', () => {
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('editor not set')
		const features = loadFeatures(editor)
		editor.selectFeature(features[0].id)

		const result: EditorCommandExecutionResult = executeEditorCommand('duplicate_selected_features')
		expect(result.ok).toBe(true)
		expect(result.commandId).toBe('duplicate_selected_features')
		expect(typeof result.message).toBe('string')
		expect(result.data?.totalFeaturesInEditor).toBeGreaterThanOrEqual(features.length)
	})

	it('delete_selected_features deletes and reports a structured result', () => {
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('editor not set')
		const features = loadFeatures(editor)
		editor.selectFeature(features[0].id)

		const result = executeEditorCommand('delete_selected_features')
		expect(result.ok).toBe(true)
		expect(result.commandId).toBe('delete_selected_features')
		expect(result.data?.deletedCount).toBe(1)
	})

	it('merge_selected_features fails gracefully with a structured failure (no throw)', () => {
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('editor not set')
		loadFeatures(editor)
		// No / incompatible selection → graceful failure, not a throw.
		const result = executeEditorCommand('merge_selected_features')
		expect(result.ok).toBe(false)
		expect(result.commandId).toBe('merge_selected_features')
		expect(typeof result.message).toBe('string')
	})

	it('simplify_selected_features returns a structured result (no throw on empty selection)', () => {
		const result = executeEditorCommand('simplify_selected_features')
		expect(result.commandId).toBe('simplify_selected_features')
		expect(typeof result.ok).toBe('boolean')
		expect(typeof result.message).toBe('string')
	})

	it('finish_drawing reports the geometry operation error instead of false success', () => {
		const editor = useEditorStore.getState().editor
		if (!editor) throw new Error('editor not set')
		editor.finishDrawing = () => null
		editor.getGeometryOperation = () =>
			({ error: 'The cutting line must cross the polygon completely.' }) as never

		const result = executeEditorCommand('finish_drawing')

		expect(result.ok).toBe(false)
		expect(result.message).toBe('The cutting line must cross the polygon completely.')
	})

	it('every editor command exposes an AI tool definition consumed by the registry', () => {
		const commands = getEditorCommands()
		const defs = getEditorAiToolDefinitions()
		const defNames = new Set(defs.map((d) => d.name))
		for (const command of commands) {
			if (command.ai?.toolName) {
				expect(defNames.has(command.ai.toolName)).toBe(true)
			}
		}
	})
})
