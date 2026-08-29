import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { castEvent } from 'applesauce-core/casts'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { useEditorStore, type GeoCollectionEditDraft, type GeoEditorWorkspace } from './store'
import {
	captureActiveDatasetPublicationBinding,
	reconcilePublishedDatasetIdentity,
} from './publicationIdentity'

const originalState = useEditorStore.getState()

function makeDataset(
	identifier: string,
	secretKey: Uint8Array = generateSecretKey(),
	createdAt = 100,
): GeoDataset {
	const event = finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: createdAt,
			tags: [['d', identifier]],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: 'Published survey',
				features: [
					{
						type: 'Feature',
						id: 'site-1',
						geometry: { type: 'Point', coordinates: [16.37, 48.2] },
						properties: { name: 'Survey site' },
					},
				],
			}),
		},
		secretKey,
	)
	eventStore.add(event)
	return castEvent(event, GeoDataset, eventStore)
}

function installScratchWorkspace() {
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: 'draft-a',
		sourceId: 'session:survey',
		name: 'Survey',
		description: '',
		collectionMeta: {
			name: 'Survey',
			description: '',
			color: '#334455',
			customProperties: {},
		},
		features: [
			{
				type: 'Feature',
				id: 'site-1',
				geometry: { type: 'Point', coordinates: [16.37, 48.2] },
				properties: { name: 'Survey site' },
			},
		],
		selectedFeatureIds: [],
		publishChannel: { kind: 'public' },
		contextRefs: [],
		blobReferences: [],
		createdAt: 10,
		updatedAt: 20,
	}
	const workspace: GeoEditorWorkspace = {
		id: 'workspace-a',
		sourceId: draft.sourceId,
		label: 'Survey',
		kind: 'scratch',
		datasetKey: null,
		baseRevisionId: null,
		activeDraftId: draft.id,
		chatSessionId: 'chat-a',
		createdAt: 10,
		updatedAt: 20,
	}
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: draft },
		activeGeoEditDraftId: draft.id,
		workspaces: { [workspace.id]: workspace },
		activeWorkspaceId: workspace.id,
		features: draft.features,
		collectionMeta: draft.collectionMeta,
		activeDataset: null,
		isDirty: true,
	})
	return { draft, workspace }
}

beforeEach(() => {
	useEditorStore.setState(originalState, true)
})

afterAll(() => {
	useEditorStore.setState(originalState, true)
})

