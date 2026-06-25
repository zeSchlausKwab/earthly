/**
 * Pure helpers for kind 37518 (Group / Topic Event — slimmed).
 *
 * A Group is a parameterized-replaceable event whose JSON content defines an
 * attach-push topic with an explicit governance ladder
 * (`open` · `schema` · `closed`). Datasets self-attach via a `c` tag into the
 * Group's foreign (contribution) lane; the owner's curated/pinned refs live in
 * the `a` lane.
 *
 * This module is the slimmed successor to `map-context/helpers.ts`: the old
 * `contextUse`/`validationMode`/`allowForeignAttachments` triad collapses to a
 * single `governance` enum, and `isGroup` adds the SPEC-03 `modelVersion`
 * clean-break gate the legacy `isMapContext` lacked (legacy 37518 silently
 * drops — no migration). All tag reads delegate to the shared `tags.ts` seam
 * (SPEC-02) — no copy-pasted getter bodies here.
 */

import { getOrComputeCachedValue } from 'applesauce-core/helpers/cache'
import { getTagValue, type KnownEvent, type NostrEvent } from 'applesauce-core/helpers/event'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event'
import { MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { hasCurrentModelVersion } from '@/lib/nostr/modelVersion'
import { getBbox, getContextRefs, getHashtags, getReferencedAddresses } from '@/lib/nostr/tags'

export type GroupEvent = KnownEvent<typeof MAP_CONTEXT_KIND>

/**
 * Governance ladder (replaces the old `contextUse`/`validationMode`/
 * `allowForeignAttachments` triad).
 *   - `open`   — anyone may attach; the foreign lane is unfiltered.
 *   - `schema` — attachments are validated against the Group's schema.
 *   - `closed` — only the owner's curated refs; no foreign lane.
 */
export type GroupGovernance = 'open' | 'schema' | 'closed'

export const MAP_CONTEXT_GEOMETRY_TYPES = [
	'Point',
	'MultiPoint',
	'LineString',
	'MultiLineString',
	'Polygon',
	'MultiPolygon',
	'GeometryCollection',
] as const

/** Re-exported under the Group name; existing geometry-checkbox consumers keep working. */
export const GROUP_GEOMETRY_TYPES = MAP_CONTEXT_GEOMETRY_TYPES
export type MapContextGeometryType = (typeof MAP_CONTEXT_GEOMETRY_TYPES)[number]
export type GroupGeometryType = MapContextGeometryType

export interface GroupGeometryConstraints {
	allowedTypes: GroupGeometryType[]
}

export interface GroupContent {
	/** Re-asserted by `GroupFactory.create()` / `.group()`. */
	modelVersion?: string
	name: string
	description?: string
	descriptionFormat?: 'markdown'
	/** Replaces the old contextUse/validationMode/allowForeignAttachments triad. */
	governance: GroupGovernance
	/** Meaningful only under `governance: 'schema'`. */
	geometryConstraints?: GroupGeometryConstraints
	/** draft-2020-12 JSON Schema; only under `governance: 'schema'`. */
	schema?: Record<string, unknown>
	image?: string
}

export const DEFAULT_GROUP_CONTENT: GroupContent = {
	name: '',
	descriptionFormat: 'markdown',
	governance: 'open',
}

const GroupContentSymbol = Symbol.for('group-content')

/**
 * SPEC-03 guard. True only for a well-formed 37518 event that carries a `d` tag
 * AND declares the current `modelVersion`. Legacy 37518 events (the old map
 * context, no `modelVersion`) and wrong-kind events return false WITHOUT
 * throwing (defensive parse via `hasCurrentModelVersion`). This is the
 * clean-break gate the legacy `isMapContext` lacked.
 */
export function isGroup(event: NostrEvent): event is GroupEvent {
	return (
		event.kind === MAP_CONTEXT_KIND &&
		getTagValue(event, 'd') !== undefined &&
		hasCurrentModelVersion(event)
	)
}

export function getGroupId(event: NostrEvent): string | undefined {
	return getTagValue(event, 'd')
}

/**
 * Defensive content getter — never throws; malformed content ⇒ defaults.
 * Merges parsed content ONLY over `DEFAULT_GROUP_CONTENT` (no legacy field
 * migration — clean break).
 */
export function getGroupContent(event: NostrEvent): GroupContent {
	return getOrComputeCachedValue(event, GroupContentSymbol, () => {
		if (!event.content) return { ...DEFAULT_GROUP_CONTENT }
		try {
			const parsed = JSON.parse(event.content) as Partial<GroupContent>
			return { ...DEFAULT_GROUP_CONTENT, ...parsed }
		} catch {
			return { ...DEFAULT_GROUP_CONTENT }
		}
	})
}

export function getGroupCoordinate(event: NostrEvent): string | undefined {
	const id = getGroupId(event)
	if (!id || !event.pubkey) return undefined
	const kind = event.kind ?? MAP_CONTEXT_KIND
	return `${kind}:${event.pubkey}:${id}`
}

// Tag reads delegate to the shared tags.ts seam (SPEC-02) — no copy-paste.
export function getGroupBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
	return getBbox(event)
}

export function getGroupHashtags(event: NostrEvent): string[] {
	return getHashtags(event)
}

/** Foreign (`c`) contribution-lane references attached to this Group. */
export function getGroupContextReferences(event: NostrEvent): string[] {
	return getContextRefs(event)
}

/** Curated (`a`) lane — the owner's pinned/blessed addressable references. */
export function getGroupReferencedAddresses(event: NostrEvent): string[] {
	return getReferencedAddresses(event)
}

/** The canonical schema hash (`schema-hash` tag) for divergence-detection. */
export function getGroupSchemaHash(event: NostrEvent): string | undefined {
	return getTagValue(event, 'schema-hash')
}
