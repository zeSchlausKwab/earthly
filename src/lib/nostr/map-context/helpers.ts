/**
 * Pure helpers for kind 37518 (Map Context Event).
 *
 * A MapContext is a parameterized-replaceable event whose JSON content
 * defines a taxonomy/validation context (geometry constraints, schema, etc.)
 * for one or more datasets to attach to.
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import {
	getTagValue,
	type KnownEvent,
	type NostrEvent,
} from 'applesauce-core/helpers/event'
import { MAP_CONTEXT_KIND } from '@/lib/ndk/kinds'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'

export type MapContextEvent = KnownEvent<typeof MAP_CONTEXT_KIND>

export type MapContextUse = 'taxonomy' | 'validation' | 'hybrid'
export type MapContextValidationMode = 'none' | 'optional' | 'required'

export const MAP_CONTEXT_GEOMETRY_TYPES = [
	'Point',
	'MultiPoint',
	'LineString',
	'MultiLineString',
	'Polygon',
	'MultiPolygon',
	'GeometryCollection',
] as const
export type MapContextGeometryType = (typeof MAP_CONTEXT_GEOMETRY_TYPES)[number]

export interface MapContextGeometryConstraints {
	allowedTypes: MapContextGeometryType[]
}

export interface MapContextContent {
	name: string
	description?: string
	descriptionFormat?: 'markdown'
	references?: string[]
	image?: string
	contextUse: MapContextUse
	validationMode: MapContextValidationMode
	allowForeignAttachments?: boolean
	geometryConstraints?: MapContextGeometryConstraints
	schemaDialect?: string
	schema?: Record<string, unknown>
}

export const DEFAULT_CONTEXT_CONTENT: MapContextContent = {
	name: '',
	descriptionFormat: 'markdown',
	contextUse: 'taxonomy',
	validationMode: 'none',
	allowForeignAttachments: false,
}

const ContextContentSymbol = Symbol.for('map-context-content')
const BoundingBoxSymbol = Symbol.for('map-context-bbox')
const HashtagsSymbol = Symbol.for('map-context-hashtags')
const RelayHintsSymbol = Symbol.for('map-context-relay-hints')
const ContextRefsSymbol = Symbol.for('map-context-context-refs')
const ReferencedAddrsSymbol = Symbol.for('map-context-referenced-addrs')

export function isMapContext(event: NostrEvent): event is MapContextEvent {
	return event.kind === MAP_CONTEXT_KIND && getContextId(event) !== undefined
}

export function getContextId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

export function getMapContextContent(event: NostrEvent): MapContextContent {
	return getOrComputeCachedValue(event, ContextContentSymbol, () => {
		if (!event.content) return { ...DEFAULT_CONTEXT_CONTENT }
		try {
			const parsed = JSON.parse(event.content) as Partial<MapContextContent>
			return { ...DEFAULT_CONTEXT_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_CONTEXT_CONTENT }
		}
	})
}

export function getContextCoordinate(event: NostrEvent): string | undefined {
	const id = getContextId(event)
	if (!id || !event.pubkey) return undefined
	const kind = event.kind ?? MAP_CONTEXT_KIND
	return `${kind}:${event.pubkey}:${id}`
}

export function getContextBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getOrComputeCachedValue(event, BoundingBoxSymbol, () => {
		const raw = getTagValue(event, 'bbox')
		if (!raw) return undefined
		const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
		if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return undefined
		return parts as GeoBoundingBox
	})
}

export function getContextRelayHints(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, RelayHintsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

export function getContextHashtags(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, HashtagsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string')
			.map((tag) => tag[1] as string),
	)
}

export function getContextVersion(event: NostrEvent): string | undefined {
	return getTagValue(event, 'v')
}

export function getContextReferencesOnContext(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, ContextRefsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'c' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)
}

export function getContextReferencedAddresses(event: NostrEvent): string[] {
	return getOrComputeCachedValue(event, ReferencedAddrsSymbol, () =>
		event.tags
			.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1])
			.map((tag) => tag[1] as string),
	)
}

export function getContextSchemaHash(event: NostrEvent): string | undefined {
	return getTagValue(event, 'schema-hash')
}

export function getParentContextCoordinate(event: NostrEvent): string | undefined {
	return getTagValue(event, 'parent')
}
