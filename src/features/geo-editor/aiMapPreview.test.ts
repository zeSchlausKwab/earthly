import { describe, expect, test } from 'bun:test'
import type { EditorFeature } from './core'
import {
	createAiMapPreviewRevealer,
	deriveAiMapPreviewFeatures,
	reconcileAiMapPreviews,
	resolveAiMapPreviewDraft,
} from './aiMapPreview'
import { createMapStackSlice } from './store/mapStackSlice'
import type { EditorState, GeoCollectionEditDraft, GeoEditorWorkspace } from './store/types'
import { createDefaultCollectionMeta } from './utils'

function point(id = 'point-1'): EditorFeature {
	return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [16, 48] }, properties: {} }
}

function harness() {
	let state = {} as EditorState
	const set = (update: Partial<EditorState> | ((value: EditorState) => Partial<EditorState>)) => {
		state = { ...state, ...(typeof update === 'function' ? update(state) : update) }
	}
	state = {
		...createMapStackSlice(set as never, (() => state) as never, {} as never),
		workspaces: {},
		geoEditDrafts: {},
		activeWorkspaceId: null,
		activeGeoEditDraftId: null,
	} as EditorState
	const add = (workspaceId: string, features: EditorFeature[] = [point()]) => {
		const draft: GeoCollectionEditDraft = {
			id: `draft-${workspaceId}`,
			sourceId: `session:${workspaceId}`,
			name: 'New Map',
			description: '',
			collectionMeta: { ...createDefaultCollectionMeta(), name: 'New Map' },
			features,
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' },
			contextRefs: [],
			blobReferences: [],
			persistenceVersion: 2,
			createdAt: 1,
			updatedAt: 1,
		}
		const workspace: GeoEditorWorkspace = {
			id: workspaceId,
			sourceId: draft.sourceId,
			label: draft.name,
			kind: 'scratch',
			datasetKey: null,
			activeDraftId: draft.id,
			chatSessionId: 'chat-1',
			createdAt: 1,
			updatedAt: 1,
		}
		set({
			workspaces: { ...state.workspaces, [workspace.id]: workspace },
			geoEditDrafts: { ...state.geoEditDrafts, [draft.id]: draft },
		})
		return { workspace, draft }
	}
	return { get: () => state, set, add, reveal: createAiMapPreviewRevealer() }
}

