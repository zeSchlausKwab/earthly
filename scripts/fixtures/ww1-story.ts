/**
 * Local development fixture inspired by docs/sketch-map-with-a-margin/data.js.
 * Geometry and narrative are SYNTHETIC STYLING DEMOS, not historical evidence.
 * This module only builds signed events; it never connects to a relay.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import { nip19, type NostrEvent } from 'nostr-tools'
import {
	normalizeMapPresentation,
	normalizeStoryViewBlock,
	stringifyStoryViewMarkdownBlock,
	type MapPresentationSource,
	type StoryViewBlockV1,
} from '@/lib/map-presentation'
import { ArticleFactory, type ArticleContent } from '@/lib/nostr/article'
import { GeoDatasetFactory } from '@/lib/nostr/geo-event/factory'
import { ARTICLE_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { stringifyNostrAddressReference } from '@/lib/nostr/references'
import { devIdentities } from '@/lib/seeder/identities'

export const WW1_DEMO_DISCLAIMER =
	'Synthetic styling demo: these simplified lines, point locations and narrative are UI fixtures, not an accurate historical dataset or a historical source.'
export const WW1_DEMO_TITLE = 'Western Front · synthetic styling demo'
export const WW1_DEMO_STORY_ID = 'ww1-demo-western-front'
/** Stable event identity for repeatable tests; the seeder handles explicit later replacements. */
export const WW1_DEMO_CREATED_AT = 1_788_480_000

export type Ww1MapKey =
	| 'front-1914'
	| 'front-1916'
	| 'front-1918-spring'
	| 'front-1918-armistice'
	| 'ww1-battles'

type DemoCollection = FeatureCollection & {
	name: string
	description: string
	properties: { synthetic: true; purpose: 'styling-demo'; period: string }
}

export interface Ww1DemoMap {
	key: Ww1MapKey
	event: NostrEvent
	address: MapPresentationSource
	naddr: string
	path: string
	collection: DemoCollection
}

const frontLines: Array<{
	key: Exclude<Ww1MapKey, 'ww1-battles'>
	period: string
	coordinates: [number, number][]
}> = [
	{
		key: 'front-1914',
		period: 'November 1914',
		coordinates: [
			[2.75, 51.13],
			[2.89, 50.85],
			[2.78, 50.4],
			[2.78, 50.29],
			[2.85, 49.9],
			[3, 49.58],
			[3.32, 49.38],
			[4.03, 49.25],
			[4.9, 49.3],
			[5.38, 49.16],
			[5.55, 48.9],
			[6.2, 48.75],
			[6.5, 48.7],
			[7, 48.3],
			[6.86, 47.64],
		],
	},
	{
		key: 'front-1916',
		period: 'December 1916',
		coordinates: [
			[2.75, 51.13],
			[2.89, 50.85],
			[2.78, 50.4],
			[2.78, 50.29],
			[2.95, 50.05],
			[2.92, 49.95],
			[3, 49.58],
			[3.32, 49.38],
			[4.03, 49.25],
			[4.9, 49.3],
			[5.4, 49.2],
			[5.55, 48.9],
			[6.2, 48.75],
			[6.5, 48.7],
			[7, 48.3],
			[6.86, 47.64],
		],
	},
	{
		key: 'front-1918-spring',
		period: 'Spring 1918',
		coordinates: [
			[2.75, 51.13],
			[2.89, 50.85],
			[2.65, 50.6],
			[2.78, 50.29],
			[2.45, 49.95],
			[2.55, 49.7],
			[3.1, 49.45],
			[3.4, 49.04],
			[4.03, 49.25],
			[4.9, 49.3],
			[5.38, 49.16],
			[5.55, 48.9],
			[6.2, 48.75],
			[6.5, 48.7],
			[7, 48.3],
			[6.86, 47.64],
		],
	},
	{
		key: 'front-1918-armistice',
		period: '11 November 1918',
		coordinates: [
			[3.72, 51.05],
			[3.95, 50.45],
			[4.4, 50.2],
			[4.94, 49.7],
			[5.2, 49.45],
			[5.6, 49.3],
			[6.18, 49.12],
			[6.5, 48.7],
			[7, 48.3],
			[6.86, 47.64],
		],
	},
]

const battlePoints: Array<[id: string, name: string, longitude: number, latitude: number]> = [
	['marne', 'Marne', 3.5, 48.95],
	['ypres', 'Ypres', 2.89, 50.85],
	['verdun', 'Verdun', 5.38, 49.16],
	['somme', 'Somme', 2.7, 50],
	['cambrai', 'Cambrai', 3.23, 50.17],
	['amiens', 'Amiens', 2.3, 49.9],
	['argonne', 'Meuse–Argonne', 5, 49.3],
]

