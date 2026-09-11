import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	composeAiChatMessage,
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
} from '../tasks/chat/conversation'
import { threadWorkSnapshot } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('draft Hide and Remove affect geometry, not saved work or chat @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	if (!earthly.isMobile) await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	const title = 'Recoverable hidden map'
	await draft.nameInput.fill(title)
	await addPointToGeometryDraft(earthly)
	const before = await editorLifecycleSnapshot(earthly)
	const sourceFeatureCount = () =>
		earthly.page.evaluate(async () => {
			const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
			const source = map.getSource('geo-editor') as GeoJSONSource | undefined
			if (!source) return -1
			const data = await source.getData()
			return data.type === 'FeatureCollection' ? data.features.length : -1
		})
	await expect.poll(sourceFeatureCount).toBe(1)
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	if (!earthly.isMobile) {
		await openAiChat(earthly)
		await selectAiChatTarget(earthly, 'current-dataset')
		await composeAiChatMessage(earthly, 'Keep this conversation and unsent message.')
	} else {
		await openPanel(earthly, 'Shelf')
	}
	const thread = earthly.isMobile ? null : await threadWorkSnapshot(earthly)
	const controls = earthly.isMobile
		? earthly.page.getByRole('region', { name: 'On the map', exact: true })
		: earthly.page.getByRole('list', { name: 'Maps on the canvas', exact: true })
	await controls.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
	await expect.poll(sourceFeatureCount).toBe(0)
	await expectGeometryFeatureCount(earthly, 1)
	await expect(controls.getByRole('button', { name: `Show ${title}`, exact: true })).toBeVisible()
	await earthly.page.screenshot({ path: testInfo.outputPath('draft-hidden.png') })
	if (earthly.isMobile) {
		// Isolate temporarily overrides a hidden layer; Eye must still offer Hide.
		await controls.getByRole('button', { name: 'Isolate on the map', exact: true }).click()
		await expect.poll(sourceFeatureCount).toBe(1)
		await controls.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
		await expect.poll(sourceFeatureCount).toBe(0)
	}
	await controls.getByRole('button', { name: `Show ${title}`, exact: true }).click()
	await expect.poll(sourceFeatureCount).toBe(1)
	await controls
		.getByRole('button', {
			name: earthly.isMobile ? 'Remove from map' : `Remove ${title} from the map`,
			exact: true,
		})
		.click()
	await expect.poll(sourceFeatureCount).toBe(0)
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.some(
				(entry) => entry.id === 'draft:active',
			),
		)
		.toBe(false)
	await expectGeometryFeatureCount(earthly, 1)
	if (!earthly.isMobile) {
		await expect(panel).toBeVisible()
		await expect(panel.locator('textarea')).toHaveValue(
			'Keep this conversation and unsent message.',
		)
		expect(await threadWorkSnapshot(earthly)).toEqual(thread)
		// Metadata writes must not silently put a removed draft back on the map.
		await draft.nameInput.fill(`${title} renamed`)
		await expect.poll(sourceFeatureCount).toBe(0)
	}
	await earthly.page.screenshot({ path: testInfo.outputPath('draft-removed.png') })
	await openPanel(earthly, 'Local drafts')
	const inventory = earthly.page.getByRole('region', { name: 'Local drafts', exact: true })
	const savedDraft = inventory.getByRole('button', {
		name: new RegExp(`^${earthly.isMobile ? title : `${title} renamed`}\\s`),
	})
	await expect(savedDraft).toBeVisible()
	await savedDraft.click()
	await expect.poll(sourceFeatureCount).toBe(1)
	await expectGeometryFeatureCount(earthly, 1)
	const restored = await editorLifecycleSnapshot(earthly)
	expect(restored.activeDraftId).toBe(before.activeDraftId)
	expect(restored.activeWorkspaceId).toBe(before.activeWorkspaceId)
	expect(restored.workspaceCount).toBe(before.workspaceCount)
	if (!earthly.isMobile) {
		await expect(panel).toBeVisible()
		await expect(panel.locator('textarea')).toHaveValue(
			'Keep this conversation and unsent message.',
		)
		expect((await threadWorkSnapshot(earthly)).id).toBe(thread?.id)
	}
})
