import { describe, expect, test } from 'bun:test'
import { ArticleFactory } from '@/lib/nostr/article'
import { GroupFactory } from '@/lib/nostr/group'
import { localMapReference } from '@/lib/nostr/story/localReferences'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import { prepareStoryMapAuthoring } from '@/features/chat/tools/story-presentation'
import {
	buildPresentationSourceRequests,
	deriveAtlasPresentationAuthorization,
	deriveStoryPresentationAuthorization,
	authorizePresentationLayer,
} from './authorization'
import {
	mapPresentationSourceKey,
	parseMapPresentation,
	parseLocalMapPresentationSource,
	resolveLocalMapPresentationSource,
} from './codec'
import { addPresentationLayer } from './authoring'
import { reduceStoryViewBlocks } from './views'
import type { MapPresentationV1, StoryViewBlockV1 } from './types'

const SOURCE = { kind: 'local-map' as const, workspaceId: 'local-workspace' }
const MENTION = localMapReference(SOURCE.workspaceId)
const COORDINATE = `37515:${'a'.repeat(64)}:published-map`
const OPENING: MapPresentationV1 = {
	version: 1,
	initialView: { center: [45, 35], zoom: 4 },
	layers: [{ id: 'regions', source: SOURCE, visible: true, opacityMultiplier: 1 }],
}

describe('local presentation authoring and authorization', () => {
	test('canonicalizes explicit local sources and rejects unknown or empty identities', () => {
		expect(parseLocalMapPresentationSource({ ...SOURCE, draftId: 'guess' })).toBeNull()
		expect(parseLocalMapPresentationSource({ kind: 'local-map', workspaceId: '' })).toBeNull()
		const parsed = parseMapPresentation(OPENING)
		expect(parsed.status).toBe('valid')
		if (parsed.status !== 'valid') throw new Error('Expected parsed local presentation')
		expect(parsed.issues).toEqual([])
		expect(parsed.value.layers[0]?.source).toEqual(SOURCE)
		expect(mapPresentationSourceKey(SOURCE)).toBe(MENTION)
	})

	test('draft-only semantic references grant exact feature scope without relay requests', () => {
		const markdown = `${localMapReference(SOURCE.workspaceId, 'relation/123')}\n\`\`\`json\n${MENTION}\n\`\`\``
		const authorization = deriveStoryPresentationAuthorization(markdown, {
			allowLocalDraftReferences: true,
		})
		const selected = { ...OPENING.layers[0]!, source: { ...SOURCE }, featureIds: ['relation/123'] }
		expect(authorizePresentationLayer(selected, authorization).status).toBe('authorized')
		expect(authorizePresentationLayer(OPENING.layers[0]!, authorization).status).toBe(
			'unauthorized-features',
		)
		expect(
			authorizePresentationLayer({ ...selected, featureIds: ['other'] }, authorization).status,
		).toBe('unauthorized-features')
		expect(
			buildPresentationSourceRequests(
				parseMapPresentation({ ...OPENING, layers: [selected] }),
				authorization,
			),
		).toEqual([])
		expect(deriveStoryPresentationAuthorization(markdown).size).toBe(0)
		expect(deriveAtlasPresentationAuthorization([MENTION]).size).toBe(0)
		expect(
			deriveAtlasPresentationAuthorization([MENTION], { allowLocalDraftReferences: true }).get(
				MENTION,
			)?.scope,
		).toBe('whole')
	})

	test('draft Story authoring retains cameras, repeated layers and named view patches', () => {
		const authorization = deriveStoryPresentationAuthorization(MENTION, {
			allowLocalDraftReferences: true,
		})
		const repeated = addPresentationLayer(OPENING, { ...SOURCE }, authorization)
		expect(repeated.layers).toHaveLength(2)
		expect(repeated.layers[0]?.id).not.toBe(repeated.layers[1]?.id)
		const prepared = prepareStoryMapAuthoring({
			markdown: MENTION,
			presentation: repeated,
			replacePresentation: true,
		})
		expect(prepared.presentation).toEqual(repeated)
		const view: StoryViewBlockV1 = {
			version: 1,
			type: 'view',
			id: 'close',
			title: 'Regional detail',
			caption: 'A closer view',
			display: 'both',
			camera: { center: [44, 36], zoom: 7 },
			layers: { regions: { opacityMultiplier: 0.6 } },
		}
		const reduced = reduceStoryViewBlocks(repeated, [view])
		expect(reduced.snapshots[0]?.state.camera).toEqual(view.camera)
		expect(reduced.snapshots[0]?.state.layers[0]?.source).toEqual(SOURCE)
		expect(reduced.snapshots[0]?.state.layers[0]?.opacityMultiplier).toBe(0.6)
		expect(() => validateStoryPresentation({ content: MENTION, presentation: repeated })).toThrow(
			'local Map drafts',
		)
	})

	test('explicit Map publication resolution preserves selectors, cameras and layer ids', () => {
		const resolved = resolveLocalMapPresentationSource(OPENING, SOURCE.workspaceId, COORDINATE)
		expect(resolved).toEqual({ ...OPENING, layers: [{ ...OPENING.layers[0], source: COORDINATE }] })
		expect(resolveLocalMapPresentationSource(OPENING, 'other', COORDINATE)).toEqual(OPENING)
	})
})

describe('public factory boundary', () => {
	let signed = 0
	const signer = async (event: {
		kind: number
		tags: string[][]
		content: string
		created_at?: number
	}) => {
		signed += 1
		return {
			...event,
			created_at: event.created_at ?? 1,
			id: 'a'.repeat(64),
			pubkey: 'b'.repeat(64),
			sig: 'c'.repeat(128),
		}
	}
	test('rejects local Story and Atlas presentations before invoking the signer', async () => {
		const before = signed
		await expect(
			ArticleFactory.create({ content: 'Plain prose', presentation: OPENING }).sign(signer),
		).rejects.toThrow('local Map drafts')
		await expect(
			GroupFactory.create({ name: 'Atlas', presentation: OPENING }).sign(signer),
		).rejects.toThrow('local Map drafts')
		await expect(
			GroupFactory.create({ presentation: { version: 99, layers: OPENING.layers } }).sign(signer),
		).rejects.toThrow('local Map drafts')
		await expect(
			GroupFactory.create().referencedAddresses(['earthly-story-draft:local-story']).sign(signer),
		).rejects.toThrow('local drafts')
		await expect(ArticleFactory.create({ content: MENTION }).sign(signer)).rejects.toThrow(
			'local Map drafts',
		)
		expect(signed).toBe(before)
	})
	test('preserves opaque future presentations that contain no local source', async () => {
		const future = { version: 99, arbitrary: ['opaque'] }
		const event = await GroupFactory.create({ presentation: future }).sign(signer)
		expect(JSON.parse(event.content).presentation).toEqual(future)
	})
})
