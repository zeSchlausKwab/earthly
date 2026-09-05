import { expect, test } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'

const emptyStyle = { version: 8, sources: {}, layers: [] }

test('failed basemap offers recovery without losing the Map draft', async ({ earthly }) => {
	const page = earthly.page
	let fail = true
	await page.route('https://tiles.openfreemap.org/styles/**', (route) => fail
		? route.abort('failed')
		: route.fulfill({ json: emptyStyle }))
	await earthly.open({ tour: 'seen' })
	await expect(page.getByText('Basemap unavailable. Your work is safe.', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Continue without basemap', exact: true }).click()
	await expect(page.getByText('No basemap · showing your maps', { exact: true })).toBeVisible()
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Basemap recovery draft')
	// Recovery belongs to the canvas, not the current phone details sheet.
	if (earthly.isMobile) await page.getByRole('slider', { name: 'Resize panel', exact: true }).press('Home')
	fail = false
	await page.getByRole('button', { name: 'Retry basemap', exact: true }).click()
	await expect(page.getByLabel('Basemap status', { exact: true })).toHaveCount(0)
	if (earthly.isMobile) await page.getByRole('button', { name: 'Map details', exact: true }).click()
	await expect(draft.nameInput).toHaveValue('Basemap recovery draft')
})

test('drawing initializes while visible basemap tiles are still pending', async ({ earthly }) => {
	let release: () => void = () => {}
	const pending = new Promise<void>((resolve) => { release = resolve })
	await earthly.page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: {
		version: 8,
		sources: { base: { type: 'raster', tiles: ['https://tiles.openfreemap.org/ai-suite-delayed/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 0 } },
		layers: [{ id: 'base', type: 'raster', source: 'base' }],
	} }))
	await earthly.page.route('https://tiles.openfreemap.org/ai-suite-delayed/**', async (route) => {
		await pending
		await route.abort().catch(() => {})
	})
	try {
		await earthly.open({ tour: 'seen' })
		await expect(earthly.page.getByText('Loading basemap…', { exact: true })).toBeVisible()
		await expect(earthly.page.locator('.maplibregl-map .backdrop-blur-xs')).toHaveCount(0)
		const draft = await startDataset(earthly)
		await draft.nameInput.fill('Drawing before tiles')
		await expect(draft.nameInput).toHaveValue('Drawing before tiles')
		await expect.poll(() => earthly.page.evaluate(() => {
			const map = (window as unknown as { __earthlyUiMap?: { getStyle(): { layers: { id: string }[] } } }).__earthlyUiMap
			return map?.getStyle().layers.some((layer) => layer.id.startsWith('geo-editor-')) ?? false
		})).toBe(true)
	} finally { release() }
})
