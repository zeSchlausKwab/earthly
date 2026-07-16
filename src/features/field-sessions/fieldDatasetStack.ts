import type { MapStackEntry } from '@/features/geo-editor/store'

export interface FieldDatasetStackDescriptor {
	datasetKey: string
	title: string
}

export function fieldDatasetStackEntryId(sessionId: string, datasetKey: string): string {
	return `field-session:${sessionId}:${datasetKey}`
}

export function planFieldDatasetStackReconciliation({
	sessionId,
	datasets,
	entries,
	order,
	dismissedIds,
}: {
	sessionId?: string
	datasets: FieldDatasetStackDescriptor[]
	entries: Record<string, MapStackEntry>
	order: string[]
	dismissedIds: ReadonlySet<string>
}): {
	upsert: Array<{
		id: string
		datasetKey: string
		title: string
		existing?: MapStackEntry
	}>
	remove: string[]
} {
	const desiredIds = new Set<string>()
	const upsert: Array<{
		id: string
		datasetKey: string
		title: string
		existing?: MapStackEntry
	}> = []

	if (sessionId) {
		for (const dataset of datasets) {
			const id = fieldDatasetStackEntryId(sessionId, dataset.datasetKey)
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

	return {
		upsert,
		remove: order.filter((id) => {
			const entry = entries[id]
			return entry?.source === 'field-session' && !desiredIds.has(id)
		}),
	}
}