function collection(name: string, period: string, features: Feature[]): DemoCollection {
	return {
		type: 'FeatureCollection',
		name: `${name} · synthetic styling demo`,
		description: WW1_DEMO_DISCLAIMER,
		properties: { synthetic: true, purpose: 'styling-demo', period },
		features,
	}
}

function withIdentifier(identifier: string) {
	return (tags: string[][]) => [...tags.filter(([key]) => key !== 'd'), ['d', identifier]]
}

/** Build all six signed events without network, storage, random ids or secret-key output. */
export async function buildWw1StoryFixture() {
	const { owner, contributors } = devIdentities()
	const mapAuthor = contributors[0]
	if (!mapAuthor) throw new Error('The WW1 demo requires the existing Mara development identity.')
	const maps = {} as Record<Ww1MapKey, Ww1DemoMap>
	const inputs: Array<{ key: Ww1MapKey; collection: DemoCollection }> = frontLines.map((front) => ({
		key: front.key,
		collection: collection(`Western Front · ${front.period}`, front.period, [
			{
				type: 'Feature',
				id: 'line',
				geometry: { type: 'LineString', coordinates: front.coordinates.map((point) => [...point]) },
				properties: {
					name: `${front.period} · schematic line`,
					synthetic: true,
					color: '#68747d',
					strokeWidth: 3,
				},
			} satisfies Feature<LineString>,
		]),
	}))
	inputs.push({
		key: 'ww1-battles',
		collection: collection(
			'Western Front battle markers',
			'1914–1918',
			battlePoints.map(
				([id, name, longitude, latitude]) =>
					({
						type: 'Feature',
						id,
						geometry: { type: 'Point', coordinates: [longitude, latitude] },
						properties: {
							name,
							synthetic: true,
							description: WW1_DEMO_DISCLAIMER,
							color: '#68747d',
							radius: 5,
						},
					}) satisfies Feature<Point>,
			),
		),
	})
	for (const input of inputs) {
		const identifier = `ww1-demo-${input.key}`
		const event = await GeoDatasetFactory.create(input.collection)
			.modifyPublicTags(withIdentifier(identifier))
			.created(WW1_DEMO_CREATED_AT)
			.hashtags(['ww1', 'western-front', 'synthetic', 'styling-demo'])
			.alt(WW1_DEMO_DISCLAIMER)
			.withDerivedMetadata()
			.sign(mapAuthor.signer)
		const address: MapPresentationSource = `37515:${event.pubkey}:${identifier}`
		const naddr = nip19.naddrEncode({ kind: GEO_EVENT_KIND, pubkey: event.pubkey, identifier })
		maps[input.key] = { ...input, event, address, naddr, path: `/map/${naddr}` }
	}
	const presentation = normalizeMapPresentation({
		version: 1,
		initialView: { center: [4.2, 49.6], zoom: 6.2, bearing: 0, pitch: 0 },
		layers: [
			{
				id: 'front-1914-ghost',
				source: maps['front-1914'].address,
				featureIds: ['line'],
				visible: false,
				opacityMultiplier: 0.2,
				style: { color: '#475569', strokeWidth: 6, lineDash: 'dashed' },
			},
			...frontLines.map(({ key }, index) => ({
				id: key,
				source: maps[key].address,
				visible: index === 0,
				opacityMultiplier: 1,
				style: { color: '#1e5c85', strokeWidth: 4, lineDash: 'solid' },
			})),
			{
				id: 'battles-context',
				source: maps['ww1-battles'].address,
				visible: true,
				opacityMultiplier: 0.18,
				style: { color: '#64748b', radius: 4 },
			},
			{
				id: 'battles-1914',
				source: maps['ww1-battles'].address,
				featureIds: ['marne', 'ypres'],
				visible: true,
				opacityMultiplier: 1,
				style: { color: '#1e5c85', radius: 8 },
			},
			{
				id: 'battles-1916',
				source: maps['ww1-battles'].address,
				featureIds: ['verdun', 'somme'],
				visible: false,
				opacityMultiplier: 1,
				style: { color: '#b45309', radius: 9 },
			},
			{
				id: 'battles-1918',
				source: maps['ww1-battles'].address,
				featureIds: ['amiens', 'cambrai', 'argonne'],
				visible: false,
				opacityMultiplier: 0.9,
				style: { color: '#9f3348', radius: 8 },
			},
		],
	})
	const views = [
		{
			version: 1,
			type: 'view',
			id: 'ww1-1914',
			title: 'November 1914 · opening view',
			display: 'both',
			caption:
				'Synthetic line and selected Marne/Ypres markers. Blue is a Story override, not a source edit.',
			camera: { center: [4.4, 49.6], zoom: 6.2 },
			layers: {
				'front-1914': { visible: true },
				'battles-1914': { visible: true },
				'battles-context': { opacityMultiplier: 0.18 },
			},
		},
		{
			version: 1,
			type: 'view',
			id: 'ww1-1916',
			title: '1916 · Verdun and the Somme',
			display: 'cue',
			caption: 'The next source line is amber; only two battle features are highlighted.',
			camera: { center: [3.9, 49.7], zoom: 6.6 },
			layers: {
				'front-1914': { visible: false },
				'front-1916': { visible: true, style: { color: '#b45309', strokeWidth: 5 } },
				'battles-1914': { visible: false },
				'battles-1916': { visible: true },
				'battles-context': { opacityMultiplier: 0.1 },
			},
		},
		{
			version: 1,
			type: 'view',
			id: 'ww1-comparison-figure',
			title: 'Static comparison · one foreign Map, two instances',
			display: 'figure',
			caption:
				'A deliberately different camera and magenta comparison. This figure must not change later scrolling cues.',
			camera: { center: [2.85, 50.05], zoom: 8, bearing: 18 },
			layers: {
				'front-1914': {
					visible: true,
					opacityMultiplier: 0.8,
					style: { color: '#c026d3', strokeWidth: 3 },
				},
				'front-1914-ghost': { visible: true, opacityMultiplier: 0.35 },
				'front-1916': { opacityMultiplier: 0.35 },
				'battles-context': { opacityMultiplier: 0.7, style: { color: '#c026d3', radius: 12 } },
			},
		},
		{
			version: 1,
			type: 'view',
			id: 'ww1-spring-1918',
			title: 'Spring 1918 · changing emphasis',
			display: 'both',
			caption:
				'A rose foreground line and a faint dashed 1914 reference reuse foreign Maps without modifying them.',
			camera: { center: [3, 49.7], zoom: 6.8 },
			layers: {
				'front-1916': { visible: false },
				'front-1914-ghost': { visible: true, opacityMultiplier: 0.22 },
				'front-1918-spring': { visible: true, style: { color: '#9f3348', strokeWidth: 5 } },
				'battles-1916': { visible: false },
				'battles-1918': { visible: true },
			},
		},
		{
			version: 1,
			type: 'view',
			id: 'ww1-armistice',
			title: '11 November 1918 · final view',
			display: 'cue',
			caption: 'Green restores a restrained closing view; the source data remains unchanged.',
			camera: { center: [5, 49.6], zoom: 6.2, bearing: 0, pitch: 0 },
			layers: {
				'front-1918-spring': { visible: false },
				'front-1914-ghost': { visible: false },
				'front-1918-armistice': {
					visible: true,
					opacityMultiplier: 0.95,
					style: { color: '#166534', strokeWidth: 4 },
				},
				'battles-1918': { opacityMultiplier: 0.7, style: { color: '#166534', radius: 7 } },
				'battles-context': { opacityMultiplier: 0.12 },
			},
		},
	].map(normalizeStoryViewBlock) satisfies StoryViewBlockV1[]
	const mention = (key: Ww1MapKey, label: string, featureId?: string) =>
		`[${label}](${stringifyNostrAddressReference({ address: maps[key].naddr, featureId })})`
	const fence = (id: string) => {
		const view = views.find((candidate) => candidate.id === id)
		if (!view) throw new Error(`Missing WW1 demo view ${id}`)
		return stringifyStoryViewMarkdownBlock(view)
	}
	const markdown = [
		`> ${WW1_DEMO_DISCLAIMER}`,
		'This local Story exercises the map-with-a-margin design. Four chronological labels organize a styling demonstration: November 1914, 1916, spring 1918 and the armistice. No precise front, battle boundary, distance or military claim should be inferred from these schematic shapes.',
		'Each line belongs to a separate Map by another development identity. The Story borrows those Maps, selects individual features, and changes their presentation without altering their geometry or original properties. Scroll the cues, inspect the figures, and follow an inline place mention to compare those interactions.',
		'## November 1914',
		fence('ww1-1914'),
		`The first view uses the ${mention('front-1914', 'November 1914 snapshot')}. Its line is blue here even though the source is neutral grey. ${mention('ww1-battles', 'Marne', 'marne')} and ${mention('ww1-battles', 'Ypres', 'ypres')} are the only strongly emphasized point features. All other markers are a separate, low-opacity instance of the same foreign Map.`,
		'Click either linked feature to inspect a genuine Nostr feature reference. Its stable feature id is part of the link; the Story does not copy the source geometry into its prose. The figure and the scrolling cue deliberately share this opening view.',
		'## 1916',
		fence('ww1-1916'),
		`This cue replaces the opening line with the ${mention('front-1916', 'December 1916 snapshot')}. ${mention('ww1-battles', 'Verdun', 'verdun')} and ${mention('ww1-battles', 'the Somme', 'somme')} now form the selected subset. Amber color, a thicker stroke and quieter context marks demonstrate view-local emphasis, not a change to the source Map.`,
		'### A figure that does not drive the map',
		fence('ww1-comparison-figure'),
		'The static comparison intentionally differs from the scrolling map. It uses an oblique close camera, a magenta copy of the 1914 line, and a wider dashed instance of that very same source. Its changes belong only to this figure. Continue reading: neither its camera nor its magenta context style should leak into the next cue.',
		'## Spring 1918',
		fence('ww1-spring-1918'),
		`The ${mention('front-1918-spring', 'spring snapshot')} becomes the foreground. A faint dashed instance of the 1914 source provides comparison while the original 1914 foreground remains hidden. The selected markers now include ${mention('ww1-battles', 'Amiens', 'amiens')}, ${mention('ww1-battles', 'Cambrai', 'cambrai')} and ${mention('ww1-battles', 'Meuse–Argonne', 'argonne')}. These place names are interaction labels, not claims about the exact timing or extent of operations.`,
		'This is the synthesis the demo is testing: selectively reference foreign content, reuse one source more than once, restyle each instance independently, and set a camera inline. Returning to the original Map should still show the original neutral styling and its complete feature set.',
		'## 11 November 1918',
		fence('ww1-armistice'),
		`The ${mention('front-1918-armistice', 'armistice snapshot')} closes the sequence in green. Earlier front instances are hidden and the marker emphasis is softer. Moving backward through the Story should reconstruct the earlier views, including their cameras and opacity, without changing the reader’s unrelated map overlays.`,
		'## Demo sources and reuse',
		`${WW1_DEMO_DISCLAIMER} The simplified coordinates were adapted from the repository’s own UI sketch at docs/sketch-map-with-a-margin/data.js. They were not digitized from an archival map and have not been historically validated.`,
		...frontLines.map(({ key, period }) => `- ${mention(key, `${period} source Map`)}`),
		`- ${mention('ww1-battles', 'Complete battle-marker source Map')} (seven synthetic point fixtures)`,
	].join('\n\n')
	const content: ArticleContent = {
		title: WW1_DEMO_TITLE,
		summary: WW1_DEMO_DISCLAIMER,
		publishedAt: WW1_DEMO_CREATED_AT,
		content: markdown,
	}
	const event = await ArticleFactory.create(content)
		.modifyPublicTags(withIdentifier(WW1_DEMO_STORY_ID))
		.created(WW1_DEMO_CREATED_AT)
		.hashtags(['ww1', 'western-front', 'synthetic', 'styling-demo'])
		.alt(WW1_DEMO_DISCLAIMER)
		.bbox([2.3, 47.64, 7, 51.13])
		.referencedAddresses(Object.values(maps).map((map) => map.address))
		.mapPresentation(presentation)
		.sign(owner.signer)
	const naddr = nip19.naddrEncode({
		kind: ARTICLE_KIND,
		pubkey: event.pubkey,
		identifier: WW1_DEMO_STORY_ID,
	})
	return {
		maps,
		presentation,
		views,
		markdown,
		story: {
			event,
			naddr,
			address: `${ARTICLE_KIND}:${event.pubkey}:${WW1_DEMO_STORY_ID}`,
			path: `/story/${naddr}`,
			readerPath: `/read/${naddr}`,
		},
		events: [...Object.values(maps).map((map) => map.event), event],
	}
}

export type Ww1StoryFixture = Awaited<ReturnType<typeof buildWw1StoryFixture>>

// A JSON-only, network-free bridge for Playwright's separate TypeScript runtime.
if (import.meta.main) console.log(JSON.stringify(await buildWw1StoryFixture()))
