import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { createDefaultCollectionMeta } from '../utils'
import { createDraftSlice, normalizePersistedGeoCollectionDraftState } from './draftSlice'
import { createMetadataSlice } from './metadataSlice'
import { createPublishingSlice } from './publishingSlice'
import type { EditorState } from './types'

function createDraftHarness() {
	let state = {
		collectionMeta: createDefaultCollectionMeta(),
		features: [],
		selectedFeatureIds: [],
		activeDatasetContextRefs: [],
		blobReferences: [],
		workspaces: {},
		activeWorkspaceId: null,
		touchActiveWorkspace: () => {},
		updateWorkspace: () => {},
		updateStats: () => {},
	} as unknown as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state) : update
		state = { ...state, ...partial }
	}
	const get = () => state

	state = {
		...state,
		...createDraftSlice(set as never, get as never, {} as never),
		...createMetadataSlice(set as never, get as never, {} as never),
		...createPublishingSlice(set as never, get as never, {} as never),
	}
	return { getState: () => state }
}

describe('geo collection draft persistence', () => {
	test('quarantines legacy drafts until their publish destination is classified', () => {
		const persisted = normalizePersistedGeoCollectionDraftState({
			drafts: {
				legacy: {
					id: 'legacy',
					sourceId: 'dataset:legacy',
					name: 'Legacy',
					features: [],
					selectedFeatureIds: [],
					createdAt: 1,
					updatedAt: 2,
				},
			},
			activeDraftId: 'legacy',
		})

		expect(persisted.activeDraftId).toBe('legacy')
		expect(persisted.drafts.legacy?.persistenceVersion).toBe(1)
		expect(persisted.drafts.legacy?.publishChannel).toEqual({
			kind: 'unresolved',
			reason: 'legacy',
		})
		expect(persisted.drafts.legacy?.contextRefs).toEqual([])
		expect(persisted.drafts.legacy?.blobReferences).toEqual([])
	})

	test('captures channel, contexts, and durable blob references on a new draft', () => {
		const harness = createDraftHarness()
		const previewCollection: FeatureCollection = { type: 'FeatureCollection', features: [] }
		harness.getState().setActiveDatasetContextRefs([' context:one ', 'context:one'])
		harness.getState().setBlobReferences([
			{
				id: 'blob-1',
				scope: 'collection',
				url: 'https://blossom.example/geo.json',
				status: 'ready',
				previewCollection,
			},
		])

		const draftId = harness.getState().createGeoEditDraft('session:one', {
			publishChannel: { kind: 'private-group', id: ' group-123 ' },
		})
		const draft = harness.getState().geoEditDrafts[draftId]
		if (!draft) throw new Error('Expected the new draft to exist')

		expect(draft.persistenceVersion).toBe(2)
		expect(draft.publishChannel).toEqual({ kind: 'private-group', id: 'group-123' })
		expect(draft.contextRefs).toEqual(['context:one'])
		expect(draft.blobReferences).toHaveLength(1)
		expect(draft.blobReferences[0]?.previewCollection).toBeUndefined()
	})

	test('quarantines a versioned draft whose saved channel is invalid', () => {
		const persisted = normalizePersistedGeoCollectionDraftState({
			drafts: {
				broken: {
					persistenceVersion: 2,
					id: 'broken',
					sourceId: 'session:broken',
					name: '',
					description: '',
					features: [],
					selectedFeatureIds: [],
					publishChannel: { kind: 'private-group', id: '' },
					contextRefs: [],
					blobReferences: [],
					createdAt: 1,
					updatedAt: 1,
				},
			},
		})

		expect(persisted.drafts.broken?.publishChannel).toEqual({
			kind: 'unresolved',
			reason: 'invalid',
		})
	})

	test('only leaves quarantine after an explicit destination is saved', () => {
		const harness = createDraftHarness()
		const draftId = harness.getState().createGeoEditDraft('session:legacy', {
			publishChannel: { kind: 'unresolved', reason: 'legacy' },
		})

		expect(harness.getState().geoEditDrafts[draftId]?.publishChannel).toEqual({
			kind: 'unresolved',
			reason: 'legacy',
		})

		harness.getState().setActiveGeoEditDraftId(null)
		harness.getState().saveGeoEditDraft(draftId, {
			publishChannel: { kind: 'private-group', id: 'survey-team' },
		})

		expect(harness.getState().geoEditDrafts[draftId]?.publishChannel).toEqual({
			kind: 'private-group',
			id: 'survey-team',
		})
		expect(harness.getState().activeGeoEditDraftId).toBeNull()
	})

	test('keeps active draft context and blob attachments in sync and restores them', () => {
		const harness = createDraftHarness()
		const draftId = harness.getState().createGeoEditDraft('session:two', {
			publishChannel: { kind: 'field-session', id: 'field-42' },
		})

		harness.getState().setActiveDatasetContextRefs(['context:ruins'])
		harness.getState().setBlobReferences([
			{
				id: 'blob-2',
				scope: 'feature',
				featureId: 'feature-7',
				url: 'https://blossom.example/feature.json',
				status: 'ready',
			},
		])
		expect(harness.getState().geoEditDrafts[draftId]?.contextRefs).toEqual(['context:ruins'])
		expect(harness.getState().geoEditDrafts[draftId]?.blobReferences).toHaveLength(1)

		harness.getState().setActiveGeoEditDraftId(null)
		harness.getState().setActiveDatasetContextRefs([])
		harness.getState().setBlobReferences([])
		harness.getState().loadGeoEditDraft(draftId)

		expect(harness.getState().activeDatasetContextRefs).toEqual(['context:ruins'])
		expect(harness.getState().blobReferences[0]).toMatchObject({
			id: 'blob-2',
			featureId: 'feature-7',
		})
		expect(harness.getState().geoEditDrafts[draftId]?.publishChannel).toEqual({
			kind: 'field-session',
			id: 'field-42',
		})
	})

	test('deleting a workspace source removes every draft for that source', () => {
		const harness = createDraftHarness()
		const first = harness.getState().createGeoEditDraft('dataset:same')
		const second = harness.getState().createGeoEditDraft('dataset:same')
		const unrelated = harness.getState().createGeoEditDraft('dataset:other')

		harness.getState().deleteGeoEditDraftsBySourceId('dataset:same')

		expect(harness.getState().geoEditDrafts[first]).toBeUndefined()
		expect(harness.getState().geoEditDrafts[second]).toBeUndefined()
		expect(harness.getState().geoEditDrafts[unrelated]).toBeDefined()
		expect(harness.getState().activeGeoEditDraftId).toBe(unrelated)
	})
})
