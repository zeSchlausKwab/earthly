import { readFileSync } from 'node:fs'
import { type NostrEvent, verifyEvent } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import { test, expect } from '../fixtures/earthly'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { addMyMapsSource, openMyMapsViewer } from '../tasks/maplets/my-maps'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'

const kml = readFileSync(new URL('../fixtures/data/maplet-layers.kml', import.meta.url), 'utf8')
const url = 'https://www.google.com/maps/d/viewer?mid=publicMap123'

test('a locked signer gives recovery guidance and keeps sources ready to retry @regression', async ({
	earthly,
}) => {
	const events = await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.route('https://www.google.com/maps/d/kml?**', (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openMyMapsViewer(earthly)
	const frame = await addMyMapsSource(earthly, url, 'Coastal survey')
	await earthly.page.evaluate(() => {
		// Replay Plebeian Signer 1.2.1's observed locked-session rejection at
		// the actual NIP-07 boundary, while the Earthly account stays signed in.
		const signer = (window as unknown as { nostr: WindowNostr }).nostr
		const sign = signer.signEvent.bind(signer)
		const nip44 = signer.nip44
		if (!nip44) throw new Error('Missing test signer encryption')
		const encrypt = nip44.encrypt.bind(nip44)
		let locked = true
		window.addEventListener('earthly-test-unlock-signer', () => {
			locked = false
		})
		const check = () => {
			if (locked)
				throw new Error("Uncaught TypeError: Cannot read properties of undefined (reading 'find')")
		}
		signer.signEvent = async (event) => {
			check()
			return sign(event)
		}
		nip44.encrypt = async (pubkey, plaintext) => {
			check()
			return encrypt(pubkey, plaintext)
		}
	})
	await frame.getByText('Name & publish source', { exact: true }).click()
	await frame.getByRole('button', { name: 'Publish source', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText(
		'Your signer could not sign this request. Open your signer, unlock it if needed, and retry.',
	)
	await frame.getByText('Name & publish source', { exact: true }).click()
	await expect(frame.getByRole('button', { name: 'Publish source', exact: true })).toBeEnabled()
	expect([...events.values()]).not.toContain(37526)
	await frame.getByRole('button', { name: 'Save for me', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText('Your signer could not encrypt this request')
	await expect(frame.getByRole('status').first()).toContainText('Saved on this device')
	expect([...events.values()]).not.toContain(30078)
	await earthly.page.evaluate(() => window.dispatchEvent(new Event('earthly-test-unlock-signer')))
	await frame.getByText('Name & publish source', { exact: true }).click()
	await frame.getByRole('button', { name: 'Publish source', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Source published')
	await expect(frame.getByRole('alert')).toHaveCount(0)
	await frame.getByRole('button', { name: 'Save for me', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Saved for your account')
	expect([...events.values()]).toEqual(expect.arrayContaining([37526, 30078]))
})

test('My Maps Viewer fetches, toggles, remembers, refreshes and copies client geometry @regression', async ({
	earthly,
}, testInfo) => {
	const events = await installIsolatedRelays(earthly)
	let fail = false
	let backend = 0
	earthly.page.on('request', (request) => {
		if (request.url().includes('/api/maplets/')) backend++
	})
	await earthly.page.route('https://www.google.com/maps/d/kml?**', (route) =>
		fail ? route.abort() : route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openMyMapsViewer(earthly)
	const frame = await addMyMapsSource(earthly, url, 'Coastal survey')
	await expect(frame.getByRole('checkbox', { name: 'Observations 2', exact: true })).toBeChecked()
	await frame.getByRole('checkbox', { name: 'Observations 2', exact: true }).uncheck()
	await frame.getByRole('slider', { name: 'Opacity', exact: true }).fill('50')
	await frame.getByRole('button', { name: 'Save for me', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Saved on this device')
	await testInfo.attach(`viewer-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await earthly.page.reload()
	await installDeterministicMapStyle(earthly)
	await openMyMapsViewer(earthly)
	await expect(
		frame.getByRole('article', { name: 'Coastal survey', exact: true }).getByRole('status'),
	).toContainText('Last fetched')
	await expect(
		frame.getByRole('checkbox', { name: 'Observations 2', exact: true }),
	).not.toBeChecked()
	await expect(frame.getByRole('slider', { name: 'Opacity', exact: true })).toHaveValue('50')
	fail = true
	await frame.getByRole('button', { name: 'Refresh source', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText('Showing the last successful fetch')
	await frame.getByLabel('Choose KML file for this source', { exact: true }).setInputFiles({
		name: 'manual.kml',
		mimeType: 'application/vnd.google-earth.kml+xml',
		buffer: Buffer.from(kml),
	})
	await expect(
		frame.getByRole('article', { name: 'Coastal survey', exact: true }).getByRole('status'),
	).toContainText('KML file loaded')
	await earthly.page.getByRole('button', { name: 'View map & close', exact: true }).click()
	const card = earthly.page.getByRole('article', { name: 'My Maps Viewer Maplet', exact: true })
	await expect(card.getByRole('status')).toContainText('1 geometries')
	await card.getByRole('button', { name: 'Refresh My Maps Viewer', exact: true }).click()
	await expect(card.getByRole('status')).toContainText('1 geometries')
	await card
		.getByRole('checkbox', { name: 'Select all My Maps Viewer geometry', exact: true })
		.check()
	await card.getByRole('button', { name: 'Copy 1 selected to editor', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	expect(backend).toBe(0)
	expect([...events.values()].filter((kind) => [37515, 37526, 30078].includes(kind))).toEqual([])
})

test('source announcements cross sessions while private saves contain no public geometry @regression', async ({
	earthly,
	newEarthlySession,
}) => {
	const stored = new Map<string, NostrEvent>()
	await installIsolatedRelays(earthly, stored)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.route('https://www.google.com/maps/d/kml?**', (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openMyMapsViewer(earthly)
	const frame = await addMyMapsSource(earthly, url, 'Coastal survey')
	await frame.getByRole('checkbox', { name: 'Observations 2', exact: true }).uncheck()
	await frame.getByText('Name & publish source', { exact: true }).click()
	await frame
		.getByLabel('Source description', { exact: true })
		.fill('A map shared by the coast survey team.')
	await frame.getByLabel('Source tags', { exact: true }).fill('coast, survey')
	await frame.getByRole('button', { name: 'Publish source', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Source published')
	await frame.getByRole('button', { name: 'Save for me', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Saved for your account')
	const announcement = [...stored.values()].find((event) => event.kind === 37526)
	const preferences = [...stored.values()].find((event) => event.kind === 30078)
	expect(announcement && verifyEvent(announcement)).toBe(true)
	expect(preferences && verifyEvent(preferences)).toBe(true)
	expect(announcement?.content).toContain('Coastal survey')
	expect(announcement?.content).not.toMatch(/geometry|coordinates|hiddenLayers/)
	expect(preferences?.content).not.toMatch(/google|Coastal/)
	expect([...stored.values()].some((event) => event.kind === 37515)).toBe(false)

	const consumer = await newEarthlySession()
	await installIsolatedRelays(consumer, stored)
	let fetched = 0
	await consumer.page.route('https://www.google.com/maps/d/kml?**', (route) => {
		fetched++
		return route.fulfill({
			contentType: 'text/xml',
			body: kml.replace('Lookout', 'Updated lookout'),
		})
	})
	await consumer.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(consumer)
	const reader = await openMyMapsViewer(consumer)
	await reader.getByRole('button', { name: 'Discover sources', exact: true }).click()
	const shared = reader.getByRole('article', {
		name: 'Coastal survey published source',
		exact: true,
	})
	await expect(shared).toBeVisible()
	expect(fetched).toBe(0)
	await shared.getByRole('button', { name: 'Add to my map', exact: true }).click()
	await expect(
		reader.getByRole('article', { name: 'Coastal survey', exact: true }).getByRole('status'),
	).toContainText('3 geometries')
	await expect(reader.getByRole('checkbox', { name: 'Observations 2', exact: true })).toBeChecked()
	expect(fetched).toBe(1)

	const otherDevice = await newEarthlySession()
	await installIsolatedRelays(otherDevice, stored)
	await authorizeJourneyIdentity(otherDevice, 'owner')
	await otherDevice.page.route('https://www.google.com/maps/d/kml?**', (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await otherDevice.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(otherDevice)
	const restored = await openMyMapsViewer(otherDevice)
	await restored.getByRole('button', { name: 'Restore from account', exact: true }).click()
	await expect(
		restored.getByRole('checkbox', { name: 'Observations 2', exact: true }),
	).not.toBeChecked()
	await expect(restored.getByRole('status').first()).toContainText(
		'Restored your saved sources from Nostr',
	)
	await frame.getByRole('button', { name: 'Discover sources', exact: true }).click()
	await frame.getByRole('button', { name: 'Unpublish source', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Source removed from discovery')
	await reader.getByRole('button', { name: 'Discover sources', exact: true }).click()
	await expect(
		reader.getByText('No published sources found on these relays yet.', { exact: true }),
	).toBeVisible()
})
