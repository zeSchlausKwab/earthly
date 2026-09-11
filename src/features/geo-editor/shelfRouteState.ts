import {
	parseAmbientOn,
	parseMapPresentationSource,
	resolveAmbientOn,
	type AmbientOnIssue,
	type MapPresentationSource,
} from '@/lib/map-presentation'
import type { MapStackEntry, MapStackEntrySource } from './store/types'

export const SHELF_ROUTE_ENTRY_PREFIX = 'route-shelf:'

const URL_SHAREABLE_DATASET_SOURCES = new Set<MapStackEntrySource>(['manual', 'route', 'chat'])

export interface PublicShelfMap {
	readonly source: MapPresentationSource
	/** Existing Map Stack identity (`pubkey:d`). */
	readonly datasetKey: string
	readonly title: string
}

export interface ShelfRouteIntent {
	readonly sources: readonly MapPresentationSource[]
	readonly live: boolean
}

export interface ResolvedShelfRouteIntent extends ShelfRouteIntent {
	readonly unresolvedSources: readonly MapPresentationSource[]
	readonly hasLegacyTokens: boolean
	readonly hasUnresolvedLegacyTokens: boolean
	readonly issues: readonly AmbientOnIssue[]
}

export interface LegacyShelfRouteIntent extends ShelfRouteIntent {
	readonly hasLegacySearch: boolean
	readonly needsContextCatalog: boolean
}

export interface ShelfRouteEntryInput {
	readonly id: string
	readonly entityType: 'dataset' | 'sighting-layer' | 'beacon-layer'
	readonly entityKey: string
	readonly title: string
	readonly source: 'route'
	readonly visible: boolean
	readonly pinned: boolean
}

export interface ShelfRouteReconciliationPlan {
	readonly removeEntryIds: readonly string[]
	readonly upsertEntries: readonly ShelfRouteEntryInput[]
	readonly orderedOwnedEntryIds: readonly string[]
}

function dedupeSources(sources: readonly MapPresentationSource[]): MapPresentationSource[] {
	const seen = new Set<MapPresentationSource>()
	return sources.filter((source) => {
		if (seen.has(source)) return false
		seen.add(source)
		return true
	})
}

export function createPublicShelfMap(input: {
	readonly kind: number
	readonly pubkey: string
	readonly identifier: string
	readonly datasetKey: string
	readonly title: string
}): PublicShelfMap | null {
	const parsed = parseMapPresentationSource(`${input.kind}:${input.pubkey}:${input.identifier}`)
	if (!parsed) return null
	return Object.freeze({
		source: parsed.coordinate,
		datasetKey: input.datasetKey,
		title: input.title,
	})
}

export function shelfRouteDatasetEntryId(source: MapPresentationSource): string {
	return `${SHELF_ROUTE_ENTRY_PREFIX}map:${source}`
}

export const SHELF_ROUTE_SIGHTING_LAYER_ID = `${SHELF_ROUTE_ENTRY_PREFIX}sighting-layer:all`
export const SHELF_ROUTE_BEACON_LAYER_ID = `${SHELF_ROUTE_ENTRY_PREFIX}beacon-layer:all`

/** Parse/canonicalize the public `on=` contract and resolve legacy d-tag aliases. */
export function resolveShelfRouteIntent(
	on: readonly string[],
	publicMaps: readonly PublicShelfMap[],
	live: boolean,
): ResolvedShelfRouteIntent {
	const parsed = parseAmbientOn(on.join(','))
	const resolved = resolveAmbientOn(
		parsed,
		publicMaps.map((map) => map.source),
	)
	const available = new Set(publicMaps.map((map) => map.source))
	return Object.freeze({
		sources: Object.freeze([...resolved.sources]),
		live,
		unresolvedSources: Object.freeze(resolved.sources.filter((source) => !available.has(source))),
		hasLegacyTokens: parsed.tokens.some((token) => token.kind === 'legacy'),
		hasUnresolvedLegacyTokens: resolved.issues.some(
			(issue) => issue.code === 'missing-legacy-source' || issue.code === 'ambiguous-legacy-source',
		),
		issues: Object.freeze([...resolved.issues]),
	})
}

type LegacyEntryType = MapStackEntry['entityType']

interface LegacyEntryToken {
	readonly type: LegacyEntryType | string
	readonly key: string
	readonly serialized: string
}

