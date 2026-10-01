import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { addLineToGeometryDraft } from '../tasks/create/geometry'
import { selectLastLine } from '../tasks/editor/geometry-operations'
import {
	addMapCallout,
	attachCalloutImage,
	draftCalloutSnapshot,
	mapCalloutCard,
	setCalloutDisplayMode,
} from '../tasks/editor/callouts'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import type { Feature, LineString } from 'geojson'

const TITLE = 'River crossing'

test.beforeEach(async ({ earthly }) => {
	await installIsolatedRelays(earthly)
	await earthly.page.route('**/callout-image-fixture/**', (route) => {
		const tall = route.request().url().endsWith('/tall')
		const width = tall ? 120 : 1200
		const height = tall ? 1200 : 120
		return route.fulfill({
			contentType: 'image/svg+xml',
			body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#79af86"/></svg>`,
		})
	})
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await addLineToGeometryDraft(earthly, [
		[0.43, 0.4],
		[0.58, 0.42],
	])
	await selectLastLine(earthly)
	await addMapCallout(earthly, 'The bridge crosses the river here.', TITLE)
})

test('callout image URLs validate, preview, and remove within the existing editor size @editor-contract', async ({
	earthly,
}) => {
	const card = mapCalloutCard(earthly, TITLE)
	const before = await card.boundingBox()
	await card.getByLabel('Callout image URL').fill('javascript:alert(1)')
	await card.getByRole('button', { name: 'Add image', exact: true }).click()
	await expect(card.getByRole('alert')).toHaveText('Enter an http or https image URL.')
	expect((await draftCalloutSnapshot(earthly))[0]?.media).toBeUndefined()
	const url = new URL('/callout-image-fixture/wide', earthly.page.url()).toString()
	await attachCalloutImage(earthly, url, TITLE)
	await expect(card.getByRole('img')).toBeVisible()
	await expect
		.poll(() => card.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBe(1200)
	const after = await card.boundingBox()
	expect(after?.width).toBe(before?.width)
	expect(after?.height).toBe(before?.height)
	await attachCalloutImage(earthly, url, TITLE)
	expect((await draftCalloutSnapshot(earthly))[0]?.media).toHaveLength(1)
	await card.getByRole('button', { name: 'Remove media', exact: true }).click()
	await expect(card.getByRole('img')).toHaveCount(0)
	expect((await draftCalloutSnapshot(earthly))[0]?.media ?? []).toEqual([])
})

test('wide and tall images fit normal, expanded, and compact map callouts @editor-contract', async ({
	earthly,
}, testInfo) => {
	for (const shape of ['wide', 'tall']) {
		await setCalloutDisplayMode(earthly, 'full')
		await earthly.page.evaluate(() => {
			const state = (
				window as typeof window & {
					__earthlyEditorStore: { getState(): { setViewMode(mode: 'edit'): void } }
				}
			).__earthlyEditorStore.getState()
			state.setViewMode('edit')
		})
		const card = mapCalloutCard(earthly, TITLE)
		const remove = card.getByRole('button', { name: 'Remove media', exact: true })
		if (await remove.isVisible()) await remove.click()
		const url = new URL(`/callout-image-fixture/${shape}`, earthly.page.url()).toString()
		await attachCalloutImage(earthly, url, TITLE)
		// Exercise read-only callouts without publishing the local draft. Center its
		// anchor at a readable zoom so the automatic compact rule cannot hide it.
		await earthly.page.evaluate(() => {
			const state = (
				window as typeof window & {
					__earthlyEditorStore: {
						getState(): {
							setViewMode(mode: 'view'): void
							editor: { getAllFeatures(): Feature<LineString>[] }
						}
					}
					__earthlyUiMap: { jumpTo(options: { center: number[]; zoom: number }): void }
				}
			).__earthlyEditorStore.getState()
			const anchor = state.editor.getAllFeatures()[0]?.geometry.coordinates[0]
			if (!anchor) throw new Error('Missing callout anchor')
			state.setViewMode('view')
			;(
				window as unknown as {
					__earthlyUiMap: { jumpTo(options: { center: number[]; zoom: number }): void }
				}
			).__earthlyUiMap.jumpTo({ center: anchor, zoom: 5 })
		})
		await expect(card).toBeVisible()
		await expect(card).toHaveAttribute('data-callout-expanded', 'false')
		const image = card.getByRole('img')
		await expect(image).toBeVisible()
		await expect
			.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalHeight))
			.toBe(shape === 'tall' ? 1200 : 120)
		const normal = await card.boundingBox()
		const thumbnail = await image.boundingBox()
		expect(thumbnail?.width).toBeLessThanOrEqual(normal?.width ?? 0)
		expect(thumbnail?.height).toBeLessThanOrEqual(normal?.height ?? 0)
		await card.getByRole('button', { name: `Expand callout: ${TITLE}`, exact: true }).click()
		await expect(card).toHaveAttribute('data-callout-expanded', 'true')
		await expect(image).toBeVisible()
		expect((await image.boundingBox())?.height).toBeLessThanOrEqual(96)
		await setCalloutDisplayMode(earthly, 'compact')
		const compact = earthly.page.locator('[data-callout-state=compact]')
		await expect(compact.getByRole('img')).toBeVisible()
		const bounds = await compact.boundingBox()
		expect(bounds?.width).toBe(168)
		expect(bounds?.height).toBe(46)
		await earthly.page.screenshot({ path: testInfo.outputPath(`${shape}-compact-callout.png`) })
	}
})
