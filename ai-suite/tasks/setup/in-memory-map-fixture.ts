import { hexToBytes } from '@noble/hashes/utils.js'
import { expect } from '@playwright/test'
import { finalizeEvent, nip19 } from 'nostr-tools'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { testIdentities } from '../../test-identities'

export const installInMemoryMapFixtureTask: AiTaskMetadata = {
	id: 'setup.in-memory-map-fixture',
	summary: 'Install a signed Map and optional comments in page memory, including reloads.',
	preconditions: ['Local Earthly page is open', 'The development EventStore handle is available'],
	sideEffects: ['Adds signed fixture events to page memory; writes nothing to a relay'],
	viewports: 'both',
}

export async function installInMemoryMapFixture(
	earthly: EarthlySession,
	input: {
		title: string
		author?: 'owner' | 'mara'
		identifier?: string
		commentCount?: number
		/** Exercise reply, reaction sorting, and annotation controls without publishing. */
		includeDiscussionFeatures?: boolean
	},
) {
	const identifier = input.identifier ?? 'ai-suite-in-memory-map'
	const timestamp = Math.floor(Date.now() / 1000) - 100
	const event = finalizeEvent(
		{
			kind: 37515,
			created_at: timestamp,
			tags: [
				['d', identifier],
				['bbox', '13.98,46.7,13.98,46.7'],
			],
			content: JSON.stringify({
				type: 'FeatureCollection',
				name: input.title,
				features: [
					{
						type: 'Feature',
						id: 'meeting-point',
						properties: { name: 'Meeting point' },
						geometry: { type: 'Point', coordinates: [13.98, 46.7] },
					},
				],
			}),
		},
		hexToBytes(testIdentities[input.author ?? 'owner'].secretKeyHex),
	)
	const address = `${event.kind}:${event.pubkey}:${identifier}`
	const comments = Array.from({ length: input.commentCount ?? 0 }, (_, index) =>
		finalizeEvent(
			{
				kind: 37517,
				created_at: timestamp + index + 1,
				tags: [
					['d', `${identifier}-comment-${index}`],
					['K', '37515'],
					['k', '37515'],
					['A', address],
					['a', address],
					['P', event.pubkey],
					['p', event.pubkey],
				],
				content: JSON.stringify({
					text: `Fixture comment ${String(index + 1).padStart(2, '0')}: a short field note.`,
					...(input.includeDiscussionFeatures && index === 0
						? {
								geojson: {
									type: 'FeatureCollection',
									features: [
										{
											type: 'Feature',
											id: 'discussion-place',
											properties: { name: 'Comment meeting point' },
											geometry: { type: 'Point', coordinates: [13.98, 46.7] },
										},
									],
								},
							}
						: {}),
				}),
			},
			hexToBytes(testIdentities.mara.secretKeyHex),
		),
	)
	const fixtures = [event, ...comments]
	const discussionParent = comments[0]
	const replyText = 'Fixture reply: use the marked meeting point after the survey.'
	if (input.includeDiscussionFeatures && discussionParent) {
		const parentAddress = `37517:${discussionParent.pubkey}:${identifier}-comment-0`
		fixtures.push(
			finalizeEvent(
				{
					kind: 37517,
					created_at: timestamp + comments.length + 1,
					tags: [
						['d', `${identifier}-reply`],
						['K', '37515'],
						['k', '37517'],
						['A', address],
						['a', parentAddress],
						['P', event.pubkey],
						['p', discussionParent.pubkey],
						['e', discussionParent.id],
					],
					content: JSON.stringify({ text: replyText }),
				},
				hexToBytes(testIdentities.owner.secretKeyHex),
			),
			finalizeEvent(
				{
					kind: 7,
					created_at: timestamp + comments.length + 2,
					tags: [
						['a', parentAddress],
						['e', discussionParent.id],
						['p', discussionParent.pubkey],
						['k', '37517'],
					],
					content: '+',
				},
				hexToBytes(testIdentities.owner.secretKeyHex),
			),
		)
	}
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await earthly.page.evaluate((events) => {
		const store = (
			window as unknown as {
				__earthlyEventStore?: { add(event: (typeof events)[number]): unknown }
			}
		).__earthlyEventStore
		if (!store) throw new Error('Earthly EventStore is unavailable')
		for (const fixture of events) store.add(fixture)
	}, fixtures)
	await earthly.page.addInitScript((events) => {
		const insertWhenReady = () => {
			const store = (
				window as unknown as {
					__earthlyEventStore?: { add(event: (typeof events)[number]): unknown }
				}
			).__earthlyEventStore
			if (store) for (const fixture of events) store.add(fixture)
			else requestAnimationFrame(insertWhenReady)
		}
		insertWhenReady()
	}, fixtures)
	return {
		title: input.title,
		address,
		path: `/map/${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier })}`,
		commentTexts: comments.map((comment) => (JSON.parse(comment.content) as { text: string }).text),
		replyText: input.includeDiscussionFeatures && discussionParent ? replyText : null,
	}
}
