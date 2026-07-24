import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, openAiChat } from '../tasks/chat/conversation'
import {
	DETERMINISTIC_CHAT_MODEL_ID,
	DETERMINISTIC_CHAT_SECONDARY_MODEL_ID,
	installDeterministicChatProvider,
} from '../tasks/setup/deterministic-chat-provider'

test('chat keeps advanced status compact and lets the model change in place', async ({
	earthly,
}, testInfo) => {
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)

	const toaster = earthly.page.locator('[data-sonner-toaster]')
	await expect(toaster).toHaveAttribute(
		'data-y-position',
		testInfo.project.name === 'mobile' ? 'top' : 'bottom',
	)
	await expect(toaster).toHaveAttribute('data-x-position', 'center')

	await earthly.open({ tour: 'seen' })
	await openAiChat(earthly)

	const panel = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
	const connection = panel.getByRole('button', { name: 'AI connection details', exact: true })
	const usage = panel.getByRole('button', { name: 'Chat usage details', exact: true })

	await expect(connection).toHaveAttribute('aria-expanded', 'false')
	await expect(usage).toHaveAttribute('aria-expanded', 'false')
	await expect(panel.getByLabel('Select chat model', { exact: true })).toBeHidden()
	await expect(usage).toContainText('Context 16.4k')
	await expect(usage).toContainText('0 requests')

	await connection.click()
	await expect(connection).toHaveAttribute('aria-expanded', 'true')
	await expect(panel.getByText('Custom endpoint', { exact: true })).toBeVisible()
	await expect(panel.getByText('Local · free', { exact: true })).toBeVisible()
	await expect(panel.getByText('Tools enabled', { exact: true })).toBeVisible()
	await expect(
		panel.getByText('Provider and credentials stay in Settings', { exact: true }),
	).toBeVisible()

	const modelSelect = panel.getByLabel('Select chat model', { exact: true })
	await expect(modelSelect).toHaveValue(DETERMINISTIC_CHAT_MODEL_ID)
	await modelSelect.selectOption(DETERMINISTIC_CHAT_SECONDARY_MODEL_ID)
	await expect(modelSelect).toHaveValue(DETERMINISTIC_CHAT_SECONDARY_MODEL_ID)
	await expect(connection).toContainText('Earthly compact fixture')
	await expect(panel.locator('#chat-provider-select')).toHaveCount(0)

	await usage.click()
	await expect(usage).toHaveAttribute('aria-expanded', 'true')
	await expect(panel.getByText('Context window', { exact: true })).toBeVisible()
	await expect(panel.getByText('Prompt budget', { exact: true })).toBeVisible()
	await expect(panel.getByText('Model requests', { exact: true })).toBeVisible()
	await expect(panel.getByText('Tool work', { exact: true })).toBeVisible()
})
