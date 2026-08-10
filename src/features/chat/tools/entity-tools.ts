/**
 * Entity read tool: `read_entity`.
 *
 * `search_entities` returns compact summaries; this is the follow-up read that
 * fetches ONE entity's full content by its naddr (or `kind:pubkey:d`
 * coordinate) — a story's Markdown body, a context/group's content and curated
 * references, a dataset's metadata and feature inventory (or one full feature
 * via `featureId`). Read-only: the write path for entities stays with the
 * user (drafts + manual publish).
 *
 * Resolution order: the in-memory applesauce event store first (already-loaded
 * entities answer instantly), then a one-shot NIP-01 request against the
 * content relays, keeping the newest replaceable version seen.
 */

import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { eventStore, pool, readRelaysFor } from '@/lib/nostr'
import { isExpired } from '@/lib/nostr/expiry'
import {
	ARTICLE_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import {
	getBbox,
	getContextRefs,
	getGeohash,
	getHashtags,
	getLabels,
	getReferencedAddresses,
} from '@/lib/nostr/tags'
import {
	coordinateToNaddrReference,
	parseNostrAddressReference,
	stringifyNostrAddressReference,
} from '@/lib/nostr/references'
import { stringifyGeoReference, type OsmElementType } from '@/lib/geo/reference'
import type { ToolEntry } from './registry'
import type { Tool } from './types'

const KIND_TO_ENTITY_TYPE: Record<number, string> = {
	[GEO_EVENT_KIND]: 'dataset',
	[MAP_CONTEXT_KIND]: 'group',
	[ARTICLE_KIND]: 'story',
	[LIVE_BEACON_KIND]: 'beacon',
	[TEMPORAL_SIGHTING_KIND]: 'sighting',
}

const RELAY_TIMEOUT_MS = 10_000
/** Cap on returned long-form body text (story Markdown, descriptions). */
const MAX_BODY_CHARS = 20_000
/** Cap on the dataset feature inventory. */
const MAX_FEATURE_LIST = 150
/** Cap on a single serialized feature returned via `featureId`. */
const MAX_FEATURE_CHARS = 30_000

// ── reference parsing (exported for tests) ─────────────────────────────

export interface ParsedEntityReference {
	kind: number
	pubkey: string
	identifier: string
	featureId?: string
}

/**
 * Accepts `nostr:naddr1…`, bare `naddr1…`, or a `kind:pubkey:d` coordinate.
 * A trailing percent-encoded `#featureId` fragment is returned to the caller,
 * so a fine-grained mention can be passed directly without duplicating args.
 */
export function parseEntityReference(value: unknown): ParsedEntityReference {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error('reference must be a non-empty string (naddr or kind:pubkey:d coordinate).')
	}
	let raw = value.trim()
	let featureId: string | undefined
	if (raw.startsWith('nostr:') || raw.startsWith('naddr1')) {
		const parsed = parseNostrAddressReference(raw.startsWith('nostr:') ? raw : `nostr:${raw}`)
		if (parsed) {
			raw = parsed.address
			featureId = parsed.featureId
		}
	}

	if (raw.startsWith('naddr1')) {
		try {
			const decoded = nip19.decode(raw)
			if (decoded.type !== 'naddr') throw new Error('not an naddr')
			const { kind, pubkey, identifier } = decoded.data
			return { kind, pubkey, identifier, ...(featureId ? { featureId } : {}) }
		} catch {
			throw new Error(`Could not decode naddr: ${raw.slice(0, 24)}…`)
		}
	}

	const parts = raw.split(':')
	if (parts.length >= 3) {
		const kind = Number.parseInt(parts[0] ?? '', 10)
		const pubkey = parts[1] ?? ''
		const identifier = parts.slice(2).join(':')
		if (Number.isFinite(kind) && pubkey && identifier) {
			return { kind, pubkey, identifier }
		}
	}
	throw new Error(
		'reference must be an naddr (nostr:naddr1…) or a kind:pubkey:d coordinate string.',
	)
}

// ── relay fetch ────────────────────────────────────────────────────────

export function fetchLatestByCoordinate(ref: ParsedEntityReference): Promise<NostrEvent | null> {
	const cached = eventStore.getReplaceable(ref.kind, ref.pubkey, ref.identifier)
	if (cached) return Promise.resolve(cached)

	return new Promise((resolve) => {
		let latest: NostrEvent | null = null
		let settled = false
		let timer: ReturnType<typeof setTimeout> | undefined

		const settle = () => {
			if (settled) return
			settled = true
			if (timer) clearTimeout(timer)
			if (latest) eventStore.add(latest)
			resolve(latest)
		}

		const sub = pool
			.request(readRelaysFor('content'), {
				kinds: [ref.kind],
				authors: [ref.pubkey],
				'#d': [ref.identifier],
			})
			.subscribe({
				next: (event: NostrEvent) => {
					if (!latest || event.created_at > latest.created_at) latest = event
				},
				complete: settle,
				error: settle,
			})

		timer = setTimeout(() => {
			sub.unsubscribe()
			settle()
		}, RELAY_TIMEOUT_MS)
		if (settled) sub.unsubscribe()
	})
}

