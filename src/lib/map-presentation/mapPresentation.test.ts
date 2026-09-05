import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { ArticleFactory } from '@/lib/nostr/article'
import { GroupFactory } from '@/lib/nostr/group'
import {
	normalizeMapPresentation,
	parseMapPresentation,
	parseMapPresentationJSON,
	parseMapPresentationSource,
	reduceStoryViewBlocks,
	stringifyMapPresentation,
} from '.'

const PUBKEY = 'A'.repeat(64)
const SOURCE = `37515:${PUBKEY.toLowerCase()}:western-front` as const

function layer(id: string, source: string = SOURCE) {
	return { id, source }
}

async function signTemplate(template: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}): Promise<NostrEvent> {
	return {
		...template,
		created_at: template.created_at ?? 1_700_000_000,
		id: '1'.repeat(64),
		pubkey: '2'.repeat(64),
		sig: '3'.repeat(128),
	}
}

describe('MapPresentationV1 codec', () => {
	test('normalizes and deterministically round-trips ordered layers', () => {
		const raw = {
			layers: [
				{
					style: {
						displayIcon: 'lucide:anchor',
						strokeColor: '#001122',
						fillOpacity: 0.35,
					},
					source: `37515:${PUBKEY}:western-front`,
					id: 'front-lines',
					featureIds: ['line-2', 'line-1'],
				},
				{ ...layer('battles'), visible: false, opacityMultiplier: 0.5 },
			],
			initialView: { pitch: 40, center: [2.3, 48.8], zoom: 7, bearing: -12 },
			version: 1,
		}

		const normalized = normalizeMapPresentation(raw)
		expect(normalized.layers.map((entry) => entry.id)).toEqual(['front-lines', 'battles'])
		expect(normalized.layers[0]?.visible).toBe(true)
		expect(normalized.layers[0]?.opacityMultiplier).toBe(1)
		expect(normalized.layers[0]?.source).toBe(SOURCE)
		expect(Object.isFrozen(normalized.layers)).toBe(true)
		expect(Object.isFrozen(normalized.layers[0]?.style)).toBe(true)

		const json = stringifyMapPresentation(raw)
		expect(json).toBe(
			`{"version":1,"initialView":{"center":[2.3,48.8],"zoom":7,"bearing":-12,"pitch":40},"layers":[{"id":"front-lines","source":"${SOURCE}","featureIds":["line-2","line-1"],"visible":true,"opacityMultiplier":1,"style":{"strokeColor":"#001122","fillOpacity":0.35,"displayIcon":"lucide:anchor"}},{"id":"battles","source":"${SOURCE}","visible":false,"opacityMultiplier":0.5}]}`,
		)
		const reparsed = parseMapPresentationJSON(json)
		expect(reparsed.status).toBe('valid')
		if (reparsed.status === 'valid') expect(reparsed.value).toEqual(normalized)
	})

	test('accepts a non-empty d-tag containing colons and canonicalizes only the pubkey', () => {
		const parsed = parseMapPresentationSource(`37515:${PUBKEY}:campaign:western:front`)
		expect(parsed).toEqual({
			kind: 37515,
			pubkey: PUBKEY.toLowerCase(),
			identifier: 'campaign:western:front',
			coordinate: `37515:${PUBKEY.toLowerCase()}:campaign:western:front`,
		})
	})

	test('drops malformed sources and later duplicate layer ids with diagnostics', () => {
		const parsed = parseMapPresentation({
			version: 1,
			layers: [
				layer('first'),
				layer('wrong-kind', `30000:${PUBKEY}:not-a-map`),
				layer('first'),
				layer('short-key', '37515:abcd:map'),
			],
		})
		expect(parsed.status).toBe('valid')
		if (parsed.status !== 'valid') return
		expect(parsed.value.layers.map((entry) => entry.id)).toEqual(['first'])
		expect(parsed.issues.map((entry) => entry.code)).toEqual([
			'invalid-source',
			'duplicate-layer-id',
			'invalid-source',
		])
	})

	test('never throws for malformed roots and preserves unsupported future values verbatim', () => {
		expect(parseMapPresentation(null).status).toBe('invalid')
		expect(parseMapPresentationJSON('{broken').status).toBe('invalid')
		const future = { version: 9, layers: [{ deliberately: 'unknown' }] }
		const parsed = parseMapPresentation(future)
		expect(parsed.status).toBe('unsupported')
		if (parsed.status === 'unsupported') {
			expect(parsed.version).toBe(9)
			expect(parsed.raw).toBe(future)
		}
	})

	test('distinguishes absent, empty, duplicate, and invalid feature selectors without widening', () => {
		const parsed = parseMapPresentation({
			version: 1,
			layers: [
				layer('whole-map'),
				{ ...layer('nothing'), featureIds: [] },
				{ ...layer('selected'), featureIds: ['a', 'a', 'b'] },
				{ ...layer('invalid-array'), featureIds: 'a' },
				{ ...layer('invalid-member'), featureIds: ['a', ''] },
			],
		})
		expect(parsed.status).toBe('valid')
		if (parsed.status !== 'valid') return
		const [whole, nothing, selected] = parsed.value.layers
		expect(whole && 'featureIds' in whole).toBe(false)
		expect(nothing?.featureIds).toEqual([])
		expect(selected?.featureIds).toEqual(['a', 'b'])
		expect(parsed.value.layers.map((entry) => entry.id)).not.toContain('invalid-array')
		expect(parsed.value.layers.map((entry) => entry.id)).not.toContain('invalid-member')
		expect(parsed.issues.map((entry) => entry.code)).toContain('duplicate-feature-id')
		expect(parsed.issues.filter((entry) => entry.code === 'invalid-feature-selector')).toHaveLength(
			2,
		)
	})

	test('enforces opacity and style bounds while retaining valid allowlisted overrides', () => {
		const parsed = parseMapPresentation({
			version: 1,
			initialView: { center: [181, 0], zoom: Number.NaN },
			layers: [
				{ ...layer('too-opaque'), opacityMultiplier: 1.01 },
				{
					...layer('styled'),
					style: {
						color: '#abc',
						fillOpacity: 2,
						strokeOpacity: 0,
						strokeWidth: 65,
						radius: 12,
						lineDash: 'dot-dot',
						arrowEnd: true,
						displayIcon: 'lucide:not-bundled',
						label: 'must not leak into presentation',
					},
				},
			],
		})
		expect(parsed.status).toBe('valid')
		if (parsed.status !== 'valid') return
		expect(parsed.value.initialView).toBeUndefined()
		expect(parsed.value.layers.map((entry) => entry.id)).toEqual(['styled'])
		expect(parsed.value.layers[0]?.style).toEqual({
			color: '#abc',
			strokeOpacity: 0,
			radius: 12,
			arrowEnd: true,
		})
		expect(parsed.issues.map((entry) => entry.code)).toContain('invalid-opacity')
		expect(parsed.issues.map((entry) => entry.code)).toContain('unknown-style-key')
		expect(parsed.issues.filter((entry) => entry.code === 'invalid-style').length).toBe(4)
	})
})

