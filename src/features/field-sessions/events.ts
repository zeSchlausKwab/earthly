import type { FeatureCollection } from 'geojson'
import { verifyEvent, type EventTemplate, type NostrEvent } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	GeoDatasetFactory,
	computeBboxFor,
	getDatasetId,
	isGeoDataset,
	type GeoDataset,
} from '@/lib/nostr/geo-event'

export const FIELD_SESSION_RECORD_KIND = 37_523

export interface FieldSessionMessage {
	event: NostrEvent
	text: string
	geometry?: FeatureCollection
}

export function fieldSessionMessageTemplate(
	sessionId: string,
	text: string,
	geometry?: FeatureCollection,
): EventTemplate & { created_at: number } {
	const trimmed = text.trim()
	const normalizedGeometry = normalizeFeatureCollection(geometry)
	const boundingBox = normalizedGeometry ? computeBboxFor(normalizedGeometry) : undefined
	if (!trimmed && !normalizedGeometry) throw new Error('Write a message or attach geometry first')
	if (trimmed.length > 8_000)
		throw new Error('Field-session messages are limited to 8,000 characters')
	return {
		kind: FIELD_SESSION_RECORD_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', crypto.randomUUID()],
			['h', sessionId],
			['t', 'field-session'],
			['type', 'message'],
			...(boundingBox ? [['bbox', boundingBox.join(',')]] : []),
		],
		content: JSON.stringify({
			version: 1,
			type: 'message',
			text: trimmed,
			...(normalizedGeometry ? { geometry: normalizedGeometry } : {}),
		}),
	}
}

export function fieldSessionIdForEvent(event: NostrEvent): string | null {
	return event.tags.find((tag) => tag[0] === 'h')?.[1] ?? null
}

export function parseFieldSessionMessage(
	event: NostrEvent,
	sessionId: string,
): FieldSessionMessage | null {
	if (
		event.kind !== FIELD_SESSION_RECORD_KIND ||
		fieldSessionIdForEvent(event) !== sessionId ||
		!verifyEvent(event)
	) {
		return null
	}
	try {
		const content = JSON.parse(event.content) as Record<string, unknown>
		if (content.version !== 1 || content.type !== 'message' || typeof content.text !== 'string') {
			return null
		}
		const text = content.text.trim()
		const geometry = normalizeFeatureCollection(content.geometry)
		return text || geometry ? { event, text, geometry } : null
	} catch {
		return null
	}
}

export function isFieldSessionDatasetEvent(event: NostrEvent, sessionId: string): boolean {
	return (
		event.kind === GEO_EVENT_KIND &&
		fieldSessionIdForEvent(event) === sessionId &&
		verifyEvent(event) &&
		isGeoDataset(event)
	)
}

export function fieldSessionDatasetFactory(
	collection: FeatureCollection,
	sessionId: string,
	previous?: GeoDataset,
): GeoDatasetFactory {
	return (
		previous
			? GeoDatasetFactory.update(previous.event, collection)
			: GeoDatasetFactory.create(collection)
	)
		.modifyPublicTags((tags) => [
			...tags.filter((tag) => tag[0] !== 'h' && !(tag[0] === 't' && tag[1] === 'field-session')),
			['h', sessionId],
			['t', 'field-session'],
		])
		.withDerivedMetadata()
}

/**
 * Keep one latest replaceable dataset version per author + d-tag. The embedded
 * relay retains older signed versions for audit/reconciliation, while the map
 * and Geometry tab present the current workspace state.
 */
export function latestFieldSessionDatasetEvents(
	events: NostrEvent[],
	sessionId: string,
): NostrEvent[] {
	const latest = new Map<string, NostrEvent>()
	for (const event of events) {
		if (!isFieldSessionDatasetEvent(event, sessionId)) continue
		const datasetId = getDatasetId(event)
		if (!datasetId) continue
		const key = `${event.pubkey}:${datasetId}`
		const current = latest.get(key)
		if (
			!current ||
			event.created_at > current.created_at ||
			(event.created_at === current.created_at && event.id > current.id)
		) {
			latest.set(key, event)
		}
	}
	return [...latest.values()].sort(
		(left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id),
	)
}

function normalizeFeatureCollection(value: unknown): FeatureCollection | undefined {
	if (!value || typeof value !== 'object') return undefined
	const candidate = value as Partial<FeatureCollection>
	if (candidate.type !== 'FeatureCollection' || !Array.isArray(candidate.features)) return undefined
	return candidate as FeatureCollection
}