function parseLegacyEntryToken(value: string): LegacyEntryToken | null {
	const separator = value.indexOf(':')
	if (separator <= 0 || separator === value.length - 1) return null
	return {
		type: value.slice(0, separator),
		key: value.slice(separator + 1),
		serialized: value,
	}
}

/**
 * One-time compatibility reader for old `ms`/`iso`/`ex` links. Its output is
 * immediately written as exact `on=`/`live=1`; none of the old keys survive.
 */
export function convertLegacyShelfSearch(
	search: string,
	publicMaps: readonly PublicShelfMap[],
	expandContext: (
		contextKey: string,
		excludedDatasetKeys: readonly string[],
	) => readonly MapPresentationSource[] = () => [],
): LegacyShelfRouteIntent {
	const params = new URLSearchParams(search)
	const ms = params.get('ms')
	if (!ms) {
		return Object.freeze({
			sources: Object.freeze([]),
			live: false,
			hasLegacySearch: params.has('iso') || params.has('ex'),
			needsContextCatalog: false,
		})
	}
	let entries = ms
		.split(',')
		.map((token) => parseLegacyEntryToken(token.trim()))
		.filter((token): token is LegacyEntryToken => token !== null)
	const isolation = params.get('iso')?.trim()
	if (isolation && entries.some((entry) => entry.serialized === isolation)) {
		entries = entries.filter((entry) => entry.serialized === isolation)
	}

	const exclusionsByContext = new Map<string, string[]>()
	for (const value of params.getAll('ex')) {
		const separator = value.indexOf('|')
		if (separator <= 0) continue
		const key = value.slice(0, separator)
		const exclusions = value
			.slice(separator + 1)
			.split(';')
			.map((item) => item.trim())
			.filter(Boolean)
		exclusionsByContext.set(key, exclusions)
	}

	const mapByDatasetKey = new Map(publicMaps.map((map) => [map.datasetKey, map]))
	const sources: MapPresentationSource[] = []
	let live = false
	let needsContextCatalog = false
	for (const entry of entries) {
		if (entry.type === 'dataset') {
			const source = mapByDatasetKey.get(entry.key)?.source
			if (source) sources.push(source)
			continue
		}
		if (entry.type === 'context') {
			needsContextCatalog = true
			for (const source of expandContext(entry.key, exclusionsByContext.get(entry.key) ?? [])) {
				const parsed = parseMapPresentationSource(source)
				if (parsed) sources.push(parsed.coordinate)
			}
			continue
		}
		if (entry.type === 'sighting-layer' || entry.type === 'beacon-layer') live = true
		// Individual sightings/beacons deliberately do not widen to aggregate Live.
	}

	return Object.freeze({
		sources: Object.freeze(dedupeSources(sources)),
		live,
		hasLegacySearch: true,
		needsContextCatalog,
	})
}

function isWholePublicShelfEntry(
	entry: MapStackEntry,
	publicMapByDatasetKey: ReadonlyMap<string, PublicShelfMap>,
): boolean {
	return (
		entry.entityType === 'dataset' &&
		entry.visible !== false &&
		entry.featureIds === undefined &&
		(entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX) ||
			URL_SHAREABLE_DATASET_SOURCES.has(entry.source)) &&
		publicMapByDatasetKey.has(entry.entityKey)
	)
}

