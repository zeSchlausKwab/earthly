import { hexToBytes } from '@noble/hashes/utils.js'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { finalizeEvent, nip19, type NostrEvent } from 'nostr-tools'
import { createWorkspaceSnapshot } from '../../src/features/maplets/workspace'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { openPanel } from '../tasks/navigation/open-panel'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { testIdentities } from '../test-identities'

function snapshot(input: {
	id: string
	name: string
	group: string
	layer: string
	author: 'owner' | 'mara'
	count?: number
	timestamp?: number
}) {
	const identity = testIdentities[input.author]
	const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000) - 20
	const collection = createWorkspaceSnapshot({
		id: input.id,
		owner: identity.publicKey,
		name: input.name,
		groups: [{ id: 'region', name: input.group }],
		layers: [
			{
				id: 'observations',
				name: input.layer,
				groupId: 'region',
				updatedAt: timestamp * 1_000,
				collection: {
					type: 'FeatureCollection',
					features: Array.from({ length: input.count ?? 1 }, (_, index) => ({
						type: 'Feature' as const,
						id: `observation-${index}`,
						properties: { name: `Observation ${index + 1}` },
						geometry: { type: 'Point' as const, coordinates: [35 + index, 33] },
					})),
				},
			},
		],
	})
	return finalizeEvent(
		{
			kind: 37515,
			created_at: timestamp,
			tags: [
				['d', input.id],
				['t', 'maplet-collection'],
			],
			content: JSON.stringify(collection),
		},
		hexToBytes(identity.secretKeyHex),
	)
}

async function receive(earthly: EarthlySession, events: NostrEvent[]) {
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await earthly.page.evaluate((values) => {
		const store = (
			window as unknown as {
				__earthlyEventStore: { add(event: NostrEvent): unknown }
			}
		).__earthlyEventStore
		for (const event of values) store.add(event)
	}, events)
}

async function renderedCount(earthly: EarthlySession) {
	return earthly.page.evaluate(async () => {
		const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
		const key = Object.keys(map.getStyle().sources).find((id) => id.startsWith('maplet:'))
		if (!key) return -1
		const data = await (map.getSource(key) as GeoJSONSource).getData()
		return data.type === 'FeatureCollection' ? data.features.length : -1
	})
}

