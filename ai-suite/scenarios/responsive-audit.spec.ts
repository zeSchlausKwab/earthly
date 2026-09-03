import { expect, test } from '../fixtures/earthly'
import { inspectSurface } from '../tasks/diagnostics/inspect-surface'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

const viewports = [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
	{ width: 768, height: 1024 },
	{ width: 1024, height: 768 },
	{ width: 1440, height: 900 },
]

test('settings and navigation adapt across breakpoint boundaries @audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'One context can resize through the full matrix')
	test.setTimeout(60_000)
	const observations = []
	for (const viewport of viewports) {
		await earthly.page.setViewportSize(viewport)
		await earthly.open({ tour: 'seen' })
		await openPanel(earthly, 'Settings')
		await earthly.page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		)
		const surface = await inspectSurface(earthly)
		observations.push({
			viewport,
			pathname: new URL(earthly.page.url()).pathname,
			documentOverflowX: surface.documentOverflowX,
			headings: surface.headings,
			unnamedControlCount: surface.unnamedControls.length,
			undersizedControlCount: surface.undersizedControls.length,
			clippedControlCount: surface.clippedControls.length,
			clippedControls: surface.clippedControls.slice(0, 5),
			tinyTextCount: surface.tinyText.length,
			visibleControlCount: surface.visibleControlCount,
		})
		await testInfo.attach(`settings-${viewport.width}x${viewport.height}.png`, {
			body: await earthly.page.screenshot({ animations: 'disabled' }),
			contentType: 'image/png',
		})
	}
	console.log(`AI_AUDIT_RESPONSIVE:${JSON.stringify(observations)}`)
	await testInfo.attach('responsive-observations.json', {
		body: JSON.stringify(observations, null, 2),
		contentType: 'application/json',
	})
})

test('mobile attribution remains compact and above transient chrome @audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Mobile chrome contract')
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)

	const attribution = earthly.page.locator('.maplibregl-ctrl-attrib')
	await expect(attribution).toBeVisible()
	await expect(attribution).toHaveClass(/maplibregl-compact/)

	const idleLayout = await earthly.page.evaluate(() => {
		const attributionBox = document
			.querySelector('.maplibregl-ctrl-attrib')
			?.getBoundingClientRect()
		const dockBox = document.querySelector('[data-tour="mobile-dock"]')?.getBoundingClientRect()
		return {
			attributionBottom: attributionBox?.bottom ?? Number.POSITIVE_INFINITY,
			attributionWidth: attributionBox?.width ?? Number.POSITIVE_INFINITY,
			dockTop: dockBox?.top ?? 0,
		}
	})
	expect(idleLayout.attributionBottom).toBeLessThanOrEqual(idleLayout.dockTop)
	expect(idleLayout.attributionWidth).toBeLessThan(80)
	await testInfo.attach('mobile-attribution-idle.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})

	await openPanel(earthly, 'Shelf')
	const sheet = earthly.page.getByTestId('mobile-sheet')
	await expect(sheet).toBeVisible()
	const sheetLayout = await earthly.page.evaluate(() => {
		const attributionBox = document
			.querySelector('.maplibregl-ctrl-attrib')
			?.getBoundingClientRect()
		const sheetBox = document.querySelector('[data-testid="mobile-sheet"]')?.getBoundingClientRect()
		return {
			attributionBottom: attributionBox?.bottom ?? Number.POSITIVE_INFINITY,
			attributionWidth: attributionBox?.width ?? Number.POSITIVE_INFINITY,
			attributionFits:
				(document.querySelector('.maplibregl-ctrl-attrib')?.scrollWidth ?? 1) <=
				(document.querySelector('.maplibregl-ctrl-attrib')?.clientWidth ?? 0) + 1,
			sheetTop: sheetBox?.top ?? 0,
		}
	})
	expect(sheetLayout.attributionBottom).toBeLessThanOrEqual(sheetLayout.sheetTop)
	expect(sheetLayout.attributionWidth).toBeLessThan(80)
	expect(sheetLayout.attributionFits).toBe(true)
	await expect
		.poll(() =>
			earthly.page.evaluate(
				() =>
					!(
						window as unknown as { __earthlyMap?: { isMoving: () => boolean } }
					).__earthlyMap?.isMoving(),
			),
		)
		.toBe(true)
	await testInfo.attach('mobile-attribution-map-stack.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
})

test('mobile Me opens the profile, exposes every section, and returns to the map @audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Mobile navigation contract')
	await earthly.open({ tour: 'seen' })
	const dock = earthly.page.locator('[data-tour="mobile-dock"]')
	await expect(dock.getByRole('button')).toHaveCount(4)
	await expect(dock.getByRole('button').nth(0)).toHaveAccessibleName('Map')
	await expect(dock.getByRole('button').nth(1)).toHaveAccessibleName('Search')
	await expect(dock.getByRole('button').nth(2)).toHaveAccessibleName('Create')
	await expect(dock.getByRole('button').nth(3)).toHaveAccessibleName('Me')

	await dock.getByRole('button', { name: 'Search', exact: true }).click()
	const mobileSearch = earthly.page.locator('search[aria-label="Search places"]')
	await expect(mobileSearch).toBeVisible()
	await dock.getByRole('button', { name: 'Just map', exact: true }).click()
	await expect(mobileSearch).toBeHidden()

	await dock.getByRole('button', { name: 'Create', exact: true }).click()
	await expect(earthly.page.getByRole('menuitem', { name: 'Map', exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('menuitem', { name: 'Atlas', exact: true })).toBeVisible()
	await earthly.page.keyboard.press('Escape')

	await dock.getByRole('button', { name: 'Me', exact: true }).click()

	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	await expect(drawer).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
	await drawer.getByRole('button', { name: 'Back to menu', exact: true }).click()
	await expect
		.poll(async () => {
			const width = await drawer.evaluate((element) => element.getBoundingClientRect().width)
			return width / (earthly.page.viewportSize()?.width ?? 1)
		})
		.toBeLessThanOrEqual(0.9)
	const menuWidth = await drawer.evaluate((element) => element.getBoundingClientRect().width)
	const viewportWidth = earthly.page.viewportSize()?.width ?? 1
	expect(menuWidth / viewportWidth).toBeGreaterThanOrEqual(0.65)
	const dockRemainsInteractive = await earthly.page
		.locator('[data-tour="mobile-dock"] button')
		.evaluateAll((buttons) =>
			buttons.every((button) => {
				const bounds = button.getBoundingClientRect()
				const topmost = document.elementFromPoint(
					bounds.left + bounds.width / 2,
					bounds.top + bounds.height / 2,
				)
				return topmost !== null && button.contains(topmost)
			}),
		)
	expect(dockRemainsInteractive).toBe(true)
	await testInfo.attach('mobile-navigation-menu.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})

	await drawer.getByRole('button', { name: /^Atlases(?:\s|$)/ }).click()
	await expect(
		drawer
			.locator('h2:visible')
			.filter({ hasText: /^Atlases$/ })
			.first(),
	).toBeVisible()
	await expect
		.poll(async () => drawer.evaluate((element) => element.getBoundingClientRect().width))
		.toBeGreaterThan(menuWidth)
	const contentWidth = await drawer.evaluate((element) => element.getBoundingClientRect().width)
	expect(contentWidth / viewportWidth).toBeLessThanOrEqual(0.93)
	await testInfo.attach('mobile-navigation-contexts.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})

	await earthly.page.getByRole('button', { name: 'Just map', exact: true }).click()
	await expect(drawer).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/')
	await expect(earthly.page.locator('.maplibregl-ctrl-attrib')).toBeVisible()
})