/** Plan adapter-owned compatibility rows without touching any pre-existing row. */
export function planShelfRouteReconciliation(
	intent: ShelfRouteIntent,
	publicMaps: readonly PublicShelfMap[],
	entries: Readonly<Record<string, MapStackEntry>>,
): ShelfRouteReconciliationPlan {
	const publicMapBySource = new Map(publicMaps.map((map) => [map.source, map]))
	const publicMapByDatasetKey = new Map(publicMaps.map((map) => [map.datasetKey, map]))
	const desiredOwnedIds = new Set<string>()
	const orderedOwnedEntryIds: string[] = []
	const upsertEntries: ShelfRouteEntryInput[] = []

	for (const source of intent.sources) {
		const map = publicMapBySource.get(source)
		const id = shelfRouteDatasetEntryId(source)
		const represented = map
			? Object.values(entries).some(
					(entry) =>
						!entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX) &&
						entry.entityKey === map.datasetKey &&
						isWholePublicShelfEntry(entry, publicMapByDatasetKey),
				)
			: false
		if (represented) continue
		desiredOwnedIds.add(id)
		orderedOwnedEntryIds.push(id)
		if (!map || entries[id]) continue
		upsertEntries.push({
			id,
			entityType: 'dataset',
			entityKey: map.datasetKey,
			title: map.title,
			source: 'route',
			visible: true,
			pinned: false,
		})
	}

	if (intent.live) {
		const hasSightings = Object.values(entries).some(
			(entry) =>
				entry.entityType === 'sighting-layer' &&
				entry.visible !== false &&
				!entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX),
		)
		const hasBeacons = Object.values(entries).some(
			(entry) =>
				entry.entityType === 'beacon-layer' &&
				entry.visible !== false &&
				!entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX),
		)
		if (!hasSightings) {
			desiredOwnedIds.add(SHELF_ROUTE_SIGHTING_LAYER_ID)
			orderedOwnedEntryIds.push(SHELF_ROUTE_SIGHTING_LAYER_ID)
			if (!entries[SHELF_ROUTE_SIGHTING_LAYER_ID]) {
				upsertEntries.push({
					id: SHELF_ROUTE_SIGHTING_LAYER_ID,
					entityType: 'sighting-layer',
					entityKey: 'all',
					title: 'Sightings',
					source: 'route',
					visible: true,
					pinned: false,
				})
			}
		}
		if (!hasBeacons) {
			desiredOwnedIds.add(SHELF_ROUTE_BEACON_LAYER_ID)
			orderedOwnedEntryIds.push(SHELF_ROUTE_BEACON_LAYER_ID)
			if (!entries[SHELF_ROUTE_BEACON_LAYER_ID]) {
				upsertEntries.push({
					id: SHELF_ROUTE_BEACON_LAYER_ID,
					entityType: 'beacon-layer',
					entityKey: 'all',
					title: 'Live locations',
					source: 'route',
					visible: true,
					pinned: false,
				})
			}
		}
	}

	const removeEntryIds = Object.keys(entries).filter(
		(id) => id.startsWith(SHELF_ROUTE_ENTRY_PREFIX) && !desiredOwnedIds.has(id),
	)
	return Object.freeze({
		removeEntryIds: Object.freeze(removeEntryIds),
		upsertEntries: Object.freeze(upsertEntries),
		orderedOwnedEntryIds: Object.freeze(orderedOwnedEntryIds),
	})
}

/** Derive only URL-representable state; feature selectors can never widen here. */
export function deriveShelfRouteIntent(
	entries: Readonly<Record<string, MapStackEntry>>,
	order: readonly string[],
	publicMaps: readonly PublicShelfMap[],
	routeIntentSources: readonly MapPresentationSource[] = [],
): ShelfRouteIntent {
	const publicMapByDatasetKey = new Map(publicMaps.map((map) => [map.datasetKey, map]))
	const publicMapBySource = new Map(publicMaps.map((map) => [map.source, map]))
	const ordered = order
		.map((id) => entries[id])
		.filter((entry): entry is MapStackEntry => entry !== undefined)
	const routeOwned = ordered.filter((entry) => entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX))
	const isolated = ordered.find(
		(entry) => entry.isolated && !entry.id.startsWith(SHELF_ROUTE_ENTRY_PREFIX),
	)
	const candidates = isolated ? [isolated, ...routeOwned] : ordered
	const sources: MapPresentationSource[] = []

	// Keep exact unresolved route sources stable until their events arrive. Once
	// resolved, stack order and row visibility become authoritative.
	for (const source of routeIntentSources) {
		if (!publicMapBySource.has(source)) sources.push(source)
	}

	for (const entry of candidates) {
		if (!isWholePublicShelfEntry(entry, publicMapByDatasetKey)) continue
		const source = publicMapByDatasetKey.get(entry.entityKey)?.source
		if (source) sources.push(source)
	}
	const live = candidates.some(
		(entry) =>
			entry.visible !== false &&
			(entry.entityType === 'sighting-layer' || entry.entityType === 'beacon-layer'),
	)

	return Object.freeze({ sources: Object.freeze(dedupeSources(sources)), live })
}

/** Mutate only the canonical Shelf keys, preserving every unrelated route key. */
export function applyShelfRouteIntentToSearch(
	params: URLSearchParams,
	intent: ShelfRouteIntent,
): void {
	params.delete('ms')
	params.delete('iso')
	params.delete('ex')
	if (intent.sources.length > 0) params.set('on', intent.sources.join(','))
	else params.delete('on')
	if (intent.live) params.set('live', '1')
	else params.delete('live')
}
