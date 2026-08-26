import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { castEvent } from 'applesauce-core/casts'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
	useEditorStore,
	type GeoCollectionEditDraft,
	type GeoEditorWorkspace,
} from '@/features/geo-editor/store'
import type { ToolExecutionRunIdentity, ToolExecutionTarget } from '@/features/chat/tools/types'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import {
	cancelReferencePublish,
	clearReferencePublishRequests,
	confirmReferencePublish,
	getReferencePublishRequest,
	setReferencePublishingChatContext,
	setReferencePublishingToolContext,
} from './requestStore'
import { captureTargetDatasetPublication, gateStoryDatasetReferences } from './storyReferenceGate'
import { reconcilePublishedDatasetIdentity } from './publishCapturedDataset'
import type { PublishedDatasetReference } from './types'

const originalState = useEditorStore.getState()

function makeDataset(identifier = 'bridges') {
	const event = finalizeEvent(
		{
			kind: GEO_EVENT_KIND,
			created_at: 100,
			tags: [['d', identifier]],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: 'Published bridges',
				features: [
					{
						type: 'Feature',
						id: 'bridge-1',
						geometry: { type: 'Point', coordinates: [16.37, 48.2] },
						properties: { name: 'Old bridge' },
					},
				],
			}),
		},
		generateSecretKey(),
	)
	eventStore.add(event)
	return castEvent(event, GeoDataset, eventStore)
}

function installDraft({
	base = makeDataset(),
	channel = { kind: 'public' } as const,
	chatId = 'chat-a',
}: {
	base?: GeoDataset | null
	channel?: GeoCollectionEditDraft['publishChannel']
	chatId?: string | null
} = {}) {
	const sourceId = base ? `dataset:${base.pubkey}:${base.dTag}` : 'session:new-dataset'
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: 'draft-a',
		sourceId,
		name: 'Bridge survey',
		description: '',
		collectionMeta: {
			name: 'Bridge survey',
			description: 'Updated crossings',
			color: '#334455',
			customProperties: {},
		},
		features: [
			{
				type: 'Feature',
				id: 'bridge-1',
				geometry: { type: 'Point', coordinates: [16.38, 48.21] },
				properties: { name: 'Updated bridge', meta: 'feature', sourceEventId: 'old' },
			},
		],
		selectedFeatureIds: [],
		publishChannel: channel,
		contextRefs: [],
		blobReferences: [],
		createdAt: 10,
		updatedAt: 20,
	}
	const workspace: GeoEditorWorkspace = {
		id: 'workspace-a',
		sourceId,
		label: 'Bridge survey',
		kind: base ? 'dataset' : 'scratch',
		datasetKey: base ? `${base.pubkey}:${base.dTag}` : null,
		activeDraftId: draft.id,
		chatSessionId: chatId,
		createdAt: 10,
		updatedAt: 20,
	}
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: draft },
		activeGeoEditDraftId: draft.id,
		workspaces: { [workspace.id]: workspace },
		activeWorkspaceId: workspace.id,
		activeDataset: base,
		features: draft.features,
		collectionMeta: draft.collectionMeta,
		activeDatasetContextRefs: [],
		blobReferences: [],
		isDirty: true,
	})
	const target: ToolExecutionTarget = {
		entityType: 'dataset',
		workspaceId: workspace.id,
		draftId: draft.id,
		sourceId: draft.sourceId,
		entityId: base ? `${base.pubkey}:${base.dTag}` : draft.sourceId,
		baseRevisionId: base?.event.id ?? null,
		draftUpdatedAt: draft.updatedAt,
		wasDirty: true,
	}
	const run: ToolExecutionRunIdentity = {
		runId: 1,
		chatId: 'chat-a',
		target,
		startedAt: 1,
	}
	return { draft, workspace, base, target, run }
}

beforeEach(() => {
	clearReferencePublishRequests()
	setReferencePublishingChatContext('chat-a')
	setReferencePublishingToolContext('tool-a')
})

afterAll(() => {
	clearReferencePublishRequests()
	useEditorStore.setState(originalState, true)
})

