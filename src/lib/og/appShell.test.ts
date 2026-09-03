import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { ARTICLE_KIND, GEO_EVENT_KIND } from '../nostr/kinds'
import {
	generateEntityAppShell,
	generateStoryReadAppShell,
	injectOGMetadataIntoAppShell,
	isNaddrForKind,
	isStoryReadAddress,
} from './appShell'
import { createGeoEventOGMeta } from './template'

const VALID_STORY_NADDR = nip19.naddrEncode({
	kind: ARTICLE_KIND,
	pubkey: 'a'.repeat(64),
	identifier: 'western-front',
})

describe('Story reader app shell', () => {
	test('replaces default metadata while preserving the executable application', async () => {
		const appShell = await Bun.file(new URL('../../index.html', import.meta.url)).text()
		const html = generateStoryReadAppShell(appShell, {
			baseUrl: 'https://earthly.city',
			naddr: VALID_STORY_NADDR,
			title: 'Western Front',
			description: 'A mapped history',
			imageIdentity: 'b'.repeat(64),
		})

		expect(html).not.toBeNull()
		expect(html).toContain('<div id="root">')
		expect(html).toContain('type="module"')
		expect(html).toContain('src="./frontend.tsx"')
		expect(html).toContain(
			`<link rel="canonical" href="https://earthly.city/read/${VALID_STORY_NADDR}">`,
		)
		expect(html).toContain(
			`<meta property="og:url" content="https://earthly.city/read/${VALID_STORY_NADDR}">`,
		)
		expect(html).toContain('<meta property="og:title" content="Western Front">')
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
		expect(html).not.toContain('<link rel="canonical" href="https://earthly.city" />')
		expect(html).not.toContain('http-equiv="refresh"')
		expect(html).not.toContain('window.location.href')
		expect(html?.match(/rel="canonical"/gu)).toHaveLength(1)
	})

	test('does not copy ambient query overlays into canonical identity', async () => {
		const appShell = await Bun.file(new URL('../../index.html', import.meta.url)).text()
		const html = generateStoryReadAppShell(appShell, {
			baseUrl: 'https://earthly.city',
			naddr: VALID_STORY_NADDR,
			title: 'Story',
			description: 'Description',
		})

		expect(html).toContain(`href="https://earthly.city/read/${VALID_STORY_NADDR}"`)
		expect(html).not.toContain('?on=')
	})

	test('escapes hostile Story fields without breaking out of metadata attributes', async () => {
		const appShell = await Bun.file(new URL('../../index.html', import.meta.url)).text()
		const html = generateStoryReadAppShell(appShell, {
			baseUrl: 'https://earthly.city',
			naddr: VALID_STORY_NADDR,
			title: '"><script data-injected>alert(1)</script>',
			description: '</title><img src=x onerror=alert(2)>',
			image: '"><img src=x onerror=alert(3)>',
		})

		expect(html).not.toBeNull()
		expect(html).not.toContain('<script data-injected>')
		expect(html).not.toContain('<img src=x onerror=')
		expect(html).not.toContain('onerror=alert(3)')
		expect(html).toContain('&lt;script data-injected&gt;')
		expect(html).toContain('content="/static/og-default.png"')
	})

	test('fails closed when the app-shell marker contract is absent', () => {
		expect(
			injectOGMetadataIntoAppShell('<html><head></head></html>', '<title>x</title>'),
		).toBeNull()
	})
})

describe('canonical entity app shells', () => {
	test('enriches a Map route without redirecting or removing the application', async () => {
		const appShell = await Bun.file(new URL('../../index.html', import.meta.url)).text()
		const naddr = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey: 'b'.repeat(64),
			identifier: 'western-front',
		})
		const html = generateEntityAppShell(
			appShell,
			createGeoEventOGMeta(
				'https://earthly.city',
				naddr,
				'Western Front Map',
				'A composed map',
				undefined,
				'c'.repeat(64),
				'map',
			),
		)

		expect(html).toContain('<div id="root">')
		expect(html).toContain('type="module"')
		expect(html).toContain(`rel="canonical" href="https://earthly.city/map/${naddr}"`)
		expect(html).toContain('<meta property="og:title" content="Western Front Map">')
		expect(html).not.toContain('http-equiv="refresh"')
		expect(html).not.toContain('window.location.href')
	})
})

describe('isStoryReadAddress', () => {
	test('accepts only a valid Story naddr', () => {
		const datasetNaddr = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey: 'a'.repeat(64),
			identifier: 'map',
		})

		expect(isStoryReadAddress(VALID_STORY_NADDR)).toBe(true)
		expect(isStoryReadAddress(datasetNaddr)).toBe(false)
		expect(isStoryReadAddress('not-an-naddr')).toBe(false)
		expect(isStoryReadAddress('')).toBe(false)
	})

	test('the shared validator checks the expected entity kind', () => {
		const datasetNaddr = nip19.naddrEncode({
			kind: GEO_EVENT_KIND,
			pubkey: 'a'.repeat(64),
			identifier: 'map',
		})

		expect(isNaddrForKind(datasetNaddr, GEO_EVENT_KIND)).toBe(true)
		expect(isNaddrForKind(datasetNaddr, ARTICLE_KIND)).toBe(false)
		expect(isNaddrForKind('not-an-naddr', GEO_EVENT_KIND)).toBe(false)
	})
})
