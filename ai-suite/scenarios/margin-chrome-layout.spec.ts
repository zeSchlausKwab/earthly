import type { Locator, TestInfo } from '@playwright/test'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

async function attachChrome(earthly: EarthlySession, testInfo: TestInfo, name: string) {
	await expect(
		earthly.page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem'),
	).toHaveCount(0, { timeout: 15_000 })
	const path = testInfo.outputPath(`${name}.png`)
	await earthly.page.screenshot({ path, animations: 'disabled' })
	await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** Actual hit testing catches a button painted under an overlapping footer or Thread. */
async function expectHittable(button: Locator) {
	await expect(button).toBeVisible()
	await expect(button).toBeInViewport({ ratio: 1 })
	await expect
		.poll(() =>
			button.evaluate((element) => {
				const bounds = element.getBoundingClientRect()
				return [0.25, 0.5, 0.75].every((fraction) => {
					const target = document.elementFromPoint(
						bounds.x + bounds.width / 2,
						bounds.y + bounds.height * fraction,
					)
					return target !== null && element.contains(target)
				})
			}),
		)
		.toBe(true)
}

for (const viewport of [
	{ width: 320, height: 568 },
	{ width: 390, height: 844 },
]) {
	test(`phone Create is roomy and usable at ${viewport.width}×${viewport.height} @regression`, async ({
		earthly,
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'mobile', 'Phone Create menu contract')
		await earthly.page.setViewportSize(viewport)
		await earthly.open({ tour: 'seen' })
		await installDeterministicMapStyle(earthly)
		const create = earthly.page.getByRole('button', { name: 'Create', exact: true })
		// Radix correctly removes the background navigation from the accessibility
		// tree while its modal menu is open. Measure the dock before opening it.
		const dockBounds = await earthly.page
			.getByRole('navigation', { name: 'Primary', exact: true })
			.boundingBox()
		await create.click()
		const menu = earthly.page.getByRole('menu', { name: 'Create', exact: true })
		await expect(menu).toBeVisible()
		await expect(menu.getByRole('menuitem')).toHaveCount(5)
		const menuBounds = await menu.boundingBox()
		if (!menuBounds || !dockBounds) throw new Error('Create menu and dock must have visible bounds')
		expect(Math.abs(menuBounds.width - Math.min(viewport.width - 24, 448))).toBeLessThanOrEqual(2)
		expect(menuBounds.x).toBeGreaterThanOrEqual(10)
		expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(viewport.width - 10)
		expect(menuBounds.y).toBeGreaterThanOrEqual(10)
		expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(dockBounds.y - 4)
		for (const name of ['Map', 'Atlas', 'Story', 'Sighting', 'Live beacon']) {
			const action = menu.getByRole('menuitem', { name, exact: true })
			await expectHittable(action)
			const bounds = await action.boundingBox()
			if (!bounds) throw new Error(`${name} action must have visible bounds`)
			expect(bounds.height).toBeGreaterThanOrEqual(56)
			expect(bounds.y).toBeGreaterThanOrEqual(menuBounds.y)
			expect(bounds.y + bounds.height).toBeLessThanOrEqual(menuBounds.y + menuBounds.height)
			await expect(action.locator('svg')).toBeVisible()
			expect((await action.innerText()).replace(name, '').trim().length).toBeGreaterThan(12)
		}
		await attachChrome(earthly, testInfo, `create-${viewport.width}x${viewport.height}`)
		await earthly.page.keyboard.press('Escape')
		await expect(menu).toBeHidden()
		await expect(create).toBeFocused()
		const before = await editorLifecycleSnapshot(earthly)
		const draft = await startDataset(earthly)
		await draft.nameInput.fill(`Create menu ${viewport.width} phone draft`)
		await expect
			.poll(async () => (await editorLifecycleSnapshot(earthly)).activeWorkspaceId)
			.not.toBe(before.activeWorkspaceId)
		await addPointToGeometryDraft(earthly)
		await expectGeometryFeatureCount(earthly, 1)
	})
}

test('Browse starts with its tabs without a redundant count or title row @regression', async ({
	earthly,
}, testInfo) => {
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openPanel(earthly, 'Maps')
	const tabs = earthly.page.getByRole('tablist', { name: 'Browse', exact: true })
	await expect(tabs).toBeVisible()
	if (earthly.isMobile) {
		const sheet = earthly.page.getByRole('dialog', { name: 'Browse panel', exact: true })
		await expect(sheet.getByText(/^On the map(?:\s|·)/)).toHaveCount(0)
		await expect
			.poll(async () => {
				const [sheetBounds, tabsBounds] = await Promise.all([
					sheet.boundingBox(),
					tabs.boundingBox(),
				])
				const viewport = earthly.page.viewportSize()
				return Boolean(
					sheetBounds &&
						tabsBounds &&
						viewport &&
						Math.abs(sheetBounds.height / viewport.height - 0.5) < 0.02 &&
						tabsBounds.y - sheetBounds.y <= 56,
				)
			})
			.toBe(true)
	} else {
		const margin = earthly.page.getByRole('complementary', { name: 'Margin', exact: true })
		await expect(margin.getByText('Browse', { exact: true })).toHaveCount(0)
		await expect
			.poll(async () => {
				const [marginBounds, tabsBounds] = await Promise.all([
					margin.boundingBox(),
					tabs.boundingBox(),
				])
				return marginBounds && tabsBounds ? tabsBounds.y - marginBounds.y : Number.POSITIVE_INFINITY
			})
			.toBeLessThanOrEqual(12)
	}
	await attachChrome(earthly, testInfo, `${testInfo.project.name}-browse-header`)
})

const MAP_CONTROL_LABELS = [
	/^Zoom in$/,
	/^Zoom out$/,
	/^Reset bearing to north$/,
	/^Track my location$/,
	/^Switch to 3D view$/,
	/^Switch to globe projection$/,
	/^Toggle fullscreen$/,
	/^(?:Hide|Show) map callouts$/,
	/^Callout size:/,
	/^(?:Disable|Enable) map popups$/,
	/^(?:Dock popups in the top-right corner|Show popups above geometry)$/,
]

async function expectDesktopMapControls(
	earthly: EarthlySession,
	scrollEach: boolean,
	testInfo: TestInfo,
	state: string,
) {
	const controls = earthly.page.getByRole('group', { name: 'Map controls', exact: true })
	await expect(controls).toBeVisible()
	await expect(controls.getByRole('button')).toHaveCount(MAP_CONTROL_LABELS.length)
	const clearance = await controls.evaluate((element) => {
		const frame = element.closest('main[aria-label="Map canvas"]')
		if (!frame) throw new Error('Map controls must belong to the map canvas')
		const style = getComputedStyle(element)
		const bounds = element.getBoundingClientRect()
		const footerTop = Math.min(
			...['.earthly-canvas-frame__status', '.earthly-canvas-frame__shelf']
				.map((selector) => frame.querySelector(selector)?.getBoundingClientRect())
				.filter((rect) => rect && rect.height > 0)
				.map((rect) => rect?.y ?? window.innerHeight),
		)
		return {
			bottom: Number.parseFloat(style.bottom),
			configuredBottom: style.getPropertyValue('--controls-bottom').trim(),
			shelfHeight: Number.parseFloat(style.getPropertyValue('--shell-canvas-shelf-h')),
			statusHeight: Number.parseFloat(style.getPropertyValue('--shell-canvas-status-h')),
			footerTop,
			controlBottom: bounds.y + bounds.height,
			attribution: Array.from(frame.querySelectorAll('.maplibregl-ctrl-attrib'))
				.map((attribution) => {
					const rect = attribution.getBoundingClientRect()
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				})
				.filter((rect) => rect.width > 0 && rect.height > 0),
		}
	})
	await testInfo.attach(`map-control-clearance-${state}`, {
		body: JSON.stringify(clearance, null, 2),
		contentType: 'application/json',
	})
	expect(clearance.configuredBottom).not.toBe('')
	expect(
		Math.abs(clearance.bottom - clearance.shelfHeight - clearance.statusHeight - 44),
	).toBeLessThan(1)
	expect(clearance.footerTop - clearance.controlBottom).toBeGreaterThanOrEqual(43)
	for (const attribution of clearance.attribution) {
		expect(clearance.controlBottom).toBeLessThanOrEqual(attribution.y - 4)
	}
	for (const name of MAP_CONTROL_LABELS) {
		const button = controls.getByRole('button', { name })
		if (scrollEach) await button.scrollIntoViewIfNeeded()
		await expect(button).toBeVisible()
		await expect(button).toBeInViewport({ ratio: 1 })
		await expect
			.poll(() =>
				button.evaluate((element) => {
					const frame = element.closest('main[aria-label="Map canvas"]')
					const controls = element.closest('[aria-label="Map controls"]')
					if (!frame || !controls) return false
					const boundaries = ['.earthly-canvas-frame__status', '.earthly-canvas-frame__shelf']
						.map((selector) => frame.querySelector(selector)?.getBoundingClientRect())
						.filter((bounds) => bounds && bounds.height > 0)
					const footerTop = Math.min(...boundaries.map((bounds) => bounds?.y ?? window.innerHeight))
					const mapBounds = frame.getBoundingClientRect()
					const clip = controls.getBoundingClientRect()
					const bounds = element.getBoundingClientRect()
					return (
						bounds.y >= Math.max(mapBounds.y, clip.y) &&
						bounds.y + bounds.height <= Math.min(footerTop, clip.y + clip.height) &&
						bounds.x >= mapBounds.x &&
						bounds.x + bounds.width <= mapBounds.x + mapBounds.width
					)
				}),
			)
			.toBe(true)
		// Conditional actions legitimately remain disabled when their parent toggle is off.
		if (await button.isEnabled()) await expectHittable(button)
	}
}

for (const viewport of [
	{ width: 1280, height: 720 },
	{ width: 1024, height: 600 },
	{ width: 1024, height: 500 },
]) {
	test(`desktop map controls clear the footer and Thread at ${viewport.width}×${viewport.height} @regression`, async ({
		earthly,
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'Desktop canvas controls contract')
		await earthly.page.setViewportSize(viewport)
		await earthly.open({ tour: 'seen' })
		await installDeterministicMapStyle(earthly)
		const scrollEach = viewport.height <= 600
		await expectDesktopMapControls(earthly, scrollEach, testInfo, 'browse')
		await attachChrome(earthly, testInfo, `map-controls-${viewport.width}x${viewport.height}`)
		const draft = await startDataset(earthly)
		await draft.nameInput.fill('Map controls retained draft')
		await expectDesktopMapControls(earthly, scrollEach, testInfo, 'edit')
		// Only open the Thread chrome: no provider configuration or model request is necessary.
		await earthly.page
			.getByRole('button', { name: 'Show Thread on the right', exact: true })
			.click()
		await expect(earthly.page.getByRole('region', { name: 'Thread', exact: true })).toBeVisible()
		await expectDesktopMapControls(earthly, scrollEach, testInfo, 'thread')
		await attachChrome(
			earthly,
			testInfo,
			`map-controls-thread-${viewport.width}x${viewport.height}`,
		)
	})
}