describe('sparse cumulative Story views', () => {
	test('figure-only snapshots inherit driving views but never change later driving state', () => {
		const presentation = normalizeMapPresentation({
			version: 1,
			initialView: { center: [4, 49], zoom: 6 },
			layers: [{ ...layer('front'), style: { color: '#111111' } }],
		})
		const reduced = reduceStoryViewBlocks(presentation, [
			{
				version: 1,
				type: 'view',
				id: 'first',
				title: '1914',
				display: 'cue',
				layers: { front: { opacityMultiplier: 0.5 } },
			},
			{
				version: 1,
				type: 'view',
				id: 'detail',
				title: 'Comparison only',
				display: 'figure',
				camera: { center: [5, 50], zoom: 10 },
				layers: { front: { visible: false, style: { color: '#ff0000' } } },
			},
			{
				version: 1,
				type: 'view',
				id: 'next',
				title: '1916',
				display: 'both',
				layers: { front: { style: { strokeWidth: 4 } } },
			},
		])
		expect(reduced.snapshots[1]?.state.layers[0]).toMatchObject({
			opacityMultiplier: 0.5,
			visible: false,
			style: { color: '#ff0000' },
		})
		expect(reduced.snapshots[1]?.state.camera?.zoom).toBe(10)
		expect(reduced.snapshots[2]?.state.camera).toEqual(presentation.initialView)
		expect(reduced.snapshots[2]?.state.layers[0]).toMatchObject({
			opacityMultiplier: 0.5,
			visible: true,
			style: { color: '#111111', strokeWidth: 4 },
		})
		expect(presentation.layers[0]?.opacityMultiplier).toBe(1)
	})

	test('accumulates camera and local layer patches without retargeting sources/selectors', () => {
		const presentation = normalizeMapPresentation({
			version: 1,
			initialView: { center: [0, 0], zoom: 3 },
			layers: [
				{
					...layer('front'),
					featureIds: ['battle-a'],
					style: { color: '#111111' },
				},
				layer('cities'),
			],
		})
		const reduced = reduceStoryViewBlocks(presentation, [
			{
				version: 1,
				type: 'view',
				id: 'opening',
				title: 'Opening',
				display: 'both',
				layers: {
					front: { visible: false, style: { fillOpacity: 0.2 } },
					'ambient-route-layer': { visible: false },
				},
			},
			{
				version: 1,
				type: 'view',
				id: 'advance',
				title: 'Advance',
				display: 'cue',
				camera: { center: [4.3, 50.1], zoom: 8, bearing: 20 },
				layers: {
					front: { opacityMultiplier: 0.4, style: { strokeColor: '#ff0000' } },
				},
			},
		])

		expect(reduced.snapshots).toHaveLength(2)
		const first = reduced.snapshots[0]?.state.layers[0]
		const second = reduced.snapshots[1]?.state.layers[0]
		expect(first?.visible).toBe(false)
		expect(first?.style).toEqual({ color: '#111111', fillOpacity: 0.2 })
		expect(second).toMatchObject({
			visible: false,
			opacityMultiplier: 0.4,
			source: SOURCE,
			featureIds: ['battle-a'],
		})
		expect(second?.style).toEqual({
			color: '#111111',
			fillOpacity: 0.2,
			strokeColor: '#ff0000',
		})
		expect(reduced.snapshots[1]?.state.camera).toEqual({
			center: [4.3, 50.1],
			zoom: 8,
			bearing: 20,
		})
		expect(reduced.issues.map((entry) => entry.code)).toContain('unknown-layer-id')
	})
})

