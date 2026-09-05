import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19 } from 'nostr-tools'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	composeAiChatMessage,
	configureChatProvider,
	setAiThreadSettingsOpen,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import {
	mobileWorkspaceChromeSnapshot,
	mobileWorkspaceSheet,
	selectMobileEntitySurface,
	switchMobileWorkspacePanel,
} from '../tasks/navigation/mobile-workspace'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { waitForEditorReady } from '../tasks/social/dataset-proposals'
import { testIdentities } from '../test-identities'

/** Page-local signed data is restored on reload, never sent to a relay. */
async function installReloadableMap(earthly: EarthlySession) {
	const identifier = 'ai-suite-object-workspace'
	const title = 'Object workspace · Alpine meeting point'
	const event = finalizeEvent(
		{
			kind: 37515,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier],
				['bbox', '13.98,46.7,13.98,46.7'],
			],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: title,
				description: 'A signed in-memory Map for navigation and editing-intent checks.',
				features: [
					{
						type: 'Feature',
						id: 'gate',
						properties: { name: 'Meeting point' },
						geometry: { type: 'Point', coordinates: [13.98, 46.7] },
					},
				],
			}),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	await earthly.page.addInitScript((fixture) => {
		const auditWindow = window as unknown as {
			__earthlyEditorStore?: {
				getState(): Record<string, unknown>
				subscribe(listener: () => void): () => void
			}
			__aiSuiteRouteAudit?: unknown[]
		}
		auditWindow.__aiSuiteRouteAudit = []
		const watchWhenReady = () => {
			const editorStore = auditWindow.__earthlyEditorStore
			if (!editorStore) {
				requestAnimationFrame(watchWhenReady)
				return
			}
			let previous = ''
			const capture = () => {
				const state = editorStore.getState()
				const dataset = state.viewDataset as {
					id?: string
					name?: string
					event?: { id?: string }
				} | null
				const subject = state.inspectionSubject as { kind?: string } | null
				const activeDataset = state.activeDataset as { id?: string; event?: { id?: string } } | null
				const drafts = state.geoEditDrafts as Record<
					string,
					{ name?: string; features?: unknown[] }
				>
				const draft =
					typeof state.activeGeoEditDraftId === 'string' ? drafts[state.activeGeoEditDraftId] : null
				const entry = {
					url: location.href,
					viewDataset: dataset ? { id: dataset.id ?? dataset.event?.id, name: dataset.name } : null,
					inspectionSubject: subject?.kind ?? null,
					activeDataset: activeDataset?.id ?? activeDataset?.event?.id ?? null,
					featureCount: Array.isArray(state.features) ? state.features.length : null,
					collectionName: (state.collectionMeta as { name?: string } | null)?.name ?? null,
					draftName: draft?.name ?? null,
					draftFeatureCount: draft?.features?.length ?? null,
					...Object.fromEntries(
						[
							'viewMode',
							'stance',
							'sidebarViewMode',
							'mobileEntitySurface',
							'mobilePanelTab',
							'mobilePanelSnap',
							'focusedType',
							'focusedNaddr',
							'activeGeoEditDraftId',
							'activeWorkspaceId',
						].map((key) => [key, state[key]]),
					),
				}
				const serialized = JSON.stringify(entry)
				if (serialized === previous) return
				previous = serialized
				auditWindow.__aiSuiteRouteAudit?.push({ ms: performance.now(), ...entry })
				if ((auditWindow.__aiSuiteRouteAudit?.length ?? 0) > 100)
					auditWindow.__aiSuiteRouteAudit?.shift()
			}
			editorStore.subscribe(capture)
			capture()
		}
		watchWhenReady()
		const addWhenReady = () => {
			const store = (
				window as unknown as {
					__earthlyEventStore?: { add(event: typeof fixture): unknown }
				}
			).__earthlyEventStore
			if (store) {
				auditWindow.__aiSuiteRouteAudit?.push({ ms: performance.now(), fixtureAdded: fixture.id })
				store.add(fixture)
			} else requestAnimationFrame(addWhenReady)
		}
		addWhenReady()
	}, event)
	return {
		title,
		path: `/map/${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier })}`,
		address: `${event.kind}:${event.pubkey}:${identifier}`,
		eventId: event.id,
	}
}

