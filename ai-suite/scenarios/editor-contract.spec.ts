import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	completeAiChatTurn,
	composeAiChatMessage,
	configureChatProvider,
	openAiChat,
	persistedThreadSnapshot,
	sendAiChatMessage,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import {
	clickEditorMap,
	expectGeometryFeatureCount,
	publishCurrentGeometryDataset,
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
	exerciseGeometryOperations,
	exercisePolygonSplit,
} from '../tasks/editor/geometry-operations'
import {
	exerciseGeometryWorkbench,
	exerciseOverlappingGeometryChooser,
} from '../tasks/editor/geometry-workbench'
import { openPanel } from '../tasks/navigation/open-panel'
import {
	mobileWorkspaceBodyBackgroundAlpha,
	mobileWorkspaceChromeSnapshot,
	mobileWorkspaceRootBackgroundAlpha,
	mobileWorkspaceSheet,
	selectMobileEntitySurface,
	setMobileWorkspaceTransparency,
	switchMobileWorkspacePanel,
} from '../tasks/navigation/mobile-workspace'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import {
	attemptDeniedDeviceLocation,
	installDeterministicGeolocation,
} from '../tasks/setup/deterministic-geolocation'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

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

test('geometry operations choose numeric or drag input before interaction @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The desktop menu contract is exercised here')
	await earthly.open({ tour: 'seen' })
	const result = await exerciseGeometryOperations(earthly)
	expect(result.numericDialogVisible).toBe(true)
	expect(result.dragGuidanceVisible).toBe(true)
	expect(result.splitGuidanceVisible).toBe(true)
	expect(result.featureCount).toBe(4)
	expect(result.geometryTypes.every((type) => type === 'LineString')).toBe(true)
})

test('a drawn line splits the selected polygon @editor-contract', async ({ earthly }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The desktop menu contract is exercised here')
	await earthly.open({ tour: 'seen' })
	const result = await exercisePolygonSplit(earthly)
	expect(result.featureCount).toBe(2)
	expect(result.geometryTypes.every((type) => type === 'Polygon')).toBe(true)
})

test('Dataset geometry rows support Finder selection, ordering, and copy actions @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The geometry workbench is desktop-only')
	await earthly.open({ tour: 'seen' })
	const result = await exerciseGeometryWorkbench(earthly)
	expect(result.selectedAfterRange).toBe(3)
	expect(result.orderChanged).toBe(true)
	expect(result.copyConfirmed).toBe(true)
	expect(result.visibleTypes).toEqual(['LineString', 'Point', 'Polygon', 'Annotation'])
})

test('overlapping map geometries present an explicit chooser @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The overlap chooser contract is exercised here')
	await earthly.open({ tour: 'seen' })
	const result = await exerciseOverlappingGeometryChooser(earthly)
	expect(result.candidateCount).toBe(2)
	expect(result.selectedFeatureCount).toBe(1)
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

test('Map Stack Clear removes geometry but preserves the active draft @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The floating Map Stack contract is desktop-only')
	await installIsolatedRelays(earthly)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	const result = await exerciseMapStackDraftLifecycle(earthly)
	expect(result.mapStack.some((entry) => entry.id === 'draft:active')).toBe(false)
	expect(result.mapStack.some((entry) => entry.isolated)).toBe(false)
})

