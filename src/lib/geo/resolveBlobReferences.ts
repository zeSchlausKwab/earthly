import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoBlobReference, GeoDataset } from '@/lib/nostr/geo-event'
import {
	isGeoJsonFeature,
	isGeoJsonFeatureCollection,
	isGeoJsonGeometry,
	normalizeGeoJsonToFeatureCollection,
} from './normalizeGeoJSON'
import { parseJsonInWorker } from './workerJsonParse'

type BlobPayload = FeatureCollection | Feature | Geometry

/** Progress callback for tracking blob download */
export type BlobProgressCallback = (loaded: number, total: number) => void

const blobCache = new Map<string, BlobPayload>()

function cloneFeature(feature: Feature): Feature {
	return JSON.parse(JSON.stringify(feature))
}

function normalizeToFeatureArray(payload: BlobPayload): Feature[] {
	const normalized = normalizeGeoJsonToFeatureCollection(payload)
	return (normalized.features ?? []).filter((feature) => Boolean(feature.geometry)) as Feature[]
}

/** URLs that have permanently failed — skipped on subsequent calls. */
const failedUrls = new Set<string>()

/**
 * Hard cap per blob (SPEC §1.5). Protects against hostile/broken Blossom
 * servers streaming unbounded payloads into memory.
 */
const MAX_BLOB_SIZE_BYTES = 50 * 1024 * 1024

/** Signals "payload exceeded MAX_BLOB_SIZE_BYTES" — never retried. */
class BlobTooLargeError extends Error {
	constructor(url: string, size: number) {
		super(`Blob at ${url} exceeds the ${MAX_BLOB_SIZE_BYTES} byte cap (got ${size})`)
	}
}

/**
 * Verify a fetched blob against the `sha256=<hex>` parameter from its blob
 * tag (SPEC §1.5.1: hash of the uncompressed payload bytes). Returns true
 * when the hash matches or verification is unavailable (no WebCrypto).
 */
async function verifyBlobSha256(text: string, expectedHex: string): Promise<boolean> {
	if (!globalThis.crypto?.subtle) return true
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	const actualHex = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	return actualHex === expectedHex.toLowerCase()
}

/** In-flight fetches by URL, so concurrent callers share one network round-trip. */
const inFlight = new Map<string, Promise<BlobPayload | null>>()

/**
 * Error class that signals "don't bother retrying" — used for HTTP 4xx
 * responses where the resource definitively doesn't exist or we're forbidden.
 */
class NonRetryableHttpError extends Error {
	readonly status: number
	constructor(status: number, statusText: string) {
		super(`HTTP ${status}: ${statusText}`)
		this.status = status
	}
}

/**
 * Fetch with streaming progress reporting.
 *
 * Retries only on transient failures (network errors, timeouts, 5xx). 4xx
 * responses throw `NonRetryableHttpError` immediately — `fetchBlobReference`
 * marks the URL as permanently failed so we never re-try it this session.
 */
