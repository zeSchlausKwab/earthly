import { describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '../test-harness'
import type { EditorFeature } from '../types'

function sourceLine(): EditorFeature {
	return {
		type: 'Feature',
		id: 'source-line',
		properties: { meta: 'feature', featureId: 'source-line', name: 'Road' },
		geometry: {
			type: 'LineString',
			coordinates: [
				[0, 0],
				[0.01, 0],
			],
		},
	}
}

describe('GeometryOperationsManager', () => {
	it('extrudes an arrow as one undoable replacement and preserves its source on undo', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([sourceLine()])
		editor.clearHistory()
		const result = editor.applyGeometryOperation(
			'source-line',
			{ kind: 'fat-arrow', width: 100, endWidth: 50 },
			'replace',
		)
		expect(editor.getFeature('source-line')).toBeUndefined()
		expect(result.features[0]?.geometry.type).toBe('Polygon')
		editor.undo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['source-line'])
		editor.redo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(result.resultFeatureIds)
	})
	it('replaces a source with split parts as one undo/redo action', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([sourceLine()])
		editor.clearHistory()

		const applied = editor.applyGeometryOperation(
			'source-line',
			{
				kind: 'split',
				cutter: { type: 'Point', coordinates: [0.005, 0] },
			},
			'replace',
		)

		expect(applied.resultFeatureIds).toHaveLength(2)
		expect(editor.getFeature('source-line')).toBeUndefined()
		expect(editor.getAllFeatures()).toHaveLength(2)

		editor.undo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['source-line'])

		editor.redo()
		expect(editor.getFeature('source-line')).toBeUndefined()
		expect(editor.getAllFeatures()).toHaveLength(2)
	})

	it('keeps a source when creating a derived offset copy', () => {
		const editor = createHeadlessEditor()
		editor.setFeatures([sourceLine()])
		editor.clearHistory()

		editor.applyGeometryOperation(
			'source-line',
			{ kind: 'offset-line', distance: 10, units: 'meters', side: 'left' },
			'copy',
		)
		expect(editor.getAllFeatures()).toHaveLength(2)

		editor.undo()
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['source-line'])
	})
})
