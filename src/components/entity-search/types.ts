import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import type { FilterConfig } from '@/components/data-filter/types'
import { getEffectiveContextUse, getEffectiveContextValidationMode } from '@/lib/context/validation'

// ── Entity types ──────────────────────────────────────────────────────

export type EntityType = 'dataset' | 'context' | 'feature'

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
	dataset: 'Datasets',
	context: 'Contexts',
	feature: 'Features',
}

// ── Unified result shape ──────────────────────────────────────────────

export interface EntitySearchResult {
	id: string
	name: string
	type: EntityType
	subtitle?: string
	address?: string
	pubkey?: string
	createdAt?: number
	/** Original entity reference for callbacks */
	entity: GeoDataset | MapContext | GeoFeatureItem
}

export interface EntitySearchResultGroup {
	type: EntityType
	label: string
	results: EntitySearchResult[]
	totalCount: number
	filteredCount: number
}

// ── Hook input / output ───────────────────────────────────────────────

export interface EntitySearchSources {
	datasets?: GeoDataset[]
	contexts?: MapContext[]
	features?: GeoFeatureItem[]
}

export interface EntitySearchOutput {
	results: EntitySearchResult[]
	groups: EntitySearchResultGroup[]
	totalCount: number
	filteredCount: number
	hasResults: boolean
}

// ── Adapter functions ─────────────────────────────────────────────────

const getDatasetDescriptionText = (event: GeoDataset): string | undefined => {
	// biome-ignore lint/suspicious/noExplicitAny: GeoJSON properties are dynamically typed
	const featureCollection = event.featureCollection as Record<string, any>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		featureCollection?.properties?.description,
		featureCollection?.properties?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

export function datasetToSearchResult(
	event: GeoDataset,
	getDatasetName?: (event: GeoDataset) => string,
): EntitySearchResult {
	const name = getDatasetName
		? getDatasetName(event)
		: (event.datasetId ?? event.dTag ?? event.id ?? 'Untitled')
	return {
		id: event.id ?? event.dTag ?? '',
		name,
		type: 'dataset',
		subtitle: getDatasetDescriptionText(event),
		pubkey: event.pubkey,
		createdAt: event.created_at,
		entity: event,
	}
}

export function contextToSearchResult(context: MapContext): EntitySearchResult {
	const content = context.context
	const effectiveUse = getEffectiveContextUse(context)
	return {
		id: context.id ?? context.dTag ?? '',
		name: content.name || context.contextId || context.id || 'Untitled',
		type: 'context',
		subtitle:
			content.description ??
			`${effectiveUse} · ${content.allowForeignAttachments ? 'open' : 'closed'}`,
		pubkey: context.pubkey,
		createdAt: context.created_at,
		entity: context,
	}
}

export function featureToSearchResult(feature: GeoFeatureItem): EntitySearchResult {
	return {
		id: feature.id,
		name: feature.name,
		type: 'feature',
		subtitle: feature.datasetName,
		address: feature.address,
		entity: feature,
	}
}

// ── Filter configs (shared, extracted from GeoDatasetsPanel) ──────────

export function createDatasetFilterConfig(
	getDatasetName: (event: GeoDataset) => string,
): FilterConfig<GeoDataset> {
	return {
		getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
		getName: (event) => getDatasetName(event),
	}
}

export const contextFilterConfig: FilterConfig<MapContext> = {
	getSearchableText: (context) => {
		const content = context.context
		return [
			content.name,
			content.description,
			getEffectiveContextUse(context),
			getEffectiveContextValidationMode(context),
			content.allowForeignAttachments ? 'open' : 'closed',
			context.contextId,
			context.id,
		]
	},
	getName: (context) => context.context.name || context.contextId || context.id || 'Untitled',
}
