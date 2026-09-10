import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { LiveBeacon } from '@/lib/nostr/live-beacon'
import type { MapContext } from '@/lib/nostr/map-context'
import type { TemporalSighting } from '@/lib/nostr/temporal-sighting'
import type { SearchLocationOutput } from '@/ctxcn'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import type { FilterConfig } from '@/components/data-filter/types'
import { getEffectiveContextUse, getEffectiveContextValidationMode } from '@/lib/context/validation'
import type { NostrEvent } from 'nostr-tools'

// ── Entity types ──────────────────────────────────────────────────────

export type EntityType =
	| 'dataset'
	| 'context'
	| 'feature'
	| 'story'
	| 'beacon'
	| 'sighting'
	| 'person'
	| 'place'

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
	dataset: 'Maps',
	context: 'Atlases',
	feature: 'Features',
	story: 'Stories',
	beacon: 'Beacons',
	sighting: 'Sightings',
	person: 'People',
	place: 'Places',
}

export interface PersonProfileMetadata {
	name?: string
	display_name?: string
	displayName?: string
	about?: string
	nip05?: string
	picture?: string
	image?: string
}

export interface PersonSearchEntity {
	event: NostrEvent
	profile: PersonProfileMetadata
}

export type PlaceSearchEntity = SearchLocationOutput['result']['results'][number]

// ── Unified result shape ──────────────────────────────────────────────

export interface EntitySearchResult {
	id: string
	name: string
	type: EntityType
	subtitle?: string
	address?: string
	/** Read-only attachment scope; independent of the search result's source id. */
	featureId?: string
	localWorkspaceId?: string
	pubkey?: string
	createdAt?: number
	/** Original entity reference for callbacks */
	entity:
		| GeoDataset
		| MapContext
		| GeoFeatureItem
		| Article
		| LiveBeacon
		| TemporalSighting
		| PersonSearchEntity
		| PlaceSearchEntity
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
	stories?: Article[]
	beacons?: LiveBeacon[]
	sightings?: TemporalSighting[]
	people?: NostrEvent[]
	places?: PlaceSearchEntity[]
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

export function storyToSearchResult(story: Article): EntitySearchResult {
	const content = story.article
	return {
		id: story.id ?? story.dTag ?? '',
		name: content.title || story.dTag || 'Untitled story',
		type: 'story',
		subtitle: content.summary,
		pubkey: story.pubkey,
		createdAt: story.created_at,
		entity: story,
	}
}

export function beaconToSearchResult(beacon: LiveBeacon): EntitySearchResult {
	return {
		id: beacon.id ?? beacon.dTag ?? '',
		name: beacon.beacon.label || 'Live beacon',
		type: 'beacon',
		subtitle: beacon.status === 'live' ? 'live' : 'ended',
		pubkey: beacon.pubkey,
		createdAt: beacon.created_at,
		entity: beacon,
	}
}

export function sightingToSearchResult(sighting: TemporalSighting): EntitySearchResult {
	const content = sighting.sighting
	return {
		id: sighting.id ?? sighting.dTag ?? '',
		name: content.title || 'Sighting',
		type: 'sighting',
		subtitle: content.description,
		pubkey: sighting.pubkey,
		createdAt: sighting.created_at,
		entity: sighting,
	}
}

export function parsePersonProfile(content: string): PersonProfileMetadata {
	try {
		const parsed: unknown = JSON.parse(content)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
		const record = parsed as Record<string, unknown>
		const stringValue = (key: string): string | undefined => {
			const value = record[key]
			return typeof value === 'string' && value.trim() ? value.trim() : undefined
		}
		return {
			name: stringValue('name'),
			display_name: stringValue('display_name'),
			displayName: stringValue('displayName'),
			about: stringValue('about'),
			nip05: stringValue('nip05'),
			picture: stringValue('picture'),
			image: stringValue('image'),
		}
	} catch {
		return {}
	}
}

export function personToSearchResult(event: NostrEvent): EntitySearchResult {
	const profile = parsePersonProfile(event.content)
	const fallback = `${event.pubkey.slice(0, 8)}…${event.pubkey.slice(-4)}`
	return {
		id: event.pubkey,
		name: profile.display_name ?? profile.displayName ?? profile.name ?? profile.nip05 ?? fallback,
		type: 'person',
		subtitle: profile.nip05 ?? profile.about,
		pubkey: event.pubkey,
		createdAt: event.created_at,
		entity: { event, profile },
	}
}

export function placeToSearchResult(place: PlaceSearchEntity): EntitySearchResult {
	const placeKind = [place.type, place.class].filter(Boolean).join(' · ')
	return {
		id: String(place.placeId),
		name: place.displayName,
		type: 'place',
		subtitle: placeKind || 'Fly there',
		entity: place,
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

export const storyFilterConfig: FilterConfig<Article> = {
	getSearchableText: (story) => [story.article.title, story.article.summary, story.dTag, story.id],
	getName: (story) => story.article.title || story.dTag || story.id || 'Untitled story',
}

export const beaconFilterConfig: FilterConfig<LiveBeacon> = {
	getSearchableText: (beacon) => [beacon.beacon.label, beacon.status, beacon.dTag, beacon.id],
	getName: (beacon) => beacon.beacon.label || 'Live beacon',
}

export const sightingFilterConfig: FilterConfig<TemporalSighting> = {
	getSearchableText: (sighting) => [
		sighting.sighting.title,
		sighting.sighting.description,
		sighting.dTag,
		sighting.id,
	],
	getName: (sighting) => sighting.sighting.title || 'Sighting',
}

export const personFilterConfig: FilterConfig<NostrEvent> = {
	getSearchableText: (event) => {
		const profile = parsePersonProfile(event.content)
		return [
			profile.display_name,
			profile.displayName,
			profile.name,
			profile.nip05,
			profile.about,
			event.pubkey,
		]
	},
	getName: (event) => personToSearchResult(event).name,
}
