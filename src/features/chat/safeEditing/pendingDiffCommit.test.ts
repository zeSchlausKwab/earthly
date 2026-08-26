import { describe, expect, test } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core'
import type { GeoCollectionEditDraft } from '@/features/geo-editor/store'
import type { CollectionMeta } from '@/features/geo-editor/types'
import type { ToolExecutionTarget } from '@/features/chat/tools/types'
import {
	buildAttachedPendingDatasetCommit,
	buildPendingDatasetFeatureCommitInput,
	planPendingDatasetUndo,
} from './pendingDiffCommit'

const META: CollectionMeta = {
	name: 'Map',
	description: '',
	color: '#000000',
	customProperties: {},
}
const TARGET: ToolExecutionTarget = {
	entityType: 'dataset',
	workspaceId: 'workspace',
	draftId: 'draft',
	sourceId: 'session:a',
	entityId: null,
	baseRevisionId: null,
	draftUpdatedAt: 1,
	wasDirty: false,
}

function feature(id: string, name = id): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties: { name },
	} as EditorFeature
}

function draft(features: EditorFeature[]): GeoCollectionEditDraft {
	return {
		persistenceVersion: 2,
		id: 'draft',
		sourceId: 'session:a',
		name: META.name,
		description: META.description,
		collectionMeta: META,
		features,
		selectedFeatureIds: [],
		publishChannel: { kind: 'public' },
		contextRefs: [],
		blobReferences: [],
		createdAt: 1,
		updatedAt: 2,
	}
}

describe('bounded pending Dataset commit', () => {
	test('inverts add/modify/delete while retaining a later disjoint feature', () => {
		const before = [feature('a', 'Before'), feature('b'), feature('c')]
		const after = [feature('a', 'After'), feature('c'), feature('d')]
		const featureInput = buildPendingDatasetFeatureCommitInput(before, after)
		expect(featureInput).not.toBeNull()
		const attached = buildAttachedPendingDatasetCommit(
			{ target: TARGET, fields: { features: featureInput ?? undefined } },
			featureInput?.diff ?? { added: [], modified: [], deleted: [] },
		)
		expect(attached).not.toBeNull()
		if (!attached || !featureInput) throw new Error('Expected a bounded commit')

		const plan = planPendingDatasetUndo(
			attached,
			featureInput.diff,
			draft([...after, feature('later')]),
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.updates.features?.map((item) => `${item.id}:${item.properties?.name}`)).toEqual([
			'a:Before',
			'b:b',
			'c:c',
			'later:later',
		])
	})

	test('rejects survivor reorder and changes beyond the bounded feature limit', () => {
		const a = feature('a')
		const b = feature('b')
		expect(buildPendingDatasetFeatureCommitInput([a, b], [b, a])).toBeNull()

		const many = Array.from({ length: 501 }, (_, index) => feature(`f-${index}`))
		expect(buildPendingDatasetFeatureCommitInput([], many)).toBeNull()
	})
})
