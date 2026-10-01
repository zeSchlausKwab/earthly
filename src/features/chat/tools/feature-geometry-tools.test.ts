import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	resolvePendingDiff,
	subscribePendingDiffs,
	type PendingDiffEntry,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { GeoEditor, EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { advertise, dispatch } from './registry'

let editor: GeoEditor
const geometry: GeoJSON.LineString = {
	type: 'LineString',
	coordinates: [
		[40, -20],
		[50, -10],
	],
}

function nextReview(): Promise<PendingDiffEntry> {
	return new Promise((resolve) => {
		const unsubscribe = subscribePendingDiffs(() => {
			const diff = getAllPendingDiffs().find((entry) => entry.status === 'pending')
			if (diff) {
				unsubscribe()
				resolve(diff)
			}
		})
	})
}

beforeEach(() => {
	editor = createHeadlessEditor()
	editor.setFeatures([
		{
			type: 'Feature',
			id: 'route',
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[1, 1],
				],
			},
			properties: {
				name: 'Route',
				fillColor: '#ff0000',
				importSource: 'authored-source',
				customProperties: { nested: ['keep'] },
				'earthly:callouts': [
					{
						id: 'photo',
						text: 'Keep the photo',
						media: [{ url: 'https://example.com/photo.jpg' }],
					},
				],
			},
		},
		{
			type: 'Feature',
			id: 'place',
			geometry: { type: 'Point', coordinates: [2, 3] },
			properties: { name: 'Untouched place' },
		},
	] as EditorFeature[])
	useEditorStore.getState().setEditor(editor)
	setSafetyLevelProvider(() => 3)
	clearPendingDiffs()
})
afterEach(() => {
	clearPendingDiffs()
	useEditorStore.getState().setEditor(null)
	editor.destroy()
	setSafetyLevelProvider(() => 2)
})

describe('feature-scoped geometry replacement', () => {
	test('advertises an explicit existing feature and bare geometry without property replacement', () => {
		const tool = advertise().find(
			(candidate) => candidate.function.name === 'update_feature_geometry',
		)
		expect(tool?.function.parameters.required).toEqual(['featureId', 'geometry'])
		expect(tool?.function.parameters.properties).not.toHaveProperty('properties')
		expect(tool?.function.parameters.properties).not.toHaveProperty('replace')
	})

	test('preserves all authored properties and other features in one undoable edit', async () => {
		const before = structuredClone(editor.getAllFeatures())
		const result = await dispatch('update_feature_geometry', { featureId: 'route', geometry })
		expect(result).toMatchObject({ cancelled: false, featureId: 'route', counts: { updated: 1 } })
		expect(editor.getFeature('route')?.geometry).toEqual(geometry)
		expect(editor.getFeature('route')?.properties).toEqual(before[0]?.properties)
		expect(editor.getFeature('place')).toEqual(before[1])
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['route', 'place'])
		expect(getAllPendingDiffs()[0]?.diff.modified).toHaveLength(1)
		editor.undoLastDatasetSnapshot()
		expect(editor.getAllFeatures()).toEqual(before)
	})

	test('restores geometry and properties when the shared review is cancelled', async () => {
		setSafetyLevelProvider(() => 2)
		const before = structuredClone(editor.getAllFeatures())
		const review = nextReview()
		const pending = dispatch('update_feature_geometry', { featureId: 'route', geometry })
		const diff = await review
		expect(diff.diff.modified).toHaveLength(1)
		resolvePendingDiff(diff.id, 'cancelled')
		expect(await pending).toMatchObject({ cancelled: true, counts: { updated: 0 } })
		expect(editor.getAllFeatures()).toEqual(before)
	})

	test('rejects unknown ids and invalid geometry without changing any features', async () => {
		const before = structuredClone(editor.getAllFeatures())
		for (const args of [
			{ featureId: 'missing', geometry },
			{ featureId: '', geometry },
			{ featureId: 'route', geometry: { type: 'FeatureCollection', features: [] } },
			{ featureId: 'route', geometry: { type: 'Point', coordinates: [181, 0] } },
			{ featureId: 'route', geometry: { type: 'LineString', coordinates: [[0, 0]] } },
		]) {
			expect(await dispatch('update_feature_geometry', args)).toMatchObject({
				ok: false,
				sideEffectsApplied: false,
			})
			expect(editor.getAllFeatures()).toEqual(before)
		}
		expect(getAllPendingDiffs()).toHaveLength(0)
	})
})