test('publishing an active Dataset replaces its protected draft presentation @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Dataset publication setup is desktop-only')
	await authorizeJourneyIdentity(earthly, 'owner')
	const draft = await startDataset(earthly)
	const datasetName = `Published edit presentation ${Date.now().toString(36)}`
	await draft.nameInput.fill(datasetName)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.43)
	await expectGeometryFeatureCount(earthly, 1)

	await publishCurrentGeometryDataset(earthly)
	const published = await editorLifecycleSnapshot(earthly)
	expect(published.mapStack.some((entry) => entry.id === 'draft:active')).toBe(false)
	expect(published.mapStack.some((entry) => entry.entityType === 'dataset' && entry.visible)).toBe(
		true,
	)

	await openPanel(earthly, 'Maps')
	await earthly.page.getByPlaceholder('Search...').first().fill(datasetName)
	const catalogTitle = earthly.page.getByRole('button', {
		name: `Zoom to dataset ${datasetName}`,
		exact: true,
	})
	await expect(catalogTitle).toBeVisible()
	const catalogRow = catalogTitle.locator(
		'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " border-l-2 ")][1]',
	)
	await catalogRow.getByRole('button', { name: 'Delete dataset', exact: true }).click()
	const confirmCatalogDelete = catalogRow.getByRole('button', {
		name: 'Confirm dataset deletion',
		exact: true,
	})
	await expect(confirmCatalogDelete).toBeVisible()
	const catalogLayout = await confirmCatalogDelete.evaluate((button) => {
		const sidebar = button.closest<HTMLElement>('[data-slot="sidebar-inner"]')
		const content = button.closest<HTMLElement>('[data-slot="sidebar-content"]')
		if (!sidebar || !content) throw new Error('Dataset catalog sidebar was not found')
		return {
			buttonRight: button.getBoundingClientRect().right,
			sidebarRight: sidebar.getBoundingClientRect().right,
			horizontalOverflow: content.scrollWidth - content.clientWidth,
		}
	})
	expect(catalogLayout.buttonRight).toBeLessThanOrEqual(catalogLayout.sidebarRight)
	expect(catalogLayout.horizontalOverflow).toBeLessThanOrEqual(1)
})

test('Dataset editor deletion stays inside the desktop sidebar @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The persistent Dataset editor rail is desktop-only',
	)
	await earthly.page.setViewportSize({ width: 1024, height: 768 })
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)

	const deleteButton = earthly.page.getByRole('button', {
		name: 'Delete saved work',
		exact: true,
	})
	await expect(deleteButton).toBeVisible()
	await deleteButton.click()

	const confirmButton = earthly.page.getByRole('button', {
		name: 'Confirm saved work deletion',
		exact: true,
	})
	await expect(confirmButton).toBeVisible()
	const layout = await confirmButton.evaluate((button) => {
		const sidebar = button.closest<HTMLElement>('[data-slot="sidebar-inner"]')
		const content = button.closest<HTMLElement>('[data-slot="sidebar-content"]')
		if (!sidebar || !content) throw new Error('Dataset editor sidebar was not found')
		const sidebarRect = sidebar.getBoundingClientRect()
		const buttonRect = button.getBoundingClientRect()
		return {
			buttonRight: buttonRect.right,
			sidebarRight: sidebarRect.right,
			horizontalOverflow: content.scrollWidth - content.clientWidth,
		}
	})
	expect(layout.buttonRight).toBeLessThanOrEqual(layout.sidebarRight)
	expect(layout.horizontalOverflow).toBeLessThanOrEqual(1)
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
	await earthly.page.getByRole('menuitem', { name: 'Atlas', exact: true }).click()
	await expect(earthly.page.getByText('Create Atlas').first()).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Create Atlas', exact: true }),
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

test('mobile map attribution remains a compact control above every sheet detent @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The responsive attribution layout is mobile-only')
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)

	const attribution = earthly.page.locator('.maplibregl-ctrl-attrib').first()
	await expect(attribution).toBeVisible()
	await expect(attribution).toHaveClass(/maplibregl-compact/)
	const viewport = earthly.page.viewportSize()
	expect(viewport).not.toBeNull()

	const expectCompactAttribution = async () => {
		const box = await attribution.boundingBox()
		expect(box).not.toBeNull()
		expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThan((viewport?.width ?? 0) * 0.5)
	}

	await expectCompactAttribution()
	const attributionToggle = attribution.locator('.maplibregl-ctrl-attrib-button')
	await attributionToggle.click()
	await expect.poll(async () => (await attribution.boundingBox())?.width ?? 0).toBeGreaterThan(80)
	await attributionToggle.click()
	await expectCompactAttribution()
	await startDataset(earthly)
	await expect(earthly.page.getByTestId('mobile-sheet')).toBeVisible()
	await expectCompactAttribution()
})

