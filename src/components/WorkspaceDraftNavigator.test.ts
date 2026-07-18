import { describe, expect, test } from 'bun:test'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import type { GeoCollectionEditDraft, GeoEditorWorkspace } from '@/features/geo-editor/store'
import { countVisibleLocalDraftWorkspaces } from './WorkspaceDraftNavigator'

const workspace: GeoEditorWorkspace = {
	id: 'workspace-1',
	kind: 'scratch',
	sourceId: 'scratch-1',
	datasetKey: null,
	label: 'Untitled workspace',
	activeDraftId: 'draft-1',
	chatSessionId: null,
	createdAt: 1,
	updatedAt: 1,
}

const blankDraft: GeoCollectionEditDraft = {
	persistenceVersion: 2,
	id: 'draft-1',
	sourceId: 'scratch-1',
	name: '',
	description: '',
	features: [],
	selectedFeatureIds: [],
	collectionMeta: createDefaultCollectionMeta(),
	publishChannel: { kind: 'public' },
	contextRefs: [],
	blobReferences: [],
	createdAt: 1,
	updatedAt: 1,
}

describe('local draft workspace visibility', () => {
	test('does not count an inactive pristine scratch draft that the panel hides', () => {
		expect(
			countVisibleLocalDraftWorkspaces(
				{ [workspace.id]: workspace },
				{ [blankDraft.id]: blankDraft },
				null,
			),
		).toBe(0)
	})

	test('counts the active scratch draft even before the user adds content', () => {
		expect(
			countVisibleLocalDraftWorkspaces(
				{ [workspace.id]: workspace },
				{ [blankDraft.id]: blankDraft },
				workspace.id,
			),
		).toBe(1)
	})

	test('counts a meaningful saved draft after the user exits editing', () => {
		const namedDraft = { ...blankDraft, name: 'Recoverable trail sketch' }
		expect(
			countVisibleLocalDraftWorkspaces(
				{ [workspace.id]: workspace },
				{ [namedDraft.id]: namedDraft },
				null,
			),
		).toBe(1)
	})

	test('keeps attachment-only drafts visible', () => {
		const attachedDraft = {
			...blankDraft,
			contextRefs: ['31990:author:survey'],
			blobReferences: [
				{
					id: 'blob-1',
					scope: 'collection' as const,
					url: 'https://blossom.example/survey.geojson',
					status: 'ready' as const,
				},
			],
		}
		expect(
			countVisibleLocalDraftWorkspaces(
				{ [workspace.id]: workspace },
				{ [attachedDraft.id]: attachedDraft },
				null,
			),
		).toBe(1)
	})
})
