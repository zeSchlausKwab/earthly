import { readFileSync } from 'node:fs'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { type NostrEvent, verifyEvent } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import { test, expect } from '../fixtures/earthly'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	createGMapperConfiguration,
	gmapperFrame,
	openGMapper,
	openGMapperConfiguration,
	publishGMapperConfiguration,
} from '../tasks/maplets/my-maps'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'

const kml = readFileSync(new URL('../fixtures/data/maplet-layers.kml', import.meta.url), 'utf8')
const url = 'https://www.google.com/maps/d/viewer?mid=publicMap123'
const exportPattern = 'https://www.google.com/maps/d/kml?**'

async function directory(frame: ReturnType<typeof gmapperFrame>) {
	await frame.getByRole('button', { name: '← GMapper', exact: true }).click()
	await expect(
		frame.getByRole('button', { name: 'Create configuration', exact: true }),
	).toBeVisible()
}

test('GMapper saves an anonymous configuration, refreshes client geometry and copies an independent draft @regression', async ({
	earthly,
}, testInfo) => {
	const published = await installIsolatedRelays(earthly)
	let fail = false
	let backendRequests = 0
	earthly.page.on('request', (request) => {
		if (request.url().includes('/api/maplets/')) backendRequests++
	})
	await earthly.page.route(exportPattern, (route) =>
		fail ? route.abort() : route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	const frame = await createGMapperConfiguration(earthly, url, 'Areas only')
	await frame.getByRole('checkbox', { name: 'Observations', exact: true }).uncheck()
	await frame.getByRole('slider', { name: 'Default opacity', exact: true }).fill('50')
	await frame.getByLabel('Areas colour', { exact: true }).fill('#225577')
	await frame.getByRole('button', { name: 'Save on this device', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Saved on this device.')
	await expect(frame.getByRole('button', { name: 'Add to map', exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Add to map', exact: true }).click()
	await expect(frame.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('50')
	await expect(frame.getByRole('checkbox', { name: 'Observations', exact: true })).not.toBeChecked()
	await testInfo.attach(`gmapper-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await earthly.page.reload()
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	await openGMapperConfiguration(earthly, 'Areas only', true)
	await frame.getByRole('tab', { name: 'Your view', exact: true }).click()
	await expect(frame.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('50')
	await expect(frame.getByLabel('Areas colour', { exact: true })).toHaveValue('#225577')
	fail = true
	await frame.getByRole('button', { name: 'Refresh data', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText('Showing the last successful fetch.')
	await frame.getByLabel('Choose KML file for this Google source', { exact: true }).setInputFiles({
		name: 'manual.kml',
		mimeType: 'application/vnd.google-earth.kml+xml',
		buffer: Buffer.from(kml),
	})
	await expect(frame.getByRole('status').last()).toContainText('Local KML')
	await frame.getByRole('tab', { name: 'Geometry', exact: true }).click()
	await frame.getByRole('checkbox', { name: 'Select all', exact: true }).check()
	await frame.getByRole('button', { name: 'Copy 1 to editor', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	expect(backendRequests).toBe(0)
	expect([...published.values()].filter((kind) => [37515, 37526, 30078].includes(kind))).toEqual([])
})

test('an owner publishes multiple flavours of one link and a visitor discovers and uses them independently @regression', async ({
	earthly,
	newEarthlySession,
}) => {
	const stored = new Map<string, NostrEvent>()
	await installIsolatedRelays(earthly, stored)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	const frame = await createGMapperConfiguration(earthly, url, 'Survey areas')
	await frame.getByRole('checkbox', { name: 'Observations', exact: true }).uncheck()
	await frame.getByLabel('Areas colour', { exact: true }).fill('#225577')
	await frame
		.getByLabel('Description', { exact: true })
		.fill('Selected areas from the coastal survey.')
	await frame.getByLabel('Tags', { exact: true }).fill('coast, survey')
	await publishGMapperConfiguration(earthly)
	await directory(frame)
	await createGMapperConfiguration(earthly, url, 'Survey observations')
	await frame.getByRole('checkbox', { name: 'Areas', exact: true }).uncheck()
	await publishGMapperConfiguration(earthly)

	const announcements = [...stored.values()].filter((event) => event.kind === 37526)
	expect(announcements).toHaveLength(2)
	expect(announcements.every(verifyEvent)).toBe(true)
	expect(
		new Set(announcements.map((event) => event.tags.find((tag) => tag[0] === 'd')?.[1])).size,
	).toBe(2)
	const areas = announcements.find((event) => JSON.parse(event.content).title === 'Survey areas')
	expect(JSON.parse(areas!.content)).toMatchObject({
		version: 2,
		hiddenLayers: ['Layer: Observations'],
		layerColors: { 'Layer: Areas': '#225577' },
	})
	expect(announcements.map((event) => event.content).join('')).not.toMatch(
		/FeatureCollection|coordinates/,
	)
	const privateSave = [...stored.values()].find((event) => event.kind === 30078)
	expect(privateSave && verifyEvent(privateSave)).toBe(true)
	expect(privateSave?.content).not.toMatch(/google|Survey/)
	expect([...stored.values()].some((event) => event.kind === 37515)).toBe(false)

	const consumer = await newEarthlySession()
	await installIsolatedRelays(consumer, stored)
	let fetched = 0
	await consumer.page.route(exportPattern, (route) => {
		fetched++
		return route.fulfill({
			contentType: 'text/xml',
			body: kml.replace('Lookout', 'Updated lookout'),
		})
	})
	await consumer.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(consumer)
	const reader = await openGMapper(consumer)
	await expect(reader.getByRole('article', { name: 'Survey areas', exact: true })).toBeVisible()
	await expect(
		reader.getByRole('article', { name: 'Survey observations', exact: true }),
	).toBeVisible()
	expect(fetched).toBe(0)
	await openGMapperConfiguration(consumer, 'Survey areas')
	await expect(reader.getByRole('button', { name: 'Make a copy', exact: true })).toBeVisible()
	await expect(reader.getByRole('button', { name: 'Edit configuration', exact: true })).toHaveCount(
		0,
	)
	await reader.getByRole('button', { name: 'Add to map', exact: true }).click()
	await expect(
		reader.getByRole('checkbox', { name: 'Observations', exact: true }),
	).not.toBeChecked()
	await expect(reader.getByLabel('Areas colour', { exact: true })).toHaveValue('#225577')
	await reader.getByRole('slider', { name: 'View opacity', exact: true }).fill('25')
	await reader.getByRole('button', { name: 'Make a copy', exact: true }).click()
	await expect(reader.getByRole('slider', { name: 'Default opacity', exact: true })).toHaveValue(
		'25',
	)
	await reader.getByLabel('Configuration name', { exact: true }).fill('My survey view')
	await reader.getByRole('button', { name: 'Save on this device', exact: true }).click()
	await expect(
		reader.getByRole('button', { name: 'Edit configuration', exact: true }),
	).toBeVisible()
	await directory(reader)
	await openGMapperConfiguration(consumer, 'Survey observations')
	await reader.getByRole('button', { name: 'Add to map', exact: true }).click()
	await expect(reader.getByRole('checkbox', { name: 'Areas', exact: true })).not.toBeChecked()
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(consumer)).mapStack
				.filter((entry) => entry.entityType === 'maplet')
				.map((entry) => entry.title)
				.sort(),
		)
		.toEqual(['Survey areas', 'Survey observations'])
	expect(fetched).toBe(2)
	await openPanel(consumer, 'Shelf')
	await expect(
		consumer.page.getByRole('button', { name: 'View configuration', exact: true }),
	).toHaveCount(2)
	await consumer.page
		.getByRole('button', { name: 'View configuration', exact: true })
		.first()
		.click()
	await expect(reader.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('25')

	const otherDevice = await newEarthlySession()
	await installIsolatedRelays(otherDevice, stored)
	await authorizeJourneyIdentity(otherDevice, 'owner')
	await otherDevice.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await otherDevice.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(otherDevice)
	const restored = await openGMapper(otherDevice)
	await restored.getByRole('tab', { name: 'Yours', exact: true }).click()
	await restored.getByRole('button', { name: 'Restore from account', exact: true }).click()
	await expect(restored.getByRole('status').first()).toContainText(
		'Restored private configurations',
	)
	await expect(restored.getByRole('article', { name: 'Survey areas', exact: true })).toBeVisible()
	await expect(
		restored.getByRole('article', { name: 'Survey observations', exact: true }),
	).toBeVisible()
})

test('locked publication keeps the draft and offers signer recovery before retry @regression', async ({
	earthly,
}) => {
	const published = await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	const frame = await createGMapperConfiguration(earthly, url, 'Retryable survey')
	await earthly.page.evaluate(() => {
		const signer = (window as unknown as { nostr: WindowNostr }).nostr
		const sign = signer.signEvent.bind(signer)
		let locked = true
		window.addEventListener('earthly-test-unlock-signer', () => {
			locked = false
		})
		signer.signEvent = async (event) => {
			if (locked)
				throw new Error("Uncaught TypeError: Cannot read properties of undefined (reading 'find')")
			return sign(event)
		}
	})
	await frame.getByRole('button', { name: 'Publish…', exact: true }).click()
	await frame.getByRole('button', { name: 'Publish configuration', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText(
		'Your signer could not sign this request. Open your signer, unlock it if needed, and retry.',
	)
	expect([...published.values()]).not.toContain(37526)
	await expect(
		frame.getByRole('button', { name: 'Publish configuration', exact: true }),
	).toBeEnabled()
	await earthly.page.evaluate(() => window.dispatchEvent(new Event('earthly-test-unlock-signer')))
	await frame.getByRole('button', { name: 'Publish configuration', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Configuration published.')
	await expect(frame.getByRole('alert')).toHaveCount(0)
	expect([...published.values()]).toEqual(expect.arrayContaining([37526, 30078]))
})

test('an unfinished configuration is restored as a draft without publishing or activating it @regression', async ({
	earthly,
}) => {
	const published = await installIsolatedRelays(earthly)
	await earthly.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	const frame = await createGMapperConfiguration(earthly, url, 'Unfinished survey')
	await frame.getByRole('checkbox', { name: 'Observations', exact: true }).uncheck()
	await directory(frame)
	await frame.getByRole('tab', { name: 'Yours', exact: true }).click()
	await expect(
		frame.getByRole('article', { name: 'Unfinished survey', exact: true }),
	).toContainText('Draft')
	await earthly.page.reload()
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	await openGMapperConfiguration(earthly, 'Unfinished survey', true)
	await expect(frame.getByLabel('Configuration name', { exact: true })).toHaveValue(
		'Unfinished survey',
	)
	await expect(frame.getByRole('checkbox', { name: 'Observations', exact: true })).not.toBeChecked()
	await frame.getByRole('button', { name: 'Discard draft', exact: true }).click()
	await expect(frame.getByRole('article', { name: 'Unfinished survey', exact: true })).toHaveCount(
		0,
	)
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.filter(
				(entry) => entry.entityType === 'maplet',
			),
		)
		.toEqual([])
	expect([...published.values()]).not.toContain(37526)
})

test('owner drafts stay unpublished and reviewed publisher updates preserve a consumer personal view @regression', async ({
	earthly,
	newEarthlySession,
}) => {
	const stored = new Map<string, NostrEvent>()
	await installIsolatedRelays(earthly, stored)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openGMapper(earthly)
	const frame = await createGMapperConfiguration(earthly, url, 'Evolving survey')
	await publishGMapperConfiguration(earthly)
	await frame.getByRole('button', { name: 'Add to map', exact: true }).click()
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.filter(
					(entry) => entry.entityType === 'maplet',
				).length,
		)
		.toBe(1)
	const originalSourceId = (await editorLifecycleSnapshot(earthly)).mapStack.find(
		(entry) => entry.entityType === 'maplet',
	)!.id
	const renderSnapshot = () =>
		earthly.page.evaluate(async (sourceId) => {
			const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
			const sourceIds = Object.keys(map.getStyle().sources).filter((id) => id.startsWith('maplet:'))
			const output = async (id: string) => {
				const data = await (map.getSource(id) as GeoJSONSource).getData()
				return {
					visibility: ['fill', 'line', 'point'].map((role) =>
						map.getLayoutProperty(`${id}:${role}`, 'visibility'),
					),
					features: data.type === 'FeatureCollection' ? data.features.length : 0,
					colours:
						data.type === 'FeatureCollection'
							? data.features.map((feature) => feature.properties?.fillColor)
							: [],
				}
			}
			return {
				original: sourceIds.includes(sourceId) ? await output(sourceId) : null,
				previews: await Promise.all(sourceIds.filter((id) => id !== sourceId).map(output)),
			}
		}, originalSourceId)
	await expect.poll(renderSnapshot).toMatchObject({
		original: { visibility: ['visible', 'visible', 'visible'], features: 3 },
		previews: [],
	})
	const consumer = await newEarthlySession()
	await installIsolatedRelays(consumer, stored)
	await consumer.page.route(exportPattern, (route) =>
		route.fulfill({ contentType: 'text/xml', body: kml }),
	)
	await consumer.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(consumer)
	const reader = await openGMapper(consumer)
	await openGMapperConfiguration(consumer, 'Evolving survey')
	await reader.getByRole('button', { name: 'Add to map', exact: true }).click()
	await reader.getByRole('slider', { name: 'View opacity', exact: true }).fill('25')
	await reader.getByRole('checkbox', { name: 'Observations', exact: true }).uncheck()
	await frame.getByRole('button', { name: 'Edit configuration', exact: true }).click()
	await frame.getByRole('checkbox', { name: 'Observations', exact: true }).uncheck()
	await frame.getByLabel('Areas colour', { exact: true }).fill('#225577')
	await expect.poll(renderSnapshot).toMatchObject({
		original: { visibility: ['none', 'none', 'none'], features: 3 },
		previews: [
			{ visibility: ['visible', 'visible', 'visible'], features: 1, colours: ['#225577'] },
		],
	})
	// Returning to the directory restores the active configuration without promoting the draft.
	await directory(frame)
	await expect.poll(renderSnapshot).toMatchObject({
		original: { visibility: ['visible', 'visible', 'visible'], features: 3 },
		previews: [],
	})
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack
				.filter((entry) => entry.entityType === 'maplet')
				.map((entry) => entry.title),
		)
		.toEqual(['Evolving survey'])
	await frame.getByRole('tab', { name: 'Yours', exact: true }).click()
	await frame.getByRole('button', { name: 'Resume draft: Evolving survey', exact: true }).click()
	await frame.getByRole('checkbox', { name: 'Observations', exact: true }).check()
	await frame.getByRole('slider', { name: 'Default opacity', exact: true }).fill('60')
	await frame.getByLabel('Description', { exact: true }).fill('New publisher defaults.')
	await frame.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText(
		'Draft saved. The published configuration is unchanged.',
	)
	expect([...stored.values()].filter((event) => event.kind === 37526)).toHaveLength(1)
	await frame.getByRole('button', { name: 'Resume draft: Evolving survey', exact: true }).click()
	await expect(frame.getByRole('slider', { name: 'Default opacity', exact: true })).toHaveValue(
		'60',
	)
	await publishGMapperConfiguration(earthly, true)
	expect([...stored.values()].filter((event) => event.kind === 37526)).toHaveLength(2)
	await directory(reader)
	await openGMapperConfiguration(consumer, 'Evolving survey')
	await reader.getByRole('tab', { name: 'Your view', exact: true }).click()
	await expect(
		reader.getByText('Configuration updated. Review the new defaults before applying them.', {
			exact: true,
		}),
	).toBeVisible()
	await expect(reader.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('25')
	await reader.getByRole('button', { name: 'Review update', exact: true }).click()
	await reader
		.getByRole('button', { name: 'Apply update · keep my overrides', exact: true })
		.click()
	await expect(reader.getByRole('status').first()).toContainText(
		'Your personal viewing choices were preserved.',
	)
	await expect(reader.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('25')
	await expect(
		reader.getByRole('checkbox', { name: 'Observations', exact: true }),
	).not.toBeChecked()
	await reader.getByRole('button', { name: 'Reset to configuration defaults', exact: true }).click()
	await expect(reader.getByRole('slider', { name: 'View opacity', exact: true })).toHaveValue('60')
	await expect(reader.getByRole('checkbox', { name: 'Observations', exact: true })).toBeChecked()
	await frame.getByRole('button', { name: 'Remove from discovery…', exact: true }).click()
	await frame.getByRole('button', { name: 'Remove from discovery', exact: true }).click()
	await expect(frame.getByRole('status').first()).toContainText('Removed from discovery.')
	await directory(reader)
	await reader.getByRole('tab', { name: 'Explore configurations', exact: true }).click()
	await expect(reader.getByRole('article', { name: 'Evolving survey', exact: true })).toHaveCount(0)
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(consumer)).mapStack
				.filter((entry) => entry.entityType === 'maplet')
				.map((entry) => entry.title),
		)
		.toEqual(['Evolving survey'])
})
