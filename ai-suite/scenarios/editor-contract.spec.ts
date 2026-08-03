import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { startDataset } from '../tasks/create/dataset'
import {
	clickEditorMap,
	expectGeometryFeatureCount,
	geometryDraftSnapshot,
} from '../tasks/create/geometry'
import {
	cancelSightingPlacement,
	placeSighting,
	startSightingPlacement,
} from '../tasks/create/sighting'
import {
	cancelDrawingAndVerifyRecovery,
	editorLifecycleSnapshot,
	exerciseMapStackDraftLifecycle,
	undoRedoGeometry,
} from '../tasks/editor/lifecycle'
import { placeMobilePrecisionPoint } from '../tasks/editor/mobile-precision-drawing'
import {
	addMapCallout,
	cycleMapCalloutDisplayMode,
	dragSelectedMapCallout,
	editFirstMapCalloutText,
} from '../tasks/editor/callouts'
import { openPanel } from '../tasks/navigation/open-panel'
import {
	attemptDeniedDeviceLocation,
	installDeterministicGeolocation,
} from '../tasks/setup/deterministic-geolocation'

test('cancel drawing unlocks panning and leaves the editor usable @editor-contract', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	const result = await cancelDrawingAndVerifyRecovery(earthly)
	expect(result.featureCount).toBe(1)
	expect(result.panLocked).toBe(false)
})

test('geometry can be undone and redone from viewport controls @editor-contract', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	const result = await undoRedoGeometry(earthly)
	expect(result.featureCount).toBe(1)
	expect(result.canUndo).toBe(true)
})

test('map callouts are authored on-map, movable, and locally hideable @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The direct map-control toggle is desktop-only')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.42)
	await expectGeometryFeatureCount(earthly, 1)
	await earthly.page.getByRole('button', { name: 'Select mode', exact: true }).click()
	await clickEditorMap(earthly, 0.62, 0.42)
	await expect(earthly.page.getByTestId('map-callout-composer')).toBeHidden()

	const authored = await addMapCallout(earthly, 'Context that stays on the map')
	expect(authored.text).toBe('Context that stays on the map')
	const moved = await dragSelectedMapCallout(earthly, { x: 42, y: -24 })
	expect(moved.offset).not.toEqual([0, 0])
	const edited = await editFirstMapCalloutText(earthly, 'Context edited directly on the map')
	expect(edited.text).toBe('Context edited directly on the map')

	const displayModeControl = earthly.page.getByRole('button', {
		name: 'Callout size: full. Switch to compact',
		exact: true,
	})
	await displayModeControl.hover()
	await expect(earthly.page.getByRole('tooltip')).toContainText(
		'Callout size: full. Switch to compact',
	)
	await cycleMapCalloutDisplayMode(earthly, 'full', 'compact')
	await cycleMapCalloutDisplayMode(earthly, 'compact', 'collapsed')
	await cycleMapCalloutDisplayMode(earthly, 'collapsed', 'full')

	await earthly.page.getByRole('button', { name: 'Hide map callouts' }).click()
	await expect(earthly.page.locator('[data-callout-state="full"]')).toBeHidden()
	await earthly.page.getByRole('button', { name: 'Show map callouts' }).click()
	await expect(
		earthly.page
			.locator('[data-callout-state="full"]')
			.filter({ hasText: 'Context edited directly on the map' }),
	).toBeVisible()
})

test('callout creation draws a point anchor when nothing is selected @editor-contract', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await expectGeometryFeatureCount(earthly, 0)

	const authored = await addMapCallout(earthly, 'Callout with a fresh anchor')
	const geometry = await geometryDraftSnapshot(earthly)
	expect(authored.text).toBe('Callout with a fresh anchor')
	expect(geometry.featureCount).toBe(1)
	expect(geometry.geometryTypes).toEqual(['Point'])
})

test('geometry editor represents and can remove an attached callout @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The floating Map Stack editor is desktop-only')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await addMapCallout(earthly, 'Remove me from the geometry')

	const mapStack = earthly.page.getByRole('region', { name: 'Map stack' })
	if (!(await mapStack.isVisible())) {
		await earthly.page.getByRole('button', { name: 'Show map stack' }).click()
	}
	await expect(mapStack).toBeVisible()
	await expect(mapStack.getByLabel('1 map callout', { exact: true })).toBeVisible()
	await mapStack.getByRole('button', { name: /^Expand Point/ }).click()
	await expect(mapStack.getByText('Map callouts (1)', { exact: true })).toBeVisible()
	await mapStack
		.getByRole('button', { name: 'Remove map callout: Remove me from the geometry', exact: true })
		.click()

	await expect(mapStack.getByLabel('1 map callout', { exact: true })).toBeHidden()
	await expect(
		earthly.page
			.locator('[data-callout-state="full"]')
			.filter({ hasText: 'Remove me from the geometry' }),
	).toBeHidden()
	await expectGeometryFeatureCount(earthly, 1)
})

