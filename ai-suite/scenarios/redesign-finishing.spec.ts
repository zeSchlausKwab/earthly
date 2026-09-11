import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19 } from 'nostr-tools'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { openPanel } from '../tasks/navigation/open-panel'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { testIdentities } from '../test-identities'

test('first visit invites exploration without a blocking directory dialog', async ({ earthly }) => {
	await earthly.open({ tour: 'new', discover: 'new' })
	await installDeterministicMapStyle(earthly)
	const welcome = earthly.page.getByRole('region', { name: 'Welcome to Earthly' })
	await expect(welcome).toBeVisible()
	await expect(earthly.page.getByRole('dialog')).toHaveCount(0)
	await welcome.getByRole('button', { name: 'Browse', exact: true }).click()
	await expect(welcome).toBeHidden()
	await expect(earthly.page.getByRole('tablist', { name: 'Browse', exact: true })).toBeVisible()
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(welcome).toBeHidden()
})

test('Atlas Inspect, Zoom and Enter have distinct effects and named references', async ({ earthly }) => {
	const page = earthly.page
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const map = await installInMemoryMapFixture(earthly, { title: 'Named Atlas reference' })
	const identifier = 'ai-suite-finishing-atlas'
	const atlas = finalizeEvent({ kind: 37518, created_at: Math.floor(Date.now() / 1000), tags: [['d', identifier], ['a', map.address]], content: JSON.stringify({ modelVersion: 'earthly/2', name: 'Finishing Atlas', governance: 'closed' }) }, hexToBytes(testIdentities.owner.secretKeyHex))
	await page.evaluate(event => (window as any).__earthlyEventStore.add(event), atlas)
	await openPanel(earthly, 'Atlases')
	await page.getByRole('button', { name: 'Open Atlas Finishing Atlas', exact: true }).click()
	const inspection = page.getByRole('region', { name: 'Atlas inspection', exact: true })
	await expect(inspection.getByRole('heading', { name: 'Finishing Atlas', exact: true })).toBeVisible()
	await expect(inspection.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
	await expect(inspection.getByRole('button', { name: map.title, exact: true })).toBeVisible()
	const path = new URL(page.url()).pathname
	await page.evaluate(() => (window as any).__earthlyUiMap.jumpTo({ center: [0, 0], zoom: 2 }))
	await inspection.getByRole('button', { name: 'Zoom', exact: true }).last().click()
	await expect.poll(() => page.evaluate(() => (window as any).__earthlyUiMap.getCenter().lng)).toBeGreaterThan(13)
	expect(new URL(page.url()).pathname).toBe(path)
	await inspection.getByRole('button', { name: 'Inspect', exact: true }).click()
	await expect(page).toHaveURL(new RegExp(map.path))
	await expect(page.getByRole('heading', { name: map.title, exact: true })).toBeFocused()
	await page.goBack()
	await inspection.getByRole('button', { name: 'Enter atlas', exact: true }).click()
	await expect.poll(() => new URL(page.url()).pathname).toBe('/browse/maps')
	expect(new URL(page.url()).searchParams.get('in')).toBe(nip19.naddrEncode({ kind: atlas.kind, pubkey: atlas.pubkey, identifier }))
	await expect(page.getByRole('button', { name: 'Leave', exact: true })).toBeVisible()
})

test('Comments stay beside desktop AI; phone writing expands and focuses the composer', async ({ earthly }) => {
	const page = earthly.page
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const map = await installInMemoryMapFixture(earthly, { title: 'Discussion and AI', commentCount: 1 })
	await openPanel(earthly, 'Maps')
	await page.getByRole('button', { name: `Open map ${map.title}`, exact: true }).click()
	await page.getByRole('tab', { name: 'Comments', exact: true }).click()
	await expect(page.getByText(map.commentTexts[0]!, { exact: true })).toBeVisible()
	if (earthly.isMobile) {
		await page.getByRole('button', { name: 'Write a comment', exact: true }).click()
		const slider = page.getByRole('slider', { name: 'Resize panel', exact: true })
		await expect.poll(async () => Number(await slider.getAttribute('aria-valuenow')) - Number(await slider.getAttribute('aria-valuemax'))).toBe(0)
		await expect(page.getByRole('form', { name: 'Comment composer' }).locator('[contenteditable="true"]')).toBeFocused()
	} else {
		await page.getByRole('tab', { name: 'Thread', exact: true }).click()
		await expect(page.getByText('Your AI conversation', { exact: true })).toBeVisible()
		await expect(page.getByRole('region', { name: 'Map inspection' }).getByText(map.commentTexts[0]!, { exact: true })).toBeVisible()
		await expect(page.getByRole('region', { name: 'Map inspection' }).getByRole('form', { name: 'Comment composer' })).toBeVisible()
	}
})
