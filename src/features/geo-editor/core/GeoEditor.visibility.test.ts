import { describe, expect, test } from 'bun:test'
import type { FeatureCollection, Position } from 'geojson'
import type { MapMouseEvent } from 'maplibre-gl'
import { createHeadlessEditor } from './test-harness'
import type { EditorEvent, EditorFeature, EditorMode } from './types'

function makePoint(id: string, coordinates: Position = [13.4, 52.5]): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates },
		properties: { name: id },
	}
}

function featureIds(collection: FeatureCollection | undefined): Array<string | number | undefined> {
	return collection?.features.map((feature) => feature.id) ?? []
}

describe('GeoEditor geometry visibility', () => {
	test('marks only direct map-selection choices as user-originated', () => {
		const editor = createHeadlessEditor()
		const events: EditorEvent[] = []
		editor.setFeatures([makePoint('selected')])
		editor.on('selection.change', (event) => events.push(event))

		// API selection is used by AI tools and hydration; it must not claim the
		// user's mobile surface. Completing a rendered-map candidate is a direct
		// user gesture and carries provenance for the responsive shell.
		editor.selectFeature('selected')
		editor.chooseSelectionCandidate('selected')

		expect(events.map((event) => event.origin)).toEqual([undefined, 'user'])
	})

	test('hides the rendered feature source without discarding the retained feature model', () => {
		const editor = createHeadlessEditor()
		const renderedCollections: FeatureCollection[] = []
		editor.rendering.render = (collection) => {
			renderedCollections.push(collection)
		}

		editor.setFeatures([makePoint('first')])
		expect(featureIds(renderedCollections.at(-1))).toEqual(['first'])

		editor.setGeometryVisible(false)
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['first'])
		expect(featureIds(renderedCollections.at(-1))).toEqual([])

		// Model updates may continue in the retained draft while another map-stack
		// entry is visible, but they must not leak back onto the map.
		editor.setFeatures([makePoint('first'), makePoint('second')])
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['first', 'second'])
		expect(featureIds(renderedCollections.at(-1))).toEqual([])

		editor.setGeometryVisible(true)
		expect(featureIds(renderedCollections.at(-1))).toEqual(['first', 'second'])
	})

	test('clears editor overlays while hidden and restores selection and vertices when shown', () => {
		const editor = createHeadlessEditor()
		const selectionFrames: EditorFeature[][] = []
		const gizmoFrames: Array<{ mode: EditorMode; center: Position | null }> = []
		const vertexFrames: Array<{ mode: EditorMode; featureIds: string[] }> = []
		let selectionBoxClears = 0
		let cursorClears = 0

		editor.rendering.renderSelectionIndicator = (features) => {
			selectionFrames.push(features)
		}
		editor.rendering.renderGizmo = (mode, center) => {
			gizmoFrames.push({ mode, center })
		}
		editor.rendering.renderVertices = (mode, features) => {
			vertexFrames.push({ mode, featureIds: features.map((feature) => feature.id) })
		}
		editor.rendering.renderSelectionBox = () => {
			selectionBoxClears += 1
		}
		editor.rendering.updateCursorIndicator = (position, shouldShow = false) => {
			if (!position && !shouldShow) cursorClears += 1
		}

		editor.setFeatures([makePoint('selected')])
		editor.selectFeatures(['selected'])
		editor.setMode('edit')
		editor.renderVertices()

		editor.setGeometryVisible(false)
		expect(selectionFrames.at(-1)).toEqual([])
		expect(gizmoFrames.at(-1)).toEqual({ mode: 'static', center: null })
		expect(vertexFrames.at(-1)).toEqual({ mode: 'static', featureIds: [] })
		expect(selectionBoxClears).toBeGreaterThan(0)
		expect(cursorClears).toBeGreaterThan(0)

		editor.setGeometryVisible(true)
		expect(selectionFrames.at(-1)?.map((feature) => feature.id)).toEqual(['selected'])
		expect(vertexFrames.at(-1)).toEqual({ mode: 'edit', featureIds: ['selected'] })
	})

	test('keeps invisible geometry inert without overwriting the independent interaction gate', () => {
		const editor = createHeadlessEditor()
		editor.setMode('draw_point')
		const click = {
			lngLat: { lng: 13.4, lat: 52.5 },
			point: { x: 13.4, y: 52.5 },
			originalEvent: {},
			preventDefault: () => {},
		} as unknown as MapMouseEvent
		const invokeMapClick = () => {
			;(editor as unknown as { onClick: (event: MapMouseEvent) => void }).onClick(click)
		}

		editor.setGeometryVisible(false)
		expect(editor.isInteractionEnabled()).toBe(true)
		invokeMapClick()
		expect(editor.getAllFeatures()).toHaveLength(0)

		editor.setGeometryVisible(true)
		invokeMapClick()
		expect(editor.getAllFeatures()).toHaveLength(1)
	})

	test('renders a transient Sighting draw preview without revealing retained Dataset geometry', () => {
		const editor = createHeadlessEditor()
		const renderedCollections: FeatureCollection[] = []
		editor.rendering.render = (collection) => {
			renderedCollections.push(collection)
		}
		const invokeMapClick = (longitude: number, latitude: number) => {
			const click = {
				lngLat: { lng: longitude, lat: latitude },
				point: { x: longitude, y: latitude },
				originalEvent: {},
				preventDefault: () => {},
			} as unknown as MapMouseEvent
			;(editor as unknown as { onClick: (event: MapMouseEvent) => void }).onClick(click)
		}

		editor.setFeatures([makePoint('retained-dataset')])
		editor.setGeometryVisible(false)
		editor.setTransientDrawingVisible(true)
		editor.setMode('draw_polygon')
		invokeMapClick(13.4, 52.5)
		invokeMapClick(13.5, 52.5)

		const preview = renderedCollections.at(-1)
		expect(featureIds(preview)).not.toContain('retained-dataset')
		expect(preview?.features).toHaveLength(1)
		expect(preview?.features[0]?.properties?.meta).toBe('feature-temp')
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['retained-dataset'])

		editor.setTransientDrawingVisible(false)
		expect(featureIds(renderedCollections.at(-1))).toEqual([])
	})
})
