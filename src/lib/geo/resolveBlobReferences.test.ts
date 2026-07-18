import { afterEach, describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { resolveGeoEventFeatureCollection } from './resolveBlobReferences'

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
		const remotePayload: FeatureCollection = {
			...payload,
			features: [{ ...payload.features[0], id: 'verified-remote-fallback' }],
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
})
