import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	openAiChat,
	setAiThreadSettingsOpen,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { switchMobileWorkspacePanel } from '../tasks/navigation/mobile-workspace'
import {
	DETERMINISTIC_CHAT_BASE_URL,
	DETERMINISTIC_CHAT_MODEL_ID,
	DETERMINISTIC_CHAT_SECONDARY_MODEL_ID,
	installDeterministicChatProvider,
} from '../tasks/setup/deterministic-chat-provider'

test('chat keeps advanced status compact and lets the model change in place', async ({
	earthly,
}, testInfo) => {
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 2 })

	const toaster = earthly.page.locator('[data-sonner-toaster]')
	await expect(toaster).toHaveAttribute(
		'data-y-position',
		testInfo.project.name === 'mobile' ? 'top' : 'bottom',
	)
	await expect(toaster).toHaveAttribute('data-x-position', 'center')

	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await openAiChat(earthly)

	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const settings = panel.getByRole('button', { name: 'Thread settings', exact: true })
	const usage = panel.getByRole('button', { name: 'Chat usage details', exact: true })

	await expect(settings).toHaveAttribute('aria-expanded', 'false')
	await expect(usage).toBeHidden()
	await expect(panel.getByLabel('Select chat model', { exact: true })).toBeHidden()
	await expect(
		panel.getByRole('button', { name: 'AI edit safety: Ask first', exact: true }),
	).toBeVisible()
	await setAiThreadSettingsOpen(earthly)
	await expect(usage).toHaveAttribute('aria-expanded', 'false')
	await expect(usage).toContainText('Usage 16.4k')
	await expect(usage).toContainText('0 requests')
	const safety = panel.getByRole('combobox', { name: 'AI edit safety', exact: true })
	await expect(safety).toHaveValue('2')
	await safety.selectOption('1')
	await expect(safety).toHaveValue('1')
	await safety.selectOption('3')
	await expect(safety).toHaveValue('3')
	await setAiThreadSettingsOpen(earthly, false)
	await expect(
		panel.getByRole('button', { name: 'AI edit safety: Auto apply', exact: true }),
	).toBeVisible()

	await setAiThreadSettingsOpen(earthly)
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
	await expect(settings).toHaveAttribute('title', /Earthly compact fixture/)
	await expect(panel.locator('#chat-provider-select')).toHaveCount(0)

	await usage.click()
	await expect(usage).toHaveAttribute('aria-expanded', 'true')
	await expect(panel.getByText('Prompt capacity', { exact: true })).toBeVisible()
	await expect(panel.getByText('Prompt budget', { exact: true })).toBeVisible()
	await expect(panel.getByText('Model requests', { exact: true })).toBeVisible()
	await expect(panel.getByText('Tool work', { exact: true })).toBeVisible()
})

test('mobile compact Thread keeps model failure recovery in view at 320 and 390px @regression', async ({
	earthly,
}) => {
	test.skip(!earthly.isMobile, 'Phone header recovery contract')
	const provider = await installDeterministicChatProvider(earthly)
	let modelsAvailable = false
	await earthly.page.route(`${DETERMINISTIC_CHAT_BASE_URL}/models`, async (route) => {
		if (modelsAvailable || route.request().method() === 'OPTIONS') return route.fallback()
		await route.fulfill({
			status: 200,
			headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
			json: { data: [] },
		})
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await switchMobileWorkspacePanel(earthly, 'Chat')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const warning = panel
		.getByRole('alert')
		.filter({ hasText: 'No models available from this provider.' })
	const retry = warning.getByRole('button', { name: 'Retry', exact: true })
	await expect(warning).toBeVisible()
	const viewport = earthly.page.viewportSize()
	if (!viewport) throw new Error('Phone viewport is unavailable')
	for (const width of [320, 390]) {
		await earthly.page.setViewportSize({ ...viewport, width })
		await expect(retry).toBeInViewport()
		const box = await retry.boundingBox()
		expect(box?.width).toBeGreaterThanOrEqual(44)
		expect(box?.height).toBeGreaterThanOrEqual(44)
		const warningBox = await warning.boundingBox()
		expect(warningBox?.x).toBeGreaterThanOrEqual(0)
		expect((warningBox?.x ?? width) + (warningBox?.width ?? width)).toBeLessThanOrEqual(width)
		await setAiThreadSettingsOpen(earthly)
		await expect(
			panel.getByRole('button', { name: 'Open provider settings', exact: true }),
		).toBeInViewport()
		await setAiThreadSettingsOpen(earthly, false)
	}
	modelsAvailable = true
	await retry.click()
	await expect(warning).toBeHidden()
	await setAiThreadSettingsOpen(earthly)
	await expect(panel.getByRole('combobox', { name: 'Select chat model', exact: true })).toHaveValue(
		DETERMINISTIC_CHAT_MODEL_ID,
	)
	await setAiThreadSettingsOpen(earthly, false)
	await expect(panel.getByRole('button', { name: 'Thread settings', exact: true })).toHaveAttribute(
		'aria-expanded',
		'false',
	)
	expect(provider.requests()).toHaveLength(0)
})

test('reopening a routed Thread keeps one composer action set @regression', async ({ earthly }) => {
	const duplicateKeyWarnings: string[] = []
	earthly.page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('same key')) {
			duplicateKeyWarnings.push(message.text())
		}
	})
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await openAiChat(earthly)

	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const drawAction = panel.getByRole('button', { name: 'Draw', exact: true })
	await expect(drawAction).toHaveCount(1)

	for (let index = 0; index < 3; index += 1) {
		await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()
		await expect(panel).toBeHidden()
		await openAiChat(earthly)
	}

	await expect(drawAction).toHaveCount(1)
	expect(duplicateKeyWarnings).toEqual([])
})