test('mobile callouts stay readable in the exposed map above the sheet @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'This verifies mobile callout placement')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.42)
	await expectGeometryFeatureCount(earthly, 1)
	await earthly.page.getByRole('button', { name: 'Select / pan', exact: true }).click()
	await clickEditorMap(earthly, 0.62, 0.42)
	await expect(earthly.page.getByTestId('map-callout-composer')).toBeHidden()
	await addMapCallout(earthly, 'Readable mobile context')

	const card = earthly.page
		.locator('[data-callout-state="full"]')
		.filter({ hasText: 'Readable mobile context' })
	const sheet = earthly.page.getByTestId('mobile-sheet')
	await expect(card).toBeVisible()
	await expect(sheet).toBeVisible()
	const [cardBox, sheetBox] = await Promise.all([card.boundingBox(), sheet.boundingBox()])
	if (!cardBox || !sheetBox) throw new Error('Callout or mobile sheet has no bounding box')
	expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(sheetBox.y + 1)
})

test('mobile magnifier is ready before touch and follows precision placement @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The precision magnifier is mobile-only')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	const result = await placeMobilePrecisionPoint(earthly)
	expect(result.featureCount).toBe(1)
	expect(result.magnifierPreloaded).toBe(true)
	expect(result.magnifierVisibleDuringTouch).toBe(true)
})

test('geometry and metadata in an unfinished draft survive reload @editor-contract', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	const draftName = `Reloadable geometry ${Date.now().toString(36)}`
	await draft.nameInput.fill(draftName)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.43)
	await expectGeometryFeatureCount(earthly, 1)

	const current = new URL(earthly.page.url())
	await earthly.open({ path: `${current.pathname}${current.search}`, tour: 'seen' })
	await openPanel(earthly, 'Local drafts')
	const drafts = earthly.page.getByRole('region', { name: 'Local drafts' })
	const expandDrafts = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expandDrafts.isVisible()) await expandDrafts.click()
	const savedDraft = drafts.getByRole('button').filter({ hasText: draftName }).first()
	await expect(savedDraft).toBeVisible()
	await savedDraft.click()
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.not.toBeNull()
	await expectGeometryFeatureCount(earthly, 1)
	await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(draftName)
})

test('Map Stack Clear preserves and can isolate the active draft @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The floating Map Stack contract is desktop-only')
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	const result = await exerciseMapStackDraftLifecycle(earthly)
	expect(result.mapStack.some((entry) => entry.id === 'draft:active')).toBe(true)
	expect(result.mapStack.some((entry) => entry.isolated)).toBe(false)
})

test('mobile Sighting pin-drop does not show dataset lock-and-drag guidance @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Sighting guidance differs on the mobile map')
	await earthly.open({ tour: 'seen' })
	await startSightingPlacement(earthly)
	await earthly.page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
	await expect(earthly.page.getByText('Lock panning to draw')).toBeHidden()
	await cancelSightingPlacement(earthly)
	await expect(earthly.page.getByText('Lock panning to draw')).toBeHidden()
})

test('mobile quick Sighting capture progressively discloses advanced controls @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The compact authoring path is mobile-only')
	await authorizeJourneyIdentity(earthly, 'owner')
	await startSightingPlacement(earthly)
	await placeSighting(earthly)

	const title = earthly.page.getByLabel('Title', { exact: true })
	const moreOptions = earthly.page.getByRole('button', { name: /More options/ })
	const publish = earthly.page.getByRole('button', { name: 'Publish Sighting', exact: true })
	await title.fill('Squirrel draft survives disclosure')

	await expect(moreOptions).toHaveAttribute('aria-expanded', 'false')
	await expect(earthly.page.getByText('Observation time', { exact: true })).toBeHidden()
	await expect(earthly.page.getByText('Fade from map', { exact: true })).toBeHidden()
	await expect(earthly.page.getByRole('button', { name: 'Attach to a Context' })).toBeHidden()
	await expect(publish).toHaveCount(1)
	await expect(publish).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

	await moreOptions.click()
	await expect(moreOptions).toHaveAttribute('aria-expanded', 'true')
	await expect(earthly.page.getByText('Observation time', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText('Fade from map', { exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Attach to a Context' })).toBeVisible()

	await moreOptions.click()
	await expect(title).toHaveValue('Squirrel draft survives disclosure')
	await expect(publish).toHaveCount(1)
})

test('mobile non-geometry editors keep their primary actions in the sheet header @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The persistent action slot is mobile-only')
	await authorizeJourneyIdentity(earthly, 'owner')

	await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Story', exact: true }).click()
	await expect(earthly.page.getByText('New Story').first()).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Publish Story', exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
	await earthly.page.getByRole('button', { name: 'Cancel', exact: true }).click()

	await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Context', exact: true }).click()
	await expect(earthly.page.getByText('Create Context').first()).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Create Context', exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
	await earthly.page.getByRole('button', { name: 'Cancel', exact: true }).click()

	await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Live beacon', exact: true }).click()
	await expect(earthly.page.getByText('Share your live location').first()).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Start beacon', exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
})

