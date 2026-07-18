import type { MapLayerState } from '@/features/geo-editor/store'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	MAX_MAP_LAYER_BLOB_BYTES,
	MAX_MAP_LAYER_MIRRORS,
	MAX_MAP_LAYER_MIRROR_URL_BYTES,
} from '@/lib/nostr/map-layer-set/trust'
import type {
	SavedRegionBlobInput,
	SavedRegionCreateRequest,
	SyncedNostrEvent,
} from '@/platform/contracts'
import { MAX_SAVED_REGION_EVENT_BYTES, MAX_SAVED_REGION_EVENTS } from './selectSavedRegionEvents'

const SHA256_FILE = /^([0-9a-f]{64})(?:\.pmtiles)?$/u
const SHA256 = /^[0-9a-f]{64}$/u
const FEATURE_BLOB_SCOPE = /^feature:[A-Za-z0-9_.-]+$/u
const MAX_REGION_BLOBS = 2_048
const MAX_BLOB_MIRRORS = MAX_MAP_LAYER_MIRRORS
const MAX_REGION_MIRROR_URL_BYTES_TOTAL = 4 * 1024 * 1024
const MAX_CONTENT_BLOB_BYTES = 50 * 1024 * 1024
const UTF8_ENCODER = new TextEncoder()

export interface SavedRegionPlan {
	request: SavedRegionCreateRequest
	chunkCount: number
	bytesTotal: number | null
	unknownSizeCount: number
}

export interface PlanSavedRegionInput {
	id: string
	name: string
	bbox: [number, number, number, number]
	sourcePubkey: string
	announcementId: string
	layer: MapLayerState
	events: SyncedNostrEvent[]
}

function intersects(
	left: [number, number, number, number],
	right: [number, number, number, number],
): boolean {
	return !(left[2] < right[0] || left[0] > right[2] || left[3] < right[1] || left[1] > right[3])
}

function validateBbox(bbox: [number, number, number, number]): void {
	const [west, south, east, north] = bbox
	if (
		bbox.some((value) => !Number.isFinite(value)) ||
		west < -180 ||
		east > 180 ||
		south < -90 ||
		north > 90 ||
		west > east ||
		south > north
	) {
		throw new Error('The visible map crosses the date line or has invalid bounds')
	}
}

interface ContentBlobReference {
	sha256: string
	url: string
	expectedSize?: number
}

interface ContentBlobAggregate {
	urls: Set<string>
	expectedSizes: Set<number>
}

function datasetReferenceError(event: SyncedNostrEvent, reason: string): Error {
	return new Error(`Dataset ${event.id.slice(0, 12)} cannot be saved completely offline: ${reason}`)
}

function isLocalOrIpHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase()
	return (
		normalized === 'localhost' ||
		normalized.endsWith('.localhost') ||
		normalized === 'local' ||
		normalized.endsWith('.local') ||
		normalized.includes(':') ||
		/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)
	)
}

function normalizeContentUrl(event: SyncedNostrEvent, value: string | undefined): string {
	try {
		if (!value) throw new Error('missing URL')
		const trimmed = value.trim()
		if (UTF8_ENCODER.encode(trimmed).byteLength > MAX_MAP_LAYER_MIRROR_URL_BYTES) {
			throw new Error('URL too long')
		}
		const url = new URL(trimmed)
		if (
			url.protocol !== 'https:' ||
			url.username !== '' ||
			url.password !== '' ||
			url.search !== '' ||
			url.hash !== '' ||
			url.hostname === '' ||
			isLocalOrIpHostname(url.hostname)
		) {
			throw new Error('unsafe URL')
		}
		return url.toString()
	} catch {
		throw datasetReferenceError(event, 'an external geometry reference has no safe HTTPS URL')
	}
}

