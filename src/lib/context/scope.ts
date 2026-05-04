import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { getContextReferencedDatasets } from './references'

export type ContextMapScopeMode = 'direct' | 'children'

export interface ScopedContextDataset {
	dataset: GeoDataset
	sourceContext: NDKMapContextEvent
}

export interface ResolvedContextMapScope {
	mode: ContextMapScopeMode
	datasets: ScopedContextDataset[]
	directDatasets: ScopedContextDataset[]
	includedContexts: NDKMapContextEvent[]
	childContexts: NDKMapContextEvent[]
}

function getDatasetScopeKey(event: GeoDataset): string {
	return `${event.kind}:${event.pubkey}:${event.datasetId ?? event.dTag ?? event.id ?? 'dataset'}`
}

function getDirectContextDatasets(
	context: NDKMapContextEvent,
	geoEvents: GeoDataset[],
): ScopedContextDataset[] {
	const coordinate = context.contextCoordinate
	const byKey = new Map<string, ScopedContextDataset>()

	getContextReferencedDatasets(context, geoEvents).forEach((dataset) => {
		byKey.set(getDatasetScopeKey(dataset), { dataset, sourceContext: context })
	})

	if (coordinate && context.context.allowForeignAttachments) {
		geoEvents.forEach((event) => {
			if (!event.contextReferences.includes(coordinate)) return
			byKey.set(getDatasetScopeKey(event), { dataset: event, sourceContext: context })
		})
	}

	return Array.from(byKey.values())
}

export function getDefaultContextMapScopeMode(
	context: NDKMapContextEvent | null | undefined,
): ContextMapScopeMode {
	return context?.context.allowForeignAttachments ? 'children' : 'direct'
}

export function getAttachedChildContexts(
	context: NDKMapContextEvent | null | undefined,
	mapContexts: NDKMapContextEvent[],
): NDKMapContextEvent[] {
	const coordinate = context?.contextCoordinate
	if (!coordinate) return []
	return mapContexts.filter(
		(candidate) =>
			candidate.id !== context?.id &&
			candidate.contextCoordinate !== coordinate &&
			candidate.contextReferences.includes(coordinate),
	)
}

export function resolveContextMapScope(
	context: NDKMapContextEvent | null | undefined,
	geoEvents: GeoDataset[],
	mapContexts: NDKMapContextEvent[],
	mode: ContextMapScopeMode,
): ResolvedContextMapScope {
	if (!context) {
		return {
			mode,
			datasets: [],
			directDatasets: [],
			includedContexts: [],
			childContexts: [],
		}
	}

	const directDatasets = getDirectContextDatasets(context, geoEvents)
	const childContexts = getAttachedChildContexts(context, mapContexts)

	if (mode === 'direct') {
		return {
			mode,
			datasets: directDatasets,
			directDatasets,
			includedContexts: [context],
			childContexts,
		}
	}

	const includedContexts: NDKMapContextEvent[] = []
	const seenContextCoordinates = new Set<string>()
	const seenDatasetKeys = new Set<string>()
	const datasets: ScopedContextDataset[] = []
	const queue: NDKMapContextEvent[] = [context]

	while (queue.length > 0) {
		const current = queue.shift()
		if (!current) continue
		const coordinate =
			current.contextCoordinate ??
			`${current.kind}:${current.pubkey}:${current.contextId ?? current.id}`
		if (seenContextCoordinates.has(coordinate)) continue
		seenContextCoordinates.add(coordinate)
		includedContexts.push(current)

		getDirectContextDatasets(current, geoEvents).forEach((entry) => {
			const key = getDatasetScopeKey(entry.dataset)
			if (seenDatasetKeys.has(key)) return
			seenDatasetKeys.add(key)
			datasets.push(entry)
		})

		getAttachedChildContexts(current, mapContexts).forEach((child) => {
			const childCoordinate =
				child.contextCoordinate ?? `${child.kind}:${child.pubkey}:${child.contextId ?? child.id}`
			if (seenContextCoordinates.has(childCoordinate)) return
			queue.push(child)
		})
	}

	return {
		mode,
		datasets,
		directDatasets,
		includedContexts,
		childContexts,
	}
}