async function fetchWithProgress(
	url: string,
	knownSize: number | undefined,
	onProgress?: BlobProgressCallback,
	maxRetries = 3,
	timeoutMs = 60000, // Increased for large files
): Promise<string> {
	let lastError: Error | null = null

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetch(url, { signal: controller.signal })
			clearTimeout(timeoutId)

			if (!response.ok) {
				// 4xx → don't retry; the resource isn't going to appear by the next attempt.
				if (response.status >= 400 && response.status < 500) {
					throw new NonRetryableHttpError(response.status, response.statusText)
				}
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			// Get total size from Content-Length header or known size from blob reference
			const contentLength = response.headers.get('Content-Length')
			const total = knownSize ?? (contentLength ? parseInt(contentLength, 10) : 0)

			// Reject oversized payloads up-front when the size is declared…
			if (total > MAX_BLOB_SIZE_BYTES) {
				throw new BlobTooLargeError(url, total)
			}

			// If no body or no progress callback, fall back to simple text()
			if (!response.body || !onProgress || total === 0) {
				const text = await response.text()
				if (text.length > MAX_BLOB_SIZE_BYTES) {
					throw new BlobTooLargeError(url, text.length)
				}
				if (onProgress && total > 0) {
					onProgress(total, total)
				}
				return text
			}

			// Stream the response with progress tracking
			const reader = response.body.getReader()
			const chunks: Uint8Array[] = []
			let loaded = 0

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				chunks.push(value)
				loaded += value.length
				// …and enforce the cap while streaming, in case the server lied.
				if (loaded > MAX_BLOB_SIZE_BYTES) {
					await reader.cancel().catch(() => {})
					throw new BlobTooLargeError(url, loaded)
				}
				onProgress(loaded, total)
			}

			// Combine chunks and decode to string
			const combined = new Uint8Array(loaded)
			let offset = 0
			for (const chunk of chunks) {
				combined.set(chunk, offset)
				offset += chunk.length
			}

			return new TextDecoder().decode(combined)
		} catch (error) {
			clearTimeout(timeoutId)
			lastError = error as Error

			// Don't retry on abort, a non-retryable 4xx, an oversized payload, or
			// on the last attempt.
			if (
				controller.signal.aborted ||
				error instanceof NonRetryableHttpError ||
				error instanceof BlobTooLargeError ||
				attempt === maxRetries - 1
			) {
				throw lastError
			}

			// Exponential backoff: 1s, 2s, 4s
			const delay = 1000 * 2 ** attempt
			console.warn(`Blob fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
	}

	throw lastError ?? new Error('Fetch failed after retries')
}

async function fetchBlobReference(
	reference: GeoBlobReference,
	onProgress?: BlobProgressCallback,
): Promise<BlobPayload | null> {
	const cached = blobCache.get(reference.url)
	if (cached) return cached

	// Already known to be unfetchable — skip silently.
	if (failedUrls.has(reference.url)) {
		return null
	}

	if (!globalThis.fetch) {
		throw new Error('fetch API is not available in this environment.')
	}

	// Coalesce concurrent fetches of the same URL into a single round-trip.
	const existing = inFlight.get(reference.url)
	if (existing) return existing

	const pending = (async () => {
		try {
			const text = await fetchWithProgress(reference.url, reference.size, onProgress)

			// SPEC §1.5.1: when the blob tag carries a sha256, verify the payload.
			// A mismatch means the server returned corrupted or substituted data.
			if (reference.sha256 && !(await verifyBlobSha256(text, reference.sha256))) {
				console.warn(
					`Blob ${reference.url} failed sha256 verification (expected ${reference.sha256}). Discarding.`,
				)
				failedUrls.add(reference.url)
				return null
			}

			const json = await parseJsonInWorker(text)

			if (
				!isGeoJsonFeatureCollection(json) &&
				!isGeoJsonFeature(json) &&
				!isGeoJsonGeometry(json)
			) {
				console.warn(
					`Blob payload at ${reference.url} is not a valid GeoJSON Feature, FeatureCollection, or Geometry.`,
				)
				failedUrls.add(reference.url)
				return null
			}
			blobCache.set(reference.url, json)
			return json
		} catch (error) {
			failedUrls.add(reference.url)
			// Log with status detail so 404s are obviously distinguishable from network errors.
			if (error instanceof NonRetryableHttpError) {
				console.warn(
					`Blob ${reference.url} unavailable (HTTP ${error.status}). Marking as permanently failed.`,
				)
			} else {
				console.warn(`Failed to fetch blob reference ${reference.url}:`, error)
			}
			return null
		} finally {
			inFlight.delete(reference.url)
		}
	})()

	inFlight.set(reference.url, pending)
	return pending
}

export interface ResolveOptions {
	/** Called with aggregated progress across all blob references */
	onProgress?: BlobProgressCallback
}

export async function resolveGeoEventFeatureCollection(
	event: GeoDataset,
	options?: ResolveOptions,
): Promise<FeatureCollection> {
	const baseCollection = event.featureCollection
	if (event.blobReferences.length === 0) {
		return baseCollection
	}

	let features = normalizeGeoJsonToFeatureCollection(baseCollection)
		.features.filter((feature) => Boolean(feature.geometry))
		.map((feature) => cloneFeature(feature as Feature))

	// Calculate total size across all blob references for aggregate progress
	const totalSize = event.blobReferences.reduce((sum, ref) => sum + (ref.size ?? 0), 0)
	let completedSize = 0
	let currentRefProgress = 0

	for (const reference of event.blobReferences) {
		const refSize = reference.size ?? 0

		// Progress callback for this specific reference
		const onProgress = options?.onProgress
		const refProgress: BlobProgressCallback | undefined = onProgress
			? (loaded, total) => {
					currentRefProgress = loaded
					const aggregateLoaded = completedSize + currentRefProgress
					onProgress(aggregateLoaded, totalSize || total)
				}
			: undefined

		const payload = await fetchBlobReference(reference, refProgress)

		// Mark this reference as complete
		completedSize += refSize
		currentRefProgress = 0

		// Skip if blob couldn't be resolved (already logged in fetchBlobReference)
		if (!payload) continue

		const resolvedFeatures = normalizeToFeatureArray(payload).map(cloneFeature)
		if (resolvedFeatures.length === 0) continue

		if (reference.scope === 'collection') {
			features = [...features, ...resolvedFeatures]
			continue
		}

		if (reference.scope === 'feature') {
			const featureId = reference.featureId
			if (featureId) {
				features = features.filter((feature) => {
					const currentId =
						typeof feature.id === 'string'
							? feature.id
							: typeof feature.id === 'number'
								? String(feature.id)
								: undefined
					return currentId !== featureId
				})
			}
			features = [...features, ...resolvedFeatures]
		}
	}

	return normalizeGeoJsonToFeatureCollection({
		...baseCollection,
		type: 'FeatureCollection',
		features,
	})
}
