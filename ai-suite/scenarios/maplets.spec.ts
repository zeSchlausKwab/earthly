import { test, expect } from '../fixtures/earthly'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { openGMapper } from '../tasks/maplets/my-maps'

test('direct Maplets route opens the tool directory and GMapper on desktop and phone @regression', async ({
	earthly,
}, testInfo) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await expect(earthly.page.getByRole('tab', { name: 'Maplets', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await expect(
		earthly.page.getByRole('button', { name: 'Open GMapper', exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: /Live Mapper/ })).toHaveCount(0)
	await expect(earthly.page.getByText('Published collections', { exact: true })).toHaveCount(0)
	const frame = await openGMapper(earthly)
	await expect(
		frame.getByRole('tab', { name: 'Explore configurations', exact: true }),
	).toHaveAttribute('aria-selected', 'true')
	await expect(frame.getByRole('tab', { name: 'Yours', exact: true })).toBeVisible()
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.filter(
				(entry) => entry.entityType === 'maplet',
			),
		)
		.toEqual([])
	const bounds = await earthly.page.locator('iframe[title="GMapper sandbox"]').boundingBox()
	const viewport = earthly.page.viewportSize()!
	expect(bounds).not.toBeNull()
	expect(bounds!.x).toBeGreaterThanOrEqual(0)
	expect(bounds!.y).toBeGreaterThanOrEqual(0)
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
	expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
	await testInfo.attach(`gmapper-directory-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await earthly.page.getByRole('button', { name: 'Sign in', exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: 'Extension', exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Extension', exact: true }).click({ trial: true })
	await earthly.page.keyboard.press('Escape')
	await frame.getByRole('button', { name: '← Maplets', exact: true }).click()
	await expect(
		earthly.page.getByRole('button', { name: 'Open GMapper', exact: true }),
	).toBeVisible()
})
