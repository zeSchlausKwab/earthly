import { afterEach, describe, expect, it, setSystemTime } from 'bun:test'
import { registerDatasetDraftEnsurer } from '@/features/geo-editor/authoringTaskBridge'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import {
	resetRunCodeFailureCounterForTests,
	setSandboxTransportForTests,
} from '@/features/chat/sandbox/runCode'
import type { SandboxTransport } from '@/features/chat/sandbox/sandboxHost'
import { executeToolCall } from './execute'
import { attachEditorDatasetMetadata } from './editorDatasetMetadata'
import { prepareMapToolFeaturesForEditor } from './helpers'
import { type ToolEntry, register, registry, unregister } from './registry'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	setPendingDiffRunContext,
	setPendingDiffToolContext,
	subscribePendingDiffs,
} from '@/features/chat/safeEditing/pendingDiffStore'
import {
	createExecutionAuthoring,
	getExecutionEditor,
	releaseToolExecutionRun,
} from './executionTarget'
import type { ToolExecutionRunIdentity } from './types'

const routeResult = {
	feature: {
		type: 'Feature' as const,
		id: 'tour-route',
		properties: { name: 'One-day tour' },
		geometry: {
			type: 'LineString' as const,
			coordinates: [
				[2.35, 48.85],
				[2.29, 48.86],
			],
		},
	},
}

function createActiveDatasetRun(runId: number): {
	draftId: string
	workspaceId: string
	run: ToolExecutionRunIdentity
} {
	const chatId = `chat-${runId}`
	const sourceId = `scratch:${runId}`
	const editor = createHeadlessEditor()
	useEditorStore.setState({
		editor,
		geoEditDrafts: {},
		workspaces: {},
		activeGeoEditDraftId: null,
		activeWorkspaceId: null,
		features: [],
		selectedFeatureIds: [],
	})
	const draftId = useEditorStore.getState().createGeoEditDraft(sourceId, { features: [] })
	const workspaceId = useEditorStore.getState().createWorkspace({
		sourceId,
		label: `Dataset ${runId}`,
		kind: 'scratch',
		activeDraftId: draftId,
		chatSessionId: chatId,
	})
	const draft = useEditorStore.getState().geoEditDrafts[draftId]
	if (!draft) throw new Error('Failed to create the test Dataset draft')
	useEditorStore.setState({
		activeGeoEditDraftId: draftId,
		activeWorkspaceId: workspaceId,
		collectionMeta: draft.collectionMeta,
		features: draft.features,
		selectedFeatureIds: draft.selectedFeatureIds,
	})
	const run: ToolExecutionRunIdentity = {
		runId,
		chatId,
		startedAt: Date.now(),
		target: {
			entityType: 'dataset',
			draftId,
			entityId: null,
			sourceId,
			baseRevisionId: null,
			draftUpdatedAt: draft.updatedAt,
			wasDirty: false,
			workspaceId,
		},
	}
	setPendingDiffRunContext(run)
	return { draftId, workspaceId, run }
}

function pointFeature(id: string, name: string, coordinates: [number, number]) {
	return {
		type: 'Feature' as const,
		id,
		properties: { name },
		geometry: { type: 'Point' as const, coordinates },
	}
}

