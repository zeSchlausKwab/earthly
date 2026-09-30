import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
	sendAiChatMessage,
	startNewAiChat,
	switchAiChat,
} from '../tasks/chat/conversation'
import { openChatView } from '../tasks/chat/navigation'
import { threadWorkSnapshot } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import { clickEditorMap } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('detail navigation and conversation switching retain message and attachments @regression', async ({
	earthly,
}, testInfo) => {
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await sendAiChatMessage(
		earthly,
		'Explain this map. ' + 'A long conversation should retain its scroll position. '.repeat(70),
	)
	await expect(panel.getByRole('status', { name: 'Chat progress', exact: true })).toHaveText(
		'Finished',
	)
	const transcript = panel.getByRole('region', { name: 'Conversation', exact: true })
	await transcript.evaluate((element) => {
		element.scrollTop = 0
	})
	await expect
		.poll(() => transcript.evaluate((element) => element.scrollHeight > element.clientHeight))
		.toBe(true)
	const original = await threadWorkSnapshot(earthly)
	const before = await editorLifecycleSnapshot(earthly)
	await panel.locator('textarea').fill('Keep my unsent map notes.')
	const attach = panel.getByRole('button', { name: 'Attach to message', exact: true })
	await attach.click()
	const choosing = earthly.page.waitForEvent('filechooser')
	await earthly.page.getByRole('menuitem', { name: 'File or image', exact: true }).click()
	await (await choosing).setFiles({
		name: 'places.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from('name,lat,lon\nVienna,48.2,16.37\n'),
	})
	await expect(panel.getByText('places.csv', { exact: true })).toBeVisible()
	await attach.click()
	await earthly.page.getByRole('menuitem', { name: 'Draw geometry', exact: true }).click()
	await panel.getByRole('button', { name: 'Draw point', exact: true }).click()
	if (earthly.isMobile) {
		await earthly.page.getByRole('slider', { name: 'Resize panel', exact: true }).press('Home')
		await expect
			.poll(
				async () => (await earthly.page.getByTestId('mobile-sheet').boundingBox())?.height ?? 1000,
			)
			.toBeLessThanOrEqual(100)
	}
	await clickEditorMap(earthly, 0.55, 0.4)
	await expect.poll(async () => (await editorLifecycleSnapshot(earthly)).featureCount).toBe(1)
	if (earthly.isMobile)
		await earthly.page.getByRole('slider', { name: 'Resize panel', exact: true }).press('End')
	await expect(panel.getByRole('button', { name: 'Attach', exact: true })).toBeEnabled()
	await panel.getByRole('button', { name: 'Attach', exact: true }).click()
	await expect(
		panel.getByRole('button', { name: 'Remove drawn attachment', exact: true }),
	).toContainText('1 drawn')
	await expect
		.poll(() => editorLifecycleSnapshot(earthly))
		.toMatchObject({
			activeWorkspaceId: before.activeWorkspaceId,
			featureCount: before.featureCount,
			interactionEnabled: before.interactionEnabled,
		})
	for (const view of ['edit', 'sources', 'settings', 'usage'] as const) {
		await openChatView(earthly, view)
		await expect(panel.locator('textarea')).toBeHidden()
	}
	await openChatView(earthly, 'chat')
	await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0)
	await expect(panel.locator('textarea')).toHaveValue('Keep my unsent map notes.')
	await expect(panel.getByText('places.csv', { exact: true })).toBeVisible()
	await expect(
		panel.getByRole('button', { name: 'Remove drawn attachment', exact: true }),
	).toBeVisible()
	const other = await startNewAiChat(earthly)
	await expect(panel.getByText('places.csv', { exact: true })).toHaveCount(0)
	await switchAiChat(earthly, original.id)
	await expect(panel.locator('textarea')).toHaveValue('Keep my unsent map notes.')
	await expect(panel.getByText('places.csv', { exact: true })).toBeVisible()
	await expect(
		panel.getByRole('button', { name: 'Remove drawn attachment', exact: true }),
	).toBeVisible()
	await switchAiChat(earthly, other.newChatId)
	await panel.getByRole('button', { name: 'Chat actions', exact: true }).click()
	await earthly.page.getByRole('menuitem', { name: 'Delete conversation…', exact: true }).click()
	const confirmation = earthly.page.getByRole('alertdialog')
	await expect(confirmation).toContainText('Your maps and stories are kept.')
	await confirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click()
	await expect.poll(async () => (await threadWorkSnapshot(earthly)).id).toBe(original.id)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(before.activeWorkspaceId)
	await panel.getByRole('button', { name: 'Remove drawn attachment', exact: true }).click()
	await expect(
		panel.getByRole('button', { name: 'Remove drawn attachment', exact: true }),
	).toHaveCount(0)
	await earthly.page.screenshot({ path: testInfo.outputPath('chat-attachments.png') })
	expect(provider.requests()).toHaveLength(1)
})

test('details keep active progress, approval review and Stop accessible @regression', async ({
	earthly,
}, testInfo) => {
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'metadata-then-geometry', {
		holdCompletionResponses: true,
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 1 })
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')
	await sendAiChatMessage(earthly, 'Change the map title, then add the requested geometry.')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const progress = panel.getByRole('status', { name: 'Chat progress', exact: true })
	await expect(progress).toHaveText('Waiting for model response')
	await openChatView(earthly, 'settings')
	await expect(panel.getByRole('combobox', { name: 'Chat connection', exact: true })).toBeDisabled()
	await expect(panel.getByRole('combobox', { name: 'AI edit safety', exact: true })).toBeDisabled()
	await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
	provider.releaseCompletionResponses()
	await expect(progress).toHaveText('Waiting for your approval')
	await panel.getByRole('button', { name: 'Review changes', exact: true }).click()
	await expect(panel.getByRole('button', { name: 'Apply', exact: true }).last()).toBeVisible()
	await openChatView(earthly, 'usage')
	await expect(progress).toHaveText('Waiting for your approval')
	await earthly.page.screenshot({ path: testInfo.outputPath('approval-in-details.png') })
	await panel.getByRole('button', { name: 'Stop', exact: true }).click()
	await expect(progress).toContainText('Stopped')
	await openChatView(earthly, 'chat')
	await expect(panel.locator('textarea')).toBeEnabled()
	await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0)
})