describe('Story Dataset reference publication gate', () => {
	test('captures the exact draft and base revision when prose cites the dirty Dataset', () => {
		const { draft, base, target } = installDraft()
		if (!base) throw new Error('expected base')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')

		const capture = captureTargetDatasetPublication({
			markdown: `See ${mention}#bridge-1.`,
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target,
		})
		expect(capture.kind).toBe('captured')
		if (capture.kind !== 'captured') return
		expect(capture.captured.binding).toMatchObject({
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			workspaceId: 'workspace-a',
			draftId: 'draft-a',
			sourceId: draft.sourceId,
			draftUpdatedAt: 20,
			baseRevisionId: base.event.id,
		})
		expect(capture.captured.featureCollection.features[0]).toMatchObject({
			id: 'bridge-1',
			properties: { name: 'Updated bridge' },
		})

		// Later navigation/editor writes cannot mutate the captured payload.
		useEditorStore.getState().setFeatures([])
		expect(capture.captured.featureCollection.features).toHaveLength(1)
	})

	test('does not retarget when the user navigates to another edit state before the tool executes', () => {
		const { draft, workspace, base, target } = installDraft()
		if (!base) throw new Error('expected base')
		const firstFeature = draft.features[0]
		if (!firstFeature) throw new Error('expected draft feature')
		const otherDraft: GeoCollectionEditDraft = {
			...draft,
			id: 'draft-other',
			sourceId: 'session:other',
			name: 'Other Dataset',
			collectionMeta: { ...draft.collectionMeta, name: 'Other Dataset' },
			features: [{ ...firstFeature, id: 'other-feature' }],
			updatedAt: 99,
		}
		const otherWorkspace: GeoEditorWorkspace = {
			...workspace,
			id: 'workspace-other',
			sourceId: otherDraft.sourceId,
			label: 'Other Dataset',
			kind: 'scratch',
			datasetKey: null,
			activeDraftId: otherDraft.id,
			updatedAt: 99,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [otherDraft.id]: otherDraft },
			workspaces: { [workspace.id]: workspace, [otherWorkspace.id]: otherWorkspace },
			activeGeoEditDraftId: otherDraft.id,
			activeWorkspaceId: otherWorkspace.id,
			activeDataset: null,
			features: otherDraft.features,
			collectionMeta: otherDraft.collectionMeta,
			isDirty: false,
		})
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')

		const capture = captureTargetDatasetPublication({
			markdown: `See ${mention}.`,
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target,
		})
		expect(capture.kind).toBe('captured')
		if (capture.kind !== 'captured') return
		expect(capture.captured.binding).toMatchObject({
			workspaceId: 'workspace-a',
			draftId: 'draft-a',
			baseRevisionId: base.event.id,
		})
		expect(capture.captured.title).toBe('Bridge survey')
		expect(capture.captured.featureIds).toEqual(['bridge-1'])
	})

	test('does not gate an unrelated published Dataset reference', () => {
		const { target } = installDraft()
		const other = makeDataset('railways')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${other.pubkey}:${other.dTag}`)
		if (!mention) throw new Error('expected mention')
		expect(
			captureTargetDatasetPublication({
				markdown: `See ${mention}.`,
				chatId: 'chat-a',
				toolCallId: 'tool-a',
				target,
			}),
		).toEqual({ kind: 'none' })
	})

	test('allows unrelated prose without inspecting a private working Dataset', () => {
		const { target } = installDraft({ channel: { kind: 'private-group', id: 'group-a' } })
		expect(
			captureTargetDatasetPublication({
				markdown: 'This Story does not cite the working Dataset.',
				chatId: 'chat-a',
				toolCallId: 'tool-a',
				target,
			}),
		).toEqual({ kind: 'none' })
	})

	test('fails closed when a cited run-bound Dataset draft disappeared', () => {
		const { base, target } = installDraft()
		if (!base) throw new Error('expected base')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')
		useEditorStore.setState({ geoEditDrafts: {}, workspaces: {} })

		expect(
			captureTargetDatasetPublication({
				markdown: `See ${mention}.`,
				chatId: 'chat-a',
				toolCallId: 'tool-a',
				target,
			}),
		).toMatchObject({
			kind: 'blocked',
			result: { code: 'reference_publish_source_unavailable', retryable: true },
		})
	})

	test('publishes a referenceable new Dataset even when its dirty flag was missed', () => {
		const { target } = installDraft({ base: null })
		const result = captureTargetDatasetPublication({
			markdown: 'A new survey Dataset.',
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target: { ...target, wasDirty: false },
			referencesNewDataset: true,
		})
		expect(result.kind).toBe('captured')
	})

	test('does not corrupt a workspace when another sibling draft becomes active during publish', () => {
		const { draft, workspace, target } = installDraft({ base: null })
		const capture = captureTargetDatasetPublication({
			markdown: 'A new survey Dataset.',
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target,
			referencesNewDataset: true,
		})
		expect(capture.kind).toBe('captured')
		if (capture.kind !== 'captured') return

		const sibling = {
			...draft,
			id: 'draft-sibling',
			name: 'Work continued while publishing',
			updatedAt: draft.updatedAt + 1,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [sibling.id]: sibling },
			workspaces: {
				[workspace.id]: { ...workspace, activeDraftId: sibling.id },
			},
			activeGeoEditDraftId: sibling.id,
		})

		reconcilePublishedDatasetIdentity(capture.captured, makeDataset('published-sibling-race'))

		const state = useEditorStore.getState()
		expect(state.workspaces[workspace.id]?.sourceId).toBe(workspace.sourceId)
		expect(state.workspaces[workspace.id]?.activeDraftId).toBe(sibling.id)
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(workspace.sourceId)
		expect(state.geoEditDrafts[sibling.id]?.sourceId).toBe(workspace.sourceId)
	})

	test('keeps inactive sibling drafts reachable when the published draft gets a new address', () => {
		const { draft, workspace, target } = installDraft({ base: null })
		const sibling = {
			...draft,
			id: 'draft-sibling',
			name: 'Alternate local revision',
			collectionMeta: { ...draft.collectionMeta, name: 'Alternate local revision' },
			updatedAt: draft.updatedAt + 1,
		}
		useEditorStore.setState({
			geoEditDrafts: { [draft.id]: draft, [sibling.id]: sibling },
		})
		const capture = captureTargetDatasetPublication({
			markdown: 'A new survey Dataset.',
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target,
			referencesNewDataset: true,
		})
		expect(capture.kind).toBe('captured')
		if (capture.kind !== 'captured') return
		const published = makeDataset('published-with-sibling')

		reconcilePublishedDatasetIdentity(capture.captured, published)

		const state = useEditorStore.getState()
		const publishedSourceId = `dataset:${published.pubkey}:${published.dTag}`
		expect(state.workspaces[workspace.id]).toMatchObject({
			sourceId: publishedSourceId,
			activeDraftId: draft.id,
		})
		expect(state.geoEditDrafts[draft.id]?.sourceId).toBe(publishedSourceId)
		const recoveryWorkspace = Object.values(state.workspaces).find(
			(candidate) => candidate.id !== workspace.id && candidate.sourceId === workspace.sourceId,
		)
		expect(recoveryWorkspace).toMatchObject({
			activeDraftId: sibling.id,
			label: 'Alternate local revision',
		})
		expect(state.geoEditDrafts[sibling.id]?.sourceId).toBe(workspace.sourceId)
	})

	test('fails closed when the run target base revision belongs to another Dataset', () => {
		const { base, target } = installDraft()
		if (!base) throw new Error('expected base')
		const other = makeDataset('wrong-base')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')

		const result = captureTargetDatasetPublication({
			markdown: `See ${mention}.`,
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target: { ...target, baseRevisionId: other.event.id },
		})

		expect(result).toMatchObject({
			kind: 'blocked',
			result: { code: 'reference_publish_source_unavailable', retryable: true },
		})
	})

	test('rejects a private draft instead of silently republishing it publicly', () => {
		const { base, target } = installDraft({ channel: { kind: 'private-group', id: 'group-a' } })
		if (!base) throw new Error('expected base')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')
		const result = captureTargetDatasetPublication({
			markdown: `See ${mention}.`,
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			target,
		})
		expect(result).toMatchObject({
			kind: 'blocked',
			result: { code: 'reference_publish_scope_incompatible', retryable: false },
		})
	})

	test('new address: publishes captured draft, returns a fresh mention, and asks the model to retry', async () => {
		const { run } = installDraft({ base: null })
		const datasetCoordinate = `37515:${'a'.repeat(64)}:fresh`
		const datasetMention = coordinateToNaddrReference(datasetCoordinate)
		if (!datasetMention) throw new Error('expected fresh mention')
		const published: PublishedDatasetReference = {
			mode: 'new',
			datasetCoordinate,
			datasetMention,
			featureIds: ['bridge-1'],
			addressChanged: true,
			eventId: 'published-event',
		}
		const resultPromise = gateStoryDatasetReferences('A tour of our new bridge.', {
			run,
			referencesActiveDataset: true,
			publishDataset: async (captured) => {
				expect(captured.binding.draftId).toBe('draft-a')
				return published
			},
		})
		await Promise.resolve()
		const request = getReferencePublishRequest()
		expect(request).toMatchObject({ draftId: 'draft-a', status: 'awaiting-confirmation' })
		if (!request) throw new Error('expected request')
		await confirmReferencePublish(request.id)

		await expect(resultPromise).resolves.toMatchObject({
			status: 'retry',
			code: 'dataset_reference_published_with_new_address',
			published: { datasetMention },
		})

		const state = useEditorStore.getState()
		const draft = state.geoEditDrafts['draft-a']
		const workspace = state.workspaces['workspace-a']
		if (!draft || !workspace) throw new Error('expected bound edit state')
		const datasetKey = `${'a'.repeat(64)}:fresh`
		const sourceId = `dataset:${datasetKey}`
		useEditorStore.setState({
			geoEditDrafts: { ...state.geoEditDrafts, [draft.id]: { ...draft, sourceId } },
			workspaces: {
				...state.workspaces,
				[workspace.id]: { ...workspace, sourceId, kind: 'dataset', datasetKey },
			},
		})
		await expect(
			gateStoryDatasetReferences(`See ${datasetMention}.`, {
				run,
				referencesActiveDataset: true,
			}),
		).resolves.toEqual({ status: 'ready', published, resumedAfterPublication: true })
		expect(getReferencePublishRequest()).toBeNull()
	})

	test('same address: resumes the blocked operation after successful update publication', async () => {
		const { base, run } = installDraft()
		if (!base) throw new Error('expected base')
		const coordinate = `${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`
		const mention = coordinateToNaddrReference(coordinate)
		if (!mention) throw new Error('expected mention')
		const published: PublishedDatasetReference = {
			mode: 'update',
			datasetCoordinate: coordinate,
			datasetMention: mention,
			featureIds: ['bridge-1'],
			addressChanged: false,
			eventId: 'updated-event',
		}
		const resultPromise = gateStoryDatasetReferences(`See ${mention}.`, {
			run,
			publishDataset: async () => published,
		})
		await Promise.resolve()
		const request = getReferencePublishRequest()
		if (!request) throw new Error('expected request')
		await confirmReferencePublish(request.id)
		await expect(resultPromise).resolves.toEqual({ status: 'ready', published })
	})

	test('Cancel refuses the reference and releases the tool without publishing', async () => {
		const { base, run } = installDraft()
		if (!base) throw new Error('expected base')
		const mention = coordinateToNaddrReference(`${GEO_EVENT_KIND}:${base.pubkey}:${base.dTag}`)
		if (!mention) throw new Error('expected mention')
		let publishCalls = 0
		const resultPromise = gateStoryDatasetReferences(`See ${mention}.`, {
			run,
			publishDataset: async () => {
				publishCalls += 1
				throw new Error('should not publish')
			},
		})
		await Promise.resolve()
		const request = getReferencePublishRequest()
		if (!request) throw new Error('expected request')
		cancelReferencePublish(request.id)
		await expect(resultPromise).resolves.toMatchObject({
			status: 'blocked',
			code: 'reference_publish_cancelled',
		})
		expect(publishCalls).toBe(0)
	})
})
