import { expect, test } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import {
	addPointToGeometryDraft,
	clickEditorMap,
	expectGeometryFeatureCount,
} from '../tasks/create/geometry'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { copyCurrentShareLink } from '../tasks/navigation/share-current-view'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'

test('overflow opens the existing tools and returns keyboard focus to its launcher @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'Desktop toolbar overflow')
	const health = monitorBrowserHealth(earthly.page)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	await addPointToGeometryDraft(earthly)
	await earthly.page.getByRole('button', { name: 'Show Thread on the right', exact: true }).click()
	await earthly.page.setViewportSize({ width: 1100, height: 900 })
	const more = earthly.page.getByRole('button', { name: 'More tools', exact: true })
	for (const [item, title] of [
		['Measure', 'Measure'],
		['Import from OpenStreetMap', 'Import from OpenStreetMap'],
		['Share and export image', 'Share this view'],
		['Map settings', 'Map settings'],
	] as const) {
		await more.click()
		await earthly.page.getByRole('menuitem', { name: item, exact: true }).focus()
		await earthly.page.keyboard.press('Enter')
		const dialog = earthly.page.getByRole('dialog', { name: title, exact: true })
		await expect(dialog).toBeVisible()
		await expect(earthly.page.getByRole('menuitem', { name: item, exact: true })).toBeHidden()
		if (item === 'Measure') await expect(dialog).toContainText('all 1 feature')
		await earthly.page.keyboard.press('Escape')
		await expect(dialog).toBeHidden()
		await expect(more).toBeFocused()
	}
	await more.click()
	await expect(
		earthly.page.getByRole('menuitem', { name: 'Add map callout', exact: true }),
	).toBeVisible()
	await earthly.page.screenshot({ path: testInfo.outputPath('more-tools.png') })
	await earthly.page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
	await expect(earthly.page.locator('html')).toHaveClass(/dark/)
	await more.click()
	await earthly.page.getByRole('menuitem', { name: 'Switch to light theme', exact: true }).click()
	await expect(earthly.page.locator('html')).toHaveClass(/light/)
	// The compact Draw menu is still usable with both panels open.
	await earthly.page.getByRole('menuitem', { name: 'Draw', exact: true }).click()
	await earthly.page.getByRole('menuitemradio', { name: 'Point', exact: true }).click()
	await clickEditorMap(earthly, 0.45, 0.55)
	await expectGeometryFeatureCount(earthly, 2)
	await more.click()
	await earthly.page.getByRole('menuitem', { name: 'Look up a location', exact: true }).click()
	await more.click()
	await expect(
		earthly.page.getByRole('menuitem', { name: 'Stop location lookup', exact: true }),
	).toBeVisible()
	await earthly.page.keyboard.press('Escape')
	await more.click()
	await earthly.page.getByRole('menuitem', { name: 'Map settings', exact: true }).click()
	await expect(
		earthly.page.getByRole('dialog', { name: 'Map settings', exact: true }),
	).toBeVisible()
	const name = earthly.page.getByPlaceholder('Name', { exact: true })
	await name.click()
	await expect(earthly.page.getByRole('dialog', { name: 'Map settings', exact: true })).toBeHidden()
	await expect(name).toBeFocused()
	expect(health.snapshot().pageErrors).toEqual([])
	health.stop()
})

test('map excerpt state survives closing overflow, resizing and drawing its area @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop toolbar overflow')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Show Thread on the right', exact: true }).click()
	await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Create map excerpt', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Create map excerpt', exact: true })
	await expect(dialog).toBeVisible()
	await dialog.getByLabel('Blossom Server', { exact: true }).fill('http://localhost:3544/preserved')
	await earthly.page.setViewportSize({ width: 1100, height: 900 })
	await expect(dialog.getByLabel('Blossom Server', { exact: true })).toHaveValue(
		'http://localhost:3544/preserved',
	)
	await dialog.getByRole('button', { name: 'Draw Area', exact: true }).click()
	await expect(dialog).toBeHidden()
	await clickEditorMap(earthly, 0.35, 0.4)
	await clickEditorMap(earthly, 0.5, 0.5)
	await clickEditorMap(earthly, 0.65, 0.4)
	await earthly.page.keyboard.press('Enter')
	await expect(dialog).toBeVisible()
	await expect(dialog.getByLabel('Blossom Server', { exact: true })).toHaveValue(
		'http://localhost:3544/preserved',
	)
	// No extraction, signing, upload or relay publication is requested by this test.
})