function validateMirrorManifest(blobs: readonly SavedRegionBlobInput[]): void {
	let totalBytes = 0
	for (const blob of blobs) {
		if (blob.mirrorUrls.length === 0 || blob.mirrorUrls.length > MAX_BLOB_MIRRORS) {
			throw new Error(`Each offline file needs between 1 and ${MAX_BLOB_MIRRORS} mirrors`)
		}
		for (const mirror of blob.mirrorUrls) {
			const bytes = UTF8_ENCODER.encode(mirror).byteLength
			if (bytes === 0 || bytes > MAX_MAP_LAYER_MIRROR_URL_BYTES) {
				throw new Error('An offline file mirror URL is too long')
			}
			try {
				const url = new URL(mirror)
				if (
					url.protocol !== 'https:' ||
					url.username !== '' ||
					url.password !== '' ||
					url.search !== '' ||
					url.hash !== '' ||
					url.hostname === ''
				) {
					throw new Error('unsafe mirror')
				}
			} catch {
				throw new Error('Offline file mirrors must use safe HTTPS URLs')
			}
			totalBytes += bytes
			if (totalBytes > MAX_REGION_MIRROR_URL_BYTES_TOTAL) {
				throw new Error('Offline file mirror metadata exceeds the 4 MiB limit')
			}
		}
	}
}

function signedBlobSize(event: SyncedNostrEvent, entries: readonly string[]): number | undefined {
	const rawSizes = entries
		.filter((entry) => entry.startsWith('size='))
		.map((entry) => entry.slice('size='.length))
	if (rawSizes.length === 0) return undefined
	if (rawSizes.length !== 1 || !/^[1-9][0-9]*$/u.test(rawSizes[0] ?? '')) {
		throw datasetReferenceError(event, 'an external geometry reference has an invalid size')
	}
	const size = Number(rawSizes[0])
	if (!Number.isSafeInteger(size) || size > MAX_CONTENT_BLOB_BYTES) {
		throw datasetReferenceError(event, 'an external geometry file exceeds the 50 MiB limit')
	}
	return size
}

/**
 * Read the signed raw tags instead of the permissive rendering helper. A saved
 * region must fail closed if a selected dataset points at geometry that cannot
 * be integrity-checked and downloaded by the native cache.
 */
function parseContentBlobReference(
	event: SyncedNostrEvent,
	tag: readonly string[],
): ContentBlobReference {
	const scope = tag[1]
	if (scope !== 'collection' && !FEATURE_BLOB_SCOPE.test(scope ?? '')) {
		throw datasetReferenceError(event, 'an external geometry reference has an invalid scope')
	}
	const hashes = tag
		.slice(3)
		.filter((entry) => entry.startsWith('sha256='))
		.map((entry) => entry.slice('sha256='.length))
	if (hashes.length !== 1 || !SHA256.test(hashes[0] ?? '')) {
		throw datasetReferenceError(
			event,
			'an external geometry reference needs one lowercase SHA-256 hash',
		)
	}
	const expectedSize = signedBlobSize(event, tag.slice(3))
	return {
		sha256: hashes[0] as string,
		url: normalizeContentUrl(event, tag[2]),
		...(expectedSize === undefined ? {} : { expectedSize }),
	}
}

function planContentBlobs(
	events: readonly SyncedNostrEvent[],
	ordinalOffset: number,
): SavedRegionBlobInput[] {
	const byHash = new Map<string, ContentBlobAggregate>()
	for (const event of events) {
		if (event.kind !== GEO_EVENT_KIND) continue
		for (const tag of event.tags) {
			if (tag[0] !== 'blob') continue
			const reference = parseContentBlobReference(event, tag)
			const aggregate = byHash.get(reference.sha256) ?? {
				urls: new Set<string>(),
				expectedSizes: new Set<number>(),
			}
			aggregate.urls.add(reference.url)
			if (reference.expectedSize !== undefined) {
				aggregate.expectedSizes.add(reference.expectedSize)
			}
			byHash.set(reference.sha256, aggregate)
		}
	}

	return [...byHash.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([sha256, aggregate], index) => {
			if (aggregate.expectedSizes.size > 1) {
				throw new Error(
					`External geometry references for ${sha256.slice(0, 12)} disagree on the signed size`,
				)
			}
			const [expectedSize] = aggregate.expectedSizes
			return {
				sha256,
				role: 'content' as const,
				required: true,
				ordinal: ordinalOffset + index,
				...(aggregate.expectedSizes.size === 1 && expectedSize !== undefined
					? { expectedSize }
					: {}),
				mirrorUrls: [...aggregate.urls].sort().slice(0, MAX_BLOB_MIRRORS),
			}
		})
}

