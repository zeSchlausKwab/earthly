import { expect, test } from '../fixtures/earthly'
import { openPanel } from '../tasks/navigation/open-panel'

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