test.afterEach(async ({ earthly }, testInfo) => {
	const audit = await earthly.page.evaluate(() => ({
		url: location.href,
		states: (window as unknown as { __aiSuiteRouteAudit?: unknown[] }).__aiSuiteRouteAudit ?? [],
	}))
	await testInfo.attach('route restoration audit', {
		body: JSON.stringify(audit, null, 2),
		contentType: 'application/json',
	})
})

function watchPublishedEvents(earthly: EarthlySession) {
	const published: unknown[] = []
	earthly.page.on('websocket', (socket) =>
		socket.on('framesent', ({ payload }) => {
			try {
				const frame = JSON.parse(typeof payload === 'string' ? payload : payload.toString())
				if (Array.isArray(frame) && frame[0] === 'EVENT') published.push(frame)
			} catch {
				/* Non-Nostr sockets are not publish attempts. */
			}
		}),
	)
	return published
}

function mapNameInput(earthly: EarthlySession) {
	return (earthly.isMobile ? mobileWorkspaceSheet(earthly) : earthly.page)
		.getByPlaceholder('Name', { exact: true })
		.first()
}

async function expandMapDetails(earthly: EarthlySession) {
	const name = mapNameInput(earthly)
	if (earthly.isMobile) {
		const details = earthly.page.getByRole('button', { name: 'Map details', exact: true })
		await expect(details.or(name).first()).toBeVisible()
		if (await details.isVisible()) await details.click()
	}
	await expect(name).toBeVisible()
}

async function draftIntent(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const state = (
			window as unknown as {
				__earthlyEditorStore?: {
					getState(): {
						activeGeoEditDraftId: string | null
						activeWorkspaceId: string | null
						geoEditDrafts: Record<
							string,
							{
								id: string
								sourceId: string
								authoringIntent?: string
								sourceDataset?: { address: string; eventId: string }
							}
						>
					}
				}
			}
		).__earthlyEditorStore?.getState()
		const draft = state?.activeGeoEditDraftId
			? state.geoEditDrafts[state.activeGeoEditDraftId]
			: null
		return draft ? { ...draft, workspaceId: state?.activeWorkspaceId } : null
	})
}

