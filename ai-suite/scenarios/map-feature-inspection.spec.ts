import type { Feature } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { expect, test } from '../fixtures/earthly'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { mobileWorkspaceSheet } from '../tasks/navigation/mobile-workspace'

const features: Feature[] = Array.from({ length: 20 }, (_, index) => {
	const x = 13.98 + (index % 5) * 0.018
	const y = 46.7 + Math.floor(index / 5) * 0.018
	return {
		type: 'Feature',
		id: `territory-${index}`,
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[x, y],
					[x + 0.01, y],
					[x + 0.01, y + 0.01],
					[x, y + 0.01],
					[x, y],
				],
			],
		},
		properties: {
			name: `Territory ${index}`,
			description: `The history of territory ${index}.`,
			color: index === 19 ? '#7c3aed' : '#d6a54d',
			...(index === 19
				? {
						customProperties: {
							period: { start: 1200, end: 1250 },
							active: false,
							...Object.fromEntries(
								Array.from({ length: 30 }, (_, i) => [
									`detail_${i}`,
									`Historical note ${i}: ${'A long source note. '.repeat(10)}`,
								]),
							),
						},
					}
				: {}),
		},
	}
})

test('Feature clicks open details by default and reveal a late sidebar row @editor-contract', async ({
	earthly,
}, testInfo) => {
	const page = earthly.page
	const publications = await installIsolatedRelays(earthly)
	await earthly.open()
	const fixture = await installInMemoryMapFixture(earthly, {
		title: 'Territorial mosaic',
		identifier: 'feature-popup-mosaic',
		description: 'This describes the whole collection, not a single territory.',
		features,
	})
	await earthly.open({ path: fixture.path })
	await installDeterministicMapStyle(earthly)
	const inspect = page.getByRole('region', { name: 'Map inspection', exact: true })
	await inspect.getByRole('button', { name: 'Frame Map', exact: true }).click()
	await expect
		.poll(() =>
			page.evaluate(() => {
				const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
				return Boolean(map && !map.isMoving() && map.getCenter().lng > 13)
			}),
		)
		.toBe(true)
	await expect(inspect.getByText('Territory 19', { exact: true })).toHaveCount(0)
	if (earthly.isMobile) {
		const resize = mobileWorkspaceSheet(earthly).getByRole('slider', {
			name: 'Resize panel',
			exact: true,
		})
		await resize.press('Home')
	}
	const snapshot = () =>
		page.evaluate(() => {
			const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
			if (!map) throw new Error('Map unavailable')
			const point = map.project([14.057, 46.759])
			const bounds = map.getCanvas().getBoundingClientRect()
			return {
				point: { x: bounds.x + point.x, y: bounds.y + point.y },
				moving: map.isMoving(),
				hits: map.queryRenderedFeatures(point).filter((f) => f.properties?.name === 'Territory 19')
					.length,
				camera: { center: map.getCenter().toArray(), zoom: map.getZoom() },
			}
		})
	await expect.poll(async () => (await snapshot()).hits).toBeGreaterThan(0)
	await expect.poll(async () => (await snapshot()).moving).toBe(false)
	const before = await snapshot()
	if (!earthly.isMobile) {
		await expect(
			page.getByRole('button', { name: 'Enable hover previews', exact: true }),
		).toBeVisible()
		await page.mouse.move(before.point.x, before.point.y)
	}
	await expect(page.getByRole('dialog', { name: 'Territory 19 details', exact: true })).toHaveCount(
		0,
	)
	if (earthly.isMobile) await page.touchscreen.tap(before.point.x, before.point.y)
	else await page.mouse.click(before.point.x, before.point.y)
	const popup = page.getByRole('dialog', { name: 'Territory 19 details', exact: true })
	await expect(popup).toBeVisible()
	await expect(popup.getByText('The history of territory 19.', { exact: true })).toBeVisible()
	await expect(popup).not.toContainText('This describes the whole collection')
	await expect(popup).not.toContainText('earthlyPresentation')
	await expect(popup.getByText('period', { exact: true })).toBeVisible()
	await expect(popup.getByText('"start": 1200', { exact: false })).toBeVisible()
	await expect(
		inspect.getByRole('button', { name: 'Collapse Territory 19', exact: true }),
	).toBeInViewport()
	await expect(inspect.locator('[aria-current="true"]')).toContainText('Territory 19')
	const scrollable = popup.getByLabel('Feature information', { exact: true })
	expect(await scrollable.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
	expect(await popup.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(420)
	if (!earthly.isMobile) {
		await page.mouse.move(1, 1)
		await expect(popup).toBeVisible()
	}
	await testInfo.attach('Feature popup and selected sidebar row', {
		body: await page.screenshot({ path: testInfo.outputPath('feature-details.png') }),
		contentType: 'image/png',
	})
	await scrollable.hover()
	await page.mouse.wheel(0, 500)
	await expect.poll(() => scrollable.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
	await popup.getByRole('button', { name: 'Close feature details', exact: true }).click()
	await expect(popup).toHaveCount(0)
	const after = await snapshot()
	expect(after.camera.zoom).toBeCloseTo(before.camera.zoom, 8)
	expect(after.camera.center[0]).toBeCloseTo(before.camera.center[0] ?? 0, 8)
	expect(after.camera.center[1]).toBeCloseTo(before.camera.center[1] ?? 0, 8)
	expect(publications.size).toBe(0)
})