test('mobile workspace keeps a running Thread and its exact edit target visible @editor-contract', async ({
	earthly,
}) => {
	test.skip(!earthly.isMobile, 'The compact workspace header is mobile-only')
	test.setTimeout(120_000)
	const provider = await installDeterministicChatProvider(earthly, 'mobile-workspace-switch', {
		holdCompletionResponses: true,
	})
	try {
		await authorizeJourneyIdentity(earthly, 'owner')
		await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
		await earthly.open({ tour: 'preserve' })
		await installDeterministicMapStyle(earthly)
		const datasetName = 'Dataset A — exact mobile Chat target'
		const draft = await startDataset(earthly)
		await draft.nameInput.fill(datasetName)
		const original = await editorLifecycleSnapshot(earthly)
		await openAiChat(earthly)
		const chatRegion = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
		const assistantMessagesBefore = await chatRegion.getByTitle('Copy assistant message').count()
		await sendAiChatMessage(
			earthly,
			'Retain a Story draft in the background while I inspect this exact Dataset target.',
		)
		await expect.poll(() => provider.requests().length).toBe(1)
		await expect(chatRegion.getByText(datasetName, { exact: true })).toBeVisible()
		const bound = await editorLifecycleSnapshot(earthly)
		expect(bound.activeWorkspaceId).toBe(original.activeWorkspaceId)
		await expect
			.poll(() => persistedThreadSnapshot(earthly))
			.toMatchObject({
				threadKey: `map-draft:${original.activeWorkspaceId}`,
				targetWorkspaceId: original.activeWorkspaceId,
			})
		const threadBeforeRun = await persistedThreadSnapshot(earthly)

		// A competing working copy gets its own route-bound Thread, never A's run.
		const datasetB = await startDataset(earthly)
		await datasetB.nameInput.fill('Dataset B — visible but never rebound')
		await expect(earthly.page).toHaveURL(/\/edit$/)
		const competing = await editorLifecycleSnapshot(earthly)
		expect(competing.activeWorkspaceId).not.toBe(original.activeWorkspaceId)
		expect(competing.activeDraftId).not.toBe(original.activeDraftId)
		expect(
			competing.workspaces.find((item) => item.id === competing.activeWorkspaceId)?.chatSessionId,
		).toBeNull()

		await openPanel(earthly, 'Local drafts')
		const drafts = earthly.page.getByRole('region', { name: 'Local drafts', exact: true })
		await expect(drafts).toBeVisible()
		const expand = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
		if (await expand.isVisible()) await expand.click()
		await drafts.getByRole('button').filter({ hasText: datasetName }).first().click()
		await openAiChat(earthly)
		await expect(earthly.page).toHaveURL(/\/edit\?tab=thread$/)
		await expect(chatRegion.getByText(datasetName, { exact: true })).toBeVisible()
		expect(await editorLifecycleSnapshot(earthly)).toMatchObject({
			activeWorkspaceId: original.activeWorkspaceId,
		})
		expect(await persistedThreadSnapshot(earthly)).toEqual(threadBeforeRun)
		expect(provider.requests()).toHaveLength(1)

		await switchMobileWorkspacePanel(earthly, 'Edit')
		await expect(draft.nameInput).toHaveValue(datasetName)
		const viewport = earthly.page.viewportSize()
		if (!viewport) throw new Error('Mobile viewport is unavailable')
		for (const width of [viewport.width, 320]) {
			await earthly.page.setViewportSize({ ...viewport, width })
			const chrome = await mobileWorkspaceChromeSnapshot(earthly)
			expect(chrome.controls.height).toBeLessThanOrEqual(48)
			for (const control of [
				chrome.slider,
				chrome.transparency,
				chrome.close,
				...(chrome.resume ? [chrome.resume] : []),
			]) {
				expect(control.width).toBeGreaterThanOrEqual(44)
				expect(control.height).toBeGreaterThanOrEqual(44)
				expect(control.x).toBeGreaterThanOrEqual(0)
				expect(control.x + control.width).toBeLessThanOrEqual(width + 1)
			}
		}
		await earthly.page.setViewportSize(viewport)
		await draft.nameInput.focus()
		await earthly.page.setViewportSize({
			...viewport,
			height: Math.max(480, viewport.height - 320),
		})
		await expect(draft.nameInput).toBeFocused()
		await expect
			.poll(async () => {
				const input = await draft.nameInput.boundingBox()
				const sheet = await mobileWorkspaceSheet(earthly).boundingBox()
				return Boolean(
					input && sheet && input.y >= 0 && input.y + input.height <= sheet.y + sheet.height + 1,
				)
			})
			.toBe(true)
		await earthly.page.setViewportSize(viewport)
		await draft.nameInput.blur()

		await openAiChat(earthly)
		await expect(chatRegion.getByText(datasetName, { exact: true })).toBeVisible()
		const backToMap = earthly.page.getByRole('button', { name: 'Back to Map', exact: true })
		expect((await backToMap.boundingBox())?.height).toBeGreaterThanOrEqual(44)
		await setMobileWorkspaceTransparency(earthly, false)
		const opaque = await mobileWorkspaceRootBackgroundAlpha(earthly)
		await setMobileWorkspaceTransparency(earthly, true)
		expect(await mobileWorkspaceRootBackgroundAlpha(earthly)).toBeLessThan(opaque - 0.25)
		expect(await mobileWorkspaceBodyBackgroundAlpha(earthly)).toBeLessThan(0.7)
		await setMobileWorkspaceTransparency(earthly, false)

		provider.releaseCompletionResponses()
		await completeAiChatTurn(earthly, assistantMessagesBefore, { approvals: ['story-target'] })
		await expect(
			chatRegion.getByText(
				'I retained the background Story draft without changing your visible mobile workspace.',
				{ exact: true },
			),
		).toBeVisible()
		await expect(chatRegion.getByText(datasetName, { exact: true })).toBeVisible()
		expect(await editorLifecycleSnapshot(earthly)).toMatchObject({
			activeWorkspaceId: original.activeWorkspaceId,
		})
		expect(await persistedThreadSnapshot(earthly)).toEqual(threadBeforeRun)
		const savedStories = await earthly.page.evaluate(() =>
			Object.keys(localStorage)
				.filter((key) => key.startsWith('earthly:story:drafts:v1'))
				.flatMap((key) => {
					const drafts = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
						string,
						{ title?: string; content?: string }
					>
					const draft = drafts['new-story']
					return draft ? [{ title: draft.title, content: draft.content }] : []
				}),
		)
		await test.info().attach('retained Story payload', {
			body: JSON.stringify(savedStories, null, 2),
			contentType: 'application/json',
		})
		expect(savedStories).toContainEqual({
			title: 'Background mobile Story',
			content: 'This deterministic Story is retained without stealing the active Chat panel.',
		})
		await selectMobileEntitySurface(earthly, 'Story', 'Background mobile Story')
		await expect(
			mobileWorkspaceSheet(earthly).getByPlaceholder('Roman ruins in Carinthia', { exact: true }),
		).toHaveValue('Background mobile Story')
		await selectMobileEntitySurface(earthly, 'Map', datasetName)
		await openAiChat(earthly)
		const followUp = 'Keep this unsent follow-up while I compare the work surfaces.'
		await composeAiChatMessage(earthly, followUp)
		await switchMobileWorkspacePanel(earthly, 'Edit')
		await switchMobileWorkspacePanel(earthly, 'Shelf')
		await selectMobileEntitySurface(earthly, 'Map', datasetName)
		await openAiChat(earthly)
		await expect(chatRegion.getByText(datasetName, { exact: true })).toBeVisible()
		await expect(chatRegion.locator('textarea')).toHaveValue(followUp)
		const final = await editorLifecycleSnapshot(earthly)
		expect(final.activeWorkspaceId).toBe(original.activeWorkspaceId)
		expect(final.activeDraftId).toBe(original.activeDraftId)
		expect(await persistedThreadSnapshot(earthly)).toEqual(threadBeforeRun)
		expect(final.workspaceCount).toBe(original.workspaceCount + 1)
		expect(
			final.workspaces.find((item) => item.id === competing.activeWorkspaceId)?.chatSessionId,
		).toBeNull()
		expect(provider.requests()).toHaveLength(2)
	} finally {
		provider.releaseCompletionResponses()
	}
})

test('mobile global create closes the account menu before arming map placement @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The mobile account popover owns this transition')
	await earthly.open({ tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Me', exact: true }).click()
	const menu = earthly.page.getByRole('dialog', { name: 'Me menu', exact: true })
	await expect(menu).toBeVisible()

	await startSightingPlacement(earthly)
	await expect(menu).toBeHidden()
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
