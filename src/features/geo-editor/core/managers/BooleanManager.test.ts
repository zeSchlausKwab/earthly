import { afterEach, describe, expect, test } from 'bun:test'
import { polygon } from '@turf/turf'
import { createHeadlessEditor } from '../test-harness'
import type { EditorFeature, GeoEditor } from '../index'

let editor: GeoEditor | undefined
afterEach(() => editor?.destroy())

describe('manual Boolean operations share the polygon engine', () => {
	test('union supports MultiPolygon input and keeps its established input consumption', () => {
		editor = createHeadlessEditor()
		const part = (west: number) =>
			polygon([
				[
					[west, 0],
					[west + 1, 0],
					[west + 1, 1],
					[west, 1],
					[west, 0],
				],
			]).geometry.coordinates
		editor.setFeatures([
			{
				type: 'Feature',
				id: 'first',
				properties: { name: 'keep' },
				geometry: { type: 'MultiPolygon', coordinates: [part(0), part(2)] },
			},
			{ ...polygon(part(4)), id: 'second', properties: {} },
		] as EditorFeature[])
		editor.selectFeatures(['first'])
		expect(editor.boolean.startUnion()).toBe(true)
		expect(editor.boolean.complete('second')).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(1)
		const result = editor.getAllFeatures()[0]
		expect(result?.geometry.type).toBe('MultiPolygon')
		expect(result?.properties.name).toBe('keep')
		expect(result?.properties.featureId).toBe(result?.id)
		editor.undo()
		expect(
			editor
				.getAllFeatures()
				.map((feature) => feature.id)
				.sort(),
		).toEqual(['first', 'second'])
	})
})