describe('tool-result geometry authoring lifecycle', () => {
	const productionRouteEntry = registry.get('valhalla_route')
	const productionIsochroneEntry = registry.get('valhalla_isochrone')
	const productionCatalogEntry = registry.get('query_geography')
	const productionWriteEntry = registry.get('write_geojson_to_editor')
	let unregisterEnsurer: (() => void) | null = null

	afterEach(() => {
		setSandboxTransportForTests(undefined)
		resetRunCodeFailureCounterForTests()
		releaseToolExecutionRun()
		clearPendingDiffs()
		setPendingDiffRunContext(null)
		setPendingDiffToolContext(null)
		setSafetyLevelProvider(() => 2)
		setSystemTime()
		unregisterEnsurer?.()
		unregisterEnsurer = null
		useEditorStore.getState().setEditor(null)
		if (productionRouteEntry) register(productionRouteEntry)
		if (productionIsochroneEntry) register(productionIsochroneEntry)
		if (productionCatalogEntry) register(productionCatalogEntry)
		unregister('delete_bound_target_fixture')
		unregister('partial_write_then_fail_fixture')
		unregister('selection_after_feature_delete_fixture')
		unregister('seed_story_conflict_dataset_fixture')
		unregister('selected_feature_persistence_fixture')
		unregister('write_story_draft_conflict_fixture')
		unregister('read_story_draft_conflict_fixture')
	})

	it('keeps a Dataset write bound to its captured draft after visible navigation', async () => {
		const targetEditor = createHeadlessEditor()
		useEditorStore.setState({
			editor: targetEditor,
			geoEditDrafts: {},
			workspaces: {},
			activeGeoEditDraftId: null,
			activeWorkspaceId: null,
			features: [],
			selectedFeatureIds: [],
		})
		const targetDraftId = useEditorStore.getState().createGeoEditDraft('scratch:target', {
			features: [],
		})
		const targetWorkspaceId = useEditorStore.getState().createWorkspace({
			sourceId: 'scratch:target',
			label: 'Target',
			kind: 'scratch',
			activeDraftId: targetDraftId,
			chatSessionId: 'chat-target',
		})
		const targetDraft = useEditorStore.getState().geoEditDrafts[targetDraftId]
		const run: ToolExecutionRunIdentity = {
			runId: 99,
			chatId: 'chat-target',
			startedAt: Date.now(),
			target: {
				entityType: 'dataset',
				draftId: targetDraftId,
				entityId: null,
				sourceId: 'scratch:target',
				baseRevisionId: null,
				draftUpdatedAt: targetDraft?.updatedAt ?? null,
				wasDirty: false,
				workspaceId: targetWorkspaceId,
			},
		}

		const otherFeature = {
			type: 'Feature' as const,
			id: 'other-visible-feature',
			properties: { name: 'Other' },
			geometry: { type: 'Point' as const, coordinates: [10, 20] },
		}
		const otherDraftId = useEditorStore.getState().createGeoEditDraft('scratch:other', {
			features: [otherFeature],
		})
		const otherWorkspaceId = useEditorStore.getState().createWorkspace({
			sourceId: 'scratch:other',
			label: 'Other',
			kind: 'scratch',
			activeDraftId: otherDraftId,
			chatSessionId: 'chat-other',
		})
		const visibleEditor = createHeadlessEditor()
		visibleEditor.setFeatures([otherFeature])
		useEditorStore.setState({
			editor: visibleEditor,
			activeGeoEditDraftId: otherDraftId,
			activeWorkspaceId: otherWorkspaceId,
			features: [otherFeature],
		})

		register({
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => routeResult,
		})

		const snapshotResult = await executeToolCall(
			{
				id: 'background-snapshot',
				type: 'function',
				function: { name: 'capture_map_snapshot', arguments: '{}' },
			},
			{ run },
		)
		expect(JSON.parse(snapshotResult.content).code).toBe('capture_target_not_visible')
		const editorStateResult = await executeToolCall(
			{
				id: 'background-editor-state',
				type: 'function',
				function: { name: 'get_editor_state', arguments: '{}' },
			},
			{ run },
		)
		const editorStateError = JSON.parse(editorStateResult.content)
		expect(editorStateError.code).toBe('editor_state_target_not_visible')
		expect(editorStateResult.content).not.toContain('other-visible-feature')
		const metadataResult = await executeToolCall(
			{
				id: 'background-metadata',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({
						name: 'Background target',
						description: 'Still bound while another Dataset is visible',
					}),
				},
			},
			{ run },
		)
		expect(JSON.parse(metadataResult.content).ok).toBe(true)
		expect(useEditorStore.getState().geoEditDrafts[targetDraftId]?.name).toBe('Background target')
		expect(useEditorStore.getState().geoEditDrafts[targetDraftId]?.description).toBe(
			'Still bound while another Dataset is visible',
		)
		expect(useEditorStore.getState().geoEditDrafts[otherDraftId]?.name).not.toBe(
			'Background target',
		)

		const result = await executeToolCall(
			{
				id: 'background-route',
				type: 'function',
				function: { name: 'valhalla_route', arguments: '{"toEditor":true}' },
			},
			{ run },
		)

		expect(JSON.parse(result.content).editorImport.importedCount).toBe(1)
		const state = useEditorStore.getState()
		expect(state.activeWorkspaceId).toBe(otherWorkspaceId)
		expect(state.activeGeoEditDraftId).toBe(otherDraftId)
		expect(visibleEditor.getAllFeatures().map((feature) => feature.id)).toEqual([
			'other-visible-feature',
		])
		expect(state.geoEditDrafts[targetDraftId]?.features.map((feature) => feature.id)).toEqual([
			'tour-route',
		])
	})

	it('returns target-unavailable when a mutated detached draft is deleted before persistence', async () => {
		useEditorStore.setState({
			editor: createHeadlessEditor(),
			geoEditDrafts: {},
			workspaces: {},
			activeGeoEditDraftId: null,
			activeWorkspaceId: null,
			features: [],
			selectedFeatureIds: [],
		})
		const draftId = useEditorStore.getState().createGeoEditDraft('scratch:deleted', {
			features: [],
		})
		const workspaceId = useEditorStore.getState().createWorkspace({
			sourceId: 'scratch:deleted',
			label: 'Deleted target',
			kind: 'scratch',
			activeDraftId: draftId,
		})
		const draft = useEditorStore.getState().geoEditDrafts[draftId]
		const run: ToolExecutionRunIdentity = {
			runId: 101,
			chatId: 'chat-deleted',
			startedAt: Date.now(),
			target: {
				entityType: 'dataset',
				draftId,
				entityId: null,
				sourceId: 'scratch:deleted',
				baseRevisionId: null,
				draftUpdatedAt: draft?.updatedAt ?? null,
				wasDirty: false,
				workspaceId,
			},
		}
		register({
			name: 'delete_bound_target_fixture',
			kind: 'authoring-primitive',
			schema: {
				type: 'function',
				function: {
					name: 'delete_bound_target_fixture',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				const editor = getExecutionEditor()
				if (!editor) throw new Error('missing fixture editor')
				createExecutionAuthoring(editor).addFeature({
					type: 'Feature',
					id: 'lost-edit',
					geometry: { type: 'Point', coordinates: [1, 2] },
					properties: {},
				})
				useEditorStore.getState().deleteGeoEditDraft(draftId)
				return { ok: true }
			},
		})

		const result = await executeToolCall(
			{
				id: 'deleted-target-call',
				type: 'function',
				function: { name: 'delete_bound_target_fixture', arguments: '{}' },
			},
			{ run },
		)

		expect(JSON.parse(result.content).code).toBe('dataset_target_unavailable')
		expect(useEditorStore.getState().geoEditDrafts[draftId]).toBeUndefined()
	})

	it('rolls back a handler partial write and starts the next same-run correction clean', async () => {
		if (!productionWriteEntry) throw new Error('Expected the production geometry writer')
		setSafetyLevelProvider(() => 3)
		const { draftId, run } = createActiveDatasetRun(105)
		register({
			name: 'partial_write_then_fail_fixture',
			kind: 'authoring-primitive',
			schema: {
				type: 'function',
				function: {
					name: 'partial_write_then_fail_fixture',
					description: 'Apply through the real gate, then report a handler failure.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: async (args, context) => {
				await productionWriteEntry.handler(args, context)
				throw new Error('fixture failed after detached mutation')
			},
		})

		const failedCall = {
			id: 'partial-write-failure',
			type: 'function' as const,
			function: {
				name: 'partial_write_then_fail_fixture',
				arguments: JSON.stringify({
					geojson: {
						type: 'FeatureCollection',
						features: [pointFeature('must-rollback', 'Partial', [1, 2])],
					},
				}),
			},
		}
		setPendingDiffToolContext(failedCall.id)
		const failedResult = await executeToolCall(failedCall, { run })
		setPendingDiffToolContext(null)

		expect(JSON.parse(failedResult.content).code).toBe('tool_handler_error')
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.features).toEqual([])
		expect(getExecutionEditor()?.getAllFeatures()).toEqual([])
		expect(getAllPendingDiffs().find((entry) => entry.toolCallId === failedCall.id)?.status).toBe(
			'failed',
		)

		const correctionCall = {
			id: 'partial-write-correction',
			type: 'function' as const,
			function: {
				name: 'write_geojson_to_editor',
				arguments: JSON.stringify({
					geojson: {
						type: 'FeatureCollection',
						features: [pointFeature('corrected', 'Corrected', [3, 4])],
					},
				}),
			},
		}
		setPendingDiffToolContext(correctionCall.id)
		const correctionResult = await executeToolCall(correctionCall, { run })
		setPendingDiffToolContext(null)

		expect(JSON.parse(correctionResult.content).importedCount).toBe(1)
		expect(
			useEditorStore.getState().geoEditDrafts[draftId]?.features.map((feature) => feature.id),
		).toEqual(['corrected'])
	})

	it('ignores editor-only feature state after a Story error without writing on a later Story read', async () => {
		setSystemTime(new Date('2026-08-23T03:32:56.000Z'))
		const { draftId, run } = createActiveDatasetRun(111)
		register({
			name: 'seed_story_conflict_dataset_fixture',
			kind: 'authoring-primitive',
			schema: {
				type: 'function',
				function: {
					name: 'seed_story_conflict_dataset_fixture',
					description: 'Persist one authored feature before the Story tools run.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				const editor = getExecutionEditor()
				if (!editor) throw new Error('Expected the detached Dataset editor')
				createExecutionAuthoring(editor).addFeature({
					type: 'Feature',
					id: 'authored-before-story',
					geometry: { type: 'Point', coordinates: [12, 34] },
					properties: {
						name: 'Preserved feature',
						status: 'verified',
						customProperties: { active: 'user-defined', nestedActive: true },
					},
				})
				return { ok: true }
			},
		})
		register({
			name: 'write_story_draft_conflict_fixture',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'write_story_draft_conflict_fixture',
					description: 'Model the existing-Story overwrite guard.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				throw new Error('Read the existing Story draft before replacing it.')
			},
		})
		let storyReads = 0
		register({
			name: 'read_story_draft_conflict_fixture',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'read_story_draft_conflict_fixture',
					description: 'A read-only Story operation.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				storyReads += 1
				return { ok: true, exists: true }
			},
		})

		const seedResult = await executeToolCall(
			{
				id: 'seed-before-story-tools',
				type: 'function',
				function: { name: 'seed_story_conflict_dataset_fixture', arguments: '{}' },
			},
			{ run },
		)
		expect(JSON.parse(seedResult.content).ok).toBe(true)

		const afterAuthoring = useEditorStore.getState().geoEditDrafts[draftId]
		if (!afterAuthoring) throw new Error('Expected the authored Dataset draft')
		const authoredProperties = afterAuthoring.features[0]?.properties
		expect(authoredProperties?.active).toBeUndefined()
		expect(authoredProperties).toMatchObject({
			name: 'Preserved feature',
			status: 'verified',
			customProperties: { active: 'user-defined', nestedActive: true },
		})

		// The visible editor's selection projection can echo the exact durable
		// feature with an editor-only active flag. This is not a user-authored edit.
		setSystemTime(new Date('2026-08-23T03:35:20.000Z'))
		useEditorStore.getState().saveGeoEditDraft(draftId, {
			features: afterAuthoring.features.map((feature) => ({
				...feature,
				properties: { ...feature.properties, active: false },
			})),
		})

		const failedStoryWrite = await executeToolCall(
			{
				id: 'guarded-story-write',
				type: 'function',
				function: { name: 'write_story_draft_conflict_fixture', arguments: '{}' },
			},
			{ run },
		)
		expect(JSON.parse(failedStoryWrite.content).code).toBe('tool_handler_error')

		const beforeStoryRead = useEditorStore.getState().geoEditDrafts[draftId]
		if (!beforeStoryRead) throw new Error('Expected the Dataset draft before the Story read')
		setSystemTime(new Date('2026-08-23T03:35:38.000Z'))
		const storyRead = await executeToolCall(
			{
				id: 'read-after-guarded-story-write',
				type: 'function',
				function: { name: 'read_story_draft_conflict_fixture', arguments: '{}' },
			},
			{ run },
		)

		const storyReadPayload = JSON.parse(storyRead.content)
		expect(storyReadPayload.code).not.toBe('dataset_target_conflict')
		expect(storyReadPayload.ok).toBe(true)
		expect(storyReads).toBe(1)
		// A read-only Story tool must not flush the detached Dataset runtime.
		expect(useEditorStore.getState().geoEditDrafts[draftId]).toBe(beforeStoryRead)
	})

	it('keeps selection presentation state out of an authored feature commit', async () => {
		const { draftId, run } = createActiveDatasetRun(112)
		register({
			name: 'selected_feature_persistence_fixture',
			kind: 'authoring-primitive',
			schema: {
				type: 'function',
				function: {
					name: 'selected_feature_persistence_fixture',
					description: 'Add and select one feature in the detached editor.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				const editor = getExecutionEditor()
				if (!editor) throw new Error('Expected the detached Dataset editor')
				createExecutionAuthoring(editor).addFeature({
					type: 'Feature',
					id: 'selected-authored-feature',
					geometry: { type: 'Point', coordinates: [56, 78] },
					properties: {
						name: 'Selected feature',
						status: 'preserve-me',
						customProperties: { active: 'user-defined' },
					},
				})
				editor.selectFeatures(['selected-authored-feature'])
				return { ok: true }
			},
		})

		const result = await executeToolCall(
			{
				id: 'author-and-select-feature',
				type: 'function',
				function: { name: 'selected_feature_persistence_fixture', arguments: '{}' },
			},
			{ run },
		)

		expect(JSON.parse(result.content).ok).toBe(true)
		const draft = useEditorStore.getState().geoEditDrafts[draftId]
		expect(draft?.selectedFeatureIds).toEqual(['selected-authored-feature'])
		expect(draft?.features[0]?.properties).toMatchObject({
			name: 'Selected feature',
			status: 'preserve-me',
			customProperties: { active: 'user-defined' },
		})
		expect(draft?.features[0]?.properties?.active).toBeUndefined()
	})

	it('does not treat a passive metadata-surface echo between same-run tools as a user conflict', async () => {
		setSystemTime(new Date('2026-08-21T06:34:20.000Z'))
		setSafetyLevelProvider(() => 3)
		const { draftId, run } = createActiveDatasetRun(102)

		const metadataResult = await executeToolCall(
			{
				id: 'same-run-metadata',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({ name: 'The Ocean Has a Memory' }),
				},
			},
			{ run },
		)
		expect(JSON.parse(metadataResult.content).ok).toBe(true)

		// The controlled metadata surface passively mirrors the just-applied value
		// after it rerenders. This is an idempotent programmatic echo, not a user edit,
		// but the draft store currently advances updatedAt for it.
		const afterMetadata = useEditorStore.getState().geoEditDrafts[draftId]
		if (!afterMetadata) throw new Error('Expected the run-bound draft after metadata persistence')
		setSystemTime(new Date('2026-08-21T06:34:21.000Z'))
		useEditorStore.getState().saveGeoEditDraft(draftId, {
			collectionMeta: { ...afterMetadata.collectionMeta },
		})
		const afterPassiveEcho = useEditorStore.getState().geoEditDrafts[draftId]
		if (!afterPassiveEcho) throw new Error('Expected the run-bound draft after its passive echo')
		expect(afterPassiveEcho.collectionMeta).toEqual(afterMetadata.collectionMeta)
		expect(afterPassiveEcho.updatedAt).toBeGreaterThan(afterMetadata.updatedAt)

		const geometryResult = await executeToolCall(
			{
				id: 'same-run-geometry',
				type: 'function',
				function: {
					name: 'write_geojson_to_editor',
					arguments: JSON.stringify({
						geojson: {
							type: 'FeatureCollection',
							features: [pointFeature('same-run-point', 'Example', [-145, 58])],
						},
					}),
				},
			},
			{ run },
		)

		const geometryPayload = JSON.parse(geometryResult.content)
		expect(geometryPayload.code).not.toBe('dataset_target_conflict')
		expect(geometryPayload.importedCount).toBe(1)
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.features).toHaveLength(1)
	})

	it('compares custom metadata properties canonically instead of by key insertion order', async () => {
		const { draftId, run } = createActiveDatasetRun(108)
		const firstResult = await executeToolCall(
			{
				id: 'canonical-metadata-first',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({
						name: 'Canonical metadata',
						properties: { zeta: 'last', alpha: 'first' },
					}),
				},
			},
			{ run },
		)
		expect(JSON.parse(firstResult.content).ok).toBe(true)

		const draft = useEditorStore.getState().geoEditDrafts[draftId]
		if (!draft) throw new Error('Expected the metadata draft')
		useEditorStore.getState().saveGeoEditDraft(draftId, {
			collectionMeta: {
				...draft.collectionMeta,
				customProperties: { alpha: 'first', zeta: 'last' },
			},
		})
		const secondResult = await executeToolCall(
			{
				id: 'canonical-metadata-second',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({ description: 'Key order is not a content edit.' }),
				},
			},
			{ run },
		)

		const payload = JSON.parse(secondResult.content)
		expect(payload.code).toBeUndefined()
		expect(payload.ok).toBe(true)
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.description).toBe(
			'Key order is not a content edit.',
		)
	})

	it('rejects an AI selection if the selected feature was concurrently deleted', async () => {
		const { draftId, run } = createActiveDatasetRun(109)
		const selected = pointFeature('selection-target', 'Selection target', [5, 6])
		useEditorStore.getState().saveGeoEditDraft(draftId, {
			features: [selected],
			selectedFeatureIds: [],
		})
		useEditorStore.getState().editor?.setFeatures([selected])
		useEditorStore.setState({ features: [selected], selectedFeatureIds: [] })
		register({
			name: 'selection_after_feature_delete_fixture',
			kind: 'authoring-primitive',
			schema: {
				type: 'function',
				function: {
					name: 'selection_after_feature_delete_fixture',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				const editor = getExecutionEditor()
				if (!editor) throw new Error('Expected the detached selection editor')
				editor.selectFeatures([selected.id])
				useEditorStore.getState().saveGeoEditDraft(draftId, {
					features: [],
					selectedFeatureIds: [],
				})
				return { selected: 1 }
			},
		})

		const result = await executeToolCall(
			{
				id: 'selection-after-delete',
				type: 'function',
				function: { name: 'selection_after_feature_delete_fixture', arguments: '{}' },
			},
			{ run },
		)

		expect(JSON.parse(result.content).code).toBe('dataset_target_conflict')
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.features).toEqual([])
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.selectedFeatureIds).toEqual([])
	})

	it('rejects a real same-field user edit and marks the optimistic diff as not applied', async () => {
		setSafetyLevelProvider(() => 3)
		const { draftId, run } = createActiveDatasetRun(103)
		const userFeature = pointFeature('user-point', 'User edit', [-123, 49])
		const toolCall = {
			id: 'same-field-geometry',
			type: 'function' as const,
			function: {
				name: 'write_geojson_to_editor',
				arguments: JSON.stringify({
					geojson: {
						type: 'FeatureCollection',
						features: [pointFeature('ai-point', 'AI edit', [-145, 58])],
					},
				}),
			},
		}
		let injectedUserEdit = false
		const unsubscribe = subscribePendingDiffs(() => {
			if (injectedUserEdit) return
			if (!getAllPendingDiffs().some((entry) => entry.toolCallId === toolCall.id)) return
			injectedUserEdit = true
			// This is the same store path used by a visible editor geometry event.
			useEditorStore.getState().setFeatures([userFeature])
		})
		setPendingDiffToolContext(toolCall.id)

		let result: Awaited<ReturnType<typeof executeToolCall>>
		try {
			result = await executeToolCall(toolCall, { run })
		} finally {
			unsubscribe()
			setPendingDiffToolContext(null)
		}

		const payload = JSON.parse(result.content)
		expect(injectedUserEdit).toBe(true)
		expect(payload.code).toBe('dataset_target_conflict')
		expect(payload.sideEffectsApplied).toBe(false)
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.features).toEqual([userFeature])
		expect(getAllPendingDiffs().find((entry) => entry.toolCallId === toolCall.id)?.status).toBe(
			'failed',
		)

		const laterResult = await executeToolCall(
			{
				id: 'same-field-later-call',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({ name: 'Must not reuse rejected state' }),
				},
			},
			{ run },
		)
		expect(JSON.parse(laterResult.content).code).toBe('dataset_target_unavailable')
	})

	it('merges a geometry tool with a concurrent user metadata edit', async () => {
		setSafetyLevelProvider(() => 3)
		const { draftId, run } = createActiveDatasetRun(104)
		const metadataResult = await executeToolCall(
			{
				id: 'disjoint-metadata',
				type: 'function',
				function: {
					name: 'set_dataset_metadata',
					arguments: JSON.stringify({ name: 'AI title' }),
				},
			},
			{ run },
		)
		expect(JSON.parse(metadataResult.content).ok).toBe(true)

		useEditorStore.getState().setCollectionMeta({
			...useEditorStore.getState().collectionMeta,
			name: 'User title',
		})
		const geometryResult = await executeToolCall(
			{
				id: 'disjoint-geometry',
				type: 'function',
				function: {
					name: 'write_geojson_to_editor',
					arguments: JSON.stringify({
						geojson: {
							type: 'FeatureCollection',
							features: [pointFeature('merged-point', 'Merged geometry', [-150, 55])],
						},
					}),
				},
			},
			{ run },
		)

		const payload = JSON.parse(geometryResult.content)
		expect(payload.code).toBeUndefined()
		expect(payload.importedCount).toBe(1)
		const mergedDraft = useEditorStore.getState().geoEditDrafts[draftId]
		expect(mergedDraft?.collectionMeta.name).toBe('User title')
		expect(mergedDraft?.features.map((feature) => feature.id)).toEqual(['merged-point'])
	})

	it('fails closed when a late toEditor result resumes after its run was released', async () => {
		const { draftId, run } = createActiveDatasetRun(106)
		let resolveRoute!: (result: typeof routeResult) => void
		let signalStarted: (() => void) | null = null
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve
		})
		register({
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'deferred fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () =>
				new Promise<typeof routeResult>((resolve) => {
					resolveRoute = resolve
					signalStarted?.()
				}),
		})

		const pendingResult = executeToolCall(
			{
				id: 'late-route-result',
				type: 'function',
				function: { name: 'valhalla_route', arguments: '{"toEditor":true}' },
			},
			{ run },
		)
		await started
		releaseToolExecutionRun(run.runId)
		resolveRoute(routeResult)

		const result = await pendingResult
		expect(JSON.parse(result.content).code).toBe('dataset_target_unavailable')
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.features).toEqual([])
		expect(useEditorStore.getState().features).toEqual([])
	})

	it('does not replay a late run_code mutation into the visible editor after Stop releases its run', async () => {
		const { draftId, run } = createActiveDatasetRun(110)
		let resolveSandbox!: (response: Awaited<ReturnType<SandboxTransport>>) => void
		let signalStarted: (() => void) | null = null
		const started = new Promise<void>((resolve) => {
			signalStarted = resolve
		})
		const deferredTransport: SandboxTransport = () =>
			new Promise((resolve) => {
				resolveSandbox = resolve
				signalStarted?.()
			})
		setSandboxTransportForTests(deferredTransport)

		const pendingResult = executeToolCall(
			{
				id: 'late-run-code-metadata',
				type: 'function',
				function: { name: 'run_code', arguments: JSON.stringify({ code: 'ignored' }) },
			},
			{ run },
		)
		await started
		releaseToolExecutionRun(run.runId)
		resolveSandbox({
			id: 'late-run-code-result',
			success: true,
			recordedCalls: [{ op: 'setDatasetMetadata', args: [{ name: 'Must not leak after Stop' }] }],
			consoleLines: [],
			truncated: false,
			returnValue: null,
		})

		const result = await pendingResult
		expect(JSON.parse(result.content).code).toBe('dataset_target_unavailable')
		expect(useEditorStore.getState().collectionMeta.name).not.toBe('Must not leak after Stop')
		expect(useEditorStore.getState().geoEditDrafts[draftId]?.collectionMeta.name).not.toBe(
			'Must not leak after Stop',
		)
	})

	it('keeps a successful durable result when the visible editor mirror throws', async () => {
		const { draftId, run } = createActiveDatasetRun(107)
		register({
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => routeResult,
		})
		const visibleEditor = useEditorStore.getState().editor
		if (!visibleEditor) throw new Error('Expected the visible test editor')
		const originalSetFeatures = visibleEditor.setFeatures.bind(visibleEditor)
		visibleEditor.setFeatures = () => {
			throw new Error('fixture mirror failure')
		}

		let result: Awaited<ReturnType<typeof executeToolCall>>
		try {
			result = await executeToolCall(
				{
					id: 'mirror-failure-route',
					type: 'function',
					function: { name: 'valhalla_route', arguments: '{"toEditor":true}' },
				},
				{ run },
			)
		} finally {
			visibleEditor.setFeatures = originalSetFeatures
		}

		const payload = JSON.parse(result.content)
		expect(payload.code).toBeUndefined()
		expect(payload.editorImport.importedCount).toBe(1)
		expect(
			useEditorStore.getState().geoEditDrafts[draftId]?.features.map((feature) => feature.id),
		).toEqual(['tour-route'])
		expect(useEditorStore.getState().features.map((feature) => feature.id)).toEqual(['tour-route'])
	})

	it('fails an unbound authoring request before any editor is mutated', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		const run: ToolExecutionRunIdentity = {
			runId: 100,
			chatId: 'chat-only',
			startedAt: Date.now(),
			target: {
				entityType: null,
				draftId: null,
				entityId: null,
				sourceId: null,
				baseRevisionId: null,
				draftUpdatedAt: null,
				wasDirty: false,
				workspaceId: null,
			},
		}
		const snapshot = await executeToolCall(
			{
				id: 'unbound-snapshot',
				type: 'function',
				function: { name: 'capture_map_snapshot', arguments: '{}' },
			},
			{ run },
		)
		expect(JSON.parse(snapshot.content).code).toBe('capture_target_required')
		const editorState = await executeToolCall(
			{
				id: 'unbound-editor-state',
				type: 'function',
				function: { name: 'get_editor_state', arguments: '{}' },
			},
			{ run },
		)
		expect(JSON.parse(editorState.content).code).toBe('editor_state_target_required')
		const result = await executeToolCall(
			{
				id: 'unbound-write',
				type: 'function',
				function: { name: 'valhalla_route', arguments: '{"toEditor":true}' },
			},
			{ run },
		)

		expect(JSON.parse(result.content).code).toBe('dataset_target_required')
		expect(editor.getAllFeatures()).toEqual([])
	})

	it('establishes a recoverable authoring target before a toEditor tool result mutates geometry', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		let authoringTargetReady = false
		unregisterEnsurer = registerDatasetDraftEnsurer(() => {
			authoringTargetReady = true
			return 'draft:active'
		})

		const fixtureEntry: ToolEntry = {
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'Return fixture route geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => routeResult,
		}
		register(fixtureEntry)

		const result = await executeToolCall({
			id: 'route-call',
			type: 'function',
			function: {
				name: 'valhalla_route',
				arguments: JSON.stringify({ toEditor: true }),
			},
		})

		expect(authoringTargetReady).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(JSON.parse(result.content).editorImport.importedCount).toBe(1)
	})

	it('imports the exact GeoCatalog result once and preserves its stable id and provenance', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		unregisterEnsurer = registerDatasetDraftEnsurer(() => 'draft:active')
		let queryCount = 0
		register({
			name: 'query_geography',
			kind: 'remote-mcp',
			schema: productionCatalogEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'query_geography',
					description: 'Return fixture catalog geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				queryCount += 1
				return attachEditorDatasetMetadata(
					{
						items: [{ id: 'overture:place:gers-123', name: 'Rasuwa' }],
						features: [
							{
								type: 'Feature',
								id: 'overture:place:gers-123',
								properties: {
									name: 'Rasuwa',
									catalogId: 'overture:place:gers-123',
									source: { name: 'Overture Maps', release: '2026-08-19.0' },
								},
								geometry: { type: 'Point', coordinates: [85.15, 28.15] },
							},
						],
					},
					{
						properties: {
							'earthly:geoCatalogSourceManifest:fixture': JSON.stringify({
								schemaVersion: 1,
								snapshotId: 'fixture',
								sources: [{ name: 'Overture Maps', release: '2026-08-19.0' }],
							}),
						},
					},
				)
			},
		})

		const result = await executeToolCall({
			id: 'catalog-call',
			type: 'function',
			function: {
				name: 'query_geography',
				arguments: JSON.stringify({ text: 'Rasuwa', toEditor: true }),
			},
		})
		const parsed = JSON.parse(result.content)
		const [imported] = editor.getAllFeatures()

		expect(queryCount).toBe(1)
		expect(imported?.id).toBe('overture:place:gers-123')
		expect(imported?.properties?.source).toEqual({
			name: 'Overture Maps',
			release: '2026-08-19.0',
		})
		expect(parsed.features).toBeUndefined()
		expect(parsed.items).toEqual([{ id: 'overture:place:gers-123', name: 'Rasuwa' }])
		expect(parsed.editorImport.importedCount).toBe(1)
		const persistedManifest = JSON.parse(
			String(
				useEditorStore.getState().collectionMeta.customProperties[
					'earthly:geoCatalogSourceManifest:fixture'
				],
			),
		) as { snapshotId?: string }
		expect(persistedManifest.snapshotId).toBe('fixture')
	})

	it('treats a deferred GeoCatalog selection or no-match as a successful non-mutation', async () => {
		const existing = pointFeature('keep-me', 'Existing', [1, 2])
		const editor = createHeadlessEditor()
		editor.setFeatures([existing])
		useEditorStore.getState().setEditor(editor)
		let authoringTargetEnsured = false
		unregisterEnsurer = registerDatasetDraftEnsurer(() => {
			authoringTargetEnsured = true
			return 'draft:active'
		})
		register({
			name: 'query_geography',
			kind: 'remote-mcp',
			schema: productionCatalogEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'query_geography',
					description: 'Return a fixture no-match.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => ({
				items: [],
				metadata: {
					coverage: { zeroResultReason: 'no_match_within_snapshot' },
				},
				editorImport: {
					available: false,
					selectionRequired: false,
					noMatch: true,
				},
			}),
		})

		const result = await executeToolCall({
			id: 'catalog-no-match',
			type: 'function',
			function: {
				name: 'query_geography',
				arguments: JSON.stringify({
					text: 'Missing River',
					toEditor: true,
					replaceExisting: true,
				}),
			},
		})
		const parsed = JSON.parse(result.content)

		expect(parsed.code).toBeUndefined()
		expect(parsed.toEditor).toBe(true)
		expect(parsed.editorImport).toMatchObject({ available: false, noMatch: true })
		expect(authoringTargetEnsured).toBe(false)
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['keep-me'])
	})

	it('does not replace editor contents when a catalog response has missing geometry', async () => {
		if (!productionCatalogEntry) throw new Error('Expected the production catalog tool')
		const existing = pointFeature('keep-me', 'Existing', [1, 2])
		const editor = createHeadlessEditor()
		editor.setFeatures([existing])
		useEditorStore.getState().setEditor(editor)
		unregisterEnsurer = registerDatasetDraftEnsurer(() => 'draft:active')
		register(productionCatalogEntry)
		const originalCall = EarthlyGeoServerClient.prototype.callRemoteTool
		EarthlyGeoServerClient.prototype.callRemoteTool = async <T = unknown>() =>
			({
				result: {
					items: [
						{
							id: 'overture:place:complete',
							kind: 'place',
							name: 'Complete',
							properties: {},
							source: { name: 'Overture Maps', release: '2026-08-19.0' },
							geometry: { type: 'Point', coordinates: [85, 28] },
						},
						{
							id: 'overture:place:missing',
							kind: 'place',
							name: 'Missing',
							properties: {},
							source: { name: 'Overture Maps', release: '2026-08-19.0' },
						},
					],
					metadata: {
						snapshot: {
							id: 'fixture',
							createdAt: '2026-08-28T00:00:00Z',
							schemaVersion: 1,
							sources: [{ name: 'Overture Maps', release: '2026-08-19.0', license: 'ODbL-1.0' }],
						},
						query: { returned: 2, limit: 20, hasMore: false },
					},
				},
			}) as T

		try {
			const result = await executeToolCall({
				id: 'catalog-partial-call',
				type: 'function',
				function: {
					name: 'query_geography',
					arguments: JSON.stringify({
						ids: ['overture:place:complete', 'overture:place:missing'],
						toEditor: true,
						replaceExisting: true,
					}),
				},
			})

			expect(JSON.parse(result.content).code).toBe('tool_handler_error')
			expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['keep-me'])
		} finally {
			EarthlyGeoServerClient.prototype.callRemoteTool = originalCall
		}
	})

	it('imports isochrones as quiet cool-blue background overlays', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		unregisterEnsurer = registerDatasetDraftEnsurer(() => 'draft:active')

		const fixtureEntry: ToolEntry = {
			name: 'valhalla_isochrone',
			kind: 'remote-mcp',
			schema: productionIsochroneEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_isochrone',
					description: 'Return fixture isochrone geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => ({
				feature: {
					type: 'Feature',
					id: 'cycle-catchment',
					properties: { name: '20-minute bicycle catchment', fillColor: '#facc15' },
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[-8.7, 41.1],
								[-8.5, 41.1],
								[-8.5, 41.2],
								[-8.7, 41.1],
							],
						],
					},
				},
			}),
		}
		register(fixtureEntry)

		await executeToolCall({
			id: 'isochrone-call',
			type: 'function',
			function: {
				name: 'valhalla_isochrone',
				arguments: JSON.stringify({ toEditor: true }),
			},
		})

		expect(editor.getAllFeatures()[0]?.properties).toMatchObject({
			fillColor: '#38bdf8',
			fillOpacity: 0.1,
			strokeColor: '#0284c7',
			strokeOpacity: 0.6,
			strokeWidth: 2,
		})
	})
})

