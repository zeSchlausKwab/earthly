import { hexToBytes } from '@noble/hashes/utils.js'
import type { TestInfo } from '@playwright/test'
import { finalizeEvent } from 'nostr-tools'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { setMobileWorkspaceTransparency } from '../tasks/navigation/mobile-workspace'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { testIdentities } from '../test-identities'

const MAP_TITLE = 'Margin contract · Alpine field notes'

async function attachView(earthly: EarthlySession, testInfo: TestInfo, name: string) {
	// Wait for the fixture's transient notification to leave so it cannot cover the phone header.
	await expect(
		earthly.page.getByText(`Added "${MAP_TITLE}" to the map.`, { exact: true }).last(),
	).toBeHidden({ timeout: 10_000 })
	const path = testInfo.outputPath(`${testInfo.project.name}-${name}.png`)
	await earthly.page.screenshot({ path, animations: 'disabled' })
	await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** Signed fixture in page memory only: no relay publish, draft publish, or external mutation. */
async function seedBrowseMap(earthly: EarthlySession) {
	const identifier = 'ai-suite-margin-browse-map'
	const content = JSON.stringify({
		type: 'FeatureCollection',
		name: MAP_TITLE,
		description: 'A small non-publishing fixture for the Browse-to-inspect interaction.',
		features: [
			{
				type: 'Feature',
				id: 'gate',
				properties: { name: 'Crew gate' },
				geometry: { type: 'Point', coordinates: [13.98, 46.7] },
			},
			{
				type: 'Feature',
				id: 'muster',
				properties: { name: 'Muster point' },
				geometry: { type: 'Point', coordinates: [13.99, 46.71] },
			},
			{
				type: 'Feature',
				id: 'trail',
				properties: { name: 'Fallback route' },
				geometry: {
					type: 'LineString',
					coordinates: [
						[13.98, 46.7],
						[13.985, 46.707],
						[13.99, 46.71],
					],
				},
			},
		],
	})
	const event = finalizeEvent(
		{
			kind: 37515,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier],
				['t', 'field-notes'],
				['bbox', '13.98,46.7,13.99,46.71'],
				['size', String(new TextEncoder().encode(content).length)],
			],
			content,
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await earthly.page.evaluate((fixture) => {
		const store = (
			window as unknown as { __earthlyEventStore?: { add(event: typeof fixture): unknown } }
		).__earthlyEventStore
		if (!store) throw new Error('Local EventStore fixture handle is unavailable')
		store.add(fixture)
	}, event)
	return `dataset:${event.pubkey}:${identifier}`
}

test('Me opens an account popover without replacing the current route @regression', async ({
	earthly,
}, testInfo) => {
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: '/', tour: 'seen' })
	const initialUrl = earthly.page.url()
	await earthly.page.getByRole('button', { name: 'Me', exact: true }).click()
	const menu = earthly.page.getByRole('dialog', { name: 'Me menu', exact: true })
	await expect(menu).toBeVisible()
	await expect(menu.getByRole('button', { name: 'Profile', exact: true })).toBeVisible()
	await expect(menu.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible()
	await expect(earthly.page).toHaveURL(initialUrl)
	await expect(
		earthly.page.getByRole('dialog', { name: 'Earthly navigation', exact: true }),
	).toBeHidden()
	await attachView(earthly, testInfo, 'me-menu')
	await menu.getByRole('button', { name: 'Profile', exact: true }).click()
	await expect(menu).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
})

