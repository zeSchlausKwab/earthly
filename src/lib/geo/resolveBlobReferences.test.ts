import { afterEach, describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	GeoBlobResolutionError,
	resolveGeoEventFeatureCollection,
	resolveGeoEventFeatureCollectionDetailed,
	resolveGeoEventFeatureCollectionOrThrow,
} from './resolveBlobReferences'

const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

function dataset(url: string, hash: string): GeoDataset {
	return {
		featureCollection: { type: 'FeatureCollection', features: [] },
		blobReferences: [{ scope: 'collection', url, sha256: hash }],
	} as unknown as GeoDataset
}

const payload: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'offline-point',
			properties: { name: 'Local trailhead' },
			geometry: { type: 'Point', coordinates: [16.37, 48.21] },
		},
	],
}

describe('GeoJSON blob resolution', () => {
	test('uses a verified native local-blob URL before the event URL', async () => {
		const text = JSON.stringify(payload)
		const hash = await sha256(text)
		const requests: string[] = []
		globalThis.fetch = (async (input) => {
			requests.push(String(input))
			return new Response(text, {
				status: 200,
				headers: { 'Content-Length': String(new TextEncoder().encode(text).length) },
			})
		}) as typeof fetch

		const resolved = await resolveGeoEventFeatureCollection(
			dataset('https://offline.invalid/dataset.json', hash),
			{
				localBlobUrl: async (sha) => `earthly-blob://localhost/${sha}`,
			},
		)

		expect(requests).toEqual([`earthly-blob://localhost/${hash}`])
		expect(resolved.features[0]?.id).toBe('offline-point')
	})

	test('falls back to the signed event URL when the local hash is absent', async () => {
		const text = JSON.stringify({
			...payload,
			features: [{ ...payload.features[0], id: 'remote-fallback' }],
		})
		const hash = await sha256(text)
		const remoteUrl = 'https://mirror.example/dataset.json'
		const requests: string[] = []
		globalThis.fetch = (async (input) => {
			const url = String(input)
			requests.push(url)
			return url.startsWith('earthly-blob:')
				? new Response('missing', { status: 404, statusText: 'Not Found' })
				: new Response(text, { status: 200 })
		}) as typeof fetch

		const resolved = await resolveGeoEventFeatureCollection(dataset(remoteUrl, hash), {
			localBlobUrl: async (sha) => `earthly-blob://localhost/${sha}`,
		})

		expect(requests).toEqual([`earthly-blob://localhost/${hash}`, remoteUrl])
		expect(resolved.features[0]?.id).toBe('remote-fallback')
	})

	test('discards a corrupt local copy and verifies the signed event URL fallback', async () => {
		const originalFeature = payload.features[0]
		if (!originalFeature) throw new Error('Expected the test payload to contain one feature')
		const remotePayload: FeatureCollection = {
			...payload,
			features: [{ ...originalFeature, id: 'verified-remote-fallback' }],
		}
		const text = JSON.stringify(remotePayload)
		const hash = await sha256(text)
		const remoteUrl = 'https://mirror.example/verified-dataset.json'
		const requests: string[] = []
		globalThis.fetch = (async (input) => {
			const url = String(input)
			requests.push(url)
			return new Response(url.startsWith('earthly-blob:') ? '{"corrupt":true}' : text, {
				status: 200,
			})
		}) as typeof fetch

		const resolved = await resolveGeoEventFeatureCollection(dataset(remoteUrl, hash), {
			localBlobUrl: async (sha) => `earthly-blob://localhost/${sha}`,
		})

		expect(requests).toEqual([`earthly-blob://localhost/${hash}`, remoteUrl])
		expect(resolved.features[0]?.id).toBe('verified-remote-fallback')
	})

	test('reports blob failures and lets strict callers reject incomplete data', async () => {
		const remoteUrl = 'https://missing.example/presentation-source.json'
		let requests = 0
		globalThis.fetch = (async () => {
			requests += 1
			return new Response('missing', { status: 404, statusText: 'Not Found' })
		}) as unknown as typeof fetch
		const source = dataset(remoteUrl, '')

		const detailed = await resolveGeoEventFeatureCollectionDetailed(source, {
			localBlobUrl: async () => null,
		})
		expect(detailed.featureCollection.features).toEqual([])
		expect(detailed.failures).toHaveLength(1)
		expect(detailed.failures[0]).toMatchObject({ code: 'http', retryable: false })

		await expect(
			resolveGeoEventFeatureCollectionOrThrow(source, { localBlobUrl: async () => null }),
		).rejects.toBeInstanceOf(GeoBlobResolutionError)
		// Permanent URL failures are diagnostic-cached instead of refetched.
		expect(requests).toBe(1)
	})
})
