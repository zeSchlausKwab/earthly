import { afterEach, describe, expect, it } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { MAP_CALLOUTS_PROPERTY } from '@/lib/geo/callouts'
import { dispatch } from './registry'

describe('get_editor_state callout summaries', () => {
	afterEach(() => {
		useEditorStore.getState().setEditor(null)
		useEditorStore.setState({ features: [], selectedFeatureIds: [] })
	})

	it('reports existing callouts with their owning feature ids in compact and full state', async () => {
		const features: EditorFeature[] = [
			{
				type: 'Feature',
				id: 'river-route',
				geometry: {
					type: 'LineString',
					coordinates: [
						[85, 28],
						[85.1, 27.9],
					],
				},
				properties: {
					name: 'Trishuli flood route',
					[MAP_CALLOUTS_PROPERTY]: [
						{
							id: 'callout-a',
							title: 'Border crossing damaged',
							text: 'The crossing was reported damaged at 08:44.',
						},
						{
							id: 'callout-b',
							text: 'Flooding moved downstream during the morning.',
						},
					],
				},
			},
		]
		const editor = createHeadlessEditor()
		editor.setFeatures(features)
		useEditorStore.getState().setEditor(editor)
		useEditorStore.setState({ features })

		for (const args of [{}, { detail: 'full' }]) {
			const state = (await dispatch('get_editor_state', args)) as {
				callouts?: {
					total: number
					featureCount: number
					byFeature: Array<{
						featureId: string
						featureName?: string
						count: number
						callouts: Array<{ id: string; title?: string; text: string }>
					}>
				}
			}
			expect(state.callouts).toMatchObject({
				total: 2,
				featureCount: 1,
				byFeature: [
					{
						featureId: 'river-route',
						featureName: 'Trishuli flood route',
						count: 2,
						callouts: [
							{
								id: 'callout-a',
								title: 'Border crossing damaged',
								text: 'The crossing was reported damaged at 08:44.',
							},
							{
								id: 'callout-b',
								text: 'Flooding moved downstream during the morning.',
							},
						],
					},
				],
			})
		}
	})
})
