import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GeoFeatureItem } from './GeoRichTextEditor'
import { parseInlineTokens, RichContentRenderer } from './RichContentRenderer'
import { stringifyStoryViewMarkdownBlock } from '@/lib/map-presentation'

const NADDR = 'naddr1qqxnzd3exgmrsvfkxymnyd3jqgsxyz9'
const OTHER_NADDR = 'naddr1zzz8kwvfexgmrsvfkxymnyd3jqgsabc2'

const availableFeatures: GeoFeatureItem[] = [
	{
		id: 'ds-1',
		name: 'Anchorage Lanes',
		address: NADDR,
		entityType: 'dataset',
	},
	{
		id: 'ds-1-f1',
		name: 'Lane Three',
		address: NADDR,
		featureId: 'feat-12',
		entityType: 'feature',
	},
]

type ParsedInlineToken = ReturnType<typeof parseInlineTokens>[number]
type MentionToken = Extract<ParsedInlineToken, { type: 'mention' }>

function mentions(tokens: ReturnType<typeof parseInlineTokens>): MentionToken[] {
	return tokens.filter((token): token is MentionToken => token.type === 'mention')
}

function textOf(tokens: ReturnType<typeof parseInlineTokens>) {
	return tokens
		.filter((token) => token.type === 'text')
		.map((token) => token.value)
		.join('')
}

