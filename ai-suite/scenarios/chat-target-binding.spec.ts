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
import { setThreadWorkingSetOpen, threadWorkSnapshot } from '../tasks/chat/working-set'
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
	test.skip(testInfo.project.name !== 'desktop', 'Desktop map and Thread restoration regression')
	await installIsolatedRelays(earthly)
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
})

test('read-only Threads can ask; references and navigation never grant Map writes @regression', async ({
	earthly,
}, testInfo) => {
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
	let working = await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: 'Reference viewed object', exact: true }).click()
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		id: chatA.newChatId,
		outputs: [],
		referenceCount: 1,
		allowCreate: false,
	})
	await setThreadWorkingSetOpen(earthly, false)
	await sendAiChatMessage(earthly, 'Explain the Map reference without editing it.')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
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
	working = await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Drawing into: Map B', { exact: true })).toBeVisible()
	await working.getByRole('button', { name: 'Remove reference Map A', exact: true }).click()
	expect(await threadWorkSnapshot(earthly)).toMatchObject({
		referenceCount: 0,
		outputs: [{ title: 'Map A' }],
	})
	expect(provider.requests()).toHaveLength(1)
})