describe('Article and Group presentation integration', () => {
	test('unrelated edits preserve an unsupported future presentation value', async () => {
		const future = { version: 2, renderer: { future: true } }
		const article = await ArticleFactory.create({ title: 'Before', presentation: future }).sign(
			signTemplate,
		)
		const editedArticle = await ArticleFactory.modify(article as never)
			.article({ title: 'After' })
			.sign(signTemplate)
		expect(JSON.parse(editedArticle.content).presentation).toEqual(future)

		const group = await GroupFactory.create({
			name: 'Atlas',
			governance: 'open',
			presentation: future,
		}).sign(signTemplate)
		const editedGroup = await GroupFactory.modify(group as never)
			.group({ description: 'Unrelated edit' })
			.sign(signTemplate)
		expect(JSON.parse(editedGroup.content).presentation).toEqual(future)
	})

	test('the explicit factory writer stores a canonical V1 presentation', async () => {
		const presentation = normalizeMapPresentation({ version: 1, layers: [layer('map')] })
		const article = await ArticleFactory.create({ title: 'Story' })
			.mapPresentation(presentation)
			.sign(signTemplate)
		expect(JSON.parse(article.content).presentation).toEqual({
			version: 1,
			layers: [{ ...layer('map'), visible: true, opacityMultiplier: 1 }],
		})
	})
})