test('Browse has compact rows with independent map toggles and opens Map inspection @regression', async ({
	earthly,
}, testInfo) => {
	await earthly.open({ tour: 'seen' })
	const entryId = await seedBrowseMap(earthly)
	await openPanel(earthly, 'Maps')
	await expect(earthly.page.getByRole('tablist', { name: 'Browse', exact: true })).toBeVisible()
	const listOptions = earthly.page.getByRole('group', { name: 'Maps list options', exact: true })
	if (earthly.isMobile) {
		await expect(listOptions).toBeHidden()
		await earthly.page.getByRole('button', { name: 'Filters', exact: true }).click()
		await expect(earthly.page.getByRole('combobox', { name: 'Sort results', exact: true })).toBeVisible()
		await expect(earthly.page.getByRole('button', { name: 'Favorites', exact: true })).toBeVisible()
		await earthly.page.keyboard.press('Escape')
	} else {
		await expect(listOptions).toBeVisible()
		const optionsBox = await listOptions.boundingBox()
		expect(optionsBox?.height).toBeLessThanOrEqual(44)
	}
	if (earthly.isMobile) {
		const sheet = earthly.page.getByRole('dialog', { name: 'Browse panel', exact: true })
		await expect(sheet).toBeVisible()
		await expect
			.poll(async () => {
				const bounds = await sheet.boundingBox()
				const viewport = earthly.page.viewportSize()
				return bounds && viewport ? Math.abs(bounds.height / viewport.height - 0.5) : 1
			})
			.toBeLessThan(0.02)
		await expect(earthly.page.getByRole('button', { name: 'Search', exact: true })).toBeHidden()
	}
	await expect(
		earthly.page.getByTitle('Local drafts saved on this device', { exact: true }),
	).toHaveCount(0)
	const row = earthly.page.locator('.entity-list-row').filter({
		has: earthly.page.getByRole('button', { name: `Open map ${MAP_TITLE}`, exact: true }),
	})
	await expect(row).toBeVisible()
	await expect(row.locator('svg').first()).toBeVisible()
	await expect(row.getByText('3 features', { exact: true })).toBeVisible()
	await expect(
		row.getByRole('button', { name: `More actions for ${MAP_TITLE}`, exact: true }),
	).toBeVisible()
	await row.getByRole('button', { name: `More actions for ${MAP_TITLE}`, exact: true }).click()
	const more = earthly.page.getByRole('dialog', { name: 'Entity actions', exact: true })
	await expect(more.getByRole('button', { name: 'Propose changes', exact: true })).toBeVisible()
	await expect(more.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
	await row.getByRole('button', { name: `More actions for ${MAP_TITLE}`, exact: true }).click()
	await expect(more).toBeHidden()
	const mapEntries = async () =>
		(await editorLifecycleSnapshot(earthly)).mapStack.filter((entry) => entry.id === entryId)
	const remove = row.getByRole('button', { name: 'Remove from map', exact: true })
	if (await remove.isVisible()) await remove.click()
	await row.getByRole('button', { name: 'Show on map', exact: true }).click()
	await expect.poll(mapEntries).toMatchObject([{ visible: true }])
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/maps')
	await remove.click()
	await expect.poll(mapEntries).toEqual([])
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/maps')
	await attachView(earthly, testInfo, 'browse')
	await row.getByRole('button', { name: `Open map ${MAP_TITLE}`, exact: true }).click()
	await expect(earthly.page).toHaveURL(/\/map\/[^/?]+(?:\?.*)?$/)
	await expect.poll(mapEntries).toMatchObject([{ visible: true }])
	const inspection = earthly.page.getByRole('region', { name: 'Map inspection', exact: true })
	await expect(inspection).toBeVisible()
	await expect(inspection.getByRole('heading', { name: MAP_TITLE, exact: true })).toBeVisible()
	await expect(inspection.getByRole('heading', { name: 'At a glance', exact: true })).toBeVisible()
	await expect(inspection.getByRole('heading', { name: 'Features', exact: true })).toBeVisible()
	await attachView(earthly, testInfo, 'inspect')
})

test('mobile Browse transparency reaches the actual table and rows and restores opaque surfaces @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Phone Browse transparency contract')
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await seedBrowseMap(earthly)
	await openPanel(earthly, 'Maps')
	const row = earthly.page.locator('.entity-list-row').filter({
		has: earthly.page.getByRole('button', { name: `Open map ${MAP_TITLE}`, exact: true }),
	})
	await expect(row).toBeVisible()
	const backgroundLayers = () =>
		row.evaluate((rowElement) => {
			const root = rowElement.closest('[role="dialog"]')
			const table = rowElement.closest('.entity-list-table')
			if (!root || !table) throw new Error('Browse row must belong to a table inside the sheet')
			const probe = document.createElement('canvas').getContext('2d')
			if (!probe) throw new Error('Cannot sample Browse background colours')
			const layers = []
			for (let element: Element | null = rowElement; element; element = element.parentElement) {
				probe.clearRect(0, 0, 1, 1)
				probe.fillStyle = getComputedStyle(element).backgroundColor
				probe.fillRect(0, 0, 1, 1)
				layers.push({
					layer: element === rowElement ? 'row' : element === table ? 'table' : element.tagName,
					alpha: (probe.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255,
				})
				if (element === root) break
			}
			return {
				layers,
				effectiveAlpha: 1 - layers.reduce((remaining, layer) => remaining * (1 - layer.alpha), 1),
			}
		})
	await setMobileWorkspaceTransparency(earthly, false)
	await expect.poll(async () => (await backgroundLayers()).effectiveAlpha).toBe(1)
	await expect
		.poll(
			async () => (await backgroundLayers()).layers.find((layer) => layer.layer === 'table')?.alpha,
		)
		.toBe(1)
	await setMobileWorkspaceTransparency(earthly, true)
	await expect.poll(async () => (await backgroundLayers()).effectiveAlpha).toBeLessThan(0.95)
	const glass = await backgroundLayers()
	expect(glass.layers.find((layer) => layer.layer === 'table')?.alpha).toBe(0)
	expect(glass.layers.find((layer) => layer.layer === 'row')?.alpha).toBeLessThan(1)
	expect(glass.layers.every((layer) => layer.alpha < 1)).toBe(true)
	await attachView(earthly, testInfo, 'browse-half-transparent')
	await setMobileWorkspaceTransparency(earthly, false)
	await expect.poll(async () => (await backgroundLayers()).effectiveAlpha).toBe(1)
	await expect
		.poll(
			async () => (await backgroundLayers()).layers.find((layer) => layer.layer === 'table')?.alpha,
		)
		.toBe(1)
	await attachView(earthly, testInfo, 'browse-half-opaque')
})