test('embedded Map Thread has one compact header and reachable settings at 320 and 390px @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Embedded object Thread is a phone composition')
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'mara')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	const fixture = await installReloadableMap(earthly)
	await earthly.open({ path: fixture.path, tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	const inspect = sheet.getByRole('region', { name: 'Map inspection', exact: true })
	await expect(inspect).toBeVisible()
	await switchMobileWorkspacePanel(earthly, 'Chat')
	const thread = inspect.getByRole('region', { name: 'AI Thread', exact: true })
	const controls = thread.getByRole('group', { name: 'Thread controls', exact: true })
	await sheet.getByRole('slider', { name: 'Resize panel', exact: true }).press('End')
	const viewport = earthly.page.viewportSize()
	if (!viewport) throw new Error('Phone viewport is unavailable')
	for (const width of [320, 390]) {
		await earthly.page.setViewportSize({ ...viewport, width })
		await expect(inspect.getByRole('heading', { name: fixture.title, exact: true })).toHaveCount(1)
		await expect(thread.getByText(fixture.title, { exact: true })).toHaveCount(0)
		await expect(controls).toBeInViewport({ ratio: 1 })
		const box = await controls.boundingBox()
		expect(box?.height).toBe(44)
		for (const name of ['AI edit safety: Auto apply', 'Thread settings', 'Export Thread']) {
			const button = controls.getByRole('button', { name, exact: true })
			await expect(button).toBeInViewport({ ratio: 1 })
			const control = await button.boundingBox()
			expect(control?.width).toBeGreaterThanOrEqual(44)
			expect(control?.height).toBeGreaterThanOrEqual(44)
			expect(control?.x).toBeGreaterThanOrEqual(0)
			expect((control?.x ?? width) + (control?.width ?? width)).toBeLessThanOrEqual(width)
		}
		await expect(thread.getByRole('combobox', { name: 'AI edit safety', exact: true })).toBeHidden()
		await expect(
			thread.getByRole('button', { name: 'Chat usage details', exact: true }),
		).toBeHidden()
		await setAiThreadSettingsOpen(earthly)
		const safety = thread.getByRole('combobox', { name: 'AI edit safety', exact: true })
		await safety.selectOption('1')
		await expect(
			controls.getByRole('button', { name: 'AI edit safety: Ask always', exact: true }),
		).toBeVisible()
		await safety.selectOption('3')
		const model = thread.getByRole('combobox', { name: 'Select chat model', exact: true })
		await model.scrollIntoViewIfNeeded()
		await expect(model).toBeInViewport({ ratio: 1 })
		await expect(model).toHaveValue(provider.settings.selectedModel)
		const providerSettings = thread.getByRole('button', {
			name: 'Open provider settings',
			exact: true,
		})
		await providerSettings.click({ trial: true })
		const snapshots = thread.getByRole('switch', { name: 'Allow AI map screenshots', exact: true })
		await snapshots.click()
		await expect(snapshots).not.toBeChecked()
		await snapshots.click()
		await expect(snapshots).toBeChecked()
		const usage = thread.getByRole('button', { name: 'Chat usage details', exact: true })
		await usage.click()
		await expect(usage).toHaveAttribute('aria-expanded', 'true')
		const lastMetric = thread.getByText('System prompt', { exact: true })
		await lastMetric.scrollIntoViewIfNeeded()
		await expect(lastMetric).toBeInViewport({ ratio: 1 })
		await usage.click()
		await setAiThreadSettingsOpen(earthly, false)
		await expect(thread.locator('textarea')).toBeInViewport({ ratio: 1 })
		const screenshot = testInfo.outputPath(`compact-embedded-thread-${width}.png`)
		await earthly.page.screenshot({ path: screenshot, animations: 'disabled' })
		await testInfo.attach(`Full embedded Thread at ${width}px`, {
			path: screenshot,
			contentType: 'image/png',
		})
	}
	expect(provider.requests()).toHaveLength(0)
})

