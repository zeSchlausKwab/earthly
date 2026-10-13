import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createServer } from 'node:http'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { test, expect } from '../fixtures/earthly'
import { isLoopbackURL } from '../core/environment'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { openPublicMap } from '../tasks/navigation/public-map'
import { DEMO_MAP } from '../../src/map-plugin/fixtures'
import { MAP_RESOURCE_URI } from '../../src/map-plugin/mcp'

test.describe('public map plugin @map-plugin', () => {
	test.skip(
		process.env.AI_SUITE_MAP_PLUGIN !== '1',
		'Run test:map-plugin:browser against the local map server',
	)

	test('preview → public share → configured iframe; MCP selection bridge', async ({
		earthly,
		request,
	}) => {
		const { page, environment } = earthly
		const healthResponse = await request.get('/health')
		const healthInfo = await healthResponse.json()
		expect(healthInfo.service).toBe('earthly-public-maps')
		expect(
			Array.isArray(healthInfo.relays) &&
				healthInfo.relays.length > 0 &&
				healthInfo.relays.every((relay: string) => isLoopbackURL(relay)),
		).toBe(true)
		const client = new Client({ name: 'earthly-map-suite', version: '1.0.0' })
		const transport = new StreamableHTTPClientTransport(new URL('/mcp', environment.baseURL))
		await client.connect(transport)
		const health = monitorBrowserHealth(page)
		let embedHtml = ''
		// A real loopback host keeps Chromium's local-network classification accurate.
		// Intercepting the parent document can leave child navigations awaiting permission.
		const hostServer = createServer((req, res) => {
			res.setHeader('Content-Type', 'text/html')
			const body =
				req.url === '/map-embed-host'
					? embedHtml
					: '<output aria-label="Conversation selection"></output><iframe title="Chat map" sandbox="allow-scripts allow-same-origin" style="border:0;width:100%;height:580px"></iframe>'
			res.end(
				`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`,
			)
		})
		await new Promise<void>((resolve, reject) => {
			hostServer.once('error', reject)
			hostServer.listen(0, '127.0.0.1', resolve)
		})
		const hostAddress = hostServer.address()
		if (!hostAddress || typeof hostAddress === 'string')
			throw new Error('Missing test host address')
		const hostUrl = new URL(`http://127.0.0.1:${hostAddress.port}/map-test-host`)
		try {
			// Only the basemap is stubbed; geometry, workers, events and publication are real.
			await page.route('https://tiles.openfreemap.org/**', (route) =>
				route.fulfill({
					json: {
						version: 8,
						sources: {},
						layers: [
							{ id: 'background', type: 'background', paint: { 'background-color': '#e7e9df' } },
						],
					},
				}),
			)
			const preview = await client.callTool({
				name: 'preview_map',
				arguments: { title: 'A journey along the Danube', data: DEMO_MAP },
			})
			expect(preview.isError).toBeUndefined()
			const { draftId, revision } = preview.structuredContent as {
				draftId: string
				revision: number
			}
			const resource = await client.readResource({ uri: MAP_RESOURCE_URI })
			const widget = resource.contents[0]
			if (!widget || !('text' in widget)) throw new Error('Missing map UI resource')
			const csp = `default-src 'none'; script-src ${environment.baseURL}; style-src ${environment.baseURL} 'unsafe-inline'; connect-src ${environment.baseURL} https://tiles.openfreemap.org; img-src data: blob: ${environment.baseURL}; worker-src blob:;`
			const html = String(widget.text).replace(
				'<head>',
				`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
			)
			// MCP hosts isolate the app on a different origin while retaining its origin
			// inside the sandbox. An opaque srcdoc origin cannot access loopback assets.
			const widgetUrl = new URL('/map-test-widget', environment.baseURL).href
			await page.route(widgetUrl, (route) =>
				route.fulfill({ contentType: 'text/html', body: html }),
			)
			await page.goto(hostUrl.href)
			await page.evaluate(
				({ widgetUrl, result }) => {
					const frame = document.querySelector('iframe')!
					window.addEventListener('message', (event) => {
						if (event.source !== frame.contentWindow) return
						const message = event.data
						if (message.method === 'ui/initialize')
							frame.contentWindow?.postMessage(
								{
									jsonrpc: '2.0',
									id: message.id,
									result: {
										protocolVersion: '2026-01-26',
										hostInfo: { name: 'Earthly test host', version: '1.0.0' },
										hostCapabilities: {},
										hostContext: { displayMode: 'inline' },
									},
								},
								'*',
							)
						if (message.method === 'ui/notifications/initialized')
							frame.contentWindow?.postMessage(
								{ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
								'*',
							)
						if (message.method === 'ui/update-model-context') {
							document.querySelector('output')!.textContent =
								message.params.structuredContent.selectedFeatureName
							frame.contentWindow?.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*')
						}
					})
					frame.src = widgetUrl
				},
				{ widgetUrl, result: preview },
			)
			const chat = page.frameLocator('iframe')
			await expect(chat.getByText('Map ready', { exact: true })).toBeVisible()
			await expect(chat.getByText('Preview · not published', { exact: true })).toBeVisible()
			await chat.getByRole('button', { name: 'Vienna', exact: true }).click()
			await expect(page.getByLabel('Conversation selection')).toHaveText('Vienna')

			const published = await client.callTool({
				name: 'publish_map',
				arguments: { draftId, revision, visibility: 'public' },
			})
			expect(published.isError).toBeUndefined()
			const { reference, shareUrl } = published.structuredContent as {
				reference: string
				shareUrl: string
			}
			await openPublicMap(earthly, shareUrl)
			await expect(page.getByRole('heading', { name: 'A journey along the Danube' })).toBeVisible()
			await page.getByRole('button', { name: 'Vienna', exact: true }).click()
			await expect(page.getByRole('complementary', { name: 'Selected feature' })).toContainText(
				'Vienna',
			)
			await expect(page.getByText('An area to explore', { exact: true })).toBeVisible()
			const embed = await client.callTool({
				name: 'get_map_embed',
				arguments: {
					reference,
					view: {
						theme: 'dark',
						title: false,
						legend: false,
						controls: false,
						center: [16.6, 48.12],
						zoom: 8,
					},
				},
			})
			expect(embed.isError).toBeUndefined()
			await transport.terminateSession()
			const { embedUrl, html: generatedHtml } = embed.structuredContent as {
				embedUrl: string
				html: string
			}
			await openPublicMap(earthly, embedUrl)
			await expect(page.getByRole('heading')).toHaveCount(0)
			await expect(page.getByRole('complementary', { name: 'Map features' })).toHaveCount(0)
			await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0)
			expect(
				await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth),
			).toBe(true)
			// Also exercise the returned HTML inside an unrelated website origin.
			embedHtml = generatedHtml
			hostUrl.pathname = '/map-embed-host'
			await page.goto(hostUrl.href, { waitUntil: 'domcontentloaded' })
			const embedded = page.frameLocator('iframe')
			await expect(embedded.getByText('Map ready', { exact: true })).toBeVisible()
			await expect(embedded.getByText('Public map', { exact: true })).toBeVisible()
			await expect(embedded.getByRole('heading')).toHaveCount(0)
			await expect(embedded.getByRole('complementary', { name: 'Map features' })).toHaveCount(0)
			expect(health.snapshot().pageErrors).toEqual([])
			expect(health.snapshot().consoleErrors).toEqual([])
		} finally {
			health.stop()
			await client.close()
			hostServer.closeAllConnections()
			await new Promise<void>((resolve) => hostServer.close(() => resolve()))
		}
	})
})
