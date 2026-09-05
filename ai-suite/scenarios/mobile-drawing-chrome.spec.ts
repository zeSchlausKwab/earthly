import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { clickEditorMap, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { mobileWorkspaceSheet } from '../tasks/navigation/mobile-workspace'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

/** Exercise a real touch gesture, including the handle being replaced between detents. */
async function dragDraftSheet(earthly: EarthlySession, detent: 'peek' | 'half' | 'full') {
	const sheet = mobileWorkspaceSheet(earthly)
	const slider = sheet.getByRole('slider', { name: 'Resize panel', exact: true })
	await expect(slider).toBeVisible()
	await expect(slider).toBeInViewport()
	const viewport = earthly.page.viewportSize()
	const handle = await slider.boundingBox()
	if (!viewport || !handle) throw new Error('The visible resize handle must have phone bounds')
	const startHeight = Number(await slider.getAttribute('aria-valuenow'))
	const targetHeight =
		detent === 'half'
			? viewport.height * 0.5
			: Number(await slider.getAttribute(detent === 'peek' ? 'aria-valuemin' : 'aria-valuemax'))
	const x = handle.x + handle.width / 2
	const startY = handle.y + handle.height / 2
	const endY = Math.max(8, Math.min(viewport.height - 8, startY + startHeight - targetHeight))
	const touch = await earthly.page.context().newCDPSession(earthly.page)
	try {
		await touch.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x, y: startY }],
		})
		for (let step = 1; step <= 8; step++) {
			await touch.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: startY + ((endY - startY) * step) / 8 }],
			})
			if (step === 1) {
				// In particular, selected/full must follow the first movement rather than
				// consuming the selection bar's height before the visible sheet moves.
				await expect
					.poll(async () => {
						const bounds = await sheet.boundingBox()
						return bounds
							? Math.abs(bounds.height - (startHeight + (startY - endY) / 8))
							: Number.POSITIVE_INFINITY
					})
					.toBeLessThan(2)
			}
		}
		await expect
			.poll(async () => Number(await slider.getAttribute('aria-valuenow')))
			.not.toBe(startHeight)
		await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
	} finally {
		await touch.detach()
	}
	await expect(slider).toHaveAttribute('aria-valuenow', String(targetHeight))
	await expect
		.poll(async () => {
			const bounds = await sheet.boundingBox()
			if (!bounds || bounds.y < 0) return false
			return Math.abs(bounds.height - targetHeight) < 2
		})
		.toBe(true)
	await expect(slider).toBeInViewport()
}

async function editableDraftSnapshot(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const store = (
			window as unknown as {
				__earthlyEditorStore?: {
					getState(): {
						collectionMeta: { name: string; customProperties: Record<string, unknown> }
						features: Array<{
							id: string
							geometry: { type: string; coordinates: unknown }
							properties: Record<string, unknown>
						}>
					}
				}
			}
		).__earthlyEditorStore
		if (!store) throw new Error('Earthly editor debug store is unavailable')
		const { collectionMeta, features } = store.getState()
		return { collectionMeta, features }
	})
}

