import { readFileSync } from 'node:fs'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import { test, expect } from '../fixtures/earthly'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'
const kml = readFileSync(new URL('../fixtures/data/maplet-layers.kml', import.meta.url), 'utf8')
const file = (text = kml) => ({
	name: 'coastal.kml',
	mimeType: 'application/vnd.google-earth.kml+xml',
	buffer: Buffer.from(text),
})

test('browser-only My Maps import previews layers, survives failures, and copies geometry @regression', async ({
	earthly,
}, testInfo) => {
	await installIsolatedRelays(earthly)
	let requests = 0
	let backendRequests = 0
	let fail = false
	earthly.page.on('request', (request) => {
		if (request.url().includes('/api/maplets/')) backendRequests++
	})
	await earthly.page.route('https://www.google.com/maps/d/kml?**', async (route) => {
		requests++
		expect(route.request().headers().cookie).toBeUndefined()
		if (fail) await route.abort('failed')
		else
			await route.fulfill({
				contentType: 'text/xml',
				headers: { 'access-control-allow-origin': '*' },
				body: kml,
			})
	})
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Import My Maps / KML', exact: true }).click()
	await frame
		.getByLabel('Google My Maps link', { exact: true })
		.fill('https://www.google.com/maps/d/u/0/viewer?mid=publicMap123&z=10')
	await frame.getByRole('button', { name: 'Fetch KML in browser', exact: true }).click()
	const candidates = frame.getByLabel('Geographic data', { exact: true })
	await expect(candidates).toContainText('Layer: Areas')
	await expect(candidates).toContainText('Layer: Observations')
	await frame.getByRole('button', { name: 'Preview entire map', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '3 geometries', exact: true })).toBeVisible()
	fail = true
	await frame.getByRole('button', { name: 'Fetch KML in browser', exact: true }).click()
	await expect(frame.getByRole('alert')).toContainText('Export a KML file')
	await expect(frame.getByRole('heading', { name: '3 geometries', exact: true })).toBeVisible()
	await frame
		.getByLabel('Choose KML file', { exact: true })
		.setInputFiles(file('<kml><Document></kml>'))
	await expect(frame.getByRole('alert')).toContainText('not valid KML')
	await expect(frame.getByRole('heading', { name: '3 geometries', exact: true })).toBeVisible()
	await frame.getByLabel('Choose KML file', { exact: true }).setInputFiles(file())
	await frame.getByRole('button', { name: 'Preview entire map', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '3 geometries', exact: true })).toBeVisible()
	await testInfo.attach(`kml-import-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	const article = earthly.page.getByRole('article', { name: 'Live Mapper Maplet', exact: true })
	await expect(article.getByRole('status')).toContainText('3 geometries')
	await article
		.getByRole('checkbox', { name: 'Select all Live Mapper geometry', exact: true })
		.check()
	await article.getByRole('button', { name: 'Copy 3 selected to editor', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 3)
	expect(requests).toBe(2)
	expect(backendRequests).toBe(0)
})

test('KML layer recipes can be saved and reused for an explicit replacement update @regression', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Manage', exact: true }).click()
	await frame.getByLabel('New collection name', { exact: true }).fill('Coastal imports')
	await frame.getByRole('button', { name: 'Create collection', exact: true }).click()
	await frame.getByRole('button', { name: 'Layers', exact: true }).click()
	await frame.getByRole('button', { name: 'Import data', exact: true }).click()
	await frame.getByLabel('Choose KML file', { exact: true }).setInputFiles(file())
	await frame.getByLabel('Geographic data', { exact: true }).selectOption('1')
	await frame.getByRole('button', { name: 'Preview selected layer', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '2 geometries', exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Add layers & save recipe', exact: true }).click()
	await expect(frame.getByRole('checkbox', { name: /Observations/ })).toBeChecked()
	await frame.getByRole('button', { name: 'Update', exact: true }).click()
	await frame
		.getByLabel('Choose KML file', { exact: true })
		.setInputFiles(file(kml.replace('12.5,45.5', '12.6,45.6')))
	await expect(frame.getByRole('status')).toContainText('Saved recipe applied')
	await expect(frame.getByLabel('Update behavior', { exact: true })).toHaveValue('replace')
	await expect(frame.getByLabel('Geographic data', { exact: true })).toHaveValue('1')
	await expect(frame.getByText(/0 added · 1 changed · 0 removed/)).toBeVisible()
	await frame.getByRole('button', { name: 'Apply update & save recipe', exact: true }).click()
	await expect(
		frame.getByRole('checkbox', { name: 'Observations 2 geometries', exact: true }),
	).toBeChecked()
})

test('default KML preview includes the blue polygons from the second layer @regression', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Import My Maps / KML', exact: true }).click()
	const twoLayers = `<kml><Document><name>Two control layers</name>
 <Style id="red"><PolyStyle><color>800000ff</color></PolyStyle></Style>
 <Style id="blue"><PolyStyle><color>80ff0000</color></PolyStyle></Style>
 <Folder><name>Red areas</name><Placemark id="red"><name>Red area</name><styleUrl>#red</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>30,48 31,48 31,49 30,48</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
 <Folder><name>Blue areas</name><Placemark id="blue"><name>Blue area</name><styleUrl>#blue</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>31,48 32,48 32,49 31,48</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder>
 </Document></kml>`
	await frame.getByLabel('Choose KML file', { exact: true }).setInputFiles(file(twoLayers))
	await expect(frame.getByLabel('Geographic data', { exact: true })).toHaveValue('-2')
	await frame.getByRole('button', { name: 'Preview entire map', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '2 geometries', exact: true })).toBeVisible()
	await frame.getByLabel('Geographic data', { exact: true }).selectOption('0')
	await expect(frame.getByText(/Other KML layers are excluded/)).toBeVisible()
	await frame.getByRole('button', { name: 'Preview selected layer', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '1 geometries', exact: true })).toBeVisible()
	await frame.getByLabel('Geographic data', { exact: true }).selectOption('-2')
	await frame.getByRole('button', { name: 'Preview entire map', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '2 geometries', exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	const article = earthly.page.getByRole('article', { name: 'Live Mapper Maplet', exact: true })
	await expect(article.getByRole('status')).toContainText('2 geometries')
	await expect(
		article.getByRole('checkbox', { name: 'Select Blue area', exact: true }),
	).toBeVisible()
	await expect
		.poll(() =>
			earthly.page.evaluate(async () => {
				const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
				const key = Object.keys(map.getStyle().sources).find((id) => id.startsWith('maplet:'))
				if (!key) return null
				const data = await (map.getSource(key) as GeoJSONSource).getData()
				return data.type === 'FeatureCollection'
					? data.features.find((feature) => feature.properties?.name === 'Blue area')?.properties
							?.fillColor
					: null
			}),
		)
		.toBe('#0000ff')
})
