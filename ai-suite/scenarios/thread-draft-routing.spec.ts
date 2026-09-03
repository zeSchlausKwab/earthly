import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	composeAiChatMessage,
	configureChatProvider,
	dispatchComposedAiChatMessage,
	openAiChat,
	waitForAiChatCompletion,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { switchMobileWorkspacePanel } from '../tasks/navigation/mobile-workspace'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'

function persistedThread(earthly: Parameters<typeof openAiChat>[0]) {
	return earthly.page.evaluate(() => {
		const stored = JSON.parse(localStorage.getItem('chat-store') ?? '{}') as {
			state?: {
				activeChatId?: string
				chatSessions?: Array<{
					id: string
					threadKey: string | null
					targetWorkspaceId: string | null
				}>
			}
		}
		const active = stored.state?.chatSessions?.find(
			(chat) => chat.id === stored.state?.activeChatId,
		)
		return active
			? { id: active.id, threadKey: active.threadKey, targetWorkspaceId: active.targetWorkspaceId }
			: null
	})
}

test('a local Map Thread binds only on send and survives closing and reload @regression', async ({
	earthly,
}) => {
	const renderErrors: string[] = []
	earthly.page.on('pageerror', (error) => renderErrors.push(error.message))
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('A Map with its own Thread')
	const before = await editorLifecycleSnapshot(earthly)
	await openAiChat(earthly)
	await expect(earthly.page).toHaveURL(/\/edit\?tab=thread$/)
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel.getByText('A Map with its own Thread', { exact: true })).toBeVisible()
	await expect
		.poll(() => persistedThread(earthly))
		.toMatchObject({
			threadKey: `map-draft:${before.activeWorkspaceId}`,
			targetWorkspaceId: null,
		})
	const thread = await persistedThread(earthly)
	await composeAiChatMessage(earthly, 'Keep this exact prompt for this Map.')
	await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
	expect(provider.requests()).toHaveLength(0)
	if (earthly.isMobile) {
		await switchMobileWorkspacePanel(earthly, 'Edit')
		await expect(earthly.page).toHaveURL(/\/edit$/)
		await expect(draft.nameInput).toHaveValue('A Map with its own Thread')
		await openAiChat(earthly)
		await expect(panel.locator('textarea')).toHaveValue('Keep this exact prompt for this Map.')
	}
	await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()
	await expect(panel).toBeHidden()
	await openAiChat(earthly)
	await expect(panel.locator('textarea')).toHaveValue('Keep this exact prompt for this Map.')
	expect(await persistedThread(earthly)).toEqual(thread)
	const assistantCount = await panel.getByTitle('Copy assistant message').count()
	await dispatchComposedAiChatMessage(earthly)
	await waitForAiChatCompletion(earthly, assistantCount)
	await expect
		.poll(() => persistedThread(earthly))
		.toMatchObject({
			id: thread?.id,
			targetWorkspaceId: before.activeWorkspaceId,
		})
	expect(provider.requests()).toHaveLength(1)
	expect((await editorLifecycleSnapshot(earthly)).workspaceCount).toBe(before.workspaceCount)

	await earthly.open({ path: '/edit?tab=thread', tour: 'preserve' })
	await openAiChat(earthly)
	await expect(panel.getByTitle('Copy user message')).toHaveCount(1)
	await expect
		.poll(() => persistedThread(earthly))
		.toMatchObject({
			id: thread?.id,
			threadKey: `map-draft:${before.activeWorkspaceId}`,
			targetWorkspaceId: before.activeWorkspaceId,
		})
	expect(
		renderErrors.filter((message) => /Maximum update depth|snapshot.*cached/.test(message)),
	).toEqual([])
})

test('different local Maps retain separate Threads and composer drafts @regression', async ({
	earthly,
}) => {
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	const first = await startDataset(earthly)
	await first.nameInput.fill('First Map Thread')
	await openAiChat(earthly)
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await composeAiChatMessage(earthly, 'A prompt only for the first Map')
	const firstThread = await persistedThread(earthly)
	await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()

	const second = await startDataset(earthly)
	await second.nameInput.fill('Second Map Thread')
	await openAiChat(earthly)
	await expect(panel.locator('textarea')).toHaveValue('')
	await expect(panel.getByText('Second Map Thread', { exact: true })).toBeVisible()
	const secondThread = await persistedThread(earthly)
	expect(secondThread?.id).not.toBe(firstThread?.id)
	expect(secondThread?.threadKey).not.toBe(firstThread?.threadKey)
	await composeAiChatMessage(earthly, 'A prompt only for the second Map')
	await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()

	await openPanel(earthly, 'Local drafts')
	const drafts = earthly.page.getByRole('region', { name: 'Local drafts', exact: true })
	const expand = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expand.isVisible()) await expand.click()
	await drafts.getByRole('button').filter({ hasText: 'First Map Thread' }).first().click()
	await openAiChat(earthly)
	await expect(panel.locator('textarea')).toHaveValue('A prompt only for the first Map')
	await expect(panel.getByText('First Map Thread', { exact: true })).toBeVisible()
	expect((await persistedThread(earthly))?.id).toBe(firstThread?.id)
	expect(provider.requests()).toHaveLength(0)
})
