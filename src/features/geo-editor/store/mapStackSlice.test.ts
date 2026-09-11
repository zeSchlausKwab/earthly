import { describe, expect, test } from 'bun:test'
import type { EditorFeature, GeoEditor } from '../core'
import { isDraftGeometryVisible } from '../draftMapVisibility'
import { createDefaultCollectionMeta } from '../utils'
import { createMapStackSlice } from './mapStackSlice'
import { ensureActiveDraftMapPresentation } from './activeDraftMapPresentation'
import type {
	EditorState,
	GeoCollectionEditDraft,
	GeoEditorWorkspace,
	MapStackEntry,
} from './types'

function draftEntry(overrides: Partial<MapStackEntry> = {}): MapStackEntry {
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
	return {
		getState: () => state,
		setState: (partial: Partial<EditorState>) => {
			state = { ...state, ...partial }
		},
	}
}

describe('published Dataset Map Stack removal', () => {
	test('Clear removes the active draft from the canvas, not from saved work', () => {
		const draftId = 'draft-1'
		const workspaceId = 'workspace-1'
		const retainedDraft = {
			id: draftId,
			sourceId: 'session:one',
		} as GeoCollectionEditDraft
		const retainedWorkspace = {
			id: workspaceId,
			sourceId: retainedDraft.sourceId,
			activeDraftId: draftId,
		} as GeoEditorWorkspace
		const harness = createMapStackHarness({
			mapStackEntries: { 'draft:active': draftEntry() },
			mapStackOrder: ['draft:active'],
			geoEditDrafts: { [draftId]: retainedDraft },
			activeGeoEditDraftId: draftId,
			workspaces: { [workspaceId]: retainedWorkspace },
			activeWorkspaceId: workspaceId,
			viewMode: 'edit',
			stance: 'author',
		})

		harness.getState().clearMapStack()
		ensureActiveDraftMapPresentation(harness.getState())

		const state = harness.getState()
		expect(state.mapStackOrder).toEqual([])
		expect(state.mapStackEntries['draft:active']).toBeUndefined()
		expect(state.geoEditDrafts[draftId]).toBe(retainedDraft)
		expect(state.workspaces[workspaceId]).toBe(retainedWorkspace)

		// A removal belongs to that draft, not to newly created Maps.
		const nextDraft = { ...retainedDraft, id: 'draft-2' }
		harness.setState({
			activeGeoEditDraftId: nextDraft.id,
			geoEditDrafts: { ...state.geoEditDrafts, [nextDraft.id]: nextDraft },
			workspaces: { [workspaceId]: { ...retainedWorkspace, activeDraftId: nextDraft.id } },
		})
		ensureActiveDraftMapPresentation(harness.getState())
		expect(harness.getState().mapStackEntries['draft:active']?.visible).toBe(true)
	})

	test('draft geometry follows canvas visibility and isolation', () => {
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

	test('hiding and removing active Dataset geometry preserves saved work', () => {
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

		// Explicit visibility choices must survive the active-draft repair loop.
		harness.getState().toggleMapStackEntryVisible('draft:active')
		ensureActiveDraftMapPresentation(harness.getState())
		syncEditorVisibility()
		expect(editorGeometryVisible).toBe(false)
		expect(harness.getState().mapStackEntries['draft:active']?.visible).toBe(false)
		harness.setState({
			geoEditDrafts: { [draftId]: { ...draft, name: 'Updated while hidden' } },
		})
		ensureActiveDraftMapPresentation(harness.getState())
		expect(harness.getState().mapStackEntries['draft:active']?.title).toBe('Updated while hidden')
		expect(harness.getState().mapStackEntries['draft:active']?.visible).toBe(false)
		harness.setState({ geoEditDrafts: { [draftId]: draft } })
		harness.getState().setMapStackEntryVisible('draft:active', true)
		ensureActiveDraftMapPresentation(harness.getState())
		syncEditorVisibility()
		expect(editorGeometryVisible).toBe(true)
		expect(harness.getState().mapStackEntries['draft:active']?.visible).toBe(true)
		harness.getState().removeMapStackEntry('draft:active')
		ensureActiveDraftMapPresentation(harness.getState())
		syncEditorVisibility()
		expect(editorGeometryVisible).toBe(false)
		expect(harness.getState().mapStackOrder).toEqual([])
		expect(harness.getState().stance).toBe('author')
		expect(harness.getState().viewMode).toBe('edit')
		expect(harness.getState().features).toEqual([feature])
		expect(harness.getState().geoEditDrafts[draftId]).toBe(draft)

		// Explicitly reopening the same draft restores it without replacing it.
		harness
			.getState()
			.addMapStackEntry(
				draftEntry({
					id: 'dataset:other',
					entityType: 'dataset',
					entityKey: 'other',
					isolated: true,
				}),
			)
		ensureActiveDraftMapPresentation(harness.getState(), { reveal: true })
		syncEditorVisibility()
		expect(editorGeometryVisible).toBe(true)
		expect(harness.getState().mapStackEntries['dataset:other']?.isolated).toBe(false)
		harness.getState().removeMapStackEntry('dataset:other')
		expect(harness.getState().dismissedDraftMapId).toBeNull()
		expect(harness.getState().activeGeoEditDraftId).toBe(draftId)

		// Successful publication first ends authoring, then swaps the draft row for
		// the saved Dataset while retaining local work for Chat and later editing.
		harness.setState({ viewMode: 'view', stance: 'focus' })
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
