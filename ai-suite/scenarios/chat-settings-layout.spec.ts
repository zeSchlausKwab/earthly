import { expect, test } from '../fixtures/earthly'
import { openPanel } from '../tasks/navigation/open-panel'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'

test('Chat settings import stays reachable by scrolling after a long paste @regression', async ({
	earthly,
}) => {
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat', exact: true })
	const input = panel.getByPlaceholder('{ "provider": "lmstudio", ... }')
	await input.fill(JSON.stringify(provider.settings, null, 4))
	await expect
		.poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
		.toBeLessThanOrEqual(192)
	// Filling focuses the input, as pasting would. Only ordinary wheel scrolling
	// may reveal Import; locator.click() must not secretly scroll clipped ancestors.
	await earthly.page.mouse.move(earthly.isMobile ? 20 : 40, 400)
	await earthly.page.mouse.wheel(0, 10000)
	const importButton = panel.getByRole('button', { name: 'Import settings', exact: true })
	await expect(importButton).toBeInViewport()
	await expect
		.poll(() =>
			importButton.evaluate((element) => {
				const box = element.getBoundingClientRect()
				return element.contains(
					document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
				)
			}),
		)
		.toBe(true)
	await importButton.click()
	await expect(earthly.page.getByText('Settings imported', { exact: true })).toBeVisible()
	await earthly.page.mouse.wheel(0, -10000)
	await expect(panel.locator('#chat-provider-select')).toBeInViewport()
	expect(provider.requests()).toHaveLength(0)
})

test('Chat settings stay inside the desktop sidebar @regression', async ({ earthly }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The reported overflow is desktop-specific')
	await earthly.page.setViewportSize({ width: 768, height: 1024 })
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')

	await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat', exact: true })
	await expect(panel).toBeVisible()
	await panel.locator('#chat-provider-select').selectOption('custom')
	await expect(panel.getByRole('button', { name: 'Connect custom endpoint' })).toBeVisible()

	const toolsToggle = panel.getByRole('button', { name: /^Geo and web tools/ })
	await expect(toolsToggle).toBeVisible()
	const layout = await toolsToggle.evaluate((element) => {
		const description = element.querySelector('p')
		const buttonRect = element.getBoundingClientRect()
		const descriptionRect = description?.getBoundingClientRect()
		return {
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			descriptionRight: descriptionRect?.right ?? Number.POSITIVE_INFINITY,
			buttonRight: buttonRect.right,
		}
	})

	expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
	expect(layout.descriptionRight).toBeLessThanOrEqual(layout.buttonRight + 1)
	expect(await panel.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
		(await panel.evaluate((element) => element.clientWidth)) + 1,
	)
})