test('mobile Dataset editing keeps global navigation and restores its map-bound sheet @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The author dock is mobile-only')
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Menu-safe mobile draft')

	const menu = earthly.page.getByRole('button', { name: 'Menu', exact: true })
	await expect(menu).toBeVisible()
	await menu.click()
	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	await expect(drawer).toBeVisible()
	await drawer.getByRole('button', { name: /^AI chat(?:\s|$)/ }).click()
	await expect(drawer.getByRole('heading', { name: 'AI chat', exact: true })).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/chat')

	await drawer.getByRole('button', { name: 'Close AI chat', exact: true }).click()
	await expect(drawer).toBeHidden()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/edit')
	await expect(earthly.page.getByTestId('mobile-sheet')).toBeVisible()
	await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue('Menu-safe mobile draft')
	await expect(menu).toBeVisible()
})

test('mobile global create closes navigation before arming map placement @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The mobile drawer owns this transition')
	await earthly.open({ tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	await expect(drawer).toBeVisible()

	await startSightingPlacement(earthly)
	await expect(drawer).toBeHidden()
	await expect(earthly.page.getByRole('button', { name: 'Cancel placement' })).toBeVisible()
	await cancelSightingPlacement(earthly)
})

test('mobile destination, search, and placement guidance occupy separate map lanes @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The overlay lanes are mobile-only')
	await earthly.open({ tour: 'seen' })

	const destination = earthly.page.getByRole('group', {
		name: /Current destination: Public.*Unattached/,
	})
	const destinationBox = await destination.boundingBox()
	const viewport = earthly.page.viewportSize()
	expect(destinationBox).not.toBeNull()
	expect(viewport).not.toBeNull()
	expect(
		Math.abs(
			(destinationBox?.x ?? 0) + (destinationBox?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2,
		),
	).toBeLessThan(3)

	await earthly.page.getByRole('button', { name: 'Search', exact: true }).click()
	const search = earthly.page.getByRole('search', { name: 'Search places' })
	await expect(search).toBeVisible()
	const searchBox = await search.boundingBox()
	const zoomInBox = await earthly.page.getByRole('button', { name: 'Zoom in' }).boundingBox()
	expect(searchBox).not.toBeNull()
	expect(zoomInBox).not.toBeNull()
	expect((searchBox?.y ?? 0) >= (destinationBox?.y ?? 0) + (destinationBox?.height ?? 0)).toBe(true)
	expect((searchBox?.x ?? 0) + (searchBox?.width ?? 0) <= (zoomInBox?.x ?? 0)).toBe(true)
	await earthly.page.getByRole('button', { name: 'Close search', exact: true }).click()

	await startSightingPlacement(earthly)
	const placement = earthly.page.getByTestId('sighting-placement-prompt')
	const placementBox = await placement.boundingBox()
	expect(placementBox).not.toBeNull()
	expect((placementBox?.y ?? 0) >= (destinationBox?.y ?? 0) + (destinationBox?.height ?? 0)).toBe(
		true,
	)
	await cancelSightingPlacement(earthly)
})

test('mobile location denial explains recovery and offers manual search @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The compact recovery action is mobile-only')
	await installDeterministicGeolocation(earthly, {
		latitude: 48.2082,
		longitude: 16.3738,
	})
	await earthly.open({ tour: 'seen' })
	await attemptDeniedDeviceLocation(earthly)

	await expect(earthly.page.getByText('Location access blocked', { exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Search for a place', exact: true }).click()
	await expect(earthly.page.getByRole('search', { name: 'Search places' })).toBeVisible()
})
