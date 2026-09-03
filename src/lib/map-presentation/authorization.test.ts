import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	authorizePresentationLayer,
	buildFallbackAtlasPresentation,
	buildFallbackStoryPresentation,
	buildPresentationSourceRequests,
	deriveAtlasPresentationAuthorization,
	deriveStoryPresentationAuthorization,
	getUsableMapPresentation,
} from './authorization'
import { parseMapPresentation } from './codec'
import type { MapPresentationLayerV1, MapPresentationSource } from './types'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const SOURCE_A = `${GEO_EVENT_KIND}:${ALICE}:front:1916` as MapPresentationSource
const SOURCE_B = `${GEO_EVENT_KIND}:${ALICE}:trenches` as MapPresentationSource
const SOURCE_C = `${GEO_EVENT_KIND}:${BOB}:front:1916` as MapPresentationSource

function naddr(source: MapPresentationSource): string {
	const first = source.indexOf(':')
	const second = source.indexOf(':', first + 1)
	return nip19.naddrEncode({
		kind: GEO_EVENT_KIND,
		pubkey: source.slice(first + 1, second),
		identifier: source.slice(second + 1),
	})
}

function layer(
	source: MapPresentationSource,
	featureIds?: readonly string[],
): MapPresentationLayerV1 {
	return {
		id: `layer-${source.slice(-4)}-${featureIds?.length ?? 'all'}`,
		source,
		...(featureIds !== undefined ? { featureIds } : {}),
		visible: true,
		opacityMultiplier: 1,
	}
}

describe('Story presentation authorization', () => {
	test('uses semantic body references, excluding ordinary and earthly-view fences', () => {
		const markdown = [
			`Visible nostr:${naddr(SOURCE_A)}#fort-a.`,
			'```md',
			`not semantic nostr:${naddr(SOURCE_B)}`,
			'```',
			'```earthly-view',
			JSON.stringify({ source: SOURCE_C }),
			'```',
		].join('\n')
		const authorization = deriveStoryPresentationAuthorization(markdown)

		expect([...authorization.keys()]).toEqual([SOURCE_A])
		expect(authorization.get(SOURCE_A)).toEqual({
			source: SOURCE_A,
			scope: 'features',
			featureIds: ['fort-a'],
		})
	})

	test('a whole-Map mention dominates feature-only mentions for the same source', () => {
		const address = naddr(SOURCE_A)
		const authorization = deriveStoryPresentationAuthorization(
			`nostr:${address}#one then nostr:${address} then nostr:${address}#two`,
		)
		expect(authorization.get(SOURCE_A)).toEqual({ source: SOURCE_A, scope: 'whole' })
	})

	test('feature grants are ordered, deduplicated, and strict', () => {
		const address = naddr(SOURCE_A)
		const authorization = deriveStoryPresentationAuthorization(
			`nostr:${address}#one nostr:${address}#two nostr:${address}#one`,
		)
		expect(authorization.get(SOURCE_A)).toEqual({
			source: SOURCE_A,
			scope: 'features',
			featureIds: ['one', 'two'],
		})
		expect(authorizePresentationLayer(layer(SOURCE_A, ['one']), authorization)).toEqual({
			status: 'authorized',
		})
		expect(authorizePresentationLayer(layer(SOURCE_A, ['one', 'three']), authorization)).toEqual({
			status: 'unauthorized-features',
			featureIds: ['three'],
			requestedWholeMap: false,
		})
		expect(authorizePresentationLayer(layer(SOURCE_A), authorization)).toEqual({
			status: 'unauthorized-features',
			featureIds: [],
			requestedWholeMap: true,
		})
	})

	test('builds a selector-safe fallback for Stories without an authored presentation', () => {
		const presentation = buildFallbackStoryPresentation(
			`nostr:${naddr(SOURCE_A)}#fort-a then nostr:${naddr(SOURCE_B)}`,
		)

		expect(presentation).toEqual({
			version: 1,
			layers: [
				{
					id: 'reference-1',
					source: SOURCE_A,
					featureIds: ['fort-a'],
					visible: true,
					opacityMultiplier: 1,
				},
				{
					id: 'reference-2',
					source: SOURCE_B,
					visible: true,
					opacityMultiplier: 1,
				},
			],
		})
	})
})

describe('Atlas presentation authorization and exact fetch planning', () => {
	test('accepts only exact kind-37515 coordinates from the curated a lane', () => {
		const authorization = deriveAtlasPresentationAuthorization([
			SOURCE_A,
			SOURCE_A,
			`37518:${ALICE}:atlas`,
			naddr(SOURCE_B),
			'not-a-coordinate',
		])
		expect([...authorization.keys()]).toEqual([SOURCE_A])
	})

	test('falls back to the curated lane in tag order without accepting foreign references', () => {
		expect(
			buildFallbackAtlasPresentation([
				SOURCE_B,
				`37518:${ALICE}:foreign-context`,
				SOURCE_A,
				SOURCE_B,
			]),
		).toEqual({
			version: 1,
			layers: [
				{
					id: 'atlas-map-1',
					source: SOURCE_B,
					visible: true,
					opacityMultiplier: 1,
				},
				{
					id: 'atlas-map-2',
					source: SOURCE_A,
					visible: true,
					opacityMultiplier: 1,
				},
			],
		})
	})

	test('builds one exact filter per source, never an author×d-tag product', () => {
		const parsed = parseMapPresentation({
			version: 1,
			layers: [
				layer(SOURCE_A),
				{ ...layer(SOURCE_A), id: 'duplicate-render-instance', opacityMultiplier: 0.4 },
				layer(SOURCE_B),
				layer(SOURCE_C),
			],
		})
		const authorization = deriveAtlasPresentationAuthorization([SOURCE_A, SOURCE_B])
		const requests = buildPresentationSourceRequests(parsed, authorization)

		expect(requests).toEqual([
			{
				source: SOURCE_A,
				filter: { kinds: [GEO_EVENT_KIND], authors: [ALICE], '#d': ['front:1916'] },
			},
			{
				source: SOURCE_B,
				filter: { kinds: [GEO_EVENT_KIND], authors: [ALICE], '#d': ['trenches'] },
			},
		])
	})

	test('an invalid layers root is unusable while its diagnostic survives', () => {
		const parsed = parseMapPresentation({ version: 1, layers: 'not-an-array' })
		expect(getUsableMapPresentation(parsed)).toBeNull()
		expect(parsed.issues).toContainEqual(
			expect.objectContaining({ code: 'invalid-layers', path: '$.layers' }),
		)
	})

	test('retains individual-layer diagnostics while fetching other valid instances', () => {
		const parsed = parseMapPresentation({
			version: 1,
			layers: [
				{ id: 'bad', source: '37515:not-a-pubkey:bad' },
				{ ...layer(SOURCE_A), id: 'good' },
			],
		})
		const authorization = deriveAtlasPresentationAuthorization([SOURCE_A])
		expect(getUsableMapPresentation(parsed)?.layers.map((entry) => entry.id)).toEqual(['good'])
		expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'invalid-source' }))
		expect(
			buildPresentationSourceRequests(parsed, authorization).map((entry) => entry.source),
		).toEqual([SOURCE_A])
	})
})
