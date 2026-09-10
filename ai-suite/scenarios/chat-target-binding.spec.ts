import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	aiChatSurfaceSnapshot,
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
	sendAiChatMessage,
	startNewAiChat,
	switchAiChat,
} from '../tasks/chat/conversation'
import { localMapOutputCounts, setThreadWorkingSetOpen, threadWorkSnapshot } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import { clickEditorMap, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

function materializedDraftFeatureCount(earthly: Parameters<typeof editorLifecycleSnapshot>[0]) {
	return earthly.page.evaluate(() => {
		const map = (
			window as unknown as { __earthlyUiMap?: { querySourceFeatures(id: string): unknown[] } }
		).__earthlyUiMap
		if (!map) return -1
		try {
			return map.querySourceFeatures('geo-editor').length
		} catch {
			return -1
		}
	})
}

test('opening a working-set Map restores its visible draft @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	test.skip(testInfo.project.name !== 'desktop', 'Desktop map and Thread restoration regression')
	const publishedEvents = await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open()
	await installDeterministicMapStyle(earthly)
	const datasetName = 'Map edit that must stay on the map'
	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill(datasetName)
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.43)
	await expectGeometryFeatureCount(earthly, 1)
	await expect.poll(() => materializedDraftFeatureCount(earthly)).toBeGreaterThan(0)
	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')
	const originalThread = await threadWorkSnapshot(earthly)
	const bound = await editorLifecycleSnapshot(earthly)
	// Reproduce a dormant target whose presentation was removed. Opening it must
	// restore editor and presentation together, not merely change a store pointer.
	await earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): { removeMapStackEntry(id: string): void }
					setState(state: { viewMode: 'view'; stance: 'focus' }): void
				}
			}
		).__earthlyEditorStore
		if (!store) throw new Error('Earthly editor debug store is unavailable')
		store.setState({ viewMode: 'view', stance: 'focus' })
		store.getState().removeMapStackEntry('draft:active')
	})
	await expect.poll(() => materializedDraftFeatureCount(earthly)).toBe(0)
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: datasetName, exact: true }).click()
	await expect(earthly.page.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.find(
					(entry) => entry.id === 'draft:active',
				)?.visible ?? false,
		)
		.toBe(true)
	await expect.poll(() => materializedDraftFeatureCount(earthly)).toBeGreaterThan(0)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(bound.activeWorkspaceId)
	expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: `Review & publish: ${datasetName}`, exact: true }).click()
	await expect(earthly.page.getByRole('menuitem', { name: 'Publish new Map', exact: true })).toBeVisible()
	expect([...publishedEvents.values()].filter(kind => kind === 37515)).toHaveLength(0)
	await earthly.page.keyboard.press('Escape')
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: `View on map: ${datasetName}`, exact: true }).click()
	await expect(earthly.page.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Move chat left', exact: true }).click()
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: datasetName, exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: 'Move chat left', exact: true })).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
	await setThreadWorkingSetOpen(earthly)
	await earthly.page.screenshot({ path: testInfo.outputPath('draft-actions.png') })
	await working.getByRole('button', { name: `Discard draft: ${datasetName}`, exact: true }).click()
	const discard = earthly.page.getByRole('alertdialog')
	await expect(discard).toContainText('Published content is kept')
	await discard.getByRole('button', { name: 'Keep draft', exact: true }).click()
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(1)
	await working.getByRole('button', { name: `Stop AI editing ${datasetName}`, exact: true }).click()
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(0)
	expect(await localMapOutputCounts(earthly)).toContainEqual({ title: datasetName, features: 1 })
	await working.getByRole('button', { name: 'Edit this map with AI', exact: true }).click()
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: `Discard draft: ${datasetName}`, exact: true }).click()
	await discard.getByRole('button', { name: 'Discard draft', exact: true }).click()
	await expect(discard).toBeHidden()
	await expect.poll(() => threadWorkSnapshot(earthly)).toMatchObject({ id: originalThread.id, outputs: [] })
	await expect.poll(() => localMapOutputCounts(earthly)).not.toContainEqual({ title: datasetName, features: 1 })
	await expect(earthly.page.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
})

test('read-only Threads can ask; references and navigation never grant Map writes @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	test.skip(testInfo.project.name !== 'desktop', 'Desktop reference and navigation regression')
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open()
	await installDeterministicMapStyle(earthly)
	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill('Map A')
	const visible = await editorLifecycleSnapshot(earthly)
	await openAiChat(earthly)
	const chatA = await startNewAiChat(earthly)
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel.getByRole('button', { name: 'References', exact: true })).toHaveCount(1)
	await expect(panel).not.toContainText('working copy')
	await panel.getByRole('button', { name: 'References', exact: true }).click()
	await earthly.page
		.getByRole('dialog', { name: 'Add references', exact: true })
		.getByRole('button', { name: 'Map A Currently open · draft', exact: true })
		.click()
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		id: chatA.newChatId,
		outputs: [],
		referenceCount: 1,
		allowCreate: false,
	})
	await sendAiChatMessage(earthly, 'Explain the Map reference without editing it.')
	await expect(
		panel.getByText('The work Thread received this prompt.', { exact: true }),
	).toBeVisible()
	expect(provider.requests()).toHaveLength(1)
	expect(provider.requests()[0]?.toolNames).toContain('read_thread_reference')
	expect(provider.requests()[0]?.toolNames).not.toContain('run_code')
	expect(provider.requests()[0]?.toolNames).not.toContain('write_story_draft')
	expect((await threadWorkSnapshot(earthly)).outputs).toEqual([])
	await selectAiChatTarget(earthly, 'current-dataset')
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await installDeterministicMapStyle(earthly)
	await openAiChat(earthly)
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		id: chatA.newChatId,
		referenceCount: 1,
		outputs: [{ title: 'Map A', kind: 'dataset' }],
	})
	const datasetB = await startDataset(earthly)
	await datasetB.nameInput.fill('Map B')
	await openAiChat(earthly)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).not.toBe(
		visible.activeWorkspaceId,
	)
	expect((await threadWorkSnapshot(earthly)).outputs.map((item) => item.title)).toEqual(['Map A'])
	const chatB = await startNewAiChat(earthly)
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		id: chatB.newChatId,
		outputs: [],
		referenceCount: 0,
	})
	await switchAiChat(earthly, chatA.newChatId)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		targetName: 'Map A',
		targetRequired: false,
	})
	await panel.getByRole('button', { name: 'Remove Map A', exact: true }).click()
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		referenceCount: 0,
		outputs: [{ title: 'Map A' }],
	})
	expect(provider.requests()).toHaveLength(1)
})