describe('parseInlineTokens nostr:naddr references', () => {
	test('bare reference in prose becomes a mention token', () => {
		const tokens = parseInlineTokens(`See nostr:${NADDR} for details`, availableFeatures)
		const [mention] = mentions(tokens)
		if (!mention) throw new Error('expected mention')
		expect(mention.address).toBe(NADDR)
		expect(mention.featureId).toBeUndefined()
		expect(mention.displayName).toBe('Anchorage Lanes')
		expect(textOf(tokens)).toBe('See  for details')
	})

	test('reference followed by sentence punctuation excludes the punctuation', () => {
		for (const punctuation of ['.', ',', ';', ':', ')']) {
			const tokens = parseInlineTokens(`Go to nostr:${NADDR}${punctuation}`, availableFeatures)
			const [mention] = mentions(tokens)
			expect(mention?.address).toBe(NADDR)
			expect(tokens.at(-1)).toMatchObject({ type: 'text', value: punctuation })
		}
	})

	test('reference inside parentheses becomes a mention token', () => {
		const tokens = parseInlineTokens(`the route (nostr:${NADDR}) here`, availableFeatures)
		expect(mentions(tokens)).toHaveLength(1)
		expect(textOf(tokens)).toBe('the route () here')
	})

	test('reference with #featureId fragment resolves the feature', () => {
		const tokens = parseInlineTokens(`See nostr:${NADDR}#feat-12 now`, availableFeatures)
		const [mention] = mentions(tokens)
		expect(mention?.address).toBe(NADDR)
		expect(mention?.featureId).toBe('feat-12')
		expect(mention?.displayName).toBe('Lane Three')
	})

	test('markdown link with nostr target becomes a single mention using the link text', () => {
		const tokens = parseInlineTokens(
			`Check [Anchorage lanes](nostr:${NADDR}) today`,
			availableFeatures,
		)
		const [mention] = mentions(tokens)
		if (!mention) throw new Error('expected mention')
		expect(mention.address).toBe(NADDR)
		expect(mention.displayName).toBe('Anchorage lanes')
		// No leftover markdown syntax around the pill
		expect(textOf(tokens)).toBe('Check  today')
		expect(tokens.some((token) => token.type === 'link')).toBe(false)
	})

	test('markdown link with nostr target and #featureId fragment', () => {
		const tokens = parseInlineTokens(`[Lane 3](nostr:${NADDR}#feat-12).`, availableFeatures)
		const [mention] = mentions(tokens)
		expect(mention?.address).toBe(NADDR)
		expect(mention?.featureId).toBe('feat-12')
		expect(mention?.displayName).toBe('Lane 3')
		expect(tokens.at(-1)).toMatchObject({ type: 'text', value: '.' })
	})

	test('markdown link whose label is itself a raw reference falls back to the resolved name', () => {
		const tokens = parseInlineTokens(`[nostr:${NADDR}](nostr:${NADDR})`, availableFeatures)
		const [mention] = mentions(tokens)
		expect(mention?.displayName).toBe('Anchorage Lanes')
	})

	test('reference inside emphasis renders a mention nested in the emphasis token', () => {
		const tokens = parseInlineTokens(`intro *see nostr:${NADDR} here* outro`, availableFeatures)
		const emphasis = tokens.find((token) => token.type === 'emphasis')
		expect(emphasis).toBeDefined()
		const nested = mentions(emphasis?.children ?? [])
		expect(nested).toHaveLength(1)
		expect(nested[0]?.address).toBe(NADDR)
		expect(nested[0]?.displayName).toBe('Anchorage Lanes')
	})

	test('reference inside strong renders a mention nested in the strong token', () => {
		const tokens = parseInlineTokens(`**Important: nostr:${NADDR}#feat-12**`, availableFeatures)
		const strong = tokens.find((token) => token.type === 'strong')
		expect(strong).toBeDefined()
		const nested = mentions(strong?.children ?? [])
		expect(nested).toHaveLength(1)
		expect(nested[0]?.featureId).toBe('feat-12')
	})

	test('markdown link with nostr target inside emphasis', () => {
		const tokens = parseInlineTokens(`*[Anchorage lanes](nostr:${NADDR})*`, availableFeatures)
		const emphasis = tokens.find((token) => token.type === 'emphasis')
		const nested = mentions(emphasis?.children ?? [])
		expect(nested).toHaveLength(1)
		expect(nested[0]?.displayName).toBe('Anchorage lanes')
	})

	test('unresolved reference still becomes a mention with a generic label', () => {
		const tokens = parseInlineTokens(`nostr:${OTHER_NADDR}`, availableFeatures)
		const [mention] = mentions(tokens)
		expect(mention?.address).toBe(OTHER_NADDR)
		expect(mention?.displayName).toBe('Reference')
	})

	test('plain emphasis and strong without references keep their text', () => {
		const tokens = parseInlineTokens('a *b* and **c**', availableFeatures)
		const emphasis = tokens.find((token) => token.type === 'emphasis')
		const strong = tokens.find((token) => token.type === 'strong')
		expect(emphasis?.value).toBe('b')
		expect(strong?.value).toBe('c')
	})

	test('regular https markdown links are unaffected', () => {
		const tokens = parseInlineTokens('[docs](https://example.com/a) end', availableFeatures)
		expect(tokens[0]).toMatchObject({ type: 'link', value: 'docs', url: 'https://example.com/a' })
		expect(mentions(tokens)).toHaveLength(0)
	})

	test('inline code and bare urls are unaffected', () => {
		const tokens = parseInlineTokens('`code` https://example.com/x.', availableFeatures)
		expect(tokens.some((token) => token.type === 'code' && token.value === 'code')).toBe(true)
		expect(
			tokens.some((token) => token.type === 'link' && token.url === 'https://example.com/x'),
		).toBe(true)
	})

	test('a code span that is exactly one reference renders as a mention pill', () => {
		const tokens = parseInlineTokens(`the network: \`nostr:${NADDR}\` .`, availableFeatures)
		const [mention] = mentions(tokens)
		expect(mention).toMatchObject({ address: NADDR, displayName: 'Anchorage Lanes' })
		expect(tokens.some((token) => token.type === 'code')).toBe(false)
	})

	test('backticked reference variants: bare naddr and #featureId fragment', () => {
		const bare = mentions(parseInlineTokens(`\`${NADDR}\``, availableFeatures))
		expect(bare[0]).toMatchObject({ address: NADDR })

		const withFeature = mentions(parseInlineTokens(`\`nostr:${NADDR}#feat-12\``, availableFeatures))
		expect(withFeature[0]).toMatchObject({ address: NADDR, featureId: 'feat-12' })
	})

	test('mixed-content code spans stay code', () => {
		const tokens = parseInlineTokens(`\`load nostr:${NADDR} now\``, availableFeatures)
		expect(tokens.some((token) => token.type === 'code')).toBe(true)
		expect(mentions(tokens)).toHaveLength(0)
	})

	test('encoded OSM-style feature ids render as feature mentions', () => {
		const token = mentions(
			parseInlineTokens(`nostr:${NADDR}#relation%2F62504`, availableFeatures),
		)[0]
		expect(token?.featureId).toBe('relation/62504')
	})

	test('coordinates and OSM element URLs render as spatial mention chips', () => {
		const spatialMentions = mentions(
			parseInlineTokens(
				'At geo:52.516275,13.377704 near https://www.openstreetmap.org/relation/62422.',
				availableFeatures,
			),
		)
		expect(spatialMentions).toHaveLength(2)
		expect(spatialMentions[0]?.address).toBe('geo:52.516275,13.377704')
		expect(spatialMentions[1]?.displayName).toBe('OSM relation 62422')
	})
})

