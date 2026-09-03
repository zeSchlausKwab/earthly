import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { MapPresentationSource, MapPresentationV1, StoryViewBlockV1 } from './types'
import {
	extractSemanticStoryMapCoordinates,
	extractSemanticStoryMapReferences,
	extractSemanticStoryReferencedCoordinates,
	extractStoryViewBlocks,
	insertStoryViewBlock,
	parseStoryMarkdown,
	reduceStoryMarkdownViews,
	removeStoryViewBlock,
	replaceStoryViewBlock,
	stringifyStoryViewMarkdownBlock,
} from './storyMarkdown'

const PUBKEY = 'a'.repeat(64)
const MAP_COORDINATE = `37515:${PUBKEY}:western:front` as MapPresentationSource
const MAP_NADDR = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'western:front' })
const STORY_NADDR = nip19.naddrEncode({ kind: 37520, pubkey: PUBKEY, identifier: 'not-a-map' })

const firstView: StoryViewBlockV1 = {
	version: 1,
	type: 'view',
	id: 'opening-line',
	title: 'The line freezes',
	display: 'cue',
	camera: { center: [4.4, 49.6], zoom: 6.2 },
	layers: { front: { visible: true } },
}

describe('Story Markdown earthly-view codec', () => {
	test('writes canonical fenced JSON and reads valid blocks in physical order', () => {
		const second = { ...firstView, id: 'verdun', title: 'Verdun', display: 'both' as const }
		const markdown = [
			'# Four years',
			'',
			stringifyStoryViewMarkdownBlock(firstView),
			'',
			'Prose between views.',
			'',
			stringifyStoryViewMarkdownBlock(second),
		].join('\n')

		expect(stringifyStoryViewMarkdownBlock(firstView)).toBe(
			`\`\`\`earthly-view\n${JSON.stringify(firstView)}\n\`\`\``,
		)
		expect(extractStoryViewBlocks(markdown).map((view) => view.id)).toEqual([
			'opening-line',
			'verdun',
		])
	})

	test('retains invalid and future blocks byte-for-byte during valid block edits', () => {
		const invalid = '```earthly-view\n{ definitely not json }\n```'
		const future = '~~~earthly-view\n{"version":2,"type":"view","newField":true}\n~~~'
		const markdown = [invalid, stringifyStoryViewMarkdownBlock(firstView), future].join('\n\n')
		const parsed = parseStoryMarkdown(markdown)
		expect(parsed.views.map((view) => view.result.status)).toEqual([
			'invalid',
			'valid',
			'unsupported',
		])

		const replacement = { ...firstView, title: 'Changed explicitly' }
		const replaced = replaceStoryViewBlock(markdown, firstView.id, replacement)
		expect(replaced).toContain(invalid)
		expect(replaced).toContain(future)
		expect(replaced).toContain('Changed explicitly')

		const removed = removeStoryViewBlock(replaced, firstView.id)
		expect(removed).toContain(invalid)
		expect(removed).toContain(future)
		expect(extractStoryViewBlocks(removed)).toEqual([])
	})

	test('does not reinterpret an earthly-view-looking fence inside a longer code fence', () => {
		const markdown = ['````md', stringifyStoryViewMarkdownBlock(firstView), '````'].join('\n')
		expect(parseStoryMarkdown(markdown).views).toHaveLength(0)
	})

	test('insertion snaps outside an existing fence and preserves surrounding prose', () => {
		const markdown = 'Before\n\n```json\n{"x":1}\n```\n\nAfter'
		const offset = markdown.indexOf('{"x"') + 2
		const inserted = insertStoryViewBlock(markdown, firstView, offset)
		expect(inserted).toContain('```json\n{"x":1}\n```\n\n```earthly-view')
		expect(inserted.endsWith('After')).toBe(true)
	})

	test('applies valid sparse blocks cumulatively and skips malformed blocks', () => {
		const presentation: MapPresentationV1 = {
			version: 1,
			layers: [
				{
					id: 'front',
					source: MAP_COORDINATE,
					visible: false,
					opacityMultiplier: 1,
				},
			],
		}
		const second: StoryViewBlockV1 = {
			version: 1,
			type: 'view',
			id: 'dim',
			title: 'Dim the line',
			display: 'figure',
			layers: { front: { opacityMultiplier: 0.25 } },
		}
		const markdown = [
			stringifyStoryViewMarkdownBlock(firstView),
			'```earthly-view\nnot-json\n```',
			stringifyStoryViewMarkdownBlock(second),
		].join('\n')
		const reduced = reduceStoryMarkdownViews(presentation, markdown)
		expect(reduced.snapshots).toHaveLength(2)
		expect(reduced.snapshots[1]?.state.layers[0]).toMatchObject({
			visible: true,
			opacityMultiplier: 0.25,
		})
	})
})

describe('semantic Story Map references', () => {
	test('keeps visible map and feature mentions while excluding non-map naddr references', () => {
		const markdown = `Map nostr:${MAP_NADDR} and feature nostr:${MAP_NADDR}#battle%2Fverdun; story nostr:${STORY_NADDR}.`
		expect(extractSemanticStoryMapReferences(markdown)).toEqual([
			{ address: MAP_NADDR, featureId: undefined },
			{ address: MAP_NADDR, featureId: 'battle/verdun' },
		])
		expect(extractSemanticStoryMapCoordinates(markdown)).toEqual([MAP_COORDINATE])
		expect(extractSemanticStoryReferencedCoordinates(markdown)).toEqual([
			MAP_COORDINATE,
			`37520:${PUBKEY}:not-a-map`,
		])
	})

	test('excludes every fenced block, indented code, inline code, HTML comments, and escapes', () => {
		const visible = `Visible nostr:${MAP_NADDR}`
		const markdown = [
			visible,
			'```js',
			`const example = "nostr:${MAP_NADDR}"`,
			'```',
			stringifyStoryViewMarkdownBlock({
				...firstView,
				caption: `nostr:${MAP_NADDR}`,
			}),
			`    nostr:${MAP_NADDR}`,
			`Inline \`nostr:${MAP_NADDR}\` example.`,
			`<!-- nostr:${MAP_NADDR} -->`,
			`Escaped \\nostr:${MAP_NADDR}.`,
		].join('\n')
		expect(extractSemanticStoryMapReferences(markdown)).toEqual([
			{ address: MAP_NADDR, featureId: undefined },
		])
	})

	test('keeps structural masking aligned after non-BMP characters', () => {
		const markdown = `🗺️ example only\n\n\`\`\`text\nnostr:${MAP_NADDR}\n\`\`\`\n\n🧭 \`nostr:${MAP_NADDR}\``
		expect(extractSemanticStoryMapReferences(markdown)).toEqual([])
	})
})
