import { describe, expect, test } from 'bun:test'
import type { MapStackEntry } from '@/features/geo-editor/store'
import { fieldDatasetStackEntryId, planFieldDatasetStackReconciliation } from './fieldDatasetStack'

const existing = (id: string): MapStackEntry => ({
	id,
	entityType: 'dataset',
	entityKey: 'dataset-a',
	title: 'Existing title',
	source: 'field-session',
	visible: false,
	pinned: true,
	isolated: false,
	exclusions: [],
	addedAt: 1,
})

describe('Field-session dataset Map Stack reconciliation', () => {
	test('preserves user-owned visibility while updating current session metadata', () => {
		const id = fieldDatasetStackEntryId('survey', 'dataset-a')
		const plan = planFieldDatasetStackReconciliation({
			sessionId: 'survey',
			datasets: [{ datasetKey: 'dataset-a', title: 'Updated title' }],
			entries: { [id]: existing(id) },
			order: [id],
			dismissedIds: new Set(),
		})
		expect(plan.upsert[0]?.existing?.visible).toBe(false)
		expect(plan.upsert[0]?.existing?.pinned).toBe(true)
		expect(plan.remove).toEqual([])
	})

	test('does not resurrect a dataset explicitly removed from the map', () => {
		const id = fieldDatasetStackEntryId('survey', 'dataset-a')
		const plan = planFieldDatasetStackReconciliation({
			sessionId: 'survey',
			datasets: [{ datasetKey: 'dataset-a', title: 'Dataset A' }],
			entries: {},
			order: [],
			dismissedIds: new Set([id]),
		})
		expect(plan.upsert).toEqual([])
	})
})