test('mobile object Details and real Thread survive reload and resume the retained Map @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Compact object navigation is a phone contract')
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'mara')
	await configureChatProvider(earthly, provider.settings)
	const fixture = await installReloadableMap(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const draft = await startDataset(earthly)
	const draftName = 'Retained field-notes draft'
	await draft.nameInput.fill(draftName)
	await addPointToGeometryDraft(earthly, 0.6, 0.3)
	const retained = await editorLifecycleSnapshot(earthly)
	await openPanel(earthly, 'Maps')
	await earthly.page.getByRole('button', { name: `Open map ${fixture.title}`, exact: true }).click()
	const sheet = mobileWorkspaceSheet(earthly)
	const inspect = sheet.getByRole('region', { name: 'Map inspection', exact: true })
	const tabs = inspect.getByRole('tablist', { name: 'Object sections', exact: true })
	await expect(inspect).toBeVisible()
	await expect(tabs.getByRole('tab')).toHaveCount(3)
	await expect(sheet.getByRole('tablist', { name: 'Map panels', exact: true })).toHaveCount(0)
	await expect(sheet.getByRole('combobox', { name: 'Edit or inspect target' })).toHaveCount(0)
	const chrome = await mobileWorkspaceChromeSnapshot(earthly)
	expect(chrome.controls.height).toBeLessThanOrEqual(20)
	for (const button of [
		chrome.transparency,
		chrome.close,
		...(chrome.resume ? [chrome.resume] : []),
	]) {
		expect(button.width).toBeGreaterThanOrEqual(44)
		expect(button.height).toBeGreaterThanOrEqual(44)
	}
	for (const button of ['Resume saved work', 'Close inspection']) {
		await expect(inspect.getByRole('button', { name: button, exact: true })).toBeVisible()
	}
	await switchMobileWorkspacePanel(earthly, 'Chat')
	await expect(earthly.page).toHaveURL(
		(url) => url.pathname === fixture.path && url.searchParams.get('tab') === 'thread',
	)
	await expect(tabs.getByRole('tab', { name: 'Thread', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await expect(inspect.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
	await expect(inspect.getByRole('heading', { name: fixture.title, exact: true })).toHaveCount(1)
	await expect(
		inspect
			.getByRole('region', { name: 'AI Thread', exact: true })
			.getByText(fixture.title, { exact: true }),
	).toHaveCount(0)
	const prompt = 'Keep this local unsent question for the inspected Map.'
	await composeAiChatMessage(earthly, prompt)
	expect(provider.requests()).toHaveLength(0)
	await switchMobileWorkspacePanel(earthly, 'Inspect')
	await expect(tabs.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await switchMobileWorkspacePanel(earthly, 'Chat')
	await expect(
		inspect.getByRole('region', { name: 'AI Thread', exact: true }).locator('textarea'),
	).toHaveValue(prompt)
	const threadPath = testInfo.outputPath('compact-map-thread.png')
	await earthly.page.screenshot({ path: threadPath, animations: 'disabled' })
	await testInfo.attach('compact Map Thread', { path: threadPath, contentType: 'image/png' })
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(inspect.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
	expect(provider.requests()).toHaveLength(0)
	await expect(earthly.page).toHaveURL(
		(url) => url.pathname === fixture.path && url.searchParams.get('tab') === 'thread',
	)
	await switchMobileWorkspacePanel(earthly, 'Inspect')
	await expect(tabs.getByRole('tab', { name: 'Details', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await expect(earthly.page).toHaveURL(
		(url) => url.pathname === fixture.path && !url.searchParams.has('tab'),
	)
	await expect(inspect.getByRole('region', { name: 'AI Thread', exact: true })).toBeHidden()
	await expect(inspect.getByText('Meeting point', { exact: true })).toBeVisible()
	const inspectPath = testInfo.outputPath('compact-map-inspection.png')
	await earthly.page.screenshot({ path: inspectPath, animations: 'disabled' })
	await testInfo.attach('compact Map inspection', { path: inspectPath, contentType: 'image/png' })
	await selectMobileEntitySurface(earthly, 'Map', draftName)
	await expect(earthly.page).toHaveURL((url) => url.pathname === '/edit')
	await expect(draft.nameInput).toHaveValue(draftName)
	expect(await editorLifecycleSnapshot(earthly)).toMatchObject({
		activeWorkspaceId: retained.activeWorkspaceId,
		activeDraftId: retained.activeDraftId,
		featureCount: retained.featureCount,
	})
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expandMapDetails(earthly)
	await expect(draft.nameInput).toHaveValue(draftName)
	await expect
		.poll(() => editorLifecycleSnapshot(earthly))
		.toMatchObject({
			activeWorkspaceId: retained.activeWorkspaceId,
			activeDraftId: retained.activeDraftId,
			featureCount: retained.featureCount,
		})
	await openPanel(earthly, 'Shelf')
	await expect(earthly.page.getByRole('region', { name: 'Shelf', exact: true })).toBeVisible()
	await selectMobileEntitySurface(earthly, 'Map', draftName)
	await expect(draft.nameInput).toHaveValue(draftName)
	const path = testInfo.outputPath('compact-retained-map.png')
	await earthly.page.screenshot({ path, animations: 'disabled' })
	await testInfo.attach('compact retained Map', { path, contentType: 'image/png' })
})

test('foreign Map proposal and fork choices keep distinct local intent through reload without publishing @regression', async ({
	earthly,
}) => {
	const published = watchPublishedEvents(earthly)
	await authorizeJourneyIdentity(earthly, 'mara')
	const fixture = await installReloadableMap(earthly)
	await earthly.open({ path: fixture.path, tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await waitForEditorReady(earthly)
	const inspect = earthly.page.getByRole('region', { name: 'Map inspection', exact: true })
	await expect(inspect.getByRole('button', { name: 'Propose changes', exact: true })).toBeVisible()
	const before = published.length
	await inspect.getByRole('button', { name: 'Propose changes', exact: true }).click()
	await expandMapDetails(earthly)
	await expect
		.poll(() => draftIntent(earthly))
		.toMatchObject({
			authoringIntent: 'propose',
			sourceDataset: { address: fixture.address, eventId: fixture.eventId },
		})
	const proposal = await draftIntent(earthly)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).featureCount).toBe(1)
	await mapNameInput(earthly).fill('Proposed meeting point')
	await expect(
		earthly.page.getByRole('button', { name: 'Send proposal', exact: true }).first(),
	).toBeVisible()
	expect(published).toHaveLength(before)
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expandMapDetails(earthly)
	await expect
		.poll(() => draftIntent(earthly))
		.toMatchObject({
			id: proposal?.id,
			workspaceId: proposal?.workspaceId,
			authoringIntent: 'propose',
		})
	await expect(mapNameInput(earthly)).toHaveValue('Proposed meeting point')
	await expect(
		earthly.page.getByRole('button', { name: 'Send proposal', exact: true }).first(),
	).toBeVisible()
	expect(published).toHaveLength(before)

	await earthly.open({ path: fixture.path, tour: 'preserve' })
	await waitForEditorReady(earthly)
	await inspect.getByRole('button', { name: 'Other ways to edit', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Fork map', exact: true }).click()
	await expandMapDetails(earthly)
	await expect
		.poll(() => draftIntent(earthly))
		.toMatchObject({
			authoringIntent: 'fork',
			sourceDataset: { address: fixture.address, eventId: fixture.eventId },
		})
	const fork = await draftIntent(earthly)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).featureCount).toBe(1)
	expect(fork?.id).not.toBe(proposal?.id)
	expect(fork?.workspaceId).not.toBe(proposal?.workspaceId)
	expect(fork?.sourceId).not.toBe(proposal?.sourceId)
	await mapNameInput(earthly).fill('My independent meeting point')
	await expect(
		earthly.page.getByRole('button', { name: 'Publish map', exact: true }).first(),
	).toBeVisible()
	expect(published).toHaveLength(before)
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expandMapDetails(earthly)
	await expect
		.poll(() => draftIntent(earthly))
		.toMatchObject({
			id: fork?.id,
			workspaceId: fork?.workspaceId,
			authoringIntent: 'fork',
		})
	await expect(mapNameInput(earthly)).toHaveValue('My independent meeting point')
	await expect(
		earthly.page.getByRole('button', { name: 'Publish map', exact: true }).first(),
	).toBeVisible()
	await expect(
		earthly.page.getByRole('button', { name: 'Send proposal', exact: true }),
	).toHaveCount(0)
	expect(published).toHaveLength(before)
	// Restoring a separate fork must not overwrite the original proposal copy.
	await earthly.open({ path: fixture.path, tour: 'preserve' })
	await waitForEditorReady(earthly)
	await inspect.getByRole('button', { name: 'Propose changes', exact: true }).click()
	await expandMapDetails(earthly)
	await expect
		.poll(() => draftIntent(earthly))
		.toMatchObject({
			id: proposal?.id,
			workspaceId: proposal?.workspaceId,
			authoringIntent: 'propose',
		})
	await expect(mapNameInput(earthly)).toHaveValue('Proposed meeting point')
	expect(published).toHaveLength(before)
})