test('anonymous reader discovers collections by name, layer, group and publisher then follows without an address @regression', async ({
	earthly,
}, testInfo) => {
	const published = await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const source = {
		id: 'ai-suite-directory-east',
		name: 'Eastern field notes',
		group: 'Levant',
		layer: 'Border observations',
		author: 'owner' as const,
	}
	const first = snapshot(source)
	const other = snapshot({
		id: 'ai-suite-directory-north',
		name: 'Northern survey',
		group: 'Europe',
		layer: 'River stations',
		author: 'mara',
	})
	await receive(earthly, [first, other])
	const directory = earthly.page.getByRole('region', { name: 'Published collections', exact: true })
	const eastern = directory.getByRole('article', {
		name: 'Eastern field notes published collection',
		exact: true,
	})
	const northern = directory.getByRole('article', {
		name: 'Northern survey published collection',
		exact: true,
	})
	await expect(eastern).toBeVisible()
	await expect(northern).toBeVisible()
	await expect(eastern).toContainText('Border observations')
	await expect(eastern).toContainText('1 layer · 1 geometry')
	const search = directory.getByRole('searchbox', {
		name: 'Find published collections',
		exact: true,
	})
	for (const term of [
		'Eastern',
		'Border observations',
		'Levant',
		first.pubkey,
		nip19.npubEncode(first.pubkey),
	]) {
		await search.fill(term)
		await expect(eastern).toBeVisible()
		await expect(northern).toHaveCount(0)
	}
	await search.fill('No such collection')
	await expect(directory.getByText(/No loaded collections match/)).toBeVisible()
	await search.fill('Border observations')
	await testInfo.attach(`maplet-directory-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await eastern
		.getByRole('button', { name: 'Follow Eastern field notes in Live Mapper', exact: true })
		.click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Live Mapper workspace', exact: true })
	await expect(dialog).toBeVisible()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await expect(
		frame.getByRole('heading', { name: 'Eastern field notes', exact: true }),
	).toBeVisible()
	await expect(frame.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0)
	await expect(frame.getByRole('checkbox', { name: /Border observations/ })).toBeChecked()
	await expect.poll(() => renderedCount(earthly)).toBe(1)
	const latest = snapshot({ ...source, count: 2, timestamp: first.created_at + 1 })
	await receive(earthly, [latest])
	await expect(frame.getByText('2 geometries', { exact: true })).toBeVisible()
	await expect.poll(() => renderedCount(earthly)).toBe(2)
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	await expect(dialog).toBeHidden()
	await expect(eastern).toContainText('1 layer · 2 geometries')
	expect([...published.values()]).not.toContain(37515)
})

test('directory Follow replaces an existing JSON preview with the subscribed collection @regression', async ({
	earthly,
}) => {
	const published = await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const event = snapshot({
		id: 'ai-suite-existing-preview-follow',
		name: 'Live survey updates',
		group: 'Coast',
		layer: 'Current stations',
		author: 'owner',
		count: 2,
	})
	await receive(earthly, [event])
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Live Mapper workspace', exact: true })
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Explore a JSON file', exact: true }).click()
	await frame.getByRole('button', { name: 'Try example data', exact: true }).click()
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByRole('heading', { name: '10 geometries', exact: true })).toBeVisible()
	await expect.poll(() => renderedCount(earthly)).toBe(10)
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	await expect(dialog).toBeHidden()
	await earthly.page.getByRole('button', { name: 'Hide Live Mapper on map', exact: true }).click()
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.find(
					(entry) => entry.entityType === 'maplet',
				)?.visible,
		)
		.toBe(false)
	await earthly.page
		.getByRole('region', { name: 'Published collections', exact: true })
		.getByRole('button', { name: 'Follow Live survey updates in Live Mapper', exact: true })
		.click()
	await expect(dialog).toBeVisible()
	await expect(
		frame.getByRole('heading', { name: 'Live survey updates', exact: true }),
	).toBeVisible()
	await expect(frame.getByRole('checkbox', { name: /Current stations/ })).toBeChecked()
	await expect(
		frame.getByRole('region', { name: 'Guided geographic import', exact: true }),
	).toHaveCount(0)
	await expect(frame.getByRole('heading', { name: 'Import data', exact: true })).toHaveCount(0)
	await expect(earthly.page.locator('iframe[title="Live Mapper sandbox"]')).toHaveCount(1)
	await expect.poll(() => renderedCount(earthly)).toBe(2)
	await expect
		.poll(
			async () =>
				(await editorLifecycleSnapshot(earthly)).mapStack.find(
					(entry) => entry.entityType === 'maplet',
				)?.visible,
		)
		.toBe(true)
	expect([...published.values()]).not.toContain(37515)
})

test('Maps exposes Follow in Live Mapper for a published collection @regression', async ({
	earthly,
}) => {
	const published = await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const event = snapshot({
		id: 'ai-suite-map-follow',
		name: 'Coastal field notes',
		group: 'Coast',
		layer: 'Survey points',
		author: 'owner',
	})
	await receive(earthly, [event])
	await openPanel(earthly, 'Maps')
	await earthly.page
		.getByRole('button', { name: 'More actions for Coastal field notes', exact: true })
		.click()
	const follow = earthly.page.getByRole('button', {
		name: 'Follow Coastal field notes in Live Mapper',
		exact: true,
	})
	await expect(follow).toBeVisible()
	await follow.click()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/maplets')
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await expect(
		frame.getByRole('heading', { name: 'Coastal field notes', exact: true }),
	).toBeVisible()
	await expect(frame.getByRole('checkbox', { name: /Survey points/ })).toBeChecked()
	await expect.poll(() => renderedCount(earthly)).toBe(1)
	expect([...published.values()]).not.toContain(37515)
})