test('phone draft sheet supports repeated touch drags and retains the full metadata and geometry editor @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Phone draft sheet touch and editing contract')
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	await draft.nameInput.fill('Touch draft')
	const drawingDock = earthly.page.getByRole('navigation', { name: 'Map drawing', exact: true })
	await drawingDock.getByRole('button', { name: 'Draw point', exact: true }).click()
	await clickEditorMap(earthly, 0.4, 0.4)
	await expectGeometryFeatureCount(earthly, 1)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.not.toBeNull()
	const beforeDrag = await editorLifecycleSnapshot(earthly)
	const originalGeometry = (await editableDraftSnapshot(earthly)).features[0]?.geometry
	const sheet = mobileWorkspaceSheet(earthly)
	await expect(sheet.getByRole('button', { name: 'Map details', exact: true })).toBeVisible()
	await expect(sheet.getByRole('slider', { name: 'Resize panel', exact: true })).toHaveAttribute(
		'aria-valuenow',
		'62',
	)
	await dragDraftSheet(earthly, 'half')
	await expect(draft.nameInput).toBeVisible()
	await expect(earthly.page.getByRole('region', { name: 'Editing Map', exact: true })).toBeHidden()
	await expect(drawingDock).toBeVisible()
	const name = `Touch edit retained ${Date.now().toString(36)}`
	await draft.nameInput.fill(name)
	await sheet.getByPlaceholder('key', { exact: true }).fill('source')
	await sheet.getByPlaceholder('value', { exact: true }).fill('Phone survey')
	await sheet.getByPlaceholder('value', { exact: true }).press('Enter')
	await expect
		.poll(async () => (await editableDraftSnapshot(earthly)).collectionMeta)
		.toMatchObject({ name, customProperties: { source: 'Phone survey' } })
	await dragDraftSheet(earthly, 'full')
	await expect(sheet.getByRole('button', { name: 'Attach to an Atlas', exact: true })).toBeVisible()
	await expect(sheet.getByRole('button', { name: 'Delete saved work', exact: true })).toBeVisible()
	await dragDraftSheet(earthly, 'peek')
	await dragDraftSheet(earthly, 'half')
	await dragDraftSheet(earthly, 'full')
	await expect(draft.nameInput).toHaveValue(name)
	const geometry = sheet.locator('[data-geometry-type="Point"]').first()
	await geometry.getByRole('button', { name: /^Expand / }).click()
	await geometry.getByPlaceholder('Name', { exact: true }).fill('Crew gate')
	await geometry.getByPlaceholder('Optional label...', { exact: true }).fill('Meet here')
	await geometry.getByRole('spinbutton').first().fill('12')
	await expect
		.poll(async () => (await editableDraftSnapshot(earthly)).features[0])
		.toMatchObject({
			geometry: originalGeometry,
			properties: { name: 'Crew gate', label: 'Meet here', radius: 12 },
		})
	await geometry.getByRole('button', { name: 'Select Crew gate', exact: true }).click()
	const selection = earthly.page.getByRole('region', { name: 'Selection actions', exact: true })
	await expect(selection).toBeVisible()
	await dragDraftSheet(earthly, 'peek')
	await dragDraftSheet(earthly, 'half')
	await dragDraftSheet(earthly, 'full')
	await expect
		.poll(async () => {
			const [panel, actions] = await Promise.all([sheet.boundingBox(), selection.boundingBox()])
			return Boolean(panel && actions && panel.y >= 0 && panel.y + panel.height <= actions.y + 1)
		})
		.toBe(true)
	const screenshot = testInfo.outputPath('mobile-draft-full-editor.png')
	await earthly.page.screenshot({ path: screenshot, animations: 'disabled' })
	await testInfo.attach('mobile-draft-full-editor', { path: screenshot, contentType: 'image/png' })
	await dragDraftSheet(earthly, 'peek')
	await expectGeometryFeatureCount(earthly, 1)
	const edited = await editableDraftSnapshot(earthly)
	await drawingDock.getByRole('button', { name: /^Done/ }).click()
	await expect(drawingDock).toBeHidden()
	await openPanel(earthly, 'Local drafts')
	const drafts = earthly.page.getByRole('region', { name: 'Local drafts' })
	const expand = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expand.isVisible()) await expand.click()
	await drafts.getByRole('button').filter({ hasText: name }).first().click()
	await expect.poll(() => editableDraftSnapshot(earthly)).toEqual(edited)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.toBe(beforeDrag.activeDraftId)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeWorkspaceId)
		.toBe(beforeDrag.activeWorkspaceId)
})

