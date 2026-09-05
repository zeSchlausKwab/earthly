import { describe, expect, test } from 'bun:test'
import { nip19, verifyEvent } from 'nostr-tools'
import {
	extractStoryViewBlocks,
	parseMapPresentation,
	parseStoryMarkdown,
	reduceStoryViewBlocks,
} from '@/lib/map-presentation'
import { getArticleContent, isArticle } from '@/lib/nostr/article'
import { getFeatureCollection, isGeoDataset } from '@/lib/nostr/geo-event'
import { extractSemanticStoryReferencedCoordinates } from '@/lib/map-presentation/storyMarkdown'
import { extractNostrAddressReferences, naddrToCoordinate } from '@/lib/nostr/references'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import { buildWw1StoryFixture, WW1_DEMO_DISCLAIMER, WW1_DEMO_STORY_ID } from './ww1-story'

describe('WW1 synthetic Story fixture', () => {
	test('builds stable signed current-kind events without publishing or rewriting the source Maps', async () => {
		const first = await buildWw1StoryFixture()
		const second = await buildWw1StoryFixture()
		expect(first.events.map((event) => event.id)).toEqual(second.events.map((event) => event.id))
		expect(first.events.map((event) => event.kind)).toEqual([
			37515, 37515, 37515, 37515, 37515, 37520,
		])
		for (const event of first.events) {
			expect(verifyEvent(event)).toBe(true)
			expect(event.tags.find(([tag]) => tag === 'd')?.[1]).toStartWith('ww1-demo-')
			expect(event.tags.some(([tag]) => tag === 'v')).toBe(false)
			expect(event.content).toContain(WW1_DEMO_DISCLAIMER)
		}
		for (const map of Object.values(first.maps)) {
			expect(isGeoDataset(map.event)).toBe(true)
			expect(map.event.pubkey).not.toBe(first.story.event.pubkey)
			expect(getFeatureCollection(map.event)).toEqual(map.collection)
			expect(
				map.collection.features.every((feature) => feature.properties?.color === '#68747d'),
			).toBe(true)
		}
		expect(first.maps['ww1-battles'].collection.features).toHaveLength(7)
		expect(isArticle(first.story.event)).toBe(true)
		expect(nip19.decode(first.story.naddr)).toMatchObject({
			type: 'naddr',
			data: { kind: 37520, identifier: WW1_DEMO_STORY_ID },
		})
		expect(first.story.path).toBe(`/story/${first.story.naddr}`)
		expect(first.story.readerPath).toBe(`/read/${first.story.naddr}`)
	})

	test('uses production codecs, canonical references, complete authorizations and four chronological cues', async () => {
		const fixture = await buildWw1StoryFixture()
		const content = getArticleContent(fixture.story.event)
		expect(parseMapPresentation(content.presentation)).toMatchObject({
			status: 'valid',
			issues: [],
		})
		expect(parseStoryMarkdown(fixture.markdown).issues).toEqual([])
		expect(extractStoryViewBlocks(fixture.markdown)).toEqual(fixture.views)
		expect(() => validateStoryPresentation(content)).not.toThrow()
		expect(
			fixture.views.filter((view) => view.display !== 'figure').map((view) => view.id),
		).toEqual(['ww1-1914', 'ww1-1916', 'ww1-spring-1918', 'ww1-armistice'])
		expect(new Set(fixture.views.map((view) => view.display))).toEqual(
			new Set(['both', 'cue', 'figure']),
		)
		const addresses = Object.values(fixture.maps)
			.map((map) => map.address)
			.sort()
		expect(extractSemanticStoryReferencedCoordinates(fixture.markdown).sort()).toEqual(addresses)
		expect(
			fixture.story.event.tags
				.filter(([tag]) => tag === 'a')
				.map(([, address]) => address)
				.sort(),
		).toEqual(addresses)
		const references = extractNostrAddressReferences(fixture.markdown)
		expect(
			references
				.filter((reference) => reference.featureId)
				.map((reference) => reference.featureId)
				.sort(),
		).toEqual(['amiens', 'argonne', 'cambrai', 'marne', 'somme', 'verdun', 'ypres'])
		for (const reference of references)
			expect(addresses.some((address) => address === naddrToCoordinate(reference.address))).toBe(true)
	})

	test('reuses foreign Map instances and selects real source features, with per-view styles and opacity', async () => {
		const fixture = await buildWw1StoryFixture()
		const battleInstances = fixture.presentation.layers.filter(
			(layer) => layer.source === fixture.maps['ww1-battles'].address,
		)
		expect(battleInstances).toHaveLength(4)
		expect(battleInstances.find((layer) => layer.id === 'battles-1916')?.featureIds).toEqual([
			'verdun',
			'somme',
		])
		expect(
			fixture.presentation.layers.filter(
				(layer) => layer.source === fixture.maps['front-1914'].address,
			),
		).toHaveLength(2)
		for (const layer of fixture.presentation.layers) {
			const map = Object.values(fixture.maps).find((source) => source.address === layer.source)
			expect(map).toBeDefined()
			const ids = map?.collection.features.map((feature) => String(feature.id)) ?? []
			for (const id of layer.featureIds ?? []) expect(ids).toContain(id)
		}
		const reduction = reduceStoryViewBlocks(fixture.presentation, fixture.views)
		expect(reduction.issues).toEqual([])
		const second = reduction.snapshots.find((snapshot) => snapshot.view.id === 'ww1-1916')
		expect(second?.state.layers.find((layer) => layer.id === 'front-1916')).toMatchObject({
			visible: true,
			style: { color: '#b45309', strokeWidth: 5 },
		})
		const last = reduction.snapshots.at(-1)
		expect(last?.state.layers.find((layer) => layer.id === 'front-1918-armistice')).toMatchObject({
			visible: true,
			opacityMultiplier: 0.95,
			style: { color: '#166534' },
		})
		expect(last?.state.layers.find((layer) => layer.id === 'front-1914-ghost')?.visible).toBe(false)
	})
})