describe('OSM point import styling', () => {
	it('assigns semantic icons and distinct fallback colors to common POI categories', () => {
		const features = prepareMapToolFeaturesForEditor('query_osm_nearby', [
			{
				type: 'Feature',
				properties: { leisure: 'park' },
				geometry: { type: 'Point', coordinates: [-8.64, 41.16] },
			},
			{
				type: 'Feature',
				properties: { tags: { shop: 'supermarket' } },
				geometry: { type: 'Point', coordinates: [-8.63, 41.16] },
			},
			{
				type: 'Feature',
				properties: { railway: 'station' },
				geometry: { type: 'Point', coordinates: [-8.62, 41.16] },
			},
		])

		expect(features.map((feature) => feature.properties?.displayIcon)).toEqual([
			'lucide:trees',
			'lucide:store',
			'lucide:train-front',
		])
		expect(new Set(features.map((feature) => feature.properties?.color)).size).toBe(3)
	})

	it('preserves an explicit icon and color supplied by the model', () => {
		const [feature] = prepareMapToolFeaturesForEditor('query_osm_bbox', [
			{
				type: 'Feature',
				properties: {
					shop: 'supermarket',
					displayIcon: 'lucide:star',
					color: '#be123c',
				},
				geometry: { type: 'Point', coordinates: [-8.63, 41.16] },
			},
		])

		expect(feature?.properties).toMatchObject({
			displayIcon: 'lucide:star',
			color: '#be123c',
		})
	})
})

describe('tool redirect execution', () => {
	it('follows one structured redirect without spending another model round', async () => {
		register({
			name: 'test_redirect_source',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'test_redirect_source',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => ({
				ok: false,
				kind: 'tool_redirect',
				toolName: 'test_redirect_source',
				message: 'Use structured reader',
				redirectTool: 'test_redirect_target',
				redirectArguments: { title: 'Rome' },
			}),
		})
		register({
			name: 'test_redirect_target',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'test_redirect_target',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: (args) => ({ ok: true, title: args.title }),
		})
		try {
			const result = await executeToolCall({
				id: 'redirect-call',
				type: 'function',
				function: { name: 'test_redirect_source', arguments: '{}' },
			})
			expect(JSON.parse(result.content)).toEqual({ ok: true, title: 'Rome' })
		} finally {
			unregister('test_redirect_source')
			unregister('test_redirect_target')
		}
	})
})