test('phone drawing keeps vertices, completed features, and saved drafts separate', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The map-first drawing composition is phone-only')
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	const name = `Phone drawing ${Date.now().toString(36)}`
	await draft.nameInput.fill(name)
	const publishing = mobileWorkspaceSheet(earthly).getByRole('button', {
		name: /^(?:Audience|Publish|Update|Save|Fork \/ Propose)(?:\s|$)/,
	})
	await expect(publishing).toHaveCount(1)
	await expect(publishing).toBeVisible()
	const expectControlsBetweenStatusAndDraft = async () => {
		await expect
			.poll(async () => {
				const [status, zoom, summary] = await Promise.all([
					earthly.page.getByRole('region', { name: 'Editing Map', exact: true }).boundingBox(),
					earthly.page.getByRole('button', { name: 'Zoom in', exact: true }).boundingBox(),
					earthly.page.getByLabel('Map draft summary', { exact: true }).boundingBox(),
				])
				return Boolean(
					status &&
						zoom &&
						summary &&
						zoom.y >= status.y + status.height &&
						zoom.y + zoom.height <= summary.y,
				)
			})
			.toBe(true)
	}
	const drawingDock = earthly.page.getByRole('navigation', { name: 'Map drawing' })
	await expect(drawingDock).toBeVisible()
	await drawingDock.getByRole('button', { name: 'Draw point', exact: true }).click()
	await clickEditorMap(earthly, 0.38, 0.4)
	await expectGeometryFeatureCount(earthly, 1)
	await expect(earthly.page.getByRole('button', { name: 'Map details', exact: true })).toBeVisible()
	await expect(publishing).toHaveCount(1)
	await expect(publishing).toBeVisible()
	await expectControlsBetweenStatusAndDraft()
	await earthly.page.getByRole('button', { name: 'Map details', exact: true }).click()
	await expect(draft.nameInput).toBeVisible()
	await expect(publishing).toHaveCount(1)
	await expect(publishing).toBeVisible()

	await drawingDock.getByRole('button', { name: 'Draw line', exact: true }).click()
	await clickEditorMap(earthly, 0.42, 0.48)
	await expect(drawingDock.getByRole('button', { name: 'Finish · 1', exact: true })).toBeDisabled()
	await clickEditorMap(earthly, 0.67, 0.46)
	await expect(drawingDock.getByRole('button', { name: 'Finish · 2', exact: true })).toBeEnabled()
	await drawingDock.getByRole('button', { name: 'Undo point', exact: true }).click()
	await expect(drawingDock.getByRole('button', { name: 'Finish · 1', exact: true })).toBeDisabled()
	await expectGeometryFeatureCount(earthly, 1)
	await clickEditorMap(earthly, 0.65, 0.4)
	await drawingDock.getByRole('button', { name: 'Finish · 2', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 2)

	await drawingDock.getByRole('button', { name: 'Draw polygon', exact: true }).click()
	await clickEditorMap(earthly, 0.4, 0.55)
	await clickEditorMap(earthly, 0.56, 0.61)
	await clickEditorMap(earthly, 0.7, 0.52)
	await expect(drawingDock.getByRole('button', { name: 'Finish · 3', exact: true })).toBeEnabled()
	await drawingDock.getByRole('button', { name: 'Undo point', exact: true }).click()
	await expect(drawingDock.getByRole('button', { name: 'Finish · 2', exact: true })).toBeDisabled()
	await drawingDock.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 2)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).mode).toBe('select')
	await expectControlsBetweenStatusAndDraft()
	await expect(
		earthly.page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem'),
	).toHaveCount(0, { timeout: 15_000 })
	const drawingScreenshot = testInfo.outputPath('mobile-map-drawing.png')
	await earthly.page.screenshot({ path: drawingScreenshot, animations: 'disabled' })
	await testInfo.attach('mobile-map-drawing.png', {
		path: drawingScreenshot,
		contentType: 'image/png',
	})
	const beforeDone = await editorLifecycleSnapshot(earthly)
	await drawingDock.getByRole('button', { name: /^Done/ }).click()
	await expect(drawingDock).toBeHidden()
	await expect(
		earthly.page
			.getByRole('navigation', { name: 'Primary' })
			.getByRole('button', { name: 'Browse', exact: true }),
	).toBeVisible()
	await openPanel(earthly, 'Local drafts')
	const drafts = earthly.page.getByRole('region', { name: 'Local drafts' })
	const expand = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expand.isVisible()) await expand.click()
	await drafts.getByRole('button').filter({ hasText: name }).first().click()
	await expectGeometryFeatureCount(earthly, 2)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeWorkspaceId)
		.toBe(beforeDone.activeWorkspaceId)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.toBe(beforeDone.activeDraftId)
})
