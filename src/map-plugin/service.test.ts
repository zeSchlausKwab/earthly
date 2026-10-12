import { describe, expect, spyOn, test } from 'bun:test'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { PublicMapDraftStore, PublicMapSession, type MapGateway } from './service'
import { decodeMapReference, createMapEmbed } from '@/features/public-map/references'
import { readPublicMap } from './gateway'
import { DEMO_MAP } from './fixtures'
import { parseViewOptions, validateMapData } from '@/features/public-map/model'

function memoryGateway() {
	const events: NostrEvent[] = []
	const attempts: NostrEvent[] = []
	const gateway: MapGateway = {
		relays: ['ws://127.0.0.1:3334'],
		read: async (reference) => {
			const pointer = decodeMapReference(reference)
			return (
				[...events]
					.reverse()
					.find(
						(event) =>
							event.pubkey === pointer.pubkey &&
							event.tags.some((tag) => tag[0] === 'd' && tag[1] === pointer.identifier),
					) ?? null
			)
		},
		publish: async (event) => {
			attempts.push(event)
			events.push(event)
			return [{ from: 'ws://127.0.0.1:3334', ok: true }]
		},
	}
	return { gateway, events, attempts }
}

describe('public map lifecycle', () => {
	test('preview is temporary; publication is signed and fresh reads need no session', async () => {
		const { gateway, events } = memoryGateway()
		const session = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const preview = session.preview({ title: 'Danube', data: DEMO_MAP })
		expect(events).toHaveLength(0)
		expect(preview.reference).toBeUndefined()
		const published = await session.publish(preview.draftId!, preview.revision!)
		expect(verifyEvent(events[0]!)).toBe(true)
		expect(events[0]!.kind).toBe(37515)
		expect(events[0]!.tags).toContainEqual(['title', 'Danube'])
		session.dispose()
		const reopened = await readPublicMap(gateway, 'https://maps.example', published.reference!)
		expect(reopened.data).toEqual(preview.data)
		expect(reopened.eventId).toBe(published.eventId)
		expect(JSON.stringify(published)).not.toContain('privateKey')
	})
	test('updates preserve address and IDs, and stale or foreign revisions cannot publish', async () => {
		const { gateway, events } = memoryGateway()
		const session = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const other = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const preview = session.preview({ title: 'First', data: DEMO_MAP })
		expect(() => other.publish(preview.draftId!, 1)).toThrow('not found')
		const published = await session.publish(preview.draftId!, 1)
		const edited = session.preview({
			title: 'Changed',
			data: DEMO_MAP,
			draftId: preview.draftId,
			revision: 1,
		})
		expect(() => session.publish(preview.draftId!, 1)).toThrow('revision')
		const next = await session.publish(edited.draftId!, 2)
		expect(next.reference).toBe(published.reference)
		expect(events[1]!.created_at).toBeGreaterThan(events[0]!.created_at)
		expect(next.data.features.map((feature) => feature.id)).toEqual(['vienna', 'journey', 'area'])
		await session.publish(edited.draftId!, 2)
		expect(events).toHaveLength(2)
	})
	test('a lost receipt reuses the exact signed event and prevents edits until retry', async () => {
		const { gateway, attempts } = memoryGateway()
		let accept = false
		gateway.publish = async (event) => {
			attempts.push(event)
			return [{ from: gateway.relays[0]!, ok: accept }]
		}
		const session = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const preview = session.preview({ title: 'Retry', data: DEMO_MAP })
		await expect(session.publish(preview.draftId!, 1)).rejects.toThrow('No relay accepted')
		expect(() =>
			session.preview({ title: 'Oops', data: DEMO_MAP, draftId: preview.draftId, revision: 1 }),
		).toThrow('uncertain')
		accept = true
		await session.publish(preview.draftId!, 1)
		expect(attempts[0]).toEqual(attempts[1])
	})
	test('concurrent publication calls share a single commit', async () => {
		const { gateway, attempts } = memoryGateway()
		const session = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const draft = session.preview({ title: 'Once', data: DEMO_MAP })
		const results = await Promise.all([
			session.publish(draft.draftId!, 1),
			session.publish(draft.draftId!, 1),
		])
		expect(attempts).toHaveLength(1)
		expect(results[0]!.eventId).toBe(results[1]!.eventId)
	})
	test('expired sessions cannot create or publish drafts', () => {
		const { gateway } = memoryGateway()
		const session = new PublicMapSession(gateway, 'https://maps.example', 0)
		expect(() => session.preview({ title: 'Expired', data: DEMO_MAP })).toThrow('expired')
	})
	test('guest capabilities survive disconnect but cannot extend their fixed lifetime', async () => {
		const { gateway } = memoryGateway()
		const now = Date.now()
		const store = new PublicMapDraftStore()
		const first = new PublicMapSession(gateway, 'https://maps.example', now + 1000, store)
		const second = new PublicMapSession(gateway, 'https://maps.example', now + 10000, store)
		const preview = first.preview({ title: 'Reconnect', data: DEMO_MAP })
		const published = await first.publish(preview.draftId!, 1)
		first.dispose()
		const edited = second.preview({ ...preview, title: 'Reconnected' })
		expect(edited.expiresAt).toBe(preview.expiresAt)
		const next = await second.publish(edited.draftId!, 2)
		expect(next.reference).toBe(published.reference)
		const clock = spyOn(Date, 'now').mockReturnValue(now + 1001)
		try {
			expect(() => second.publish(edited.draftId!, 2)).toThrow('expired')
			expect(store.size).toBe(0)
		} finally {
			clock.mockRestore()
			store.dispose()
		}
	})
	test('shared guest storage stays bounded across connection churn', () => {
		const { gateway } = memoryGateway()
		const store = new PublicMapDraftStore(1)
		const first = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000, store)
		const second = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000, store)
		const preview = first.preview({ title: 'First', data: DEMO_MAP })
		first.dispose()
		expect(() => second.preview({ title: 'Second', data: DEMO_MAP })).toThrow('capacity')
		expect(second.preview({ ...preview, title: 'Update existing' }).revision).toBe(2)
		store.dispose()
	})
})