describe('published Dataset identity continuity', () => {
	test('promotes the retained workspace and draft without changing their binding ids', () => {
		const { draft, workspace } = installScratchWorkspace()
		const binding = captureActiveDatasetPublicationBinding()
		expect(binding).toEqual({
			workspaceId: workspace.id,
			draftId: draft.id,
			sourceId: draft.sourceId,
			draftUpdatedAt: draft.updatedAt,
		})

		const published = makeDataset('published-survey')
		const result = reconcilePublishedDatasetIdentity(binding, published, 'Published survey')

		const state = useEditorStore.getState()
		const datasetKey = `${published.pubkey}:${published.dTag}`
		expect(result).toEqual({
			status: 'reconciled',
			stillDisplayed: true,
			draftWasUnchanged: true,
		})
		expect(state.activeWorkspaceId).toBe(workspace.id)
		expect(state.activeGeoEditDraftId).toBe(draft.id)
		expect(state.workspaces[workspace.id]).toMatchObject({
			id: workspace.id,
			sourceId: `dataset:${datasetKey}`,
			kind: 'dataset',
			datasetKey,
			baseRevisionId: published.event.id,
			activeDraftId: draft.id,
			chatSessionId: 'chat-a',
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(`dataset:${datasetKey}`)
		expect(state.activeDataset).toBe(published)
		expect(state.isDirty).toBe(false)
	})

	test('keeps edits made while publication is pending dirty on the promoted draft', () => {
		installScratchWorkspace()
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')
		useEditorStore.getState().setFeatures([
			{
				type: 'Feature',
				id: 'site-2',
				geometry: { type: 'Point', coordinates: [16.4, 48.25] },
				properties: { name: 'Late edit' },
			},
		])

		const result = reconcilePublishedDatasetIdentity(
			binding,
			makeDataset('published-with-late-edit'),
			'Published survey',
		)

		expect(result).toMatchObject({ status: 'reconciled', draftWasUnchanged: false })
		expect(useEditorStore.getState().isDirty).toBe(true)
	})

	test('promotes the captured task without disturbing a workspace opened during publication', () => {
		const { draft, workspace } = installScratchWorkspace()
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')

		const otherDataset = makeDataset('other-dataset')
		const otherDraft: GeoCollectionEditDraft = {
			...draft,
			id: 'draft-other',
			sourceId: `dataset:${otherDataset.pubkey}:${otherDataset.dTag}`,
			name: 'Other dataset',
			updatedAt: 30,
		}
		const otherWorkspace: GeoEditorWorkspace = {
			...workspace,
			id: 'workspace-other',
			sourceId: otherDraft.sourceId,
			label: 'Other dataset',
			kind: 'dataset',
			datasetKey: `${otherDataset.pubkey}:${otherDataset.dTag}`,
			baseRevisionId: otherDataset.event.id,
			activeDraftId: otherDraft.id,
			chatSessionId: 'chat-other',
			updatedAt: 30,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [otherDraft.id]: otherDraft },
			activeGeoEditDraftId: otherDraft.id,
			workspaces: { [workspace.id]: workspace, [otherWorkspace.id]: otherWorkspace },
			activeWorkspaceId: otherWorkspace.id,
			features: otherDraft.features,
			collectionMeta: otherDraft.collectionMeta,
			activeDataset: otherDataset,
			isDirty: true,
		})

		const published = makeDataset('published-after-navigation')
		const result = reconcilePublishedDatasetIdentity(binding, published, 'Published survey')

		const state = useEditorStore.getState()
		const publishedKey = `${published.pubkey}:${published.dTag}`
		expect(result).toEqual({
			status: 'reconciled',
			stillDisplayed: false,
			draftWasUnchanged: true,
		})
		expect(state.workspaces[workspace.id]).toMatchObject({
			sourceId: `dataset:${publishedKey}`,
			datasetKey: publishedKey,
			activeDraftId: draft.id,
			chatSessionId: 'chat-a',
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(`dataset:${publishedKey}`)
		expect(state.activeWorkspaceId).toBe(otherWorkspace.id)
		expect(state.activeGeoEditDraftId).toBe(otherDraft.id)
		expect(state.activeDataset).toBe(otherDataset)
		expect(state.isDirty).toBe(true)
	})

	test('updates the published base revision without changing local or chat identities', () => {
		const { draft, workspace } = installScratchWorkspace()
		const secretKey = generateSecretKey()
		const base = makeDataset('stable-address', secretKey, 100)
		const datasetKey = `${base.pubkey}:${base.dTag}`
		const sourceId = `dataset:${datasetKey}`
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: { ...draft, sourceId } },
			workspaces: {
				[workspace.id]: {
					...workspace,
					sourceId,
					kind: 'dataset',
					datasetKey,
					baseRevisionId: base.event.id,
				},
			},
			activeDataset: base,
		})
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')

		const updated = makeDataset('stable-address', secretKey, 101)
		const result = reconcilePublishedDatasetIdentity(binding, updated, 'Updated survey')

		const state = useEditorStore.getState()
		expect(updated.event.id).not.toBe(base.event.id)
		expect(result).toEqual({
			status: 'reconciled',
			stillDisplayed: true,
			draftWasUnchanged: true,
		})
		expect(state.activeWorkspaceId).toBe(workspace.id)
		expect(state.activeGeoEditDraftId).toBe(draft.id)
		expect(state.workspaces[workspace.id]).toMatchObject({
			id: workspace.id,
			sourceId,
			datasetKey,
			baseRevisionId: updated.event.id,
			activeDraftId: draft.id,
			chatSessionId: 'chat-a',
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(sourceId)
		expect(state.activeDataset).toBe(updated)
		expect(state.isDirty).toBe(false)
	})

	test('keeps an active sibling visible and dirty when an update advances the same address', () => {
		const { draft, workspace } = installScratchWorkspace()
		const secretKey = generateSecretKey()
		const base = makeDataset('stable-address-with-sibling', secretKey, 100)
		const datasetKey = `${base.pubkey}:${base.dTag}`
		const sourceId = `dataset:${datasetKey}`
		const datasetDraft: GeoCollectionEditDraft = { ...draft, sourceId }
		const datasetWorkspace: GeoEditorWorkspace = {
			...workspace,
			sourceId,
			kind: 'dataset',
			datasetKey,
			baseRevisionId: base.event.id,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: datasetDraft },
			workspaces: { [workspace.id]: datasetWorkspace },
			activeDataset: base,
		})
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')

		const sibling: GeoCollectionEditDraft = {
			...datasetDraft,
			id: 'draft-sibling',
			name: 'Continued sibling work',
			features: [
				{
					type: 'Feature',
					id: 'sibling-site',
					geometry: { type: 'Point', coordinates: [16.5, 48.3] },
					properties: { name: 'Sibling work must remain visible' },
				},
			],
			updatedAt: 21,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: datasetDraft, [sibling.id]: sibling },
			activeGeoEditDraftId: sibling.id,
			workspaces: {
				[workspace.id]: { ...datasetWorkspace, activeDraftId: sibling.id },
			},
			features: sibling.features,
			collectionMeta: sibling.collectionMeta,
			isDirty: true,
		})

		const updated = makeDataset('stable-address-with-sibling', secretKey, 101)
		const result = reconcilePublishedDatasetIdentity(binding, updated, 'Updated survey')

		const state = useEditorStore.getState()
		expect(result).toEqual({
			status: 'reconciled',
			stillDisplayed: false,
			draftWasUnchanged: true,
		})
		expect(Object.keys(state.workspaces)).toEqual([workspace.id])
		expect(state.workspaces[workspace.id]).toMatchObject({
			id: workspace.id,
			sourceId,
			datasetKey,
			baseRevisionId: updated.event.id,
			activeDraftId: sibling.id,
			chatSessionId: 'chat-a',
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(sourceId)
		expect(state.geoEditDrafts[sibling.id]?.sourceId).toBe(sourceId)
		expect(state.activeWorkspaceId).toBe(workspace.id)
		expect(state.activeGeoEditDraftId).toBe(sibling.id)
		expect(state.features).toBe(sibling.features)
		expect(state.activeDataset).toBe(updated)
		expect(state.isDirty).toBe(true)
	})

	test('keeps a newly activated sibling visible while the captured task follows its publication', () => {
		const { draft, workspace } = installScratchWorkspace()
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')
		const sibling: GeoCollectionEditDraft = {
			...draft,
			id: 'draft-sibling',
			name: 'Continued work',
			updatedAt: 21,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [sibling.id]: sibling },
			activeGeoEditDraftId: sibling.id,
			workspaces: {
				[workspace.id]: { ...workspace, activeDraftId: sibling.id },
			},
		})

		const published = makeDataset('published-with-active-sibling')
		const result = reconcilePublishedDatasetIdentity(binding, published, 'Published survey')

		const state = useEditorStore.getState()
		const datasetKey = `${published.pubkey}:${published.dTag}`
		const recoveryWorkspace = Object.values(state.workspaces).find(
			(candidate) => candidate.id !== workspace.id && candidate.sourceId === draft.sourceId,
		)
		if (!recoveryWorkspace) throw new Error('expected a recovery workspace')
		expect(result).toEqual({
			status: 'reconciled',
			stillDisplayed: false,
			draftWasUnchanged: true,
		})
		expect(state.workspaces[workspace.id]).toMatchObject({
			sourceId: `dataset:${datasetKey}`,
			activeDraftId: draft.id,
			chatSessionId: 'chat-a',
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(`dataset:${datasetKey}`)
		expect(recoveryWorkspace).toMatchObject({
			sourceId: draft.sourceId,
			activeDraftId: sibling.id,
			chatSessionId: null,
		})
		expect(state.activeWorkspaceId).toBe(recoveryWorkspace.id)
		expect(state.activeGeoEditDraftId).toBe(sibling.id)
		expect(state.features).toBe(sibling.features)
		expect(state.activeDataset).toBeNull()
		expect(state.isDirty).toBe(true)
	})

	test('fails closed when the captured task was rebound during publication', () => {
		const { draft, workspace } = installScratchWorkspace()
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')
		useEditorStore.setState({
			geoEditDrafts: {
				[draft.id]: { ...draft, sourceId: 'session:replacement' },
			},
			workspaces: {
				[workspace.id]: { ...workspace, sourceId: 'session:replacement' },
			},
		})

		const result = reconcilePublishedDatasetIdentity(
			binding,
			makeDataset('must-not-retarget'),
			'Published survey',
		)

		expect(result).toEqual({ status: 'stale-binding' })
		expect(useEditorStore.getState().workspaces[workspace.id]?.sourceId).toBe('session:replacement')
		expect(useEditorStore.getState().geoEditDrafts[draft.id]?.sourceId).toBe('session:replacement')
	})

	test('keeps inactive sibling revisions reachable under their original local source', () => {
		const { draft, workspace } = installScratchWorkspace()
		const sibling: GeoCollectionEditDraft = {
			...draft,
			id: 'draft-sibling',
			name: 'Alternate revision',
			collectionMeta: { ...draft.collectionMeta, name: 'Alternate revision' },
			updatedAt: 21,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [sibling.id]: sibling },
		})
		const binding = captureActiveDatasetPublicationBinding()
		if (!binding) throw new Error('expected a publication binding')

		const published = makeDataset('published-with-sibling')
		reconcilePublishedDatasetIdentity(binding, published, 'Published survey')

		const state = useEditorStore.getState()
		const recoveryWorkspace = Object.values(state.workspaces).find(
			(candidate) => candidate.id !== workspace.id && candidate.sourceId === draft.sourceId,
		)
		expect(recoveryWorkspace).toMatchObject({
			activeDraftId: sibling.id,
			label: 'Alternate revision',
		})
		expect(state.geoEditDrafts[sibling.id]?.sourceId).toBe(draft.sourceId)
	})
})