describe('first AI-created Map preview', () => {
	test('foreground local presentations claim previews temporarily without changing saved canvas choices', () => {
		const h = harness()
		const first = h.add('first')
		h.add('second', [point('other')])
		h.reveal(h.get(), 'run-1', 'chat-1', 'first', first.draft.id)
		h.reveal(h.get(), 'run-2', 'chat-1', 'second', 'draft-second')
		const before = JSON.stringify({
			entries: h.get().mapStackEntries,
			order: h.get().mapStackOrder,
			drafts: h.get().geoEditDrafts,
		})
		expect(
			deriveAiMapPreviewFeatures(h.get(), new Set(['first'])).map(
				(feature) => feature.properties?.localWorkspaceId,
			),
		).toEqual(['second'])
		expect(
			JSON.stringify({
				entries: h.get().mapStackEntries,
				order: h.get().mapStackOrder,
				drafts: h.get().geoEditDrafts,
			}),
		).toBe(before)
		expect(
			deriveAiMapPreviewFeatures(h.get()).map((feature) => feature.properties?.localWorkspaceId),
		).toEqual(['first', 'second'])
		h.get().setMapStackEntryVisible('ai-result:first', false)
		expect(
			deriveAiMapPreviewFeatures(h.get(), new Set()).map(
				(feature) => feature.properties?.localWorkspaceId,
			),
		).toEqual(['second'])
	})
	test('waits for real geometry, reveals only the first Map of a run, and leaves authoring unchanged', () => {
		const h = harness()
		const { draft } = h.add('first', [
			{ ...point(), geometry: null } as unknown as EditorFeature,
			{ ...point(), geometry: { type: 'LineString', coordinates: [] } },
		])
		h.add('second')
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(false)
		draft.features = [point()]
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(true)
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'second', 'draft-second')).toBe(false)
		expect(h.get().mapStackOrder).toEqual(['ai-result:first'])
		expect(h.get().activeWorkspaceId).toBeNull()
		expect(h.get().activeGeoEditDraftId).toBeNull()
		expect(h.reveal(h.get(), 'run-2', 'chat-1', 'second', 'draft-second')).toBe(true)
	})

	test('validates the owning Thread and exact workspace/revision before consuming a run', () => {
		const h = harness()
		const { draft, workspace } = h.add('first')
		expect(h.reveal(h.get(), 'run-1', 'other-chat', 'first', draft.id)).toBe(false)
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', 'missing')).toBe(false)
		workspace.sourceId = 'other-source'
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(false)
		workspace.sourceId = draft.sourceId
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(true)
		workspace.activeDraftId = 'replacement'
		const entry = h.get().mapStackEntries['ai-result:first']
		if (!entry) throw new Error('Expected a revealed preview')
		expect(resolveAiMapPreviewDraft(h.get(), entry)).toBeNull()
	})

	test('refreshes local style/title and respects Hide, Remove, and Clear without resurrecting a preview', () => {
		const h = harness()
		const { draft } = h.add('first')
		draft.publishChannel = { kind: 'private-group', id: 'private' }
		const first = draft.features[0]
		if (!first) throw new Error('Expected a first feature')
		first.properties = {
			sourceEventId: 'stale-publication',
			datasetId: 'stale-map',
			strokeWidth: 4,
		}
		h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)
		let features = deriveAiMapPreviewFeatures(h.get())
		expect(features).toHaveLength(1)
		expect(features[0]?.properties).toMatchObject({
			color: '#1d4ed8',
			strokeWidth: 4,
			localDraftId: draft.id,
		})
		expect(features[0]?.properties?.sourceEventId).toBeUndefined()
		expect(features[0]?.properties?.datasetId).toBeUndefined()
		expect(draft.features[0]?.properties?.sourceEventId).toBe('stale-publication')
		draft.collectionMeta = { ...draft.collectionMeta, name: 'Renamed', color: '#00ff00' }
		draft.features = [
			...draft.features,
			{ ...point('point-2'), properties: { color: '#ff0000', displayIcon: 'lucide:anchor' } },
		]
		reconcileAiMapPreviews(h.get())
		features = deriveAiMapPreviewFeatures(h.get())
		expect(h.get().mapStackEntries['ai-result:first']?.title).toBe('Renamed')
		expect(features.map((feature) => feature.properties?.color)).toEqual(['#00ff00', '#ff0000'])
		expect(features[1]?.properties?.displayIcon).toBe('lucide:anchor')
		h.get().setMapStackEntryVisible('ai-result:first', false)
		reconcileAiMapPreviews(h.get())
		expect(deriveAiMapPreviewFeatures(h.get())).toEqual([])
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(false)
		h.get().removeMapStackEntry('ai-result:first')
		reconcileAiMapPreviews(h.get())
		expect(h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)).toBe(false)
		expect(h.get().mapStackOrder).toEqual([])
		h.add('second')
		h.reveal(h.get(), 'run-2', 'chat-1', 'second', 'draft-second')
		h.get().clearMapStack()
		reconcileAiMapPreviews(h.get())
		expect(h.reveal(h.get(), 'run-2', 'chat-1', 'second', 'draft-second')).toBe(false)
		expect(h.get().geoEditDrafts[draft.id]).toBe(draft)
	})

	test('obeys canvas isolation and removes the duplicate when its manual editor is opened', () => {
		const h = harness()
		const { draft } = h.add('first')
		h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)
		h.get().addMapStackEntry({
			entityType: 'dataset',
			entityKey: 'other',
			title: 'Other',
			source: 'manual',
			visible: true,
			pinned: false,
			isolated: true,
		})
		expect(deriveAiMapPreviewFeatures(h.get())).toEqual([])
		h.get().clearMapStackIsolation()
		expect(deriveAiMapPreviewFeatures(h.get())).toHaveLength(1)
		h.set({ activeWorkspaceId: 'first', activeGeoEditDraftId: draft.id })
		h.get().addMapStackEntry({
			id: 'draft:active',
			entityType: 'draft',
			entityKey: 'draft:active',
			title: 'New Map',
			source: 'workspace',
			visible: false,
			pinned: false,
		})
		expect(deriveAiMapPreviewFeatures(h.get())).toEqual([])
		reconcileAiMapPreviews(h.get())
		expect(h.get().mapStackEntries['ai-result:first']).toBeUndefined()
		expect(h.get().mapStackEntries['draft:active']?.visible).toBe(false)
	})

	test('cleans up a deleted/replaced local draft without touching retained authoring', () => {
		const h = harness()
		const { draft } = h.add('first')
		h.reveal(h.get(), 'run-1', 'chat-1', 'first', draft.id)
		h.set({ geoEditDrafts: {} })
		expect(deriveAiMapPreviewFeatures(h.get())).toEqual([])
		reconcileAiMapPreviews(h.get())
		expect(h.get().mapStackOrder).toEqual([])
		expect(h.get().workspaces.first).toBeDefined()
	})
})