test('mobile Browse remains a sheet across People, reload and Back @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Phone Browse sheet route contract')
	await earthly.open({ tour: 'seen' })
	const initialUrl = earthly.page.url()
	await earthly.page.getByRole('button', { name: 'Search places', exact: true }).click()
	const placeSearch = earthly.page.getByRole('search', { name: 'Search places', exact: true })
	await expect(placeSearch).toBeVisible()
	await expect(placeSearch.getByPlaceholder('Search places…', { exact: true })).toBeFocused()
	await placeSearch.getByRole('button', { name: 'Close search', exact: true }).click()
	await expect(placeSearch).toBeHidden()
	await expect(earthly.page).toHaveURL(initialUrl)
	await openPanel(earthly, 'Maps')
	const sheet = earthly.page.getByRole('dialog', { name: 'Browse panel', exact: true })
	await expect(sheet).toBeVisible()
	await earthly.page.getByRole('tab', { name: /^People(?:\s|$)/ }).click()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/people')
	await expect(sheet).toBeVisible()
	await expect(earthly.page.getByRole('tab', { name: /^People(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(sheet).toBeVisible()
	await expect(earthly.page.getByRole('tab', { name: /^People(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await earthly.page.goBack({ waitUntil: 'domcontentloaded' })
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/maps')
	await expect(sheet).toBeVisible()
	await expect(earthly.page.getByRole('tab', { name: /^Maps(?:\s|$)/ })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await attachView(earthly, testInfo, 'browse-after-back')
})

test('desktop canvas toolbar is opaque and ticker content shares its centreline @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(
		earthly.isMobile,
		'Desktop toolbar and activity ticker are replaced by the phone composition',
	)
	await earthly.open({ tour: 'seen' })
	await seedBrowseMap(earthly)
	const ticker = earthly.page.getByRole('region', { name: 'Recent Earthly activity', exact: true })
	await expect(ticker).toBeVisible()
	await expect(ticker.locator('.earthly-activity-ticker__item')).toBeVisible()
	await ticker.hover()
	const alignment = await ticker.evaluate((element) => {
		const frame = element.getBoundingClientRect()
		const item = element.querySelector('.earthly-activity-ticker__item')?.getBoundingClientRect()
		return item ? Math.abs(frame.y + frame.height / 2 - item.y - item.height / 2) : null
	})
	expect(alignment).not.toBeNull()
	expect(alignment).toBeLessThanOrEqual(2)
	await startDataset(earthly)
	const toolbar = earthly.page.locator('.earthly-canvas-frame__toolbar')
	await expect(toolbar).toBeVisible()
	const alpha = await toolbar.evaluate((element) => {
		const probe = document.createElement('canvas').getContext('2d')
		if (!probe) throw new Error('Cannot resolve toolbar background colour')
		probe.fillStyle = getComputedStyle(element).backgroundColor
		probe.fillRect(0, 0, 1, 1)
		return probe.getImageData(0, 0, 1, 1).data[3]
	})
	expect(alpha).toBe(255)
	await attachView(earthly, testInfo, 'toolbar')
})
