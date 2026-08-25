import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore, type GeoCollectionEditDraft } from '@/features/geo-editor/store'
import type { CollectionMeta } from '@/features/geo-editor/types'
import type { ToolExecutionRunIdentity } from '@/features/chat/tools/types'
import {
	attachPendingDiffCommit,
	clearPendingDiffs,
	emitDiffBlock,
	getPendingDiff,
	setPendingDiffRunContext,
	setPendingDiffToolContext,
} from './pendingDiffStore'
import {
	buildPendingDatasetFeatureCommitInput,
	type PendingDatasetCommitInput,
} from './pendingDiffCommit'
import { undoPendingDiff } from './targetBoundUndo'

const initialEditorState = useEditorStore.getState()
const EMPTY_DIFF: DatasetDiff = { added: [], modified: [], deleted: [] }
const BEFORE_META: CollectionMeta = {
	name: 'Before',
	description: 'Before description',
	color: '#123456',
	customProperties: { source: 'human' },
}
const AFTER_META: CollectionMeta = {
	name: 'After',
	description: 'After description',
	color: '#abcdef',
	customProperties: { source: 'ai' },
}

function feature(id: string, name: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties: { name },
	} as EditorFeature
}

function draft(features: EditorFeature[], collectionMeta = AFTER_META): GeoCollectionEditDraft {
	return {
		persistenceVersion: 2,
		id: 'draft-a',
		sourceId: 'session:a',
		name: collectionMeta.name,
		description: collectionMeta.description,
		collectionMeta,
		features,
		selectedFeatureIds: [],
		publishChannel: { kind: 'public' },
		contextRefs: [],
		blobReferences: [],
		createdAt: 1,
		updatedAt: 2,
	}
}

const RUN: ToolExecutionRunIdentity = {
	runId: 91,
	chatId: 'chat-a',
	startedAt: 1,
	target: {
		entityType: 'dataset',
		workspaceId: 'workspace-a',
		draftId: 'draft-a',
		sourceId: 'session:a',
		entityId: null,
		baseRevisionId: null,
		draftUpdatedAt: 1,
		wasDirty: false,
	},
}

function installDraft(value: GeoCollectionEditDraft, visible = false): void {
	useEditorStore.setState({
		geoEditDrafts: { [value.id]: value },
		workspaces: {
			'workspace-a': {
				id: 'workspace-a',
				sourceId: 'session:a',
				label: 'A',
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: 'draft-a',
				chatSessionId: 'chat-a',
				createdAt: 1,
				updatedAt: 2,
			},
		},
		activeGeoEditDraftId: visible ? 'draft-a' : null,
		activeWorkspaceId: visible ? 'workspace-a' : null,
	})
}

function registerCommit(diff: DatasetDiff, commit: PendingDatasetCommitInput): string {
	setPendingDiffRunContext(RUN)
	setPendingDiffToolContext('tool-a')
	const handle = emitDiffBlock(diff, { status: 'applied' })
	expect(
		attachPendingDiffCommit(
			{ runId: 91, chatId: 'chat-a', toolCallId: 'tool-a', target: RUN.target },
			commit,
		),
	).toBe(1)
	return handle.id
}

beforeEach(() => {
	clearPendingDiffs()
	setPendingDiffRunContext(null)
	setPendingDiffToolContext(null)
})

afterEach(() => {
	clearPendingDiffs()
	useEditorStore.setState(initialEditorState, true)
})

describe('target-bound AI Undo', () => {
	test('restores the owning background draft and preserves a later disjoint feature add', () => {
		const base = feature('base', 'Base')
		const ai = feature('ai', 'AI')
		const later = feature('later', 'Later user edit')
		const featureCommit = buildPendingDatasetFeatureCommitInput([base], [base, ai])
		expect(featureCommit).not.toBeNull()
		installDraft(draft([base, ai, later]))
		useEditorStore.setState({ features: [feature('visible', 'Unrelated visible map')] })
		const id = registerCommit(featureCommit?.diff ?? EMPTY_DIFF, {
			target: RUN.target,
			fields: { features: featureCommit ?? undefined },
		})

		expect(undoPendingDiff(id)).toBe('undone')
		expect(
			useEditorStore.getState().geoEditDrafts['draft-a']?.features.map((item) => item.id),
		).toEqual(['base', 'later'])
		expect(useEditorStore.getState().features.map((item) => item.id)).toEqual(['visible'])
		expect(getPendingDiff(id)?.status).toBe('undone')
		expect(getPendingDiff(id)?.commit).toBeUndefined()
	})

	test('refuses a stale same-feature inverse and reports Undo unavailable', () => {
		const base = feature('base', 'Base')
		const ai = feature('ai', 'AI')
		const userChangedAi = feature('ai', 'User changed the AI feature')
		const featureCommit = buildPendingDatasetFeatureCommitInput([base], [base, ai])
		installDraft(draft([base, userChangedAi]))
		const id = registerCommit(featureCommit?.diff ?? EMPTY_DIFF, {
			target: RUN.target,
			fields: { features: featureCommit ?? undefined },
		})

		expect(undoPendingDiff(id)).toBe('undo-unavailable')
		expect(useEditorStore.getState().geoEditDrafts['draft-a']?.features[1]?.properties?.name).toBe(
			'User changed the AI feature',
		)
		expect(getPendingDiff(id)?.status).toBe('undo-unavailable')
	})

	test('CASes metadata while preserving later disjoint geometry and selection', () => {
		const later = feature('later', 'Later')
		const current = draft([later], AFTER_META)
		current.selectedFeatureIds = ['later']
		installDraft(current)
		const id = registerCommit(EMPTY_DIFF, {
			target: RUN.target,
			fields: { collectionMeta: { before: BEFORE_META, after: AFTER_META } },
		})

		expect(undoPendingDiff(id)).toBe('undone')
		const restored = useEditorStore.getState().geoEditDrafts['draft-a']
		expect(restored?.collectionMeta).toEqual(BEFORE_META)
		expect(restored?.name).toBe('Before')
		expect(restored?.features.map((item) => item.id)).toEqual(['later'])
		expect(restored?.selectedFeatureIds).toEqual(['later'])
	})

	test('never writes through to a different visible target', () => {
		const base = feature('base', 'Base')
		const ai = feature('ai', 'AI')
		const featureCommit = buildPendingDatasetFeatureCommitInput([base], [base, ai])
		installDraft(draft([base, ai]))
		useEditorStore.setState({
			activeWorkspaceId: 'workspace-other',
			activeGeoEditDraftId: 'draft-other',
			features: [feature('other', 'Other')],
		})
		const id = registerCommit(featureCommit?.diff ?? EMPTY_DIFF, {
			target: RUN.target,
			fields: { features: featureCommit ?? undefined },
		})

		expect(undoPendingDiff(id)).toBe('undone')
		expect(useEditorStore.getState().features.map((item) => item.id)).toEqual(['other'])
	})
})
