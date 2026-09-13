import type { StyleSpecification } from 'maplibre-gl'
import { expect, test } from '../fixtures/earthly'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

// Adjacent event attributes reproduce GHSA-jrc7-96c5-q579's live-attribute-list
// removal bug. The harmless marker records execution entirely inside this page.
const attribution = [
	'<a href="https://example.invalid/attribution">Fixture attribution</a>',
	'<details open onload="window.__attributionExecuted = true"',
	' ontoggle="window.__attributionExecuted = true">',
	'<summary>Attribution security fixture</summary></details>',
].join('')

const style: StyleSpecification = {
	version: 8,
	sources: {
		fixture: {
			type: 'geojson',
			attribution,
			data: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: {},
						geometry: { type: 'Point', coordinates: [0, 0] },
					},
				],
			},
		},
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': '#dcebf1' } },
		{
			id: 'fixture',
			type: 'circle',
			source: 'fixture',
			paint: { 'circle-radius': 36, 'circle-color': '#e11d48' },
		},
	],
}

test('MapLibre loads its worker, renders GeoJSON, and sanitizes style attribution', async ({
	earthly,
}, testInfo) => {
	const page = earthly.page
	const health = monitorBrowserHealth(page)
	await installIsolatedRelays(earthly)
	await page.addInitScript(() => {
		localStorage.setItem(
			'earthly-map-viewport-v1',
			JSON.stringify({
				version: 1,
				center: [0, 0],
				zoom: 2,
				bearing: 0,
				pitch: 0,
			}),
		)
	})
	// Intercept the real startup style rather than using a development-only map
	// handle, so this contract also exercises the production bundle unchanged.
	await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
		route.fulfill({ json: style }),
	)
	const [workerResponse, worker] = await Promise.all([
		page.waitForResponse(
			(response) => new URL(response.url()).pathname === '/workers/maplibre.worker.js',
		),
		page.waitForEvent(
			'worker',
			(worker) => new URL(worker.url()).pathname === '/workers/maplibre.worker.js',
		),
		earthly.open({ tour: 'seen' }),
	])
	expect(workerResponse.ok()).toBe(true)
	expect(workerResponse.headers()['content-type']).toMatch(/javascript/)
	expect(new URL(worker.url()).origin).toBe(new URL(earthly.environment.baseURL).origin)

	const canvas = page.locator('canvas[aria-label="Map"]').first()
	// Count the fixture's solid circle pixels in an actual screenshot. Canvas
	// presence and background color alone also pass when the worker is broken.
	await expect
		.poll(
			async () => {
				const png = await canvas.screenshot()
				return page.evaluate(async (base64) => {
					const image = new Image()
					image.src = `data:image/png;base64,${base64}`
					await image.decode()
					const probe = document.createElement('canvas')
					probe.width = image.width
					probe.height = image.height
					const context = probe.getContext('2d')
					if (!context) throw new Error('Canvas screenshot decoding is unavailable')
					context.drawImage(image, 0, 0)
					const { data } = context.getImageData(0, 0, probe.width, probe.height)
					let pixels = 0
					for (let index = 0; index < data.length; index += 4) {
						if (data[index] === 225 && data[index + 1] === 29 && data[index + 2] === 72) {
							pixels++
						}
					}
					return pixels
				}, png.toString('base64'))
			},
			{ message: 'The GeoJSON fixture must be rendered by the map worker' },
		)
		.toBeGreaterThan(200)

	const control = page.locator('.maplibregl-ctrl-attrib').first()
	await control.locator('.maplibregl-ctrl-attrib-button').click()
	const credit = control.getByRole('link', { name: 'Fixture attribution', exact: true })
	await expect(credit).toBeVisible()
	await expect(credit).toHaveAttribute('href', 'https://example.invalid/attribution')
	const payload = control.locator('.maplibregl-ctrl-attrib-inner details')
	await expect(payload).toHaveText('Attribution security fixture')
	await expect(control.locator('[onload], [ontoggle]')).toHaveCount(0)
	await payload.evaluate((element) => element.dispatchEvent(new Event('toggle')))
	expect(
		await page.evaluate(
			() =>
				(window as unknown as { __attributionExecuted?: boolean }).__attributionExecuted ?? false,
		),
	).toBe(false)
	expect(health.snapshot().pageErrors).toEqual([])
	expect(health.snapshot().consoleErrors).toEqual([])
	health.stop()
	await testInfo.attach('maplibre-runtime.png', {
		body: await canvas.screenshot(),
		contentType: 'image/png',
	})
})

test('unsupported WebGL shows a readable failure instead of leaving the basemap loading', async ({
	earthly,
}) => {
	const page = earthly.page
	const health = monitorBrowserHealth(page)
	await installIsolatedRelays(earthly)
	await page.addInitScript(() => {
		localStorage.setItem('earthly-tour-seen', 'true')
		localStorage.setItem('earthly-discover-welcome-v1', 'seen')
		HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
			apply(target, receiver, argumentsList) {
				if (argumentsList[0] === 'webgl2') return null
				return Reflect.apply(target, receiver, argumentsList)
			},
		})
	})
	// This failure intentionally has no ready map canvas for EarthlySession.open.
	await page.goto(earthly.environment.baseURL, { waitUntil: 'domcontentloaded' })
	await expect(page).toHaveTitle(/Earthly/)
	await expect(page.getByRole('alert')).toHaveText(
		'The map requires WebGL 2. Enable hardware acceleration or try another browser.',
	)
	await expect(page.getByText('Loading basemap…', { exact: true })).toHaveCount(0)
	expect(health.snapshot().pageErrors).toEqual([])
	health.stop()
})