test('compact location search keeps feedback, keyboard selection and its query across resize @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop toolbar overflow')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	// Deterministic search response: exercise the toolbar, not an external geocoder.
	// Editing shortcuts take priority over expanding the search input now.
	await earthly.page.setViewportSize({ width: 1920, height: 900 })
	await earthly.page.evaluate(() => {
		const store = (
			window as unknown as {
				__earthlyEditorStore: {
					getState(): { searchQuery: string }
					setState(state: Record<string, unknown>): void
				}
			}
		).__earthlyEditorStore
		store.setState({
			performSearch: () => {
				const query = store.getState().searchQuery
				store.setState({
					searchPerformed: true,
					searchLoading: false,
					searchError: query === 'error' ? 'Test search unavailable' : null,
					searchResults:
						query === 'Vienna'
							? [
									{
										placeId: 1,
										displayName: 'Vienna test result',
										coordinates: { lat: 48.2, lon: 16.37 },
										boundingbox: null,
									},
								]
							: [],
				})
			},
		})
	})
	const search = earthly.page.getByRole('textbox', { name: 'Search location', exact: true })
	await search.fill('Vienna')
	await earthly.page.getByRole('button', { name: 'Show Thread on the right', exact: true }).click()
	const trigger = earthly.page.getByRole('button', { name: 'Search location', exact: true })
	await trigger.click()
	await expect(search).toHaveValue('Vienna')
	await expect(search).toBeFocused()
	await search.fill('empty')
	await search.press('Enter')
	await expect(earthly.page.getByText('No places match “empty”.', { exact: true })).toBeVisible()
	await search.fill('error')
	await search.press('Enter')
	await expect(earthly.page.getByText('Test search unavailable', { exact: true })).toBeVisible()
	await search.fill('Vienna')
	await search.press('Enter')
	await expect(
		earthly.page.getByRole('button', { name: 'Vienna test result', exact: true }),
	).toBeVisible()
	await search.press('ArrowDown')
	await search.press('Enter')
	await expect(
		earthly.page.getByRole('dialog', { name: 'Search location', exact: true }),
	).toBeHidden()
	await expect(trigger).toBeFocused()
	await trigger.click()
	await search.fill('Vienna')
	await search.press('Enter')
	await earthly.page.getByRole('button', { name: 'Vienna test result', exact: true }).click()
	await expect(
		earthly.page.getByRole('dialog', { name: 'Search location', exact: true }),
	).toBeHidden()
})

test('Draw and Edit progressively release shortcuts into available canvas space @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'Desktop toolbar allocation')
	const health = monitorBrowserHealth(earthly.page)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	await addPointToGeometryDraft(earthly)
	await earthly.page.getByRole('button', { name: 'Show Thread on the right', exact: true }).click()
	const toolbar = earthly.page.locator('[data-tour="toolbar"]')
	const shortcutNames = [
		'Select mode',
		'Box select mode',
		'Draw point',
		'Draw line',
		'Draw polygon',
		'Draw label',
		'Draw arrow',
		'Draw shape',
		'Undo',
		'Redo',
		'Toggle snapping',
		'Edit vertices',
		'Toggle edit isolation',
		'Delete',
		'Duplicate',
		'Geometry operations',
	]
	const snapshot = () =>
		toolbar.evaluate((element, names) => {
				const buttons = Array.from(element.querySelectorAll('button')).filter(
				(button) =>
					names.includes(button.getAttribute('aria-label') ?? '') &&
					button.getBoundingClientRect().width > 0,
			)
			const menu = element.querySelector('[role="menubar"]')!.getBoundingClientRect()
			const search = element
				.querySelector('[aria-label="Search location"]')!
				.getBoundingClientRect()
			return {
				count: buttons.length,
				gap: search.left - menu.right,
				height: element.getBoundingClientRect().height,
			}
		}, shortcutNames)
	const counts: number[] = []
	for (const width of [1440, 1600, 1760, 1920, 2040, 2240, 2560]) {
		await earthly.page.setViewportSize({ width, height: 900 })
		await expect
			.poll(async () => {
				const state = await snapshot()
				return state.count === 16 || state.gap < 52
			})
			.toBe(true)
		const state = await snapshot()
		expect(state.height).toBeLessThanOrEqual(40)
		counts.push(state.count)
		if (width === 1920) {
			for (const name of ['Draw point', 'Draw line', 'Draw polygon', 'Undo', 'Redo']) {
				await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()
			}
			await earthly.page.screenshot({ path: testInfo.outputPath('progressive-both-panels.png') })
		}
	}
	expect(new Set(counts).size).toBeGreaterThanOrEqual(4)
	expect(counts).toEqual([...counts].sort((a, b) => a - b))
	expect(counts.at(-1)).toBe(16)
	// Closing a dock changes the canvas width without a viewport resize.
	await earthly.page.setViewportSize({ width: 1440, height: 900 })
	await expect.poll(async () => (await snapshot()).count).toBe(counts[0])
	await earthly.page.getByRole('button', { name: 'Hide Thread', exact: true }).click()
	await expect.poll(async () => (await snapshot()).count).toBeGreaterThan(counts[0]!)
	// Direct history and the full menu catalog both still operate.
	await toolbar.getByRole('button', { name: 'Undo', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 0)
	await toolbar.getByRole('menuitem', { name: 'Edit', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Redo', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	expect(health.snapshot().pageErrors).toEqual([])
	health.stop()
})

test('the existing Share workflow reaches its canonical link through overflow @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop toolbar overflow')
	await earthly.open({ tour: 'seen' })
	const fixture = await installInMemoryMapFixture(earthly, { title: 'Overflow share fixture' })
	await earthly.open({ path: fixture.path, tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const link = await copyCurrentShareLink(earthly)
	expect(new URL(link).pathname).toBe(fixture.path)
})
