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

// Track failed URLs to avoid repeated requests
const failedUrls = new Set<string>()

/**
 * Fetch with streaming progress reporting.
 * Uses ReadableStream to track download progress against known total size.
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
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			// Get total size from Content-Length header or known size from blob reference
			const contentLength = response.headers.get('Content-Length')
			const total = knownSize ?? (contentLength ? parseInt(contentLength, 10) : 0)

			// If no body or no progress callback, fall back to simple text()
			if (!response.body || !onProgress || total === 0) {
				const text = await response.text()
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

			// Don't retry on abort or if it's the last attempt
			if (controller.signal.aborted || attempt === maxRetries - 1) {
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

	// Skip URLs that have previously failed (after all retries)
	if (failedUrls.has(reference.url)) {
		return null
	}

	if (!globalThis.fetch) {
		throw new Error('fetch API is not available in this environment.')
	}

	try {
		const text = await fetchWithProgress(reference.url, reference.size, onProgress)

		const json = await parseJsonInWorker(text)

		if (!isGeoJsonFeatureCollection(json) && !isGeoJsonFeature(json) && !isGeoJsonGeometry(json)) {
			console.warn(
				`Blob payload at ${reference.url} is not a valid GeoJSON Feature, FeatureCollection, or Geometry.`,
			)
			failedUrls.add(reference.url)
			return null
		}
		blobCache.set(reference.url, json)
		return json
	} catch (error) {
		// Network error or other fetch failure (after retries)
		failedUrls.add(reference.url)
		console.warn(`Failed to fetch blob reference ${reference.url}:`, error)
		return null
	}
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