describe('RichContentRenderer tables', () => {
	test('renders a GFM table with inline formatting and geo references', () => {
		const html = renderToStaticMarkup(
			createElement(RichContentRenderer, {
				content: [
					'| Time | Event | Mapped location |',
					'| :--- | :--- | ---: |',
					`| 08:37 | **Collapse** | nostr:${NADDR}#feat-12 |`,
				].join('\n'),
				availableFeatures,
			}),
		)

		expect(html).toContain('<table')
		expect(html).toContain('<th scope="col"')
		expect(html).toContain('<strong')
		expect(html).toContain('Lane Three')
		expect(html).not.toContain(':---')
	})
})

describe('RichContentRenderer Story views', () => {
	test('renders cue and figure blocks physically while leaving malformed blocks inert', () => {
		const cue = stringifyStoryViewMarkdownBlock({
			version: 1,
			type: 'view',
			id: 'verdun',
			title: 'Verdun and the Somme',
			display: 'cue',
			camera: { center: [3.9, 49.7], zoom: 6.6 },
		})
		const figure = stringifyStoryViewMarkdownBlock({
			version: 1,
			type: 'view',
			id: 'armistice',
			title: 'Armistice',
			display: 'figure',
			caption: 'The line on 11 November 1918.',
		})
		const html = renderToStaticMarkup(
			createElement(RichContentRenderer, {
				content: ['Before', cue, figure, '```earthly-view', 'not-json', '```'].join('\n\n'),
				renderStoryViewFigure: (view) => createElement('div', null, `figure:${view.id}`),
			}),
		)

		expect(html).toContain('data-story-view-id="verdun"')
		expect(html).toContain('Moves the camera')
		expect(html).toContain('data-story-view-id="armistice"')
		expect(html).toContain('figure:armistice')
		expect(html).toContain('The line on 11 November 1918.')
		expect(html).toContain('not-json')
	})

	test('never activates an unclosed view fence or a nested example', () => {
		const viewJson = JSON.stringify({
			version: 1,
			type: 'view',
			id: 'example-only',
			title: 'Example only',
			display: 'cue',
		})
		const html = renderToStaticMarkup(
			createElement(RichContentRenderer, {
				content: [
					`\`\`\`\`markdown\n\`\`\`earthly-view\n${viewJson}\n\`\`\`\n\`\`\`\``,
					`\`\`\`earthly-view\n${viewJson}`,
				].join('\n\n'),
			}),
		)

		expect(html).not.toContain('data-story-view-id="example-only"')
		expect(html).toContain('Example only')
	})
})