// ── result shaping ─────────────────────────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

function truncate(text: string, max: number): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false }
	return { text: `${text.slice(0, max)}…`, truncated: true }
}

function toMentions(coordinates: string[]): string[] {
	return coordinates
		.map((coordinate) => coordinateToNaddrReference(coordinate))
		.filter((value): value is string => Boolean(value))
}

function parseContentJson(event: NostrEvent): Record<string, unknown> {
	try {
		const parsed = JSON.parse(event.content) as unknown
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>
		}
	} catch {
		// fall through — tags still describe the entity
	}
	return {}
}

interface GeoJsonFeatureLike {
	id?: unknown
	properties?: Record<string, unknown> | null
	geometry?: { type?: string } | null
}

const OMITTED_INVENTORY_PROPERTIES = new Set([
	'color',
	'fillColor',
	'fillOpacity',
	'strokeColor',
	'strokeOpacity',
	'strokeWidth',
	'displayIcon',
	'label',
])

function compactFeatureProperties(
	properties: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean> | undefined {
	if (!properties) return undefined
	const entries = Object.entries(properties).flatMap(([key, value]) => {
		if (OMITTED_INVENTORY_PROPERTIES.has(key)) return []
		if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
			return []
		}
		return [[key, value] as const]
	})
	return entries.length > 0 ? Object.fromEntries(entries.slice(0, 8)) : undefined
}

function osmReferenceForFeature(feature: GeoJsonFeatureLike): string | undefined {
	const properties = feature.properties
	const direct = [feature.id, properties?.osmRef, properties?.osm_ref, properties?.['@id']]
	for (const candidate of direct) {
		if (typeof candidate !== 'string' && typeof candidate !== 'number') continue
		const match = String(candidate).match(/^(node|way|relation)[/:](\d+)$/i)
		if (!match?.[1] || !match[2]) continue
		return stringifyGeoReference({
			kind: 'osm',
			elementType: match[1].toLowerCase() as OsmElementType,
			id: match[2],
		})
	}
	return undefined
}

function shapeDataset(
	event: NostrEvent,
	featureId: string | undefined,
	datasetMention: string | null,
): Record<string, unknown> {
	let collection: { name?: unknown; description?: unknown; features?: unknown } = {}
	try {
		collection = JSON.parse(event.content) as typeof collection
	} catch {
		// malformed content — report what tags carry
	}
	const features = Array.isArray(collection.features)
		? (collection.features as GeoJsonFeatureLike[])
		: []

	const blobScopes = event.tags
		.filter((tag) => tag[0] === 'blob')
		.map((tag) => tag[1])
		.filter((scope): scope is string => Boolean(scope))

	if (featureId) {
		const feature = features.find((f) => f.id === featureId || f.properties?.id === featureId)
		if (!feature) {
			return {
				featureId,
				feature: null,
				note:
					blobScopes.length > 0
						? 'Feature not found inline; this dataset stores some geometry in external blobs.'
						: 'Feature not found in this dataset.',
			}
		}
		const serialized = truncate(JSON.stringify(feature), MAX_FEATURE_CHARS)
		return {
			featureId,
			feature: serialized.text,
			featureTruncated: serialized.truncated,
		}
	}

	const parsedDatasetMention = parseNostrAddressReference(datasetMention)
	const inventory = features.slice(0, MAX_FEATURE_LIST).map((feature, index) => {
		const id =
			typeof feature.id === 'string' || typeof feature.id === 'number'
				? String(feature.id)
				: String(index)
		const pointCoordinates =
			feature.geometry?.type === 'Point' &&
			Array.isArray((feature.geometry as { coordinates?: unknown }).coordinates)
				? (feature.geometry as { coordinates: unknown[] }).coordinates.slice(0, 2)
				: undefined
		return {
			id,
			name: str(feature.properties?.name),
			geometry: feature.geometry?.type ?? 'Unknown',
			displayIcon: str(feature.properties?.displayIcon),
			...(parsedDatasetMention
				? {
						reference: stringifyNostrAddressReference({
							address: parsedDatasetMention.address,
							featureId: id,
						}),
					}
				: {}),
			...(osmReferenceForFeature(feature) ? { osmReference: osmReferenceForFeature(feature) } : {}),
			...(pointCoordinates ? { coordinates: pointCoordinates } : {}),
			...(compactFeatureProperties(feature.properties)
				? { properties: compactFeatureProperties(feature.properties) }
				: {}),
		}
	})

	return {
		name: str(collection.name),
		description: str(collection.description),
		featureCount: features.length,
		features: inventory,
		featuresTruncated: features.length > MAX_FEATURE_LIST,
		...(blobScopes.length > 0
			? { externalBlobs: blobScopes, note: 'Some geometry lives in external blobs (not inline).' }
			: {}),
	}
}

