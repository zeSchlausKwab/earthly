import { createHash } from 'node:crypto'
import type { Feature, FeatureCollection } from 'geojson'
import { normalizeGeoJsonToFeatureCollection } from '@/lib/geo/normalizeGeoJSON'
import type { GeoBlobReference } from '@/lib/nostr/geo-event/helpers'
import { assertPublicHttpUrl } from './publicRemote'

const MAX_PREVIEW_BLOB_REFERENCES = 4
const MAX_PREVIEW_BLOB_BYTES = 12 * 1024 * 1024
const MAX_PREVIEW_TOTAL_BLOB_BYTES = 24 * 1024 * 1024
const MAX_PREVIEW_FEATURES = 600
const VALID_HASH = /^[0-9a-f]{64}$/u
const ACCEPTED_GEOJSON_MIME_TYPES = new Set([
	'application/geo+json',
	'application/json',
	'application/octet-stream',
	'text/json',
	'text/plain',
])

interface ParsedBlob {
	featureCollection: FeatureCollection
	byteLength: number
}

export interface ResolvedOGGeoBlobs {
	featureCollection: FeatureCollection
	totalFeatureCount: number
	resolvedReferenceCount: number
}

export interface ResolveOGGeoBlobsOptions {
	/**
	 * Test/runtime seam. Production uses the guarded public fetcher below; the
	 * returned bytes still pass through the same size, hash, and GeoJSON checks.
	 */
	loadBytes?: (reference: GeoBlobReference) => Promise<Uint8Array | null>
	maxFeatures?: number
}

const parsedBlobCache = new Map<string, ParsedBlob>()
const inflightBlobs = new Map<string, Promise<ParsedBlob | null>>()

function validHash(reference: GeoBlobReference): string | undefined {
	const hash = reference.sha256?.toLowerCase()
	return hash && VALID_HASH.test(hash) ? hash : undefined
}

function blobCacheKey(reference: GeoBlobReference): string {
	return `sha256:${validHash(reference)}`
}

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array | null> {
	if (!response.body) return new Uint8Array()
	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > limit) {
				await reader.cancel().catch(() => {})
				return null
			}
			chunks.push(value)
		}
	} catch {
		return null
	}

	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}

async function loadPublicGeoBlob(reference: GeoBlobReference): Promise<Uint8Array | null> {
	if (
		reference.size !== undefined &&
		(!Number.isFinite(reference.size) ||
			reference.size < 0 ||
			reference.size > MAX_PREVIEW_BLOB_BYTES)
	) {
		return null
	}

	const safeUrl = await assertPublicHttpUrl(reference.url)
	if (!safeUrl) return null

	try {
		const response = await fetch(safeUrl.href, {
			headers: {
				Accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.5',
				'User-Agent': 'Earthly/1.0 (+https://earthly.city) OGGeoJSON',
			},
			redirect: 'error',
			signal: AbortSignal.timeout(8000),
		})
		if (!response.ok) return null

		const rawMimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
		if (rawMimeType && !ACCEPTED_GEOJSON_MIME_TYPES.has(rawMimeType)) return null

		const contentLength = Number(response.headers.get('content-length'))
		if (Number.isFinite(contentLength) && contentLength > MAX_PREVIEW_BLOB_BYTES) return null

		return readBoundedBody(response, MAX_PREVIEW_BLOB_BYTES)
	} catch {
		return null
	}
}

function samplePreviewFeatures(
	featureCollection: FeatureCollection,
	limit: number,
): FeatureCollection {
	if (featureCollection.features.length <= limit) return featureCollection
	const step = featureCollection.features.length / limit
	const features = Array.from(
		{ length: limit },
		(_, index) => featureCollection.features[Math.floor(index * step)],
	).filter((feature): feature is Feature => Boolean(feature))
	return { ...featureCollection, features }
}

function parseGeoBlob(bytes: Uint8Array, expectedHash: string | undefined): ParsedBlob | null {
	if (bytes.byteLength > MAX_PREVIEW_BLOB_BYTES) return null
	if (expectedHash) {
		const actualHash = createHash('sha256').update(bytes).digest('hex')
		if (actualHash !== expectedHash) return null
	}

	let payload: unknown
	try {
		payload = JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		return null
	}

	const featureCollection = normalizeGeoJsonToFeatureCollection(payload)
	const features = featureCollection.features.filter((feature) => Boolean(feature.geometry))
	if (features.length === 0) return null

	return {
		featureCollection: { ...featureCollection, features },
		byteLength: bytes.byteLength,
	}
}

async function resolveBlob(
	reference: GeoBlobReference,
	loadBytes: (reference: GeoBlobReference) => Promise<Uint8Array | null>,
): Promise<ParsedBlob | null> {
	// A mutable URL cannot safely feed an image cached under the immutable Nostr
	// event id. Blossom references therefore need their content hash here.
	if (!validHash(reference)) return null
	const key = blobCacheKey(reference)
	const cached = parsedBlobCache.get(key)
	if (cached) return cached
	const inflight = inflightBlobs.get(key)
	if (inflight) return inflight

	const pending = (async () => {
		const bytes = await loadBytes(reference)
		if (!bytes) return null
		const parsed = parseGeoBlob(bytes, validHash(reference))
		if (parsed) parsedBlobCache.set(key, parsed)
		return parsed
	})().finally(() => {
		inflightBlobs.delete(key)
	})
	inflightBlobs.set(key, pending)
	return pending
}

function featureId(feature: Feature): string | undefined {
	if (typeof feature.id === 'string') return feature.id
	if (typeof feature.id === 'number') return String(feature.id)
	return undefined
}

/**
 * Resolve enough of an event's signed external GeoJSON to make its social card
 * meaningful. Failures are soft: the inline collection remains available and
 * the caller can still render the event's signed bbox.
 */
export async function resolveOGGeoBlobReferences(
	baseCollection: FeatureCollection,
	references: GeoBlobReference[],
	options: ResolveOGGeoBlobsOptions = {},
): Promise<ResolvedOGGeoBlobs> {
	let features = normalizeGeoJsonToFeatureCollection(baseCollection).features.filter((feature) =>
		Boolean(feature.geometry),
	)
	let resolvedReferenceCount = 0
	let consumedBytes = 0
	const loadBytes = options.loadBytes ?? loadPublicGeoBlob

	for (const reference of references.slice(0, MAX_PREVIEW_BLOB_REFERENCES)) {
		if (
			reference.size !== undefined &&
			(reference.size < 0 || reference.size > MAX_PREVIEW_TOTAL_BLOB_BYTES - consumedBytes)
		) {
			continue
		}

		const parsed = await resolveBlob(reference, loadBytes)
		if (!parsed || parsed.byteLength > MAX_PREVIEW_TOTAL_BLOB_BYTES - consumedBytes) continue
		consumedBytes += parsed.byteLength
		resolvedReferenceCount += 1

		const resolvedFeatures = parsed.featureCollection.features
		if (reference.scope === 'feature' && reference.featureId) {
			features = features.filter((feature) => featureId(feature) !== reference.featureId)
		}
		features = [...features, ...resolvedFeatures]
	}

	const totalFeatureCount = features.length
	const featureCollection = samplePreviewFeatures(
		{ ...baseCollection, type: 'FeatureCollection', features },
		options.maxFeatures ?? MAX_PREVIEW_FEATURES,
	)
	return { featureCollection, totalFeatureCount, resolvedReferenceCount }
}
