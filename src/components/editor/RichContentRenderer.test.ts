import { describe, expect, test } from 'bun:test'
import type { GeoFeatureItem } from './GeoRichTextEditor'
import { parseInlineTokens } from './RichContentRenderer'

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

function mentions(tokens: ReturnType<typeof parseInlineTokens>) {
	return tokens.filter((token) => token.type === 'mention')
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
		expect(mention).toBeDefined()
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
		expect(mention).toBeDefined()
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
		expect(nested[0].address).toBe(NADDR)
		expect(nested[0].displayName).toBe('Anchorage Lanes')
	})

	test('reference inside strong renders a mention nested in the strong token', () => {
		const tokens = parseInlineTokens(`**Important: nostr:${NADDR}#feat-12**`, availableFeatures)
		const strong = tokens.find((token) => token.type === 'strong')
		expect(strong).toBeDefined()
		const nested = mentions(strong?.children ?? [])
		expect(nested).toHaveLength(1)
		expect(nested[0].featureId).toBe('feat-12')
	})

	test('markdown link with nostr target inside emphasis', () => {
		const tokens = parseInlineTokens(`*[Anchorage lanes](nostr:${NADDR})*`, availableFeatures)
		const emphasis = tokens.find((token) => token.type === 'emphasis')
		const nested = mentions(emphasis?.children ?? [])
		expect(nested).toHaveLength(1)
		expect(nested[0].displayName).toBe('Anchorage lanes')
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
})
