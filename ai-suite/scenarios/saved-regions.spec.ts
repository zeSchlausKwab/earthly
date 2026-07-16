import { expect, test } from '../fixtures/earthly'
import { openPanel } from '../tasks/navigation/open-panel'

test('browser identifies saved map regions as an Android capability', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Offline', exact: true }).click()

	const section = earthly.page.getByRole('heading', { name: 'Saved map regions' }).locator('..')
	await expect(section).toContainText('Earthly Android app')
	await expect(earthly.page.getByRole('button', { name: 'Save & download' })).toHaveCount(0)
})
