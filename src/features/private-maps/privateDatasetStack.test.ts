import { describe, expect, test } from 'bun:test'
import type { MapStackEntry } from '@/features/geo-editor/store'
import {
	planPrivateDatasetStackReconciliation,
	privateDatasetStackEntryId,
} from './privateDatasetStack'

const workspaceId = 'group-1'
const dataset = { datasetKey: 'author:dataset-1', title: 'Trail plan' }
const entryId = privateDatasetStackEntryId(workspaceId, dataset.datasetKey)

function entry(overrides: Partial<MapStackEntry> = {}): MapStackEntry {
	return {
		id: entryId,
		entityType: 'dataset',
		entityKey: dataset.datasetKey,
		title: dataset.title,
		source: 'private-group',
		visible: false,
		pinned: true,
		isolated: false,
		exclusions: [],
		addedAt: 1,
		...overrides,
	}
}

describe('private dataset Map Stack reconciliation', () => {
	test('auto-adds a newly discovered encrypted dataset', () => {
		const plan = planPrivateDatasetStackReconciliation({
			workspaceId,
			datasets: [dataset],
			entries: {},
			order: [],
			dismissedIds: new Set(),
		})

		expect(plan.upsert.map((item) => item.id)).toEqual([entryId])
		expect(plan.remove).toEqual([])
	})

	test('does not resurrect an explicitly removed dataset', () => {
		const plan = planPrivateDatasetStackReconciliation({
			workspaceId,
			datasets: [dataset],
			entries: {},
			order: [],
			dismissedIds: new Set([entryId]),
		})

		expect(plan.upsert).toEqual([])
	})

	test('retains an existing hidden and pinned entry without rewriting it', () => {
		const existing = entry()
		const plan = planPrivateDatasetStackReconciliation({
			workspaceId,
			datasets: [dataset],
			entries: { [entryId]: existing },
			order: [entryId],
			dismissedIds: new Set(),
		})

		expect(plan.upsert).toEqual([])
		expect(existing.visible).toBe(false)
		expect(existing.pinned).toBe(true)
	})

	test('removes private entries when their encrypted scope is no longer active', () => {
		const plan = planPrivateDatasetStackReconciliation({
			datasets: [],
			entries: { [entryId]: entry() },
			order: [entryId],
			dismissedIds: new Set(),
		})

		expect(plan.remove).toEqual([entryId])
	})
})