function shapeStory(event: NostrEvent): Record<string, unknown> {
	const content = parseContentJson(event)
	const body = str(content.content) ?? ''
	const truncated = truncate(body, MAX_BODY_CHARS)
	return {
		title: str(content.title),
		summary: str(content.summary),
		image: str(content.image),
		publishedAt: typeof content.publishedAt === 'number' ? content.publishedAt : undefined,
		markdown: truncated.text,
		markdownTruncated: truncated.truncated,
		referencedMentions: toMentions(getReferencedAddresses(event)),
	}
}

function shapeGroup(event: NostrEvent): Record<string, unknown> {
	const content = parseContentJson(event)
	const description = str(content.description)
	const truncated = description ? truncate(description, MAX_BODY_CHARS) : undefined
	return {
		name: str(content.name),
		description: truncated?.text,
		descriptionTruncated: truncated?.truncated ?? false,
		// Both content generations of kind 37518 in the wild: legacy MapContext
		// (contextUse/validationMode) and SPEC-v2 Group (governance).
		governance: str(content.governance),
		contextUse: str(content.contextUse),
		validationMode: str(content.validationMode),
		geometryConstraints: content.geometryConstraints,
		hasSchema: Boolean(content.schema),
		curatedMentions: toMentions(getReferencedAddresses(event)),
		attachedContextRefs: getContextRefs(event),
	}
}

function shapeTimestamped(event: NostrEvent): Record<string, unknown> {
	const content = parseContentJson(event)
	const description = str(content.description)
	const truncated = description ? truncate(description, MAX_BODY_CHARS) : undefined
	return {
		title: str(content.title) ?? str(content.label),
		description: truncated?.text,
		descriptionTruncated: truncated?.truncated ?? false,
	}
}

// ── schema ─────────────────────────────────────────────────────────────

const readEntitySchema: Tool = {
	type: 'function',
	function: {
		name: 'read_entity',
		description:
			"Fetch ONE Earthly entity's full content by reference — use after search_entities (which only returns summaries) or when the user attaches/mentions an entity. Accepts an naddr (nostr:naddr1…), including an encoded #featureId selector, or a kind:pubkey:d coordinate. Returns the full story Markdown body with its referenced mentions, a group/context's content and curated references, or a dataset's metadata and feature inventory. Dataset inventory rows include ready-to-cite fine-grained references, OSM references when present, Point coordinates, and compact semantic properties. An explicit featureId overrides the selector in reference.",
		parameters: {
			type: 'object',
			properties: {
				reference: {
					type: 'string',
					description:
						"The entity reference: 'nostr:naddr1…', bare 'naddr1…', or 'kind:pubkey:d' coordinate.",
				},
				featureId: {
					type: 'string',
					description:
						'Datasets only: return this single feature (full geometry + properties) instead of the feature inventory.',
				},
			},
			required: ['reference'],
		},
	},
}

// ── registration ───────────────────────────────────────────────────────

export function registerEntityTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'read_entity',
		kind: 'host-builtin',
		schema: readEntitySchema,
		handler: async (args) => {
			const ref = parseEntityReference(args.reference)
			const type = KIND_TO_ENTITY_TYPE[ref.kind]
			if (!type) {
				throw new Error(
					`Unsupported kind ${ref.kind}. Supported: ${Object.entries(KIND_TO_ENTITY_TYPE)
						.map(([kind, name]) => `${name} (${kind})`)
						.join(', ')}.`,
				)
			}

			const event = await fetchLatestByCoordinate(ref)
			if (!event) {
				return {
					ok: false,
					error: 'not_found',
					message:
						'No event found for this reference on the content relays (it may be unpublished, deleted, or on another relay).',
				}
			}
			// SPEC §10: expired beacons/sightings never reach the model.
			if (isExpired(event, Math.floor(Date.now() / 1000))) {
				return { ok: false, error: 'expired', message: 'This entity has expired.' }
			}

			const featureId = typeof args.featureId === 'string' ? args.featureId : ref.featureId
			const coordinate = `${ref.kind}:${ref.pubkey}:${ref.identifier}`
			const mention = coordinateToNaddrReference(coordinate)
			let shaped: Record<string, unknown>
			if (ref.kind === GEO_EVENT_KIND) {
				shaped = shapeDataset(event, featureId, mention)
			} else if (ref.kind === ARTICLE_KIND) {
				shaped = shapeStory(event)
			} else if (ref.kind === MAP_CONTEXT_KIND) {
				shaped = shapeGroup(event)
			} else {
				shaped = shapeTimestamped(event)
			}

			const hashtags = getHashtags(event)
			const labels = getLabels(event)
			return {
				ok: true,
				type,
				coordinate,
				mention,
				author: event.pubkey,
				updatedAt: event.created_at,
				...(getBbox(event) ? { bbox: getBbox(event) } : {}),
				...(getGeohash(event) ? { geohash: getGeohash(event) } : {}),
				...(hashtags.length > 0 ? { hashtags } : {}),
				...(labels.length > 0 ? { labels } : {}),
				...shaped,
			}
		},
	})
}
