import { test, expect } from '../fixtures/earthly'
import { expectGeometryFeatureCount, publishCurrentGeometryDataset } from '../tasks/create/geometry'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('Maplet import preview renders and copies selected geometry to an independent draft @regression', async ({
	earthly,
}, testInfo) => {
	const published = await installIsolatedRelays(earthly)
	if (!earthly.isMobile) await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const panel = earthly.page.getByRole('tabpanel', { name: 'Maplets', exact: true })
	await panel.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Live Mapper workspace', exact: true })
	await expect(dialog).toBeVisible()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Explore a JSON file', exact: true }).click()
	await frame.getByRole('button', { name: 'Try example data', exact: true }).click()
	await expect(frame.getByLabel('Geographic data', { exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '10 geometries', exact: true })).toBeVisible()
	await testInfo.attach(`maplet-import-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	await expect(dialog).toBeHidden()
	const maplet = panel.getByRole('article', { name: 'Live Mapper Maplet', exact: true })
	await expect(maplet.getByRole('status')).toContainText('10 geometries')
	await maplet.getByRole('button', { name: 'Hide Live Mapper on map', exact: true }).click()
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.find(
					(entry) => entry.entityType === 'maplet',
				)?.visible,
		)
		.toBe(false)
	await maplet.getByRole('button', { name: 'Show Live Mapper on map', exact: true }).click()
	await maplet
		.getByRole('checkbox', { name: /^Select / })
		.nth(1)
		.check()
	await maplet.getByRole('button', { name: 'Copy 1 selected to editor', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.not.toBeNull()
	expect([...published.values()].includes(37515)).toBe(false)
	if (!earthly.isMobile) {
		await publishCurrentGeometryDataset(earthly)
		await expect.poll(() => [...published.values()].includes(37515)).toBe(true)
	}
})

test('direct Maplets route opens its catalog on desktop and phone @regression', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await expect(earthly.page.getByRole('tab', { name: 'Maplets', exact: true })).toHaveAttribute(
		'aria-selected',
		'true',
	)
	await expect(
		earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }),
	).toBeVisible()
})

test('failed connector leaves the previous Maplet preview available @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop connector failure boundary')
	await installIsolatedRelays(earthly)
	let requests = 0
	await earthly.page.route('**/api/maplets/liveuamap-yemen', async (route) => {
		requests++
		await route.fulfill({
			status: 502,
			contentType: 'application/json',
			body: JSON.stringify({
				error: { code: 'source_challenge', message: 'Liveuamap requires a browser verification.' },
			}),
		})
	})
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Explore a JSON file', exact: true }).click()
	await frame.getByRole('button', { name: 'Try example data', exact: true }).click()
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '10 geometries', exact: true })).toBeVisible()
	await frame.getByText('Input: Captured example.json', { exact: true }).click()
	await frame.getByRole('button', { name: 'Try available connector', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText('browser verification')
	expect(requests).toBe(1)
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	await expect(
		earthly.page
			.getByRole('article', { name: 'Live Mapper Maplet', exact: true })
			.getByRole('status'),
	).toContainText('10 geometries')
})
