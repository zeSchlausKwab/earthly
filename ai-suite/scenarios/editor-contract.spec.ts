import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	aiChatSurfaceSnapshot,
	completeAiChatTurn,
	composeAiChatMessage,
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
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
	mobileEditingTargetPillSnapshot,
	mobileWorkspaceBodyBackgroundAlpha,
	mobileWorkspaceChromeSnapshot,
	mobileWorkspaceRootBackgroundAlpha,
	mobileWorkspaceSheet,
	mobileWorkspaceTab,
	selectMobileEntitySurface,
	setMobileWorkspaceTransparency,
	switchMobileWorkspacePanel,
} from '../tasks/navigation/mobile-workspace'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installInMemoryContextFixture } from '../tasks/setup/in-memory-context-fixture'
import {
	attemptDeniedDeviceLocation,
	installDeterministicGeolocation,
} from '../tasks/setup/deterministic-geolocation'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

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

	await earthly.page.getByRole('button', { name: 'Datasets', exact: true }).click()
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

test('mobile workspace keeps a running Chat and its exact edit target visible @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'The three-surface workspace is mobile-only')
	test.setTimeout(120_000)

	const provider = await installDeterministicChatProvider(earthly, 'mobile-workspace-switch', {
		holdCompletionResponses: true,
	})
	try {
		await authorizeJourneyIdentity(earthly, 'owner')
		await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
		await earthly.open({ tour: 'preserve' })
		await installDeterministicMapStyle(earthly)

		const inspectorContextName = `Mobile Inspector fixture ${Date.now().toString(36)}`
		const inspectorContextDescription =
			'A local Context used to prove that read-only inspection remains independent from Chat and Dataset editing.'
		await installInMemoryContextFixture(earthly, {
			name: inspectorContextName,
			description: inspectorContextDescription,
		})

		const datasetName = 'Dataset A — exact mobile Chat target'
		const draft = await startDataset(earthly)
		await draft.nameInput.fill(datasetName)
		await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
		await clickEditorMap(earthly, 0.62, 0.38)
		await expectGeometryFeatureCount(earthly, 1)
		// This journey later opens Local drafts to create a competing workspace.
		// Leave point drawing through the visible mobile action first so its
		// persistent pan-lock guidance cannot cover that next explicit choice.
		const mobileTools = earthly.page.getByRole('button', { name: /^More tools/ })
		await expect(mobileTools).toBeVisible()
		await mobileTools.click()
		await earthly.page.getByRole('menuitem', { name: 'Cancel drawing', exact: true }).click()
		await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).mode).toBe('select')
		await expect(earthly.page.getByText('Lock panning to draw', { exact: true })).toBeHidden()
		const materializedDraftFeatureCount = () =>
			earthly.page.evaluate(() => {
				const map = (
					window as unknown as {
						__earthlyUiMap?: { querySourceFeatures(id: string): unknown[] }
					}
				).__earthlyUiMap
				if (!map) return -1
				try {
					return map.querySourceFeatures('geo-editor').length
				} catch {
					return -1
				}
			})
		await expect.poll(materializedDraftFeatureCount).toBeGreaterThan(0)
		const taskBeforeChat = await editorLifecycleSnapshot(earthly)
		expect(taskBeforeChat.activeWorkspaceId).not.toBeNull()
		expect(taskBeforeChat.activeDraftId).not.toBeNull()

		// Dataset A is active authoring work, so its Map Stack representation is
		// mandatory: it has no hide/remove action and survives Clear.
		await switchMobileWorkspacePanel(earthly, 'Stack')
		const stack = earthly.page.getByRole('region', { name: 'Map stack', exact: true })
		await expect(stack).toBeVisible()
		await expect
			.poll(async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.some(
					(entry) => entry.id === 'draft:active',
				),
			)
			.toBe(true)
		await expect(
			stack.getByRole('button', { name: 'Hide edit from map', exact: true }),
		).toHaveCount(0)
		const clearStack = stack.getByRole('button', { name: 'Clear', exact: true })
		if (await clearStack.isEnabled()) await clearStack.click()
		await expect
			.poll(async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.some(
					(entry) => entry.id === 'draft:active',
				),
			)
			.toBe(true)
		await expect.poll(materializedDraftFeatureCount).toBeGreaterThan(0)
		await switchMobileWorkspacePanel(earthly, 'Edit')
		await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(datasetName)
		const retainedAInEdit = await editorLifecycleSnapshot(earthly)
		expect(retainedAInEdit.activeWorkspaceId).toBe(taskBeforeChat.activeWorkspaceId)
		expect(retainedAInEdit.activeDraftId).toBe(taskBeforeChat.activeDraftId)
		expect(retainedAInEdit.featureCount).toBe(1)
		expect(retainedAInEdit.mapStack.some((entry) => entry.id === 'draft:active')).toBe(true)

		await openAiChat(earthly)
		const targetName = await selectAiChatTarget(earthly, 'current-dataset')
		expect(targetName).toBe(datasetName)
		const chatBeforeRun = await aiChatSurfaceSnapshot(earthly)
		expect(chatBeforeRun.targetName).toBe(datasetName)
		expect(chatBeforeRun.targetRequired).toBe(false)
		const boundA = await editorLifecycleSnapshot(earthly)
		expect(boundA.activeWorkspaceId).toBe(taskBeforeChat.activeWorkspaceId)
		expect(boundA.activeDraftId).toBe(taskBeforeChat.activeDraftId)
		expect(boundA.mapStack.some((entry) => entry.id === 'draft:active')).toBe(true)

		const chatRegion = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
		const assistantMessagesBefore = await chatRegion.getByTitle('Copy assistant message').count()
		await sendAiChatMessage(
			earthly,
			'Retain a Story draft in the background while I inspect this exact Dataset target.',
		)
		await expect.poll(() => provider.requests().length).toBe(1)

		// Make a genuinely competing task visible after Chat binds Dataset A. The
		// pending run must neither follow nor acquire this new Dataset B.
		const datasetBName = 'Dataset B — visible but never rebound'
		const datasetB = await startDataset(earthly)
		await datasetB.nameInput.fill(datasetBName)
		await expect(datasetB.nameInput).toHaveValue(datasetBName)
		const taskBVisible = await editorLifecycleSnapshot(earthly)
		expect(taskBVisible.activeWorkspaceId).not.toBe(taskBeforeChat.activeWorkspaceId)
		expect(taskBVisible.activeDraftId).not.toBe(taskBeforeChat.activeDraftId)
		expect(taskBVisible.workspaceCount).toBe(taskBeforeChat.workspaceCount + 1)
		expect(taskBVisible.mapStack.some((entry) => entry.id === 'draft:active')).toBe(true)
		expect(
			taskBVisible.workspaces.find((workspace) => workspace.id === taskBVisible.activeWorkspaceId)
				?.chatSessionId,
		).toBeNull()
		const currentRouteIdentity = () =>
			earthly.page.evaluate(
				() => `${window.location.pathname}${window.location.search}${window.location.hash}`,
			)
		const workspaceRouteBeforeSwitches = await currentRouteIdentity()
		// Chat is a presentation switch and leaves B active. Only the explicit
		// Chat -> Edit action restores this conversation's immutable Dataset A.
		await switchMobileWorkspacePanel(earthly, 'Chat')
		await expect.poll(currentRouteIdentity).toBe(workspaceRouteBeforeSwitches)
		await expect(mobileWorkspaceTab(earthly, 'Chat')).toHaveAttribute('aria-selected', 'true')
		expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
			chatId: chatBeforeRun.chatId,
			targetName: datasetName,
			targetRequired: false,
		})
		expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(
			taskBVisible.activeWorkspaceId,
		)
		await switchMobileWorkspacePanel(earthly, 'Edit')
		await expect.poll(currentRouteIdentity).toBe(workspaceRouteBeforeSwitches)
		await expect(mobileWorkspaceTab(earthly, 'Edit')).toHaveAttribute('aria-selected', 'true')
		await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(datasetName)
		const taskInEdit = await editorLifecycleSnapshot(earthly)
		expect(taskInEdit.activeWorkspaceId).toBe(taskBeforeChat.activeWorkspaceId)
		expect(taskInEdit.activeDraftId).toBe(taskBeforeChat.activeDraftId)
		expect(taskInEdit.workspaceCount).toBe(taskBeforeChat.workspaceCount + 1)
		// Exact Chat target restoration replaces Dataset B's shared draft row with
		// Dataset A's mandatory visible authoring representation.
		expect(taskInEdit.mapStack.some((entry) => entry.id === 'draft:active')).toBe(true)
		await expect.poll(materializedDraftFeatureCount).toBeGreaterThan(0)
		expect(
			taskInEdit.workspaces.find((workspace) => workspace.id === taskBVisible.activeWorkspaceId)
				?.chatSessionId,
		).toBeNull()
		expect(provider.requests()).toHaveLength(1)

		// Android commonly resizes the layout viewport instead of reporting an
		// occluding overlay. The focused Dataset field must remain above both the
		// visual viewport edge and the sheet's reserved bottom-dock boundary.
		const editNameInput = earthly.page.getByPlaceholder('Name').first()
		const fullViewport = earthly.page.viewportSize()
		expect(fullViewport).not.toBeNull()
		await editNameInput.focus()
		await expect(editNameInput).toBeFocused()
		await earthly.page.setViewportSize({
			width: fullViewport?.width ?? 390,
			height: Math.max(480, (fullViewport?.height ?? 844) - 320),
		})
		try {
			await expect(editNameInput).toBeFocused()
			await expect
				.poll(async () => {
					const inputBox = await editNameInput.boundingBox()
					const sheetBox = await mobileWorkspaceSheet(earthly).boundingBox()
					const visualBounds = await earthly.page.evaluate(() => {
						const top = window.visualViewport?.offsetTop ?? 0
						return {
							top,
							bottom: top + (window.visualViewport?.height ?? window.innerHeight),
						}
					})
					if (!inputBox || !sheetBox) return false
					const inputBottom = inputBox.y + inputBox.height
					const sheetBottom = sheetBox.y + sheetBox.height
					return (
						inputBox.y >= visualBounds.top &&
						inputBottom <= sheetBottom + 1 &&
						sheetBottom < visualBounds.bottom - 24
					)
				})
				.toBe(true)
			await expect(editNameInput).toHaveValue(datasetName)
		} finally {
			if (fullViewport) await earthly.page.setViewportSize(fullViewport)
			await editNameInput.blur()
		}
		await expect(editNameInput).toHaveValue(datasetName)

		// The handle, three workspace tabs, eye, and close action form one compact
		// sheet-wide rail. Its three groups distribute spare width between them so
		// the handle and close action anchor the sheet edges at every phone width.
		const assertSingleRowWorkspaceRail = async (expectedViewportWidth?: number) => {
			const chrome = await mobileWorkspaceChromeSnapshot(earthly)
			expect(chrome.controls.height).toBe(48)
			const controlsCenter = chrome.controls.y + chrome.controls.height / 2
			const orderedTargets = [chrome.slider, ...chrome.tabs, chrome.transparency, chrome.close]
			for (const control of orderedTargets) {
				expect(control.width).toBeGreaterThanOrEqual(44)
				expect(control.height).toBeGreaterThanOrEqual(44)
				expect(Math.abs(control.y + control.height / 2 - controlsCenter)).toBeLessThanOrEqual(2)
				expect(control.x).toBeGreaterThanOrEqual(chrome.controls.x - 1)
				expect(control.y).toBeGreaterThanOrEqual(chrome.controls.y)
				expect(control.x + control.width).toBeLessThanOrEqual(
					chrome.controls.x + chrome.controls.width + 1,
				)
				expect(control.y + control.height).toBeLessThanOrEqual(
					chrome.controls.y + chrome.controls.height,
				)
			}
			for (let index = 0; index < orderedTargets.length - 1; index += 1) {
				const current = orderedTargets[index]
				const next = orderedTargets[index + 1]
				expect(current).toBeDefined()
				expect(next).toBeDefined()
				expect((current?.x ?? 0) + (current?.width ?? 0)).toBeLessThanOrEqual((next?.x ?? 0) + 1)
			}
			const groupedTargets = [chrome.slider, chrome.tablist, chrome.actionGroup]
			const interGroupGaps = groupedTargets.slice(0, -1).map((current, index) => {
				const next = groupedTargets[index + 1]
				expect(next).toBeDefined()
				return (next?.x ?? 0) - (current.x + current.width)
			})
			for (const gap of interGroupGaps) expect(gap).toBeGreaterThanOrEqual(-1)
			expect(Math.max(...interGroupGaps) - Math.min(...interGroupGaps)).toBeLessThanOrEqual(2)
			expect(chrome.transparency.width).toBeGreaterThanOrEqual(44)
			expect(chrome.close.width).toBeGreaterThanOrEqual(44)
			expect(
				chrome.close.x - (chrome.transparency.x + chrome.transparency.width),
			).toBeLessThanOrEqual(1)
			expect(
				chrome.close.x - (chrome.transparency.x + chrome.transparency.width),
			).toBeGreaterThanOrEqual(-1)
			expect(Math.abs(chrome.actionGroup.x - chrome.transparency.x)).toBeLessThanOrEqual(1)
			expect(
				Math.abs(
					chrome.actionGroup.x + chrome.actionGroup.width - (chrome.close.x + chrome.close.width),
				),
			).toBeLessThanOrEqual(1)
			expect(chrome.controls.x).toBeGreaterThanOrEqual(chrome.sheet.x - 1)
			expect(chrome.controls.x + chrome.controls.width).toBeLessThanOrEqual(
				chrome.sheet.x + chrome.sheet.width + 1,
			)
			expect(chrome.tablist.x).toBeGreaterThanOrEqual(chrome.controls.x - 1)
			expect(chrome.tablist.x + chrome.tablist.width).toBeLessThanOrEqual(
				chrome.controls.x + chrome.controls.width + 1,
			)
			for (const tab of chrome.tabs) {
				expect(tab.width).toBeGreaterThanOrEqual(44)
				expect(tab.width).toBeLessThanOrEqual(88)
				expect(tab.height).toBeGreaterThanOrEqual(44)
				expect(tab.labelFits).toBe(true)
			}
			expect(chrome.tabs.map((tab) => tab.label)).toEqual(['Stack', 'Edit', 'Chat'])
			if (expectedViewportWidth !== undefined) {
				expect(chrome.sheet.x + chrome.sheet.width).toBeLessThanOrEqual(expectedViewportWidth + 1)
				expect(chrome.controls.x + chrome.controls.width).toBeLessThanOrEqual(
					expectedViewportWidth + 1,
				)
				const leftBoundary = Math.max(chrome.controls.x, 0)
				const rightBoundary = Math.min(
					chrome.controls.x + chrome.controls.width,
					expectedViewportWidth,
				)
				const leftInset = chrome.slider.x - leftBoundary
				const rightInset = rightBoundary - (chrome.close.x + chrome.close.width)
				expect(Math.abs(leftInset)).toBeLessThanOrEqual(1)
				expect(Math.abs(rightInset)).toBeLessThanOrEqual(1)
				expect(Math.min(...interGroupGaps)).toBeGreaterThan(1)
			}
		}

		const regularMobileViewport = earthly.page.viewportSize()
		expect(regularMobileViewport).not.toBeNull()
		await assertSingleRowWorkspaceRail(regularMobileViewport?.width)
		await earthly.page.setViewportSize({
			width: 320,
			height: regularMobileViewport?.height ?? 844,
		})
		try {
			await assertSingleRowWorkspaceRail(320)
		} finally {
			if (regularMobileViewport) await earthly.page.setViewportSize(regularMobileViewport)
		}

		// The purple target capsule is a compact visual inside a full-size action
		// row: reducing header density must not shrink the semantic open target.
		await switchMobileWorkspacePanel(earthly, 'Chat')
		const targetPill = await mobileEditingTargetPillSnapshot(earthly, datasetName)
		expect(targetPill.shell.height).toBeGreaterThanOrEqual(44)
		expect(targetPill.visualCapsule.height).toBeGreaterThanOrEqual(28)
		expect(targetPill.visualCapsule.height).toBeLessThanOrEqual(36)
		expect(targetPill.shell.height - targetPill.visualCapsule.height).toBeGreaterThanOrEqual(8)
		expect(targetPill.openAction.width).toBeGreaterThanOrEqual(44)
		expect(targetPill.openAction.height).toBeGreaterThanOrEqual(44)
		expect(targetPill.label).toBe(datasetName)
		// The label is normal-size text, so its rendered foreground and effective
		// capsule background must meet WCAG AA. This catches opaque color fallbacks
		// that collapse both sides of the compact purple pill to the same token.
		expect(targetPill.foregroundRgb).not.toEqual(targetPill.visualCapsuleBackgroundRgb)
		expect(targetPill.textContrastRatio).toBeGreaterThanOrEqual(4.5)

		// Moving the tabs into the resize rail must not make panel selection a
		// resize gesture. Preserve both the stored detent and rendered sheet height
		// across a click transition and a successful keyboard-arrow transition.
		const railBeforePanelSwitch = await mobileWorkspaceChromeSnapshot(earthly)
		const expectUnchangedSheetDetent = async () => {
			const currentRail = await mobileWorkspaceChromeSnapshot(earthly)
			expect(currentRail.detentPx).toBe(railBeforePanelSwitch.detentPx)
			expect(
				Math.abs(currentRail.sheet.height - railBeforePanelSwitch.sheet.height),
			).toBeLessThanOrEqual(1)
		}
		await switchMobileWorkspacePanel(earthly, 'Stack')
		await expectUnchangedSheetDetent()
		const stackRailTab = mobileWorkspaceTab(earthly, 'Stack')
		await stackRailTab.focus()
		await expect(stackRailTab).toBeFocused()
		await stackRailTab.press('ArrowRight')
		const editRailTab = mobileWorkspaceTab(earthly, 'Edit')
		await expect(editRailTab).toHaveAttribute('aria-selected', 'true')
		await expect(editRailTab).toBeFocused()
		await expectUnchangedSheetDetent()

		// Transparency must affect the root and every workspace body, not just
		// paint a blue border around an otherwise opaque child panel. The eye and
		// close controls stay global and measurable while each panel is selected.
		const workspacePanels = ['Stack', 'Edit', 'Chat'] as const
		const opaqueAlphas: Partial<Record<(typeof workspacePanels)[number], number>> = {}
		const opaqueRootAlpha = await mobileWorkspaceRootBackgroundAlpha(earthly)
		expect(opaqueRootAlpha).toBeGreaterThan(0.98)
		for (const panel of workspacePanels) {
			await switchMobileWorkspacePanel(earthly, panel)
			await expect.poll(currentRouteIdentity).toBe(workspaceRouteBeforeSwitches)
			await assertSingleRowWorkspaceRail()
			opaqueAlphas[panel] = await mobileWorkspaceBodyBackgroundAlpha(earthly)
			expect(opaqueAlphas[panel]).toBeGreaterThan(0.98)
		}
		await setMobileWorkspaceTransparency(earthly, true)
		const translucentRootAlpha = await mobileWorkspaceRootBackgroundAlpha(earthly)
		expect(translucentRootAlpha).toBeLessThan(0.7)
		expect(opaqueRootAlpha - translucentRootAlpha).toBeGreaterThan(0.25)
		for (const panel of workspacePanels) {
			await switchMobileWorkspacePanel(earthly, panel)
			await assertSingleRowWorkspaceRail()
			const translucentAlpha = await mobileWorkspaceBodyBackgroundAlpha(earthly)
			expect(translucentAlpha).toBeLessThan(0.7)
			expect((opaqueAlphas[panel] ?? 0) - translucentAlpha).toBeGreaterThan(0.25)
		}
		await setMobileWorkspaceTransparency(earthly, false)

		// The transparency loop ends on Chat without treating the tab as routing or
		// moving the conversation's target.
		await expect.poll(currentRouteIdentity).toBe(workspaceRouteBeforeSwitches)
		await expect(mobileWorkspaceTab(earthly, 'Chat')).toHaveAttribute('aria-selected', 'true')
		expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
			chatId: chatBeforeRun.chatId,
			targetName: datasetName,
			targetRequired: false,
			userMessageCount: chatBeforeRun.userMessageCount + 1,
		})
		expect(provider.requests()).toHaveLength(1)

		// An explicit catalog action may establish the canonical Context route. Once
		// there, Inspector and the retained Dataset editor are presentation choices:
		// neither may rewrite that route, move Chat's target, change the active
		// workspace, nor make hidden edit geometry visible again.
		await openPanel(earthly, 'Contexts')
		const inspectContext = earthly.page
			.getByRole('button', {
				name: `Inspect context ${inspectorContextName}`,
				exact: true,
			})
			.first()
		await expect(inspectContext).toBeVisible()
		await inspectContext.click()
		await expect(mobileWorkspaceTab(earthly, 'Inspect')).toHaveAttribute('aria-selected', 'true')
		const inspectorSheet = mobileWorkspaceSheet(earthly)
		await expect(
			inspectorSheet.getByText(inspectorContextName, { exact: true }).first(),
		).toBeVisible()
		await expect(
			inspectorSheet.getByText(inspectorContextDescription, { exact: true }).first(),
		).toBeVisible()
		await expect(inspectorSheet.getByPlaceholder('Roman ruins in Carinthia')).toHaveCount(0)
		await expect(
			inspectorSheet.getByRole('button', { name: 'Edit context', exact: true }),
		).toHaveCount(0)

		const inspectorRoute = await currentRouteIdentity()
		const taskInInspector = await editorLifecycleSnapshot(earthly)
		expect(taskInInspector.activeWorkspaceId).toBe(taskBeforeChat.activeWorkspaceId)
		expect(taskInInspector.activeDraftId).toBe(taskBeforeChat.activeDraftId)
		expect(taskInInspector.workspaceCount).toBe(taskBeforeChat.workspaceCount + 1)
		expect(taskInInspector.featureCount).toBe(1)
		expect(taskInInspector.mapStack).toEqual(taskInEdit.mapStack)

		await selectMobileEntitySurface(earthly, 'Dataset', datasetName)
		await expect.poll(currentRouteIdentity).toBe(inspectorRoute)
		await expect(mobileWorkspaceTab(earthly, 'Edit')).toHaveAttribute('aria-selected', 'true')
		await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(datasetName)
		const taskAfterInspectorToEditor = await editorLifecycleSnapshot(earthly)
		expect(taskAfterInspectorToEditor.activeWorkspaceId).toBe(taskInInspector.activeWorkspaceId)
		expect(taskAfterInspectorToEditor.activeDraftId).toBe(taskInInspector.activeDraftId)
		expect(taskAfterInspectorToEditor.workspaceCount).toBe(taskInInspector.workspaceCount)
		expect(taskAfterInspectorToEditor.featureCount).toBe(taskInInspector.featureCount)
		expect(taskAfterInspectorToEditor.mapStack).toEqual(taskInInspector.mapStack)

		await selectMobileEntitySurface(earthly, 'Inspect', inspectorContextName)
		await expect.poll(currentRouteIdentity).toBe(inspectorRoute)
		await expect(mobileWorkspaceTab(earthly, 'Inspect')).toHaveAttribute('aria-selected', 'true')
		await expect(
			inspectorSheet.getByText(inspectorContextName, { exact: true }).first(),
		).toBeVisible()
		const taskAfterEditorToInspector = await editorLifecycleSnapshot(earthly)
		expect(taskAfterEditorToInspector.activeWorkspaceId).toBe(taskInInspector.activeWorkspaceId)
		expect(taskAfterEditorToInspector.activeDraftId).toBe(taskInInspector.activeDraftId)
		expect(taskAfterEditorToInspector.workspaceCount).toBe(taskInInspector.workspaceCount)
		expect(taskAfterEditorToInspector.featureCount).toBe(taskInInspector.featureCount)
		expect(taskAfterEditorToInspector.mapStack).toEqual(taskInInspector.mapStack)

		await switchMobileWorkspacePanel(earthly, 'Chat')
		await expect.poll(currentRouteIdentity).toBe(inspectorRoute)
		expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
			chatId: chatBeforeRun.chatId,
			targetName: datasetName,
			targetRequired: false,
			userMessageCount: chatBeforeRun.userMessageCount + 1,
		})
		expect((await editorLifecycleSnapshot(earthly)).mapStack).toEqual(taskInInspector.mapStack)
		expect(provider.requests()).toHaveLength(1)

		provider.releaseCompletionResponses()
		await completeAiChatTurn(earthly, assistantMessagesBefore, {
			approvals: ['story-target'],
		})
		await expect(
			chatRegion.getByText(
				'I retained the background Story draft without changing your visible mobile workspace.',
				{ exact: true },
			),
		).toBeVisible()
		await expect(mobileWorkspaceTab(earthly, 'Chat')).toHaveAttribute('aria-selected', 'true')
		expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
			chatId: chatBeforeRun.chatId,
			targetName: datasetName,
			targetRequired: false,
		})

		// Background Story creation is retained but must not steal Chat or change
		// the Dataset editor selected for this task.
		await expect
			.poll(() =>
				earthly.page.evaluate(() =>
					Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).some(
						(key) =>
							key?.startsWith('earthly:story:drafts:v1:') &&
							localStorage.getItem(key)?.includes('Background mobile Story'),
					),
				),
			)
			.toBe(true)
		await selectMobileEntitySurface(earthly, 'Story', 'Background mobile Story')
		await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(
			'Background mobile Story',
		)
		await selectMobileEntitySurface(earthly, 'Dataset', datasetName)
		await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(datasetName)
		const followUpDraft = 'Keep this unsent follow-up while I compare the work surfaces.'
		await switchMobileWorkspacePanel(earthly, 'Chat')
		await composeAiChatMessage(earthly, followUpDraft)
		await switchMobileWorkspacePanel(earthly, 'Edit')
		await switchMobileWorkspacePanel(earthly, 'Stack')
		await switchMobileWorkspacePanel(earthly, 'Chat')
		expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
			chatId: chatBeforeRun.chatId,
			prompt: followUpDraft,
			targetName: datasetName,
			targetRequired: false,
		})
		expect(provider.requests()).toHaveLength(2)
		const finalTask = await editorLifecycleSnapshot(earthly)
		expect(finalTask.activeWorkspaceId).toBe(taskBeforeChat.activeWorkspaceId)
		expect(finalTask.workspaceCount).toBe(taskBeforeChat.workspaceCount + 1)
		expect(
			finalTask.workspaces.find((workspace) => workspace.id === taskBVisible.activeWorkspaceId)
				?.chatSessionId,
		).toBeNull()
		await expect(mobileWorkspaceSheet(earthly)).toBeVisible()
	} finally {
		provider.releaseCompletionResponses()
	}
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