describe('map input and embed boundary', () => {
	test('rejects invalid coordinates, open rings, duplicate IDs and oversized payloads', () => {
		const invalid = structuredClone(DEMO_MAP)
		invalid.features[0]!.geometry = { type: 'Point', coordinates: [48, 180] }
		expect(() => validateMapData(invalid)).toThrow()
		invalid.features[0]!.geometry = {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
				],
			],
		}
		expect(() => validateMapData(invalid)).toThrow()
		expect(() =>
			validateMapData({ ...DEMO_MAP, features: [DEMO_MAP.features[0], DEMO_MAP.features[0]] }),
		).toThrow('Duplicate')
		expect(() => validateMapData({ ...DEMO_MAP, extra: 'x'.repeat(50000) })).toThrow('inline maps')
	})
	test('embed options round-trip without changing data or needing an edit token', async () => {
		const { gateway } = memoryGateway()
		const session = new PublicMapSession(gateway, 'https://maps.example', Date.now() + 10000)
		const draft = session.preview({ title: 'Embed', data: DEMO_MAP })
		const saved = await session.publish(draft.draftId!, 1)
		const embed = createMapEmbed(
			'https://maps.example',
			saved.reference!,
			{ theme: 'dark', legend: false, center: [16, 48], zoom: 7 },
			640,
		)
		expect(parseViewOptions(new URL(embed.embedUrl).searchParams)).toEqual(embed.view)
		expect(embed.html).toContain('&amp;')
		expect(embed.html).toContain('height="640"')
		expect(embed.embedUrl).not.toContain(draft.draftId!)
		expect(() => parseViewOptions(new URLSearchParams('legend=maybe'))).toThrow()
		expect(() => parseViewOptions(new URLSearchParams('v=99'))).toThrow()
	})
})
