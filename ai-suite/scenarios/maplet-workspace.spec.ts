import type { NostrEvent } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import sample from '../../src/features/maplets/live-mapper/liveuamap-yemen.sample.json' with {
	type: 'json',
}
import type { WorkspaceCollection } from '../../src/features/maplets/workspace'
import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('Live Mapper imports mixed overlay shapes and updates an ordered line without duplicates @regression', async ({
	earthly,
}, testInfo) => {
	const published = await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Manage', exact: true }).click()
	await frame
		.getByRole('textbox', { name: 'New collection name', exact: true })
		.fill('Mixed observations')
	await frame.getByRole('button', { name: 'Create collection', exact: true }).click()
	await frame.getByRole('button', { name: 'Layers', exact: true }).click()
	await frame.getByRole('button', { name: 'Import data', exact: true }).click()
	const line = {
		id: 140,
		name: 'Survey route',
		type_id: 14,
		strokecolor: '#315ea8',
		strokeweight: '3.00',
		points: [
			{ lat: 33.2, lng: 35.4 },
			{ lat: 33.25, lng: 35.5 },
			{ lat: 33.3, lng: 35.6 },
		],
	}
	await frame.getByLabel('Choose JSON file', { exact: true }).setInputFiles({
		name: 'mixed-overlays.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				fields: {
					610: {
						id: 610,
						name: 'Survey area',
						type_id: 6,
						points: [[33, 35, 33, 35.1, 33.1, 35.1, 33, 35]],
					},
					140: line,
				},
			}),
		),
	})
	await expect(frame.getByRole('combobox', { name: 'Geographic data', exact: true })).toContainText(
		'2 geometries',
	)
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '2 geometries', exact: true })).toBeVisible()
	await expect(frame.getByText('Polygon', { exact: true })).toBeVisible()
	await expect(frame.getByText('LineString', { exact: true })).toBeVisible()
	await testInfo.attach(`mixed-overlay-preview-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await frame.getByRole('button', { name: 'Add layers & save recipe', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Saved locally with its import recipe')
	await expect(frame.getByRole('checkbox', { name: /^Survey area/ })).toBeChecked()
	await expect(frame.getByRole('checkbox', { name: /^Survey route/ })).toBeChecked()
	const readSaved = () =>
		earthly.page.evaluate(() => {
			const key = Object.keys(localStorage).find(
				(entry) =>
					entry.startsWith('earthly:maplet-workspace:v1:') && !entry.endsWith(':anonymous'),
			)
			if (!key) throw new Error('Expected a persisted contributor workspace')
			return (JSON.parse(localStorage.getItem(key) ?? '') as { collections: WorkspaceCollection[] })
				.collections[0]
		})
	const initial = await readSaved()
	expect(initial?.layers).toHaveLength(2)
	const initialLine = initial?.layers.find((layer) => layer.name === 'Survey route')
	if (!initialLine) throw new Error('Expected the ordered line layer')
	expect(initialLine.recipe).toMatchObject({
		path: [],
		adapter: 'liveuamap',
		sourceIds: ['140'],
	})
	expect(initialLine.collection.features).toHaveLength(1)
	expect(initialLine.collection.features[0]?.geometry).toEqual({
		type: 'LineString',
		coordinates: [
			[35.4, 33.2],
			[35.5, 33.25],
			[35.6, 33.3],
		],
	})
	const sourceRow = frame
		.getByRole('checkbox', { name: /^Survey route/ })
		.locator('xpath=ancestor::div[1]')
	await sourceRow.getByRole('button', { name: 'Update', exact: true }).click()
	const updatedLine = { ...line, points: [...line.points.slice(0, 2), { lat: 33.4, lng: 35.7 }] }
	await frame.getByLabel('Choose JSON file', { exact: true }).setInputFiles({
		name: 'updated-route.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({ fields: { 140: updatedLine } })),
	})
	await expect(frame.getByRole('status')).toContainText('Saved recipe applied')
	await expect(frame.getByRole('heading', { name: '1 geometries', exact: true })).toBeVisible()
	await expect(
		frame.getByText('0 added · 1 changed · 0 removed · Other records retained', { exact: true }),
	).toBeVisible()
	await frame.getByRole('button', { name: 'Apply update & save recipe', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Saved locally with its import recipe')
	const updated = await readSaved()
	expect(updated?.layers).toHaveLength(2)
	const nextLine = updated?.layers.find((layer) => layer.id === initialLine.id)
	expect(nextLine?.collection.features).toHaveLength(1)
	expect(nextLine?.collection.features[0]?.id).toBe(initialLine.collection.features[0]?.id)
	expect(nextLine?.collection.features[0]?.geometry).toEqual({
		type: 'LineString',
		coordinates: [
			[35.4, 33.2],
			[35.5, 33.25],
			[35.7, 33.4],
		],
	})
	expect(updated?.layers.find((layer) => layer.name === 'Survey area')).toEqual(
		initial?.layers.find((layer) => layer.name === 'Survey area'),
	)
	expect([...published.values()]).not.toContain(37515)
})

test('Live Mapper publishes a grouped collection and reapplies a saved recipe after reload @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop contributor workspace contract')
	const published = await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await installDeterministicMapStyle(earthly)
	await openPanel(earthly, 'Maps')
	await earthly.page.getByRole('tab', { name: 'Maplets', exact: true }).click()
	const panel = earthly.page.getByRole('tabpanel', { name: 'Maplets', exact: true })
	await panel.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Live Mapper workspace', exact: true })
	await expect(dialog).toBeVisible()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await expect(frame.getByRole('heading', { name: 'Your next layer starts here' })).toBeVisible()
	await frame.getByRole('button', { name: 'Manage', exact: true }).click()
	await frame
		.getByRole('textbox', { name: 'New collection name', exact: true })
		.fill('Regional observations')
	await frame.getByRole('button', { name: 'Create collection', exact: true }).click()
	await frame.getByRole('textbox', { name: 'New group name', exact: true }).fill('Yemen')
	await frame.getByRole('button', { name: 'Add group', exact: true }).click()
	await expect(frame.getByRole('textbox', { name: 'Group name', exact: true })).toHaveValue('Yemen')
	await frame.getByRole('button', { name: 'Layers', exact: true }).click()
	await frame.getByRole('button', { name: 'Import data', exact: true }).click()
	await frame.getByRole('button', { name: 'Try example data', exact: true }).click()
	await frame.getByRole('combobox', { name: 'Group', exact: true }).selectOption({ label: 'Yemen' })
	await expect(
		frame.getByRole('checkbox', { name: 'Create a named layer for each source overlay' }),
	).toBeChecked()
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '10 geometries', exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Add layers & save recipe', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Saved locally with its import recipe')
	await expect(frame.getByRole('heading', { name: 'Yemen', exact: true })).toBeVisible()
	for (const record of Object.values(sample)) {
		await expect(frame.getByRole('checkbox', { name: new RegExp(`^${record.name}`) })).toBeChecked()
	}
	const readSaved = () =>
		earthly.page.evaluate(() => {
			const key = Object.keys(localStorage).find(
				(entry) =>
					entry.startsWith('earthly:maplet-workspace:v1:') && !entry.endsWith(':anonymous'),
			)
			if (!key) throw new Error('Expected a persisted contributor workspace')
			return JSON.parse(localStorage.getItem(key) ?? '') as {
				collections: WorkspaceCollection[]
				publishedEvents: Record<string, NostrEvent>
			}
		})
	const initial = (await readSaved()).collections[0]
	if (!initial) throw new Error('Expected a local collection')
	expect(initial.name).toBe('Regional observations')
	expect(initial.groups).toHaveLength(1)
	expect(initial.layers).toHaveLength(5)
	for (const layer of initial.layers) {
		expect(layer.groupId).toBe(initial.groups[0]?.id)
		expect(layer.recipe).toMatchObject({ version: 1, adapter: 'liveuamap', path: [] })
		expect(layer.recipe?.sourceIds).toHaveLength(1)
	}

	await frame.getByRole('button', { name: 'Manage', exact: true }).click()
	await frame.getByRole('button', { name: 'Review snapshot for publishing', exact: true }).click()
	await expect(
		frame.getByText('1 groups · 5 layers · 10 geometries', { exact: true }),
	).toBeVisible()
	expect([...published.values()]).not.toContain(37515)
	await frame.getByRole('button', { name: 'Sign & publish snapshot', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Snapshot published')
	await expect.poll(() => [...published.values()].filter((kind) => kind === 37515).length).toBe(1)
	const address = await frame
		.getByRole('textbox', { name: 'Collection address', exact: true })
		.inputValue()
	expect(address).toMatch(/^naddr1/)
	const firstEvent = (await readSaved()).publishedEvents[initial.id]
	if (!firstEvent) throw new Error('Expected the signed published snapshot')
	expect(verifyEvent(firstEvent)).toBe(true)
	expect(firstEvent.kind).toBe(37515)
	expect(firstEvent.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(initial.id)
	const publicContent = JSON.parse(firstEvent.content)
	expect(publicContent.features).toHaveLength(10)
	expect(publicContent['earthly:maplet-collection'].layers).toHaveLength(5)
	expect(firstEvent.content).not.toContain('"recipe"')
	expect(firstEvent.content).not.toContain('"rawPayload"')

	await earthly.open({ path: '/browse/maplets', tour: 'preserve' })
	await installDeterministicMapStyle(earthly)
	await panel.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	await expect(dialog).toBeVisible()
	await expect(
		frame.getByRole('heading', { name: 'Regional observations', exact: true }),
	).toBeVisible()
	await expect(frame.getByRole('button', { name: 'Update', exact: true })).toHaveCount(5)
	const updatedSource = structuredClone(sample['522576445'])
	updatedSource.points = updatedSource.points.filter((path) => path.length > 4).slice(0, 1)
	updatedSource.description = 'Updated fixture geometry'
	const sourceRow = frame
		.getByRole('checkbox', { name: /^Southern Transitional Council/ })
		.locator('xpath=ancestor::div[1]')
	await sourceRow.getByRole('button', { name: 'Update', exact: true }).click()
	await frame.getByLabel('Choose JSON file', { exact: true }).setInputFiles({
		name: 'single-overlay.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(updatedSource)),
	})
	await expect(frame.getByRole('status')).toContainText('Saved recipe applied')
	await expect(
		frame.getByRole('combobox', { name: 'Destination layer', exact: true }),
	).toContainText('Southern Transitional Council')
	await expect(frame.getByRole('heading', { name: '1 geometries', exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Apply update & save recipe', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Saved locally with its import recipe')
	const updated = (await readSaved()).collections[0]
	if (!updated) throw new Error('Expected an updated local collection')
	expect(updated.layers).toHaveLength(5)
	for (const previous of initial.layers) {
		const next = updated.layers.find((layer) => layer.id === previous.id)
		if (previous.name === 'Southern Transitional Council') {
			expect(next?.collection.features).toHaveLength(1)
			expect(next?.collection.features[0]?.properties?.description).toBe('Updated fixture geometry')
			expect(next?.recipe?.sourceIds).toEqual(['522576445'])
		} else expect(next).toEqual(previous)
	}
	expect(updated.dirty).toBe(true)
	await frame.getByRole('button', { name: 'Manage', exact: true }).click()
	await frame.getByRole('button', { name: 'Review snapshot for publishing', exact: true }).click()
	await expect(frame.getByText('1 groups · 5 layers · 5 geometries', { exact: true })).toBeVisible()
	await frame.getByRole('button', { name: 'Sign & publish snapshot', exact: true }).click()
	await expect(frame.getByRole('status')).toContainText('Snapshot published')
	await expect.poll(() => [...published.values()].filter((kind) => kind === 37515).length).toBe(2)
	await expect(frame.getByRole('textbox', { name: 'Collection address', exact: true })).toHaveValue(
		address,
	)
	const secondEvent = (await readSaved()).publishedEvents[initial.id]
	if (!secondEvent) throw new Error('Expected a second published snapshot')
	expect(verifyEvent(secondEvent)).toBe(true)
	expect(secondEvent.id).not.toBe(firstEvent.id)
	expect(secondEvent.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(initial.id)
})
