import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, matchFilter, nip19, type Filter } from 'nostr-tools'
import { expect, test } from '../fixtures/earthly'
import type { EarthlySession } from '../core/session'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { testIdentities } from '../test-identities'

async function catalogRelay(earthly: EarthlySession) {
	const timestamp = Math.floor(Date.now() / 1000)
	const events = Array.from({ length: 225 }, (_, index) => finalizeEvent({
		kind: 37515, created_at: timestamp - index, tags: [['d', `catalog-${index}`], ['bbox', '13,46,13,46']],
		content: JSON.stringify({ type: 'FeatureCollection', name: `Catalog Map ${index}`, features: [{ type: 'Feature', id: 'point', properties: {}, geometry: { type: 'Point', coordinates: [13, 46] } }] }),
	}, hexToBytes(testIdentities.owner.secretKeyHex)))
	const requested: Filter[] = []
	await earthly.page.routeWebSocket(/^ws:\/\/(?:localhost|127\.0\.0\.1):3334\/?$/, socket => {
		socket.onMessage(raw => {
			const message = JSON.parse(String(raw)) as unknown[]
			if (message[0] !== 'REQ') return
			const filters = message.slice(2) as Filter[]
			requested.push(...filters)
			const matching = new Set(filters.flatMap(filter => events.filter(event => matchFilter(filter, event)).slice(0, filter.limit ?? events.length)))
			for (const event of matching) socket.send(JSON.stringify(['EVENT', message[1], event]))
			socket.send(JSON.stringify(['EOSE', message[1]]))
		})
	})
	return { requested, oldPath: `/map/${nip19.naddrEncode({ kind: 37515, pubkey: testIdentities.owner.publicKey, identifier: 'catalog-224' })}` }
}

test('initial Browse is bounded; older pages and full-history filters remain reachable', async ({ earthly }) => {
	const relay = await catalogRelay(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await openPanel(earthly, 'Maps')
	await expect.poll(() => relay.requested.some(filter => filter.kinds?.includes(37515) && filter.limit === 100)).toBe(true)
	expect(relay.requested.filter(filter => filter.kinds?.includes(37515) && !filter.authors && filter.limit === undefined)).toHaveLength(0)
	await earthly.page.getByRole('button', { name: 'Load older maps', exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: 'Open map Catalog Map 100', exact: true })).toBeVisible()
	await earthly.page.getByRole('textbox', { name: 'Filter maps…', exact: true }).fill('Catalog Map 224')
	await expect(earthly.page.getByRole('button', { name: 'Open map Catalog Map 224', exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Open map Catalog Map 224', exact: true }).click()
	await expect(earthly.page.getByRole('region', { name: 'Map inspection' })).toContainText('Catalog Map 224')
})

test('a deep link resolves a Map outside the initial catalog without downloading all Maps', async ({ earthly }) => {
	const relay = await catalogRelay(earthly)
	await earthly.open({ tour: 'seen' })
	await earthly.page.goto(new URL(relay.oldPath, earthly.environment.baseURL).href)
	await expect(earthly.page.getByRole('region', { name: 'Map inspection' })).toContainText('Catalog Map 224')
	expect(relay.requested.some(filter => filter['#d']?.includes('catalog-224') && filter.authors?.includes(testIdentities.owner.publicKey))).toBe(true)
	expect(relay.requested.filter(filter => filter.kinds?.includes(37515) && !filter.authors && filter.limit === undefined)).toHaveLength(0)
})
