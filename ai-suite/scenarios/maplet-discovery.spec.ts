import { createHash } from 'node:crypto'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { finalizeEvent, type NostrEvent } from 'nostr-tools'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { testIdentities } from '../test-identities'

const fixtureOrigin = 'https://maplet-fixture.invalid'

function fixtureHtml(marker: string): string {
	const collection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				id: 'fixture:area',
				properties: {
					name: 'Signed fixture area',
					fillColor: '#8b5cf6',
					fillOpacity: 0.7,
					strokeColor: '#4c1d95',
					strokeWidth: 2,
				},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[13, 46],
							[14, 46],
							[14, 47],
							[13, 47],
							[13, 46],
						],
					],
				},
			},
		],
	}
	return `<!doctype html><html><head><title>Signed fixture</title></head><body><script>
window.parent.postMessage({type:'maplet-fixture-executed',marker:${JSON.stringify(marker)}},'*');
window.napplet.map.replace(${JSON.stringify(collection)},{warnings:['Signed fixture output']});
</script></body></html>`
}

function signedFixture(title: string, identifier: string) {
	const html = fixtureHtml(identifier)
	const hash = createHash('sha256').update(html, 'utf8').digest('hex')
	const aggregate = createHash('sha256').update(`${hash} /index.html\n`, 'utf8').digest('hex')
	const event = finalizeEvent(
		{
			kind: 35129,
			created_at: Math.floor(Date.now() / 1000),
			content: '',
			tags: [
				['d', identifier],
				['title', title],
				['description', 'In-memory signed Maplet integration fixture'],
				['t', 'maplet'],
				['archetype', 'maplet'],
				['requires', 'map'],
				['path', '/index.html', hash],
				['x', aggregate, 'aggregate'],
				['server', fixtureOrigin],
			],
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	return { event, hash, html }
}

async function seedManifest(earthly: EarthlySession, event: NostrEvent) {
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await earthly.page.evaluate((manifest) => {
		const store = (
			window as unknown as { __earthlyEventStore?: { add(event: NostrEvent): unknown } }
		).__earthlyEventStore
		if (!store) throw new Error('Earthly development EventStore is unavailable')
		store.add(manifest)
	}, event)
}

async function watchFixtureExecution(earthly: EarthlySession) {
	await earthly.page.addInitScript(() => {
		const observed = window as unknown as { __mapletFixtureExecutions: string[] }
		observed.__mapletFixtureExecutions = []
		window.addEventListener('message', (event) => {
			if (event.data?.type === 'maplet-fixture-executed' && typeof event.data.marker === 'string') {
				observed.__mapletFixtureExecutions.push(event.data.marker)
			}
		})
	})
}

test('a signed third-party Maplet is discovered, verified and rendered @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop signed artifact integration contract')
	const published = await installIsolatedRelays(earthly)
	await watchFixtureExecution(earthly)
	const title = 'Signed Polygon Fixture'
	const fixture = signedFixture(title, 'ai-suite-signed-maplet')
	const requests: string[] = []
	await earthly.page.route(`${fixtureOrigin}/**`, async (route) => {
		requests.push(route.request().url())
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: fixture.html,
		})
	})
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await seedManifest(earthly, fixture.event)
	const panel = earthly.page.getByRole('tabpanel', { name: 'Maplets', exact: true })
	await panel.getByRole('button', { name: 'Discover Maplets', exact: true }).click()
	await panel.getByRole('button', { name: `Open ${title}`, exact: true }).click()
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.filter(
				(entry) => entry.entityType === 'maplet',
			),
		)
		.toMatchObject([{ title, visible: true }])
	await expect
		.poll(() =>
			earthly.page.evaluate(() => [
				...new Set(
					(window as unknown as { __mapletFixtureExecutions: string[] }).__mapletFixtureExecutions,
				),
			]),
		)
		.toEqual(['ai-suite-signed-maplet'])
	expect(requests).toEqual([`${fixtureOrigin}/${fixture.hash}`])
	await openPanel(earthly, 'Shelf')
	await earthly.page.getByRole('button', { name: 'Fit configuration', exact: true }).click()
	await expect
		.poll(() =>
			earthly.page.evaluate(async () => {
				const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
				if (map.isMoving()) return false
				const sourceId = Object.keys(map.getStyle().sources).find((id) => id.startsWith('maplet:'))
				if (!sourceId) return false
				const source = map.getSource(sourceId) as GeoJSONSource
				const data = await source.getData()
				const layers = map
					.getStyle()
					.layers.filter((layer) => layer.id.startsWith('maplet:') && layer.type === 'fill')
					.map((layer) => layer.id)
				return (
					data.type === 'FeatureCollection' &&
					data.features.length === 1 &&
					layers.length > 0 &&
					map
						.queryRenderedFeatures({ layers })
						.some((feature) => feature.properties.name === 'Signed fixture area')
				)
			}),
		)
		.toBe(true)
	await expect
		.poll(async () =>
			(await editorLifecycleSnapshot(earthly)).mapStack.filter(
				(entry) => entry.entityType === 'maplet',
			),
		)
		.toMatchObject([{ title, visible: true }])
	// Fixtures only enter this page's memory; no release or dataset is published.
	expect([...published.values()]).not.toContain(35129)
	expect([...published.values()]).not.toContain(37515)
})

test('tampered third-party artifact bytes are rejected before sandbox execution @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop signed artifact integrity contract')
	const published = await installIsolatedRelays(earthly)
	await watchFixtureExecution(earthly)
	const title = 'Tampered Polygon Fixture'
	const fixture = signedFixture(title, 'ai-suite-tampered-maplet')
	const requests: string[] = []
	await earthly.page.route(`${fixtureOrigin}/**`, async (route) => {
		requests.push(route.request().url())
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			headers: { 'Access-Control-Allow-Origin': '*' },
			body: fixtureHtml('tampered-bytes-executed'),
		})
	})
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await seedManifest(earthly, fixture.event)
	const panel = earthly.page.getByRole('tabpanel', { name: 'Maplets', exact: true })
	await panel.getByRole('button', { name: 'Discover Maplets', exact: true }).click()
	await panel.getByRole('button', { name: `Open ${title}`, exact: true }).click()
	await expect(
		earthly.page.getByText(/Could not retrieve a verified maplet|Maplet file hash mismatch/),
	).toBeVisible()
	expect(requests).toEqual([`${fixtureOrigin}/${fixture.hash}`])
	await expect(
		earthly.page.locator('iframe[title="Tampered Polygon Fixture sandbox"]'),
	).toHaveCount(0)
	expect(
		await earthly.page.evaluate(
			() =>
				(window as unknown as { __mapletFixtureExecutions: string[] }).__mapletFixtureExecutions,
		),
	).toEqual([])
	expect(
		(await editorLifecycleSnapshot(earthly)).mapStack.filter(
			(entry) => entry.entityType === 'maplet',
		),
	).toEqual([])
	expect([...published.values()]).not.toContain(35129)
	expect([...published.values()]).not.toContain(37515)
})
