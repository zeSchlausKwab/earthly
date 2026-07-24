import { describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from './test-harness'

describe('GeoEditor primitives', () => {
	test('starts human shape drawing without spawning geometry', () => {
		const editor = createHeadlessEditor()

		editor.startPrimitiveDrawing('circle')

		expect(editor.getMode()).toBe('draw_primitive')
		expect(editor.getAllFeatures()).toHaveLength(0)
		editor.destroy()
	})

	test('keeps programmatic insertion available for AI commands', () => {
		const editor = createHeadlessEditor()

		const feature = editor.insertPrimitive('triangle')

		expect(feature.geometry.type).toBe('Polygon')
		expect(feature.properties?.primitiveShape).toBe('triangle')
		expect(editor.getSelectedFeatures().map((item) => item.id)).toEqual([feature.id])
		expect(editor.getMode()).toBe('select')
		expect(editor.history.canUndo()).toBe(true)
		editor.destroy()
	})
})
