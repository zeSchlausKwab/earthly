import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { startDataset } from '../tasks/create/dataset'
import { clickEditorMap, expectGeometryFeatureCount } from '../tasks/create/geometry'
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
import { openPanel } from '../tasks/navigation/open-panel'

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

	await moreOptions.click()
	await expect(moreOptions).toHaveAttribute('aria-expanded', 'true')
	await expect(earthly.page.getByText('Observation time', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText('Fade from map', { exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Attach to a Context' })).toBeVisible()

	await moreOptions.click()
	await expect(title).toHaveValue('Squirrel draft survives disclosure')
	await expect(publish).toHaveCount(1)
})
