import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import type { GeoBlobReference } from '@/lib/nostr/geo-event/helpers'
import { resolveOGGeoBlobReferences } from './resolveGeoBlobs'

const encoder = new TextEncoder()

function encoded(payload: unknown): Uint8Array {
	return encoder.encode(JSON.stringify(payload))
}

function hash(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

function reference(
	url: string,
	bytes: Uint8Array,
	overrides: Partial<GeoBlobReference> = {},
): GeoBlobReference {
	return {
		scope: 'collection',
		url,
		sha256: hash(bytes),
		size: bytes.byteLength,
		mimeType: 'application/geo+json',
		...overrides,
	}
}

describe('resolveOGGeoBlobReferences', () => {
	test('merges collection blobs and verifies their signed hash', async () => {
		const bytes = encoded({
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'port',
					properties: { name: 'Port' },
					geometry: { type: 'Point', coordinates: [56.2, 25.3] },
				},
			],
		})
		const resolved = await resolveOGGeoBlobReferences(
			{ type: 'FeatureCollection', features: [] },
			[reference('https://blossom.example/valid', bytes)],
			{ loadBytes: async () => bytes },
		)

		expect(resolved.totalFeatureCount).toBe(1)
		expect(resolved.resolvedReferenceCount).toBe(1)
		expect(resolved.featureCollection.features[0]?.id).toBe('port')
	})

	test('keeps inline geometry when the blob hash does not match', async () => {
		const bytes = encoded({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Point', coordinates: [1, 2] },
		})
		const base: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'inline',
					properties: {},
					geometry: { type: 'Point', coordinates: [3, 4] },
				},
			],
		}
		const resolved = await resolveOGGeoBlobReferences(
			base,
			[
				{
					...reference('https://blossom.example/bad-hash', bytes),
					sha256: '0'.repeat(64),
				},
			],
			{ loadBytes: async () => bytes },
		)

		expect(resolved.resolvedReferenceCount).toBe(0)
		expect(resolved.featureCollection.features.map((feature) => feature.id)).toEqual(['inline'])
	})

	test('does not resolve a mutable external reference without a content hash', async () => {
		let loaded = false
		const resolved = await resolveOGGeoBlobReferences(
			{ type: 'FeatureCollection', features: [] },
			[
				{
					scope: 'collection',
					url: 'https://blossom.example/mutable',
				},
			],
			{
				loadBytes: async () => {
					loaded = true
					return encoded({
						type: 'Feature',
						properties: {},
						geometry: { type: 'Point', coordinates: [1, 2] },
					})
				},
			},
		)

		expect(loaded).toBe(false)
		expect(resolved.resolvedReferenceCount).toBe(0)
	})

	test('applies feature-scoped blobs as replacements', async () => {
		const replacement = encoded({
			type: 'Feature',
			id: 'road',
			properties: { name: 'Updated road' },
			geometry: {
				type: 'LineString',
				coordinates: [
					[1, 1],
					[2, 2],
				],
			},
		})
		const base: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'road',
					properties: { name: 'Old road' },
					geometry: { type: 'Point', coordinates: [0, 0] },
				},
				{
					type: 'Feature',
					id: 'camp',
					properties: {},
					geometry: { type: 'Point', coordinates: [3, 3] },
				},
			],
		}
		const resolved = await resolveOGGeoBlobReferences(
			base,
			[
				reference('https://blossom.example/replacement', replacement, {
					scope: 'feature',
					featureId: 'road',
				}),
			],
			{ loadBytes: async () => replacement },
		)

		expect(resolved.featureCollection.features).toHaveLength(2)
		expect(
			resolved.featureCollection.features.find((feature) => feature.id === 'road')?.properties
				?.name,
		).toBe('Updated road')
	})

	test('samples a large resolved collection deterministically for rendering', async () => {
		const bytes = encoded({
			type: 'FeatureCollection',
			features: Array.from({ length: 10 }, (_, index) => ({
				type: 'Feature',
				id: index,
				properties: {},
				geometry: { type: 'Point', coordinates: [index, index] },
			})),
		})
		const resolved = await resolveOGGeoBlobReferences(
			{ type: 'FeatureCollection', features: [] },
			[reference('https://blossom.example/large', bytes)],
			{ loadBytes: async () => bytes, maxFeatures: 3 },
		)

		expect(resolved.totalFeatureCount).toBe(10)
		expect(resolved.featureCollection.features.map((feature) => feature.id)).toEqual([0, 3, 6])
	})

	test('skips a reference whose declared size exceeds the preview budget', async () => {
		let loaded = false
		const resolved = await resolveOGGeoBlobReferences(
			{ type: 'FeatureCollection', features: [] },
			[
				{
					scope: 'collection',
					url: 'https://blossom.example/oversized',
					size: 25 * 1024 * 1024,
				},
			],
			{
				loadBytes: async () => {
					loaded = true
					return new Uint8Array()
				},
			},
		)

		expect(loaded).toBe(false)
		expect(resolved.resolvedReferenceCount).toBe(0)
	})
})
