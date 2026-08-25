import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	aiChatSurfaceSnapshot,
	attemptTargetRequiredAiChatSend,
	composeAiChatMessage,
	configureChatProvider,
	dispatchComposedAiChatMessage,
	openAiChat,
	selectAiChatTarget,
	startNewAiChat,
	switchAiChat,
	waitForAiChatCompletion,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

test('each Chat requires and retains its own explicit Dataset target @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The retained Dataset target rail is desktop-only')

	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'preserve' })
	await installDeterministicMapStyle(earthly)

	const datasetName = 'Dataset A — explicit Chat target'
	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill(datasetName)
	await expect(dataset.nameInput).toHaveValue(datasetName)
	const visibleDataset = await editorLifecycleSnapshot(earthly)
	expect(visibleDataset.activeWorkspaceId).not.toBeNull()
	expect(visibleDataset.activeDraftId).not.toBeNull()

	await openAiChat(earthly)
	const chatA = await startNewAiChat(earthly)
	const prompt = 'Keep this exact prompt while I choose its Dataset target.'

	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		prompt: '',
		sendEnabled: false,
		targetRequired: true,
		targetName: null,
		userMessageCount: 0,
	})
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(
		visibleDataset.activeWorkspaceId,
	)

	await composeAiChatMessage(earthly, prompt)
	await attemptTargetRequiredAiChatSend(earthly)
	expect(provider.requests()).toHaveLength(0)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		prompt,
		sendEnabled: false,
		targetRequired: true,
		targetName: null,
		userMessageCount: 0,
	})

	const selectedTarget = await selectAiChatTarget(earthly, 'current-dataset')
	expect(selectedTarget).toBe(datasetName)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		prompt,
		sendEnabled: true,
		targetRequired: false,
		targetName: datasetName,
		userMessageCount: 0,
	})

	const panel = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
	const assistantMessagesBefore = await panel.getByTitle('Copy assistant message').count()
	await dispatchComposedAiChatMessage(earthly)
	await waitForAiChatCompletion(earthly, assistantMessagesBefore)
	expect(provider.requests()).toHaveLength(1)
	await expect(
		panel.getByText('The explicitly selected Dataset target received this prompt.', {
			exact: true,
		}),
	).toBeVisible()

	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await installDeterministicMapStyle(earthly)
	await openAiChat(earthly)
	await expect
		.poll(async () => {
			const surface = await aiChatSurfaceSnapshot(earthly)
			return { chatId: surface.chatId, targetName: surface.targetName }
		})
		.toEqual({ chatId: chatA.newChatId, targetName: datasetName })
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		prompt: '',
		sendEnabled: false,
		targetRequired: false,
		targetName: datasetName,
		userMessageCount: 1,
	})

	const datasetBName = 'Dataset B — visible but not Chat A target'
	const datasetB = await startDataset(earthly)
	await datasetB.nameInput.fill(datasetBName)
	await expect(datasetB.nameInput).toHaveValue(datasetBName)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeWorkspaceId)
		.not.toBe(visibleDataset.activeWorkspaceId)
	const secondVisibleDataset = await editorLifecycleSnapshot(earthly)
	expect(secondVisibleDataset.activeWorkspaceId).not.toBeNull()
	expect(secondVisibleDataset.activeDraftId).not.toBe(visibleDataset.activeDraftId)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		targetRequired: false,
		targetName: datasetName,
	})

	const chatB = await startNewAiChat(earthly)
	expect(chatB.previousChatId).toBe(chatA.newChatId)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatB.newChatId,
		prompt: '',
		sendEnabled: false,
		targetRequired: true,
		targetName: null,
		userMessageCount: 0,
	})
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(
		secondVisibleDataset.activeWorkspaceId,
	)

	await switchAiChat(earthly, chatA.newChatId)
	await expect.poll(async () => (await aiChatSurfaceSnapshot(earthly)).targetName).toBe(datasetName)
	expect(await aiChatSurfaceSnapshot(earthly)).toMatchObject({
		chatId: chatA.newChatId,
		targetRequired: false,
		targetName: datasetName,
	})
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(
		secondVisibleDataset.activeWorkspaceId,
	)
	expect(provider.requests()).toHaveLength(1)
})
