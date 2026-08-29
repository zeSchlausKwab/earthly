import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { getFeatureCallouts } from '@/lib/geo/callouts'
import { advertise, dispatch, registry } from './registry'

describe('map callout AI tools', () => {
	beforeEach(() => {
		const editor = createHeadlessEditor()
		editor.setFeatures([
			{
				type: 'Feature',
				id: 'route-a',
				properties: { name: 'Route A' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[0, 0],
						[1, 1],
					],
				},
			},
			{
				type: 'Feature',
				id: 'route-b',
				properties: { name: 'Route B' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[1, 1],
						[2, 2],
					],
				},
			},
		])
		useEditorStore.getState().setEditor(editor)
		setSafetyLevelProvider(() => 3)
	})

	afterEach(() => {
		useEditorStore.getState().setEditor(null)
		setSafetyLevelProvider(() => 2)
	})

	test('registers and advertises dedicated add, update, and remove verbs', () => {
		const names = advertise().map((tool) => tool.function.name)
		for (const name of [
			'add_feature_callout',
			'add_feature_callouts',
			'update_feature_callout',
			'remove_feature_callout',
		]) {
			expect(registry.get(name)?.kind).toBe('authoring-primitive')
			expect(names).toContain(name)
		}
	})

	test('advertises one atomic batch for adding callouts to multiple owners', () => {
		const batch = advertise().find((tool) => tool.function.name === 'add_feature_callouts')
		expect(batch?.function.parameters.properties).toHaveProperty('callouts')
		expect(batch?.function.parameters.required).toContain('callouts')
		expect(batch?.function.description).toContain('alreadyPresent')
	})

	test('does not expose geometry or arbitrary feature replacement in callout schemas', () => {
		const add = advertise().find((tool) => tool.function.name === 'add_feature_callout')
		const properties = add?.function.parameters.properties ?? {}
		expect(properties).toHaveProperty('featureId')
		expect(properties).toHaveProperty('text')
		expect(properties).not.toHaveProperty('geometry')
		expect(properties).not.toHaveProperty('feature')
	})

	test('atomically stores authored callouts on their owning geometries', async () => {
		const result = (await dispatch('add_feature_callouts', {
			callouts: [
				{ featureId: 'route-a', title: 'A', text: 'First callout' },
				{ featureId: 'route-b', title: 'B', text: 'Second callout' },
			],
		})) as { cancelled: boolean; counts: { updated: number }; calloutCount: number }

		expect(result.cancelled).toBe(false)
		expect(result.counts.updated).toBe(2)
		expect(result.calloutCount).toBe(2)
		const editor = useEditorStore.getState().editor
		expect(getFeatureCallouts(editor?.getFeature('route-a') ?? { properties: {} })).toMatchObject([
			{ title: 'A', text: 'First callout' },
		])
		expect(getFeatureCallouts(editor?.getFeature('route-b') ?? { properties: {} })).toMatchObject([
			{ title: 'B', text: 'Second callout' },
		])
	})

	test('treats an identical repeated single callout as already present', async () => {
		const first = (await dispatch('add_feature_callout', {
			featureId: 'route-a',
			title: 'Flood reaches Muglin',
			text: 'The reported flood front reached this section at 15:20.',
		})) as {
			added: number
			alreadyPresent: number
			calloutId: string
		}
		const repeated = (await dispatch('add_feature_callout', {
			featureId: 'route-a',
			title: 'Flood reaches Muglin',
			text: 'The reported flood front reached this section at 15:20.',
		})) as {
			added: number
			alreadyPresent: number
			calloutId: string
			counts: { updated: number }
		}

		expect(first).toMatchObject({ added: 1, alreadyPresent: 0 })
		expect(repeated).toMatchObject({
			added: 0,
			alreadyPresent: 1,
			counts: { updated: 0 },
		})
		expect(repeated.calloutId).toBe(first.calloutId)
		const editor = useEditorStore.getState().editor
		expect(getFeatureCallouts(editor?.getFeature('route-a') ?? { properties: {} })).toHaveLength(1)
	})

	test('deduplicates identical callouts across repeated atomic batches', async () => {
		const args = {
			callouts: [
				{ featureId: 'route-a', title: 'A', text: 'First callout' },
				{ featureId: 'route-b', title: 'B', text: 'Second callout' },
			],
		}
		const first = (await dispatch('add_feature_callouts', args)) as {
			added: number
			alreadyPresent: number
		}
		const repeated = (await dispatch('add_feature_callouts', args)) as {
			added: number
			alreadyPresent: number
			calloutCount: number
			counts: { updated: number }
		}

		expect(first).toMatchObject({ added: 2, alreadyPresent: 0 })
		expect(repeated).toMatchObject({
			added: 0,
			alreadyPresent: 2,
			calloutCount: 0,
			counts: { updated: 0 },
		})
		const editor = useEditorStore.getState().editor
		expect(getFeatureCallouts(editor?.getFeature('route-a') ?? { properties: {} })).toHaveLength(1)
		expect(getFeatureCallouts(editor?.getFeature('route-b') ?? { properties: {} })).toHaveLength(1)
	})

	test('keeps distinct placement, update, and remove operations intact', async () => {
		const first = (await dispatch('add_feature_callout', {
			featureId: 'route-a',
			text: 'Same authored text',
		})) as { calloutId: string }
		const placed = (await dispatch('add_feature_callout', {
			featureId: 'route-a',
			text: 'Same authored text',
			placementSide: 'top',
		})) as { added: number; calloutId: string }
		expect(placed.added).toBe(1)

		await dispatch('update_feature_callout', {
			featureId: 'route-a',
			calloutId: first.calloutId,
			text: 'Updated authored text',
		})
		await dispatch('remove_feature_callout', {
			featureId: 'route-a',
			calloutId: placed.calloutId,
		})

		const editor = useEditorStore.getState().editor
		expect(getFeatureCallouts(editor?.getFeature('route-a') ?? { properties: {} })).toMatchObject([
			{ id: first.calloutId, text: 'Updated authored text' },
		])
	})

	test('validates every owner before an atomic batch mutates the map', async () => {
		const result = await dispatch('add_feature_callouts', {
			callouts: [
				{ featureId: 'route-a', text: 'Would otherwise be valid' },
				{ featureId: 'missing-route', text: 'Missing owner' },
			],
		})

		expect(result).toMatchObject({ ok: false, kind: 'handler_error' })
		const editor = useEditorStore.getState().editor
		expect(getFeatureCallouts(editor?.getFeature('route-a') ?? { properties: {} })).toEqual([])
	})
})
