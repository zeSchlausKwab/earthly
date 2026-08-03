import type { Feature, FeatureCollection } from 'geojson'

export type MapCalloutSide = 'auto' | 'top' | 'right' | 'bottom' | 'left'
export type MapCalloutLeader = 'line' | 'none'

/** A NIP-92-compatible media attachment embedded in a map callout. */
export interface MapCalloutMedia {
	[key: string]: unknown
	url: string
	mimeType?: string
	sha256?: string
	size?: number
	dimensions?: string
	alt?: string
	blurhash?: string
	thumbnailUrl?: string
}

/**
 * Authored content attached to a geometry and rendered without hover/click.
 * Position is intentionally screen-relative: geometry remains the geographic
 * anchor while side/offset describe the card's preferred presentation.
 */
export interface MapCallout {
	[key: string]: unknown
	id: string
	text: string
	title?: string
	media?: MapCalloutMedia[]
	placement?: {
		[key: string]: unknown
		side?: MapCalloutSide
		offset?: [number, number]
		leader?: MapCalloutLeader
	}
}

export const MAP_CALLOUTS_PROPERTY = 'earthly:callouts' as const

const CALLOUT_SIDES = new Set<MapCalloutSide>(['auto', 'top', 'right', 'bottom', 'left'])
const CALLOUT_LEADERS = new Set<MapCalloutLeader>(['line', 'none'])

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeMedia(value: unknown): MapCalloutMedia | null {
	if (!isRecord(value) || typeof value.url !== 'string' || !value.url.trim()) return null
	const media: MapCalloutMedia = { ...value, url: value.url.trim() }
	if (typeof value.mimeType === 'string') media.mimeType = value.mimeType
	else delete media.mimeType
	if (typeof value.sha256 === 'string') media.sha256 = value.sha256
	else delete media.sha256
	if (typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0) {
		media.size = value.size
	} else delete media.size
	if (typeof value.dimensions === 'string') media.dimensions = value.dimensions
	else delete media.dimensions
	if (typeof value.alt === 'string') media.alt = value.alt
	else delete media.alt
	if (typeof value.blurhash === 'string') media.blurhash = value.blurhash
	else delete media.blurhash
	if (typeof value.thumbnailUrl === 'string') media.thumbnailUrl = value.thumbnailUrl
	else delete media.thumbnailUrl
	return media
}

export function normalizeMapCallout(value: unknown): MapCallout | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return null
	if (typeof value.text !== 'string') return null

	const callout: MapCallout = { ...value, id: value.id.trim(), text: value.text }
	if (typeof value.title === 'string' && value.title.trim()) callout.title = value.title.trim()
	else delete callout.title
	if (Array.isArray(value.media)) {
		const media = value.media.map(normalizeMedia).filter((item): item is MapCalloutMedia => !!item)
		if (media.length > 0) callout.media = media
		else delete callout.media
	} else {
		delete callout.media
	}

	if (isRecord(value.placement)) {
		const rawSide = value.placement.side
		const rawLeader = value.placement.leader
		const rawOffset = value.placement.offset
		const side =
			typeof rawSide === 'string' && CALLOUT_SIDES.has(rawSide as MapCalloutSide)
				? (rawSide as MapCalloutSide)
				: undefined
		const leader =
			typeof rawLeader === 'string' && CALLOUT_LEADERS.has(rawLeader as MapCalloutLeader)
				? (rawLeader as MapCalloutLeader)
				: undefined
		const x = Array.isArray(rawOffset) ? finiteNumber(rawOffset[0]) : undefined
		const y = Array.isArray(rawOffset) ? finiteNumber(rawOffset[1]) : undefined
		if (side || leader || (x !== undefined && y !== undefined)) {
			callout.placement = {
				...value.placement,
				...(side ? { side } : {}),
				...(leader ? { leader } : {}),
				...(x !== undefined && y !== undefined ? { offset: [x, y] as [number, number] } : {}),
			}
			if (!side) delete callout.placement.side
			if (!leader) delete callout.placement.leader
			if (x === undefined || y === undefined) delete callout.placement.offset
		}
	} else {
		delete callout.placement
	}

	return callout
}

export function getFeatureCallouts(feature: Pick<Feature, 'properties'>): MapCallout[] {
	const raw = feature.properties?.[MAP_CALLOUTS_PROPERTY]
	if (!Array.isArray(raw)) return []
	const seen = new Set<string>()
	const callouts: MapCallout[] = []
	for (const value of raw) {
		const callout = normalizeMapCallout(value)
		if (!callout || seen.has(callout.id)) continue
		seen.add(callout.id)
		callouts.push(callout)
	}
	return callouts
}

export function withFeatureCallouts<T extends Feature>(feature: T, callouts: MapCallout[]): T {
	const properties = { ...(feature.properties ?? {}) }
	if (callouts.length > 0) properties[MAP_CALLOUTS_PROPERTY] = callouts
	else delete properties[MAP_CALLOUTS_PROPERTY]
	return { ...feature, properties } as T
}

export function createMapCallout(text = ''): MapCallout {
	const id =
		typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `callout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	return {
		id,
		text,
		placement: { side: 'auto', offset: [0, 0], leader: 'line' },
	}
}

/** Flatten unique callout media so dataset publishers can mirror it to NIP-92 imeta tags. */
export function collectCalloutMedia(collection: FeatureCollection): MapCalloutMedia[] {
	const seen = new Set<string>()
	const media: MapCalloutMedia[] = []
	for (const feature of collection.features) {
		for (const callout of getFeatureCallouts(feature)) {
			for (const attachment of callout.media ?? []) {
				const key = attachment.sha256 || attachment.url
				if (seen.has(key)) continue
				seen.add(key)
				media.push(attachment)
			}
		}
	}
	return media
}
