import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, nip19, type NostrEvent } from 'nostr-tools'
import { expect, test } from '../fixtures/earthly'
import { testIdentities } from '../test-identities'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('Story layers count distinct Map sources and retain independent controls @editor-contract', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'The canvas Shelf strip is a desktop surface.')
	const result = await promisify(execFile)('bun', [resolve('scripts/fixtures/ww1-story.ts')], {
		maxBuffer: 2 * 1024 * 1024,
	})
	const fixture = JSON.parse(result.stdout) as {
		events: NostrEvent[]
		presentation: { layers: Array<{ source: string; featureIds?: string[] }> }
		story: { event: NostrEvent; path: string }
	}
	const source = fixture.presentation.layers[0]!
	const [kind, pubkey, ...identifier] = source.source.split(':')
	const mapAddress = nip19.naddrEncode({
		kind: Number(kind),
		pubkey: pubkey!,
		identifier: identifier.join(':'),
	})
	const story = finalizeEvent(
		{
			kind: fixture.story.event.kind,
			created_at: fixture.story.event.created_at + 1,
			tags: [fixture.story.event.tags.find((tag) => tag[0] === 'd')!, ['a', source.source]],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				title: 'One Map, nineteen presentation layers',
				content: `Independent styles and visibility reuse the same [Map source](nostr:${mapAddress}).`,
				presentation: {
					version: 1,
					layers: Array.from({ length: 19 }, (_, index) => ({
						id: `layer-${index}`,
						source: source.source,
						featureIds: source.featureIds,
						visible: true,
					})),
				},
			}),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	const events = new Map(fixture.events.map((event) => [event.id, event]))
	events.delete(fixture.story.event.id)
	events.set(story.id, story)
	await installIsolatedRelays(earthly, events)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open({ path: fixture.story.path })
	const layers = earthly.page.getByRole('list', { name: 'Layers on the canvas', exact: true })
	const chips = layers.locator('[data-shelf-item^="presentation:story:"]')
	await expect(chips).toHaveCount(19)
	await expect(
		earthly.page.getByRole('button', {
			name: 'On the map, 1 Map · 19 layers',
			exact: true,
		}),
	).toBeVisible()
	await chips
		.first()
		.getByRole('button', { name: /^Hide / })
		.click()
	await expect(chips.first().getByRole('button', { name: /^Show / })).toHaveAttribute(
		'aria-pressed',
		'false',
	)
	await expect(chips.nth(1).getByRole('button', { name: /^Hide / })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
	await expect(
		earthly.page.getByRole('button', {
			name: 'On the map, 1 Map · 19 layers',
			exact: true,
		}),
	).toBeVisible()
})
