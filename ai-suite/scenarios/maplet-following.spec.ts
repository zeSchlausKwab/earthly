import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19, type NostrEvent } from 'nostr-tools'
import type { Page } from '@playwright/test'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { createWorkspaceSnapshot } from '../../src/features/maplets/workspace'
import { test, expect } from '../fixtures/earthly'
import { testIdentities } from '../test-identities'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'

function snapshot(version: number, timestamp: number) {
	const collection = createWorkspaceSnapshot({
		id: 'maplet-reader-fixture',
		owner: testIdentities.owner.publicKey,
		name: 'Field observations',
		groups: [{ id: 'region', name: 'Yemen' }],
		layers: [
			{
				id: 'stations',
				name: 'Survey stations',
				groupId: 'region',
				updatedAt: timestamp * 1000,
				collection: {
					type: 'FeatureCollection',
					features: Array.from({ length: version }, (_, index) => ({
						type: 'Feature' as const,
						id: `station-${index}`,
						properties: { name: `Station ${index + 1}` },
						geometry: { type: 'Point' as const, coordinates: [44 + index, 15] },
					})),
				},
			},
		],
	})
	return finalizeEvent(
		{
			kind: 37515,
			created_at: timestamp,
			tags: [['d', 'maplet-reader-fixture']],
			content: JSON.stringify(collection),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
}

async function receive(page: Page, event: NostrEvent) {
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await page.evaluate((value) => {
		;(
			window as unknown as { __earthlyEventStore: { add(event: NostrEvent): unknown } }
		).__earthlyEventStore.add(value)
	}, event)
}

async function renderedCount(page: Page) {
	return page.evaluate(async () => {
		const map = (window as unknown as { __earthlyUiMap: MapLibreMap }).__earthlyUiMap
		const key = Object.keys(map.getStyle().sources).find((id) => id.startsWith('maplet:'))
		if (!key) return -1
		const data = await (map.getSource(key) as GeoJSONSource).getData()
		return data.type === 'FeatureCollection' ? data.features.length : -1
	})
}

test('reader follows exact signed collection updates and keeps private visibility @regression', async ({
	earthly,
}, testInfo) => {
	const published = await installIsolatedRelays(earthly)
	await earthly.open({ path: '/browse/maplets', tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const first = snapshot(1, Math.floor(Date.now() / 1000) - 20)
	const second = snapshot(2, first.created_at + 1)
	await receive(earthly.page, first)
	await earthly.page.getByRole('button', { name: 'Add Live Mapper to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="Live Mapper sandbox"]')
	await frame.getByRole('button', { name: 'Follow', exact: true }).click()
	await frame
		.getByLabel('Collection address', { exact: true })
		.fill(
			nip19.naddrEncode({ kind: 37515, pubkey: first.pubkey, identifier: 'maplet-reader-fixture' }),
		)
	await frame.getByRole('button', { name: 'Follow collection', exact: true }).click()
	await expect(
		frame.getByRole('heading', { name: 'Field observations', exact: true }),
	).toBeVisible()
	await expect(frame.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0)
	await expect(frame.getByRole('heading', { name: 'Yemen', exact: true })).toBeVisible()
	await expect.poll(() => renderedCount(earthly.page)).toBe(1)
	await frame.getByRole('checkbox', { name: /Survey stations/ }).uncheck()
	await expect.poll(() => renderedCount(earthly.page)).toBe(0)
	await receive(earthly.page, second)
	await expect(frame.getByText('2 geometries', { exact: true })).toBeVisible()
	await expect(frame.getByRole('checkbox', { name: /Survey stations/ })).not.toBeChecked()
	await expect.poll(() => renderedCount(earthly.page)).toBe(0)
	await frame.getByRole('checkbox', { name: /Survey stations/ }).check()
	await expect.poll(() => renderedCount(earthly.page)).toBe(2)
	await testInfo.attach(`maplet-reader-${testInfo.project.name}`, {
		body: await earthly.page.screenshot(),
		contentType: 'image/png',
	})
	await frame.getByRole('button', { name: 'View on map', exact: true }).click()
	const maplet = earthly.page.getByRole('article', { name: 'Live Mapper Maplet', exact: true })
	await maplet.getByRole('checkbox', { name: 'Select Station 1', exact: true }).check()
	await maplet.getByRole('button', { name: 'Copy 1 selected to editor', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	const provenance = await earthly.page.evaluate(() => {
		const store = (
			window as unknown as {
				__earthlyEditorStore: {
					getState(): { features: Array<{ properties?: Record<string, unknown> }> }
				}
			}
		).__earthlyEditorStore
		return store?.getState().features[0]?.properties?.mapletWorkspaceSource
	})
	// The copied feature retains the exact consumed event, independently of future feed updates.
	expect(provenance).toMatchObject({ owner: first.pubkey, eventId: second.id })
	expect([...published.values()].includes(37515)).toBe(false)
})