function validateRetainedEvents(events: readonly SyncedNostrEvent[]): void {
	if (events.length > MAX_SAVED_REGION_EVENTS) {
		throw new Error(`Offline content cannot contain more than ${MAX_SAVED_REGION_EVENTS} records`)
	}
	let bytes = 0
	for (const event of events) {
		bytes += UTF8_ENCODER.encode(JSON.stringify(event)).byteLength
		if (bytes > MAX_SAVED_REGION_EVENT_BYTES) {
			throw new Error('Offline content exceeds the 16 MiB signed-record limit')
		}
	}
}

/** Build a deterministic, content-addressed native download plan from a trusted announcement. */
export function planSavedRegion(input: PlanSavedRegionInput): SavedRegionPlan {
	validateBbox(input.bbox)
	validateRetainedEvents(input.events)
	if (!input.layer.announcement) {
		throw new Error('The selected map layer does not publish downloadable regions')
	}
	const signedMirrors = input.layer.signedBlossomServers ?? []
	if (signedMirrors.length > MAX_BLOB_MIRRORS) {
		throw new Error(`The signed map layer publishes more than ${MAX_BLOB_MIRRORS} mirrors`)
	}
	const mirrors = [...new Set(signedMirrors)]
	if (mirrors.length === 0) throw new Error('The selected map layer has no trusted download mirror')

	const chunks = Object.entries(input.layer.announcement)
		.filter(([, chunk]) => intersects(input.bbox, chunk.bbox))
		.sort(([left], [right]) => left.localeCompare(right))
	if (chunks.length === 0) throw new Error('No map files intersect the selected area')
	if (chunks.length > MAX_REGION_BLOBS) {
		throw new Error(`This area requires more than ${MAX_REGION_BLOBS} map files`)
	}

	let knownBytes = 0
	let unknownSizeCount = 0
	const basemapBlobs: SavedRegionBlobInput[] = chunks.map(([, chunk], ordinal) => {
		const match = chunk.file.match(SHA256_FILE)
		if (!match?.[1]) throw new Error('A map file is not bound to a SHA-256 identity')
		if (chunk.size === undefined) {
			throw new Error('A map file does not publish its signed download size')
		}
		if (
			!Number.isSafeInteger(chunk.size) ||
			chunk.size <= 0 ||
			chunk.size > MAX_MAP_LAYER_BLOB_BYTES
		) {
			throw new Error('A map file exceeds the 2 GiB offline file limit')
		}
		knownBytes += chunk.size
		return {
			sha256: match[1],
			role: 'basemap' as const,
			required: true,
			ordinal,
			expectedSize: chunk.size,
			mirrorUrls: mirrors.map((mirror) => `${mirror.replace(/\/$/u, '')}/${chunk.file}`),
		}
	})
	const contentBlobs = planContentBlobs(input.events, basemapBlobs.length)
	if (basemapBlobs.length + contentBlobs.length > MAX_REGION_BLOBS) {
		throw new Error(`This area requires more than ${MAX_REGION_BLOBS} offline files`)
	}
	for (const blob of contentBlobs) {
		if (blob.expectedSize === undefined) unknownSizeCount += 1
		else knownBytes += blob.expectedSize
	}
	const blobs = [...basemapBlobs, ...contentBlobs]
	validateMirrorManifest(blobs)

	return {
		request: {
			version: 1,
			id: input.id,
			name: input.name.trim(),
			bbox: input.bbox,
			layerId: input.layer.id,
			sourcePubkey: input.sourcePubkey,
			announcementId: input.announcementId,
			blobs,
			events: input.events,
		},
		chunkCount: basemapBlobs.length,
		bytesTotal: unknownSizeCount === 0 ? knownBytes : null,
		unknownSizeCount,
	}
}
