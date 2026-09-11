import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	deriveAtlasPresentationAuthorization,
	type MapPresentationAuthorization,
} from './authorization'
import { parseMapPresentation } from './codec'
import {
	getPresentationDatasetSource,
	indexPresentationSourceEvents,
	resolvePresentationLayers,
	type PresentationSourceResolution,
} from './runtime'
import type { MapPresentationSource } from './types'

const PK = 'a'.repeat(64)
const OTHER_PK = 'b'.repeat(64)
const SOURCE = `37515:${PK}:battlefield` as MapPresentationSource
const UNAUTHORIZED_SOURCE = `37515:${OTHER_PK}:secret` as MapPresentationSource

function sourceEvent(
	id: string,
	createdAt = 1,
	featureCollection: FeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'present',
				properties: {},
				geometry: { type: 'Point', coordinates: [1, 2] },
			},
		],
	},
): GeoDataset {
	return {
		id,
		kind: 37515,
		pubkey: PK,
		datasetId: 'battlefield',
		created_at: createdAt,
		featureCollection,
		blobReferences: [],
	} as unknown as GeoDataset
}

function presentation() {
	return parseMapPresentation({
		version: 1,
		layers: [
			{
				id: 'partial',
				source: SOURCE,
				featureIds: ['present', 'gone'],
				visible: true,
				opacityMultiplier: 1,
			},
			{
				id: 'all-missing',
				source: SOURCE,
				featureIds: ['gone'],
				visible: true,
				opacityMultiplier: 1,
			},
			{
				id: 'empty-intentionally',
				source: SOURCE,
				featureIds: [],
				visible: true,
				opacityMultiplier: 1,
			},
			{
				id: 'unauthorized',
				source: UNAUTHORIZED_SOURCE,
				visible: true,
				opacityMultiplier: 1,
			},
		],
	})
}

function states(
	state: PresentationSourceResolution,
): ReadonlyMap<MapPresentationSource, PresentationSourceResolution> {
	return new Map([[SOURCE, state]])
}

describe('presentation runtime resolution', () => {
	const authorization: MapPresentationAuthorization = deriveAtlasPresentationAuthorization([SOURCE])

	test('preserves layer order and differentiates partial, missing, empty, and unauthorized', () => {
		const event = sourceEvent('event-1')
		const runtime = resolvePresentationLayers(
			presentation(),
			authorization,
			states({
				status: 'resolved',
				sourceEvent: event,
				featureCollection: event.featureCollection,
			}),
		)

		expect(runtime.layers.map((layer) => layer.layer.id)).toEqual([
			'partial',
			'all-missing',
			'empty-intentionally',
			'unauthorized',
		])
		expect(runtime.layers.map((layer) => layer.status)).toEqual([
			'partial-missing',
			'missing-features',
			'resolved',
			'unauthorized-source',
		])
		expect(runtime.layers[0]?.featureCollection.features.map((feature) => feature.id)).toEqual([
			'present',
		])
		expect(runtime.layers[1]?.featureCollection.features).toEqual([])
		expect(runtime.layers[2]?.featureCollection.features).toEqual([])
		expect(runtime.layers[3]?.featureCollection.features).toEqual([])
	})

	test('keeps loading, missing source, and blob errors explicit and empty', () => {
		const event = sourceEvent('event-1')
		for (const [sourceState, expected] of [
			[{ status: 'loading' }, 'loading'],
			[{ status: 'missing-source' }, 'missing-source'],
			[{ status: 'blob-error', sourceEvent: event, error: 'checksum mismatch' }, 'blob-error'],
		] as const) {
			const runtime = resolvePresentationLayers(presentation(), authorization, states(sourceState))
			expect(runtime.layers[0]?.status).toBe(expected)
			expect(runtime.layers[0]?.featureCollection.features).toEqual([])
		}
	})

	test('retains codec diagnostics while refusing a malformed layers root', () => {
		const parsed = parseMapPresentation({ version: 1, layers: null })
		const runtime = resolvePresentationLayers(parsed, authorization, new Map())
		expect(runtime.presentation).toBeNull()
		expect(runtime.layers).toEqual([])
		expect(runtime.issues[0]?.code).toBe('invalid-layers')
	})
})

describe('source event identity', () => {
	test('uses exact coordinate identity and deterministically selects the latest event', () => {
		const older = sourceEvent('a'.repeat(64), 1)
		const tieLow = sourceEvent('b'.repeat(64), 2)
		const tieHigh = sourceEvent('c'.repeat(64), 2)
		expect(getPresentationDatasetSource(older)).toBe(SOURCE)
		expect(indexPresentationSourceEvents([tieLow, older, tieHigh]).get(SOURCE)).toBe(tieHigh)
	})
})
