import type { MapStackEntry } from '@/features/geo-editor/store'

export interface PrivateDatasetStackDescriptor {
	datasetKey: string
	title: string
}

export interface PrivateDatasetStackUpsert extends PrivateDatasetStackDescriptor {
	id: string
	existing?: MapStackEntry
}

export interface PrivateDatasetStackPlan {
	upsert: PrivateDatasetStackUpsert[]
	remove: string[]
}

export function privateDatasetStackEntryId(workspaceId: string, datasetKey: string) {
	return `private-group:${workspaceId}:${datasetKey}`
}

/**
 * Reconcile decrypted workspace geometry with the Map Stack without overriding
 * user intent. New references are auto-added once; explicitly dismissed IDs
 * stay absent, and existing visibility/pin/isolation state is left untouched.
 */
export function planPrivateDatasetStackReconciliation({
	workspaceId,
	datasets,
	entries,
	order,
	dismissedIds,
}: {
	workspaceId?: string
	datasets: PrivateDatasetStackDescriptor[]
	entries: Record<string, MapStackEntry>
	order: string[]
	dismissedIds: ReadonlySet<string>
}): PrivateDatasetStackPlan {
	const desiredIds = new Set<string>()
	const upsert: PrivateDatasetStackUpsert[] = []

	if (workspaceId) {
		for (const dataset of datasets) {
			const id = privateDatasetStackEntryId(workspaceId, dataset.datasetKey)
			desiredIds.add(id)
			const existing = entries[id]
			if (!existing && dismissedIds.has(id)) continue
			if (
				!existing ||
				existing.title !== dataset.title ||
				existing.entityKey !== dataset.datasetKey
			) {
				upsert.push({ id, ...dataset, existing })
			}
		}
	}

	const remove = order.filter((id) => {
		const entry = entries[id]
		return entry?.source === 'private-group' && !desiredIds.has(id)
	})

	return { upsert, remove }
}
