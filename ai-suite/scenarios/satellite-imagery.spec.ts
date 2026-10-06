import type { LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../fixtures/earthly'
import { openMapSettings } from '../tasks/navigation/map-settings'
import { openPanel } from '../tasks/navigation/open-panel'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

const satelliteId = 'earthly-eox-satellite-imagery'
const sourceId = 'earthly-eox-satellite'
const originalOrder = ['background', 'land', 'road', 'building', 'label', 'authored']
const fixtureStyle: StyleSpecification = {
	version: 8,
	sources: {
		openmaptiles: {
			type: 'geojson',
			attribution: 'OpenFreeMap · OpenStreetMap',
			data: { type: 'FeatureCollection', features: [] },
		},
		authored: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': '#e3e8dd' } },
		{ id: 'land', type: 'fill', source: 'openmaptiles' },
		{ id: 'road', type: 'line', source: 'openmaptiles' },
		{ id: 'building', type: 'fill', source: 'openmaptiles' },
		{ id: 'label', type: 'symbol', source: 'openmaptiles' },
		{ id: 'authored', type: 'circle', source: 'authored', paint: { 'circle-opacity': 0.4 } },
	],
}

async function composition(page: import('@playwright/test').Page) {
	return page.evaluate(
		({ satelliteId, sourceId, originalOrder }) => {
			const map = (window as unknown as { __earthlyUiMap?: MapLibreMap }).__earthlyUiMap
			const style = map?.getStyle()
			const trackedIds = new Set([...originalOrder, satelliteId])
			const imagery = style?.layers.find(
				(layer): layer is Extract<LayerSpecification, { type: 'raster' }> =>
					layer.id === satelliteId && layer.type === 'raster',
			)
			return {
				order: style?.layers.filter((layer) => trackedIds.has(layer.id)).map((layer) => layer.id),
				opacity: imagery?.paint?.['raster-opacity'] ?? null,
				source: style?.sources[sourceId] ?? null,
			}
		},
		{ satelliteId, sourceId, originalOrder },
	)
}

test('satellite composition is optional, configurable, and survives reload and style changes @regression', async ({
	earthly,
}, testInfo) => {
	const page = earthly.page
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await installIsolatedRelays(earthly)
	await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
		route.fulfill({ json: fixtureStyle }),
	)
	let tileRequests = 0
	await page.route('https://tiles.maps.eox.at/**', (route) => {
		tileRequests++
		// Tile content is controlled; this regression never depends on the public service.
		return route.fulfill({
			contentType: 'image/png',
			path: fileURLToPath(
				new URL('../../public/static/android-chrome-192x192.png', import.meta.url),
			),
		})
	})
	await earthly.open({ tour: 'seen' })
	expect(tileRequests).toBe(0)
	const background = page.getByRole('button', { name: /^Map background:/ })
	await expect(background).toHaveCount(1)
	await expect(background).toHaveAccessibleName('Map background: OSM. Switch to Satellite')
	if (!earthly.isMobile) {
		await expect(page.getByRole('tab', { name: /^Stories(?:\s|$)/ })).toHaveAttribute(
			'aria-selected',
			'true',
		)
	}
	await page.getByRole('button', { name: 'Browse', exact: true }).click()
	await expect(page.getByRole('tab', { name: /^Stories(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	if (earthly.isMobile) await page.getByRole('button', { name: 'Just map', exact: true }).click()
	const bounds = await background.boundingBox()
	expect(bounds?.height).toBe(44)
	expect(bounds?.width).toBe(44)
	await expect(background).toHaveText('')
	await background.click()
	await expect(background).toHaveAccessibleName('Map background: Satellite. Switch to Combined')
	await expect.poll(async () => (await composition(page)).opacity).toBe(1)
	await expect
		.poll(async () => (await composition(page)).order)
		.toEqual(['background', 'land', 'road', 'building', 'label', satelliteId, 'authored'])
	await background.press('Enter')
	await expect(background).toHaveAccessibleName('Map background: Combined. Switch to OSM')
	await expect.poll(async () => (await composition(page)).opacity).toBe(0.75)
	await background.press('Space')
	await expect.poll(async () => (await composition(page)).source).toBeNull()
	await expect(background).toHaveAccessibleName('Map background: OSM. Switch to Satellite')
	await page.screenshot({
		path: testInfo.outputPath('map-background-switch.png'),
		animations: 'disabled',
	})
	if (earthly.isMobile) {
		await page.setViewportSize({ width: 320, height: 568 })
		await background.click()
		await expect(background).toHaveAccessibleName('Map background: Satellite. Switch to Combined')
		await expect.poll(async () => (await composition(page)).opacity).toBe(1)
		const bounds = await background.boundingBox()
		expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThan(270)
		await page.screenshot({
			path: testInfo.outputPath('map-background-narrow.png'),
			animations: 'disabled',
		})
		await background.click()
		await expect(background).toHaveAccessibleName('Map background: Combined. Switch to OSM')
		await background.click()
		await expect.poll(async () => (await composition(page)).source).toBeNull()
		await page.setViewportSize({ width: 390, height: 844 })
	}
	let settings = await openMapSettings(earthly)
	const toggle = () => settings.getByRole('switch', { name: 'Satellite imagery', exact: true })
	await expect(toggle()).not.toBeChecked()
	await toggle().click()
	await expect.poll(() => tileRequests).toBeGreaterThan(0)
	await expect
		.poll(async () => (await composition(page)).order)
		.toEqual(['background', 'land', 'building', satelliteId, 'road', 'label', 'authored'])
	const opacity = settings.getByRole('slider', { name: 'Imagery opacity', exact: true })
	await opacity.press('Home')
	await expect.poll(async () => (await composition(page)).source).toBeNull()
	await opacity.press('End')
	await opacity.press('ArrowLeft')
	await expect(opacity).toHaveAttribute('aria-valuenow', '95')
	await expect.poll(async () => (await composition(page)).opacity).toBe(0.95)
	await settings.getByRole('switch', { name: 'Keep OSM roads and labels', exact: true }).click()
	await expect
		.poll(async () => (await composition(page)).order)
		.toEqual(['background', 'land', 'road', 'building', 'label', satelliteId, 'authored'])
	await page.screenshot({ path: testInfo.outputPath('satellite-settings.png') })
	if (!earthly.isMobile) {
		await page.keyboard.press('Escape')
		await page.getByRole('button', { name: 'More tools', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
		await expect.poll(async () => (await composition(page)).opacity).toBe(0.95)
	}
	await page.reload()
	await expect.poll(async () => (await composition(page)).opacity).toBe(0.95)
	await expect(page.getByLabel('Basemap status', { exact: true })).toHaveCount(0)
	settings = await openMapSettings(earthly)
	await expect(toggle()).toBeChecked()
	await expect(
		settings.getByRole('slider', { name: 'Imagery opacity', exact: true }),
	).toHaveAttribute('aria-valuenow', '95')
	await expect(
		settings.getByRole('switch', { name: 'Keep OSM roads and labels', exact: true }),
	).not.toBeChecked()
	await toggle().click()
	await expect.poll(async () => (await composition(page)).source).toBeNull()
	await expect.poll(async () => (await composition(page)).order).toEqual(originalOrder)
	if (!earthly.isMobile) await page.keyboard.press('Escape')
	else await page.getByRole('button', { name: 'Just map', exact: true }).click()
	await background.click()
	await expect(background).toHaveAccessibleName('Map background: Satellite. Switch to Combined')
	await expect.poll(async () => (await composition(page)).opacity).toBe(1)
	await background.press('Enter')
	await expect.poll(async () => (await composition(page)).opacity).toBe(0.95)
	await background.press('Space')
	await expect.poll(async () => (await composition(page)).source).toBeNull()
	expect(errors).toEqual([])
})

test('an unavailable satellite service leaves the OSM basemap usable @regression', async ({
	earthly,
}) => {
	const page = earthly.page
	await installIsolatedRelays(earthly)
	await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
		route.fulfill({ json: fixtureStyle }),
	)
	let failures = 0
	await page.route('https://tiles.maps.eox.at/**', (route) => {
		failures++
		return route.fulfill({ status: 429, body: 'Rate limited' })
	})
	await earthly.open({ tour: 'seen' })
	const settings = await openMapSettings(earthly)
	await settings.getByRole('switch', { name: 'Satellite imagery', exact: true }).click()
	await expect.poll(() => failures).toBeGreaterThan(0)
	await expect(page.getByLabel('Basemap status', { exact: true })).toHaveCount(0)
	await settings.getByRole('switch', { name: 'Satellite imagery', exact: true }).click()
	await expect.poll(async () => (await composition(page)).order).toEqual(originalOrder)
	if (!earthly.isMobile) await page.keyboard.press('Escape')
	await openPanel(earthly, 'Maps')
	await expect(page.locator('canvas[aria-label="Map"]').first()).toBeVisible()
})
