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

test('mobile Browse opens the catalog sheet and Me opens a route-preserving menu @audit', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Mobile navigation contract')
	await earthly.open({ tour: 'seen' })
	const dock = earthly.page.locator('[data-tour="mobile-dock"]')
	await expect(dock.getByRole('button')).toHaveCount(4)
	await expect(dock.getByRole('button').nth(0)).toHaveAccessibleName('Map')
	await expect(dock.getByRole('button').nth(1)).toHaveAccessibleName('Browse')
	await expect(dock.getByRole('button').nth(2)).toHaveAccessibleName('Create')
	await expect(dock.getByRole('button').nth(3)).toHaveAccessibleName('Me')

	await dock.getByRole('button', { name: 'Browse', exact: true }).click()
	const sheet = earthly.page.getByRole('dialog', { name: 'Browse panel', exact: true })
	await expect(sheet).toBeVisible()
	await expect(sheet.getByRole('tab', { name: /^Maps(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await expect(earthly.page.getByRole('search', { name: 'Search places' })).toBeHidden()
	const viewportWidth = earthly.page.viewportSize()?.width ?? 1
	await expect
		.poll(async () => sheet.evaluate((element) => element.getBoundingClientRect().width))
		.toBe(viewportWidth)
	await sheet.getByRole('tab', { name: /^Atlases(?:\s|$)/ }).click()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/atlases')
	await expect(sheet.getByRole('tab', { name: /^Atlases(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await testInfo.attach('mobile-browse-atlases.png', {
		body: await earthly.page.screenshot({ animations: 'disabled' }),
		contentType: 'image/png',
	})
	await dock.getByRole('button', { name: 'Just map', exact: true }).click()
	await expect(sheet).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/')

	await dock.getByRole('button', { name: 'Create', exact: true }).click()
	await expect(earthly.page.getByRole('menuitem', { name: 'Map', exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('menuitem', { name: 'Atlas', exact: true })).toBeVisible()
	await earthly.page.keyboard.press('Escape')

	const beforeMe = earthly.page.url()
	await dock.getByRole('button', { name: 'Me', exact: true }).click()
	const menu = earthly.page.getByRole('dialog', { name: 'Me menu', exact: true })
	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	await expect(menu).toBeVisible()
	await expect(drawer).toBeHidden()
	await expect.poll(() => earthly.page.url()).toBe(beforeMe)
	for (const label of [
		'Profile',
		'Drafts',
		'Inbox',
		'Circles',
		'Nearby sessions',
		'Share live location',
		'Sync & delivery',
		'Wallet',
		'Settings',
		'Help & tour',
	]) {
		await expect(menu.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) })).toBeVisible()
	}
	const menuBox = await menu.boundingBox()
	expect(menuBox).not.toBeNull()
	expect(menuBox?.x ?? -1).toBeGreaterThanOrEqual(0)
	expect((menuBox?.x ?? viewportWidth) + (menuBox?.width ?? 1)).toBeLessThanOrEqual(viewportWidth)
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

	await menu.getByRole('button', { name: 'Profile', exact: true }).click()
	await expect(menu).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
	await expect(drawer).toBeVisible()

	await earthly.page.getByRole('button', { name: 'Just map', exact: true }).click()
	await expect(drawer).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/')
	await expect(earthly.page.locator('.maplibregl-ctrl-attrib')).toBeVisible()
})
