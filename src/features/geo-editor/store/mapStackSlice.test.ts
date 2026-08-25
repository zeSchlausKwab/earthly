import { describe, expect, test } from 'bun:test'
import type { EditorFeature, GeoEditor } from '../core'
import { isDraftGeometryVisible } from '../draftMapVisibility'
import { createDefaultCollectionMeta } from '../utils'
import { createMapStackSlice } from './mapStackSlice'
import type { EditorState, GeoCollectionEditDraft, GeoEditorWorkspace } from './types'

function draftEntry(overrides: Partial<EditorState['mapStackEntries'][string]> = {}) {
	return {
		id: 'draft:active',
		entityType: 'draft' as const,
		entityKey: 'draft:active',
		title: 'Draft',
		source: 'workspace',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 1,
		...overrides,
	}
}

function createMapStackHarness(seed: Partial<EditorState>) {
	let state = {} as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state) : update
		state = { ...state, ...partial }
	}
	const actions = createMapStackSlice(set as never, (() => state) as never, {} as never)
	state = { ...state, ...actions, ...seed }
	return { getState: () => state }
}

describe('published Dataset Map Stack removal', () => {
	test('uses canonical visibility and isolation precedence for the retained draft layer', () => {
		const visibleDraft = draftEntry()
		const hiddenDraft = draftEntry({ visible: false })
		const isolatedDraft = draftEntry({ visible: false, isolated: true })
		const other = {
			...draftEntry({
				id: 'dataset:other',
				entityType: 'dataset',
				entityKey: 'other',
				isolated: true,
			}),
		}

		expect(isDraftGeometryVisible({}, [])).toBe(false)
		expect(isDraftGeometryVisible({ 'draft:active': visibleDraft }, ['draft:active'])).toBe(true)
		expect(isDraftGeometryVisible({ 'draft:active': hiddenDraft }, ['draft:active'])).toBe(false)
		expect(isDraftGeometryVisible({ 'draft:active': isolatedDraft }, ['draft:active'])).toBe(true)
		expect(
			isDraftGeometryVisible({ 'draft:active': visibleDraft, 'dataset:other': other }, [
				'draft:active',
				'dataset:other',
			]),
		).toBe(false)
	})

	test('hides retained active Dataset geometry without deleting saved work', () => {
		const feature: EditorFeature = {
			type: 'Feature',
			id: 'published-point',
			geometry: { type: 'Point', coordinates: [16.3725, 48.2083] },
			properties: { name: 'Published point' },
		}
		const datasetKey = 'owner:published-dataset'
		const stackEntryId = `dataset:${datasetKey}`
		const draftId = 'draft-published-dataset'
		const workspaceId = 'workspace-published-dataset'
		const draft: GeoCollectionEditDraft = {
			persistenceVersion: 2,
			id: draftId,
			sourceId: `dataset:${datasetKey}`,
			name: 'Published dataset',
			description: '',
			collectionMeta: createDefaultCollectionMeta(),
			features: [feature],
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' },
			contextRefs: [],
			blobReferences: [],
			createdAt: 1,
			updatedAt: 2,
		}
		const workspace: GeoEditorWorkspace = {
			id: workspaceId,
			sourceId: draft.sourceId,
			label: 'Published dataset',
			kind: 'dataset',
			datasetKey,
			baseRevisionId: 'published-event-id',
			activeDraftId: draftId,
			chatSessionId: null,
			createdAt: 1,
			updatedAt: 2,
		}
		let editorGeometryVisible = true
		const editor = {
			setGeometryVisible: (visible: boolean) => {
				editorGeometryVisible = visible
			},
		} as unknown as GeoEditor
		const harness = createMapStackHarness({
			editor,
			features: [feature],
			selectedFeatureIds: [],
			geoEditDrafts: { [draftId]: draft },
			activeGeoEditDraftId: draftId,
			workspaces: { [workspaceId]: workspace },
			activeWorkspaceId: workspaceId,
			viewMode: 'edit',
			stance: 'author',
			mapStackEntries: {
				'draft:active': draftEntry({ title: 'Published dataset draft', addedAt: 3 }),
			},
			mapStackOrder: ['draft:active'],
		})

		const syncEditorVisibility = () => {
			const state = harness.getState()
			editor.setGeometryVisible(isDraftGeometryVisible(state.mapStackEntries, state.mapStackOrder))
		}
		expect(
			isDraftGeometryVisible(harness.getState().mapStackEntries, harness.getState().mapStackOrder),
		).toBe(true)

		// Successful publication swaps the draft row for the saved Dataset row,
		// while retaining the local draft/workspace for Chat and later editing.
		harness.getState().removeMapStackEntry('draft:active')
		harness.getState().addMapStackEntry({
			id: stackEntryId,
			entityType: 'dataset',
			entityKey: datasetKey,
			title: 'Published dataset',
			source: 'route',
			visible: true,
			pinned: false,
		})
		syncEditorVisibility()
		expect(editorGeometryVisible).toBe(false)

		harness.getState().removeMapStackEntry(stackEntryId)
		syncEditorVisibility()

		const state = harness.getState()
		expect(state.mapStackOrder).toEqual([])
		expect(state.mapStackEntries).toEqual({})
		expect(state.geoEditDrafts[draftId]).toBe(draft)
		expect(state.workspaces[workspaceId]).toBe(workspace)
		expect(state.features).toEqual([feature])
		expect(editorGeometryVisible).toBe(false)
		expect(state.activeGeoEditDraftId).toBe(draftId)
		expect(state.activeWorkspaceId).toBe(workspaceId)
	})
})
