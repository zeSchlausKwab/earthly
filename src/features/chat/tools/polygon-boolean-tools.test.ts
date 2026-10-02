import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bbox, polygon } from '@turf/turf'
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
import { BROWSER_EDITOR_TOOLS } from '@/features/webmcp/catalog'

let editor: GeoEditor
const args = {
	sourceFeatureId: 'source',
	maskFeatureIds: ['mask'],
	operation: 'intersection',
	resultMode: 'replace-source',
}

function rectangle(id: string, west: number, east: number): EditorFeature {
	return {
		...polygon([
			[
				[west, 0],
				[east, 0],
				[east, 10],
				[west, 10],
				[west, 0],
			],
		]),
		id,
		properties: { name: id },
	} as EditorFeature
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
	const source = rectangle('source', 0, 10)
	source.properties = {
		...source.properties,
		fillColor: '#ff0000',
		importSource: 'coastline',
		'earthly:derivedFrom': 'previous-provenance',
		'earthly:callouts': [
			{
				id: 'photo',
				text: 'Preserve this photo',
				media: [{ url: 'https://example.com/photo.jpg' }],
			},
		],
		customProperties: { nested: ['preserve'] },
	}
	editor.setFeatures([source, rectangle('mask', 5, 15), rectangle('unrelated', 30, 40)])
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

describe('polygon Boolean chat and native authoring contract', () => {
	test('advertises explicit IDs, mandatory result mode, and native discovery', () => {
		expect(
			advertise().find((tool) => tool.function.name === 'polygon_boolean')?.function.parameters
				.required,
		).toEqual(['sourceFeatureId', 'maskFeatureIds', 'operation', 'resultMode'])
		expect(BROWSER_EDITOR_TOOLS).toContain('polygon_boolean')
	})

	test('replace-source preserves ID, properties, masks, unrelated work and one Undo', async () => {
		const before = structuredClone(editor.getAllFeatures())
		expect(await dispatch('polygon_boolean', args)).toMatchObject({
			cancelled: false,
			emptyResult: false,
			resultFeatureIds: ['source'],
			counts: { created: 0, updated: 1 },
		})
		const source = editor.getFeature('source')
		if (!source) throw new Error('Expected the source feature')
		expect(bbox(source)).toEqual([5, 0, 10, 10])
		expect(editor.getFeature('source')?.properties).toEqual(before[0]?.properties)
		expect(editor.getFeature('mask')).toEqual(before[1])
		expect(editor.getFeature('unrelated')).toEqual(before[2])
		expect(getAllPendingDiffs()).toHaveLength(1)
		editor.undoLastDatasetSnapshot()
		expect(editor.getAllFeatures()).toEqual(before)
	})

	test('append produces a fresh ID with inherited styles, callouts and provenance', async () => {
		const before = structuredClone(editor.getAllFeatures())
		const result = (await dispatch('polygon_boolean', { ...args, resultMode: 'append' })) as {
			resultFeatureIds: string[]
		}
		const id = result.resultFeatureIds[0]
		expect(id).toBeString()
		expect(id).not.toBe('source')
		const feature = editor.getFeature(id ?? '')
		expect(feature?.properties).toMatchObject({
			...before[0]?.properties,
			featureId: id,
			'earthly:polygonBoolean': {
				operation: 'intersection',
				sourceFeatureId: 'source',
				maskFeatureIds: ['mask'],
			},
		})
		expect(editor.getAllFeatures().slice(0, 3)).toEqual(before)
		expect(editor.getAllFeatures()).toHaveLength(4)
		editor.undoLastDatasetSnapshot()
		expect(editor.getAllFeatures()).toEqual(before)
	})

	test('one cancelled review restores everything for append and replace-source', async () => {
		for (const resultMode of ['append', 'replace-source']) {
			clearPendingDiffs()
			setSafetyLevelProvider(() => 1)
			const before = structuredClone(editor.getAllFeatures())
			const review = nextReview()
			const pending = dispatch('polygon_boolean', { ...args, resultMode })
			const diff = await review
			expect(getAllPendingDiffs()).toHaveLength(1)
			resolvePendingDiff(diff.id, 'cancelled')
			expect(await pending).toMatchObject({
				cancelled: true,
				resultFeatureIds: [],
				counts: { created: 0, updated: 0 },
			})
			expect(editor.getAllFeatures()).toEqual(before)
		}
	})

	test('empty results cannot erase source or create a phantom Undo/review', async () => {
		const before = structuredClone(editor.getAllFeatures())
		expect(
			await dispatch('polygon_boolean', { ...args, maskFeatureIds: ['unrelated'] }),
		).toMatchObject({
			emptyResult: true,
			unchanged: true,
			resultFeatureIds: [],
			counts: { created: 0, updated: 0 },
		})
		expect(
			await dispatch('polygon_boolean', {
				...args,
				operation: 'difference',
				maskFeatureIds: ['source'],
			}),
		).toMatchObject({ ok: false, sideEffectsApplied: false })
		expect(editor.getAllFeatures()).toEqual(before)
		expect(getAllPendingDiffs()).toHaveLength(0)
	})

	test('invalid or unresolved IDs fail atomically without filtering unknown masks', async () => {
		const before = structuredClone(editor.getAllFeatures())
		for (const override of [
			{ sourceFeatureId: 'missing' },
			{ maskFeatureIds: ['mask', 'missing'] },
			{ maskFeatureIds: ['mask', 'mask'] },
			{ maskFeatureIds: ['source'] },
			{ maskFeatureIds: [] },
			{ operation: 'xor' },
			{ resultMode: undefined },
		]) {
			expect(await dispatch('polygon_boolean', { ...args, ...override })).toMatchObject({
				ok: false,
				sideEffectsApplied: false,
			})
			expect(editor.getAllFeatures()).toEqual(before)
		}
		expect(getAllPendingDiffs()).toHaveLength(0)
	})
})
