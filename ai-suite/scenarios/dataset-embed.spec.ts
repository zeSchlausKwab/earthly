import { finalizeEvent, nip19, SimplePool } from 'nostr-tools'
import { createServer } from 'node:http'
import type { FeatureCollection } from 'geojson'
import { test, expect } from '../fixtures/earthly'
import { isLoopbackURL } from '../core/environment'
import { copyCurrentShareLink, openDatasetEmbed } from '../tasks/navigation/share-current-view'
import { DEMO_MAP } from '../../src/map-plugin/fixtures'

// Opt in with the same PUBLIC_MAP_URL used to start the local Earthly app.
const viewer = process.env.AI_SUITE_EMBED_URL
const localRelay = 'ws://127.0.0.1:3334'

async function publishFixture(data: FeatureCollection = DEMO_MAP) {
	const identifier = `embed-suite-${crypto.randomUUID()}`
	const event = finalizeEvent(
		{
			kind: 37515,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier],
				['title', 'Embeddable dataset'],
				['bbox', '16.37,48.03,17.11,48.21'],
			],
			content: JSON.stringify({ ...data, name: 'Embeddable dataset' }),
		},
		new Uint8Array(32).fill(1),
	)
	const pool = new SimplePool()
	try {
		await Promise.all(pool.publish([localRelay], event))
	} finally {
		pool.destroy()
	}
	return nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier })
}

test.describe('dataset Share embeds @dataset-embed', () => {
	test.skip(!viewer, 'Set AI_SUITE_EMBED_URL and the app PUBLIC_MAP_URL to a local map service')
	test.beforeEach(async ({ request }) => {
		if (!viewer || !isLoopbackURL(viewer)) throw new Error('Embed tests require a loopback viewer')
		const response = await request.get(new URL('/health', viewer).href)
		const health = await response.json()
		expect(health.service).toBe('earthly-public-maps')
		expect(health.relays.length).toBeGreaterThan(0)
		expect(health.relays.every(isLoopbackURL)).toBe(true)
	})

	test('configures, previews and copies an iframe while preserving link sharing', async ({
		earthly,
	}, testInfo) => {
		const reference = await publishFixture()
		const { page } = earthly
		await earthly.open({ path: `/map/${reference}` })
		const link = await copyCurrentShareLink(earthly)
		expect(new URL(link).pathname).toBe(`/map/${reference}`)
		await openDatasetEmbed(earthly)
		const frame = page.frameLocator('iframe[title="Dataset embed preview"]')
		await expect(frame.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 15_000 })
		await expect(page.getByLabel('Scroll to zoom', { exact: true })).not.toBeChecked()
		await page.getByLabel('Theme', { exact: true }).selectOption('dark')
		await page.getByLabel('Height (px)', { exact: true }).fill('199')
		await expect(page.getByRole('button', { name: 'Copy iframe', exact: true })).toBeDisabled()
		await page.getByLabel('Height (px)', { exact: true }).fill('620')
		for (const name of ['Show title', 'Show legend', 'Show map controls'])
			await page.getByLabel(name, { exact: true }).uncheck()
		await page.getByLabel('Scroll to zoom', { exact: true }).check()
		await page.getByRole('button', { name: 'Use current camera', exact: true }).click()
		await expect(page.getByRole('textbox', { name: 'Iframe code' })).toHaveValue(/center=.*zoom=/)
		await page.getByRole('button', { name: 'Fit dataset', exact: true }).click()
		await expect(frame.getByText('Map ready', { exact: true })).toBeVisible({ timeout: 15_000 })
		await expect(frame.getByRole('heading')).toHaveCount(0)
		await expect(frame.getByRole('complementary', { name: 'Map features' })).toHaveCount(0)
		await expect(frame.getByRole('button', { name: 'Zoom in' })).toHaveCount(0)
		await page.getByRole('button', { name: 'Copy iframe', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Iframe copied', exact: true })).toBeVisible()
		const html = await page.evaluate(() => navigator.clipboard.readText())
		expect(html).toContain('height="620"')
		expect(html).toContain(
			'theme=dark&amp;title=false&amp;legend=false&amp;controls=false&amp;scrollZoom=true',
		)
		expect(html).not.toContain('center=')
		await page.screenshot({ path: testInfo.outputPath('embed-preview.png') })
		const panel = page.getByRole('region', { name: 'Embed dataset' })
		expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
		// Exercise the exact copied snippet in a separate page, independent of the app state.
		const host = await page.context().newPage()
		// Real HTTP preserves Chromium's loopback network classification for child frames.
		const server = createServer((_req, res) => {
			res.setHeader('Content-Type', 'text/html')
			res.end(
				`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${html}</body></html>`,
			)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		try {
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('Missing host port')
			await host.goto(`http://127.0.0.1:${address.port}`)
			await expect(host.frameLocator('iframe').getByText('Map ready', { exact: true })).toBeVisible(
				{ timeout: 15_000 },
			)
		} finally {
			await host.close()
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})

	test('blocks copy and preview on service failure, then allows retry', async ({ earthly }) => {
		const reference = await publishFixture()
		const endpoint = new URL(`/api/maps/${reference}`, viewer).href
		await earthly.page.route(endpoint, (route) =>
			route.fulfill({
				status: 400,
				headers: { 'Access-Control-Allow-Origin': '*' },
				json: { error: 'Map unavailable' },
			}),
		)
		await earthly.open({ path: `/map/${reference}` })
		await openDatasetEmbed(earthly)
		await expect(earthly.page.getByRole('alert')).toContainText('could not read this dataset')
		await expect(
			earthly.page.getByRole('button', { name: 'Copy iframe', exact: true }),
		).toBeDisabled()
		await expect(earthly.page.getByTitle('Dataset embed preview', { exact: true })).toHaveCount(0)
		await earthly.page.unroute(endpoint)
		await earthly.page.getByRole('button', { name: 'Check again', exact: true }).click()
		await expect(
			earthly.page.getByRole('button', { name: 'Copy iframe', exact: true }),
		).toBeEnabled({ timeout: 15_000 })
	})

	test('rejects oversized datasets before requesting the viewer', async ({ earthly }) => {
		const point = DEMO_MAP.features[0]
		if (!point) throw new Error('Missing demo geometry')
		const reference = await publishFixture({
			type: 'FeatureCollection',
			features: Array.from({ length: 301 }, (_, id) => ({ ...point, id })),
		})
		let requests = 0
		earthly.page.on('request', (request) => {
			if (request.url().startsWith(`${viewer}/api/maps/`)) requests++
		})
		await earthly.open({ path: `/map/${reference}` })
		await openDatasetEmbed(earthly)
		await expect(earthly.page.getByRole('alert')).toContainText('not supported')
		await expect(
			earthly.page.getByRole('button', { name: 'Copy iframe', exact: true }),
		).toBeDisabled()
		await expect(earthly.page.getByTitle('Dataset embed preview', { exact: true })).toHaveCount(0)
		expect(requests).toBe(0)
	})
})
