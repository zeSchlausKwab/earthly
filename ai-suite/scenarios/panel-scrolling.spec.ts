import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { openPanel } from '../tasks/navigation/open-panel'

test('Profile sections remain reachable in a short desktop Margin @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop Margin scroll ownership')
	await earthly.page.setViewportSize({ width: 1100, height: 500 })
	await authorizeJourneyIdentity(earthly, 'owner')
	await openPanel(earthly, 'Me')
	const margin = earthly.page.getByRole('complementary', { name: 'Margin', exact: true })
	const tabs = margin.getByRole('tablist', { name: 'Profile sections', exact: true })
	await expect(tabs).toBeVisible()
	const box = await tabs.boundingBox()
	if (!box) throw new Error('Profile sections must have bounds')
	await earthly.page.mouse.move(40, 300)
	await earthly.page.mouse.wheel(0, Math.max(200, box.y - 250))
	await expect(tabs).toBeInViewport()
	await expect
		.poll(() =>
			tabs.evaluate((element) => {
				const bounds = element.getBoundingClientRect()
				return element.contains(
					document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
				)
			}),
		)
		.toBe(true)
})
