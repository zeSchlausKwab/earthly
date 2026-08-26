import { afterEach, describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { GeoEditor } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import {
	getExecutionEditor,
	prepareToolExecutionRun,
	releaseToolExecutionRun,
} from './executionTarget'
import type { ToolExecutionRunIdentity } from './types'

const initialEditorState = useEditorStore.getState()
const initialWindow = (globalThis as { window?: unknown }).window
const visibleEditorsToDestroy = new Set<GeoEditor>()

function datasetRun(runId: number): ToolExecutionRunIdentity {
	const chatId = `chat-${runId}`
	const sourceId = `scratch:${runId}`
	const draftId = `draft-${runId}`
	const workspaceId = `workspace-${runId}`
	const updatedAt = runId
	useEditorStore.setState({
		geoEditDrafts: {
			[draftId]: {
				persistenceVersion: 2,
				id: draftId,
				sourceId,
				name: '',
				description: '',
				collectionMeta: createDefaultCollectionMeta(),
				features: [],
				selectedFeatureIds: [],
				publishChannel: { kind: 'public' },
				contextRefs: [],
				blobReferences: [],
				createdAt: updatedAt,
				updatedAt,
			},
		},
		workspaces: {
			[workspaceId]: {
				id: workspaceId,
				sourceId,
				label: `Workspace ${runId}`,
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: draftId,
				chatSessionId: chatId,
				createdAt: updatedAt,
				updatedAt,
			},
		},
		activeGeoEditDraftId: null,
		activeWorkspaceId: null,
	})
	return {
		runId,
		chatId,
		startedAt: updatedAt,
		target: {
			entityType: 'dataset',
			draftId,
			entityId: null,
			sourceId,
			baseRevisionId: null,
			draftUpdatedAt: updatedAt,
			wasDirty: false,
			workspaceId,
		},
	}
}

function trackDestroy(editor: GeoEditor): () => number {
	let calls = 0
	const destroy = editor.destroy.bind(editor)
	editor.destroy = () => {
		calls += 1
		destroy()
	}
	return () => calls
}

afterEach(() => {
	releaseToolExecutionRun()
	for (const editor of visibleEditorsToDestroy) editor.destroy()
	visibleEditorsToDestroy.clear()
	useEditorStore.setState(initialEditorState, true)
	if (initialWindow === undefined) {
		delete (globalThis as { window?: unknown }).window
	} else {
		;(globalThis as { window?: unknown }).window = initialWindow
	}
})

describe('detached Dataset execution editor lifecycle', () => {
	test('disables interaction immediately and release destroys only the detached editor once', () => {
		const visibleEditor = createHeadlessEditor()
		visibleEditorsToDestroy.add(visibleEditor)
		const visibleDestroyCalls = trackDestroy(visibleEditor)
		useEditorStore.setState({ editor: visibleEditor })

		const run = datasetRun(401)
		prepareToolExecutionRun(run)
		const detachedEditor = getExecutionEditor()

		expect(detachedEditor).not.toBeNull()
		expect(detachedEditor).not.toBe(visibleEditor)
		expect(detachedEditor?.isInteractionEnabled()).toBe(false)
		const detachedDestroyCalls = trackDestroy(detachedEditor as GeoEditor)

		releaseToolExecutionRun(run.runId)
		releaseToolExecutionRun(run.runId)

		expect(detachedDestroyCalls()).toBe(1)
		expect(visibleDestroyCalls()).toBe(0)
		expect(getExecutionEditor()).toBe(visibleEditor)
	})

	test('replacement destroys the prior runtime without double-destroying either editor', () => {
		const firstRun = datasetRun(402)
		prepareToolExecutionRun(firstRun)
		const firstEditor = getExecutionEditor() as GeoEditor
		const firstDestroyCalls = trackDestroy(firstEditor)

		const secondRun = datasetRun(403)
		prepareToolExecutionRun(secondRun)
		const secondEditor = getExecutionEditor() as GeoEditor
		const secondDestroyCalls = trackDestroy(secondEditor)

		expect(firstDestroyCalls()).toBe(1)
		expect(secondEditor).not.toBe(firstEditor)
		expect(secondEditor.isInteractionEnabled()).toBe(false)

		// Preparing an already-active run and releasing a stale run are no-ops.
		prepareToolExecutionRun(secondRun)
		releaseToolExecutionRun(firstRun.runId)
		expect(secondDestroyCalls()).toBe(0)

		releaseToolExecutionRun(secondRun.runId)
		releaseToolExecutionRun(secondRun.runId)
		expect(firstDestroyCalls()).toBe(1)
		expect(secondDestroyCalls()).toBe(1)
	})
})
