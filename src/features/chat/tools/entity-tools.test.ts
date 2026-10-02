import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { type Observable, Subject, of, throwError } from 'rxjs'
import { eventStore, pool } from '@/lib/nostr'
import { ARTICLE_KIND, GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { MAP_CALLOUTS_PROPERTY } from '@/lib/geo/callouts'
import { fetchLatestByCoordinate, parseEntityReference } from './entity-tools'
import { dispatch } from './registry'

const PUBKEY = 'a'.repeat(64)
const addedEventIds: string[] = []
let restoreRequest: (() => void) | undefined

afterEach(() => {
	restoreRequest?.()
	restoreRequest = undefined
	for (const id of addedEventIds.splice(0)) eventStore.remove(id)
})

function requestFixture(source: Observable<NostrEvent>) {
	const request = spyOn(pool, 'request').mockImplementation(() => source)
	restoreRequest = () => request.mockRestore()
	return request
}

function revisions(kind = ARTICLE_KIND) {
	const secret = generateSecretKey()
	const identifier = crypto.randomUUID()
	const original = finalizeEvent(
		{ kind, created_at: 100, tags: [['d', identifier]], content: '{}' },
		secret,
	)
	const next = (created_at: number, content = '{}', tags = original.tags) => {
		const event = finalizeEvent({ kind, created_at, tags, content }, secret)
		addedEventIds.push(event.id)
		return event
	}
	addedEventIds.push(original.id)
	eventStore.add(original)
	return {
		original,
		next,
		ref: { kind, pubkey: original.pubkey, identifier },
		reference: `${kind}:${original.pubkey}:${identifier}`,
	}
}

describe('public coordinate refresh', () => {
	it('keeps default cached reads instant without opening a relay query', async () => {
		const fixture = revisions()
		const request = requestFixture(new Subject())
		expect(await fetchLatestByCoordinate(fixture.ref)).toBe(fixture.original)
		expect(request).not.toHaveBeenCalled()
	})

	it('refreshes once and waits for the full query before selecting the newest signed source', async () => {
		const fixture = revisions()
		const updates = new Subject<NostrEvent>()
		const request = requestFixture(updates)
		const newer = fixture.next(102),
			older = fixture.next(101)
		let settled = false
		const read = fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true })
		read.then(() => {
			settled = true
		})
		updates.next(newer)
		updates.next(older)
		await Promise.resolve()
		expect(settled).toBe(false)
		expect(
			eventStore.getReplaceable(fixture.ref.kind, fixture.ref.pubkey, fixture.ref.identifier)?.id,
		).toBe(fixture.original.id)
		updates.complete()
		expect((await read)?.id).toBe(newer.id)
		expect(request).toHaveBeenCalledTimes(1)
		expect(request.mock.calls[0]?.[1]).toEqual({
			kinds: [fixture.ref.kind],
			authors: [fixture.ref.pubkey],
			'#d': [fixture.ref.identifier],
		})
	})

	it('rejects unrelated coordinates and forged signed bytes even with a copied verified marker', async () => {
		const fixture = revisions()
		const signed = fixture.next(105)
		const wrongIdentifier = fixture.next(106, '{}', [['d', 'other']])
		const wrongAuthor = finalizeEvent(
			{ kind: ARTICLE_KIND, created_at: 107, tags: fixture.original.tags, content: '{}' },
			generateSecretKey(),
		)
		requestFixture(
			of(
				wrongIdentifier,
				wrongAuthor,
				{ ...signed, kind: GEO_EVENT_KIND },
				{ ...signed, content: 'forged' },
			),
		)
		expect((await fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true }))?.id).toBe(
			fixture.original.id,
		)
		expect(eventStore.getEvent(signed.id)).toBeUndefined()
	})

	it('uses the NIP-01 lower event ID when valid revisions have equal timestamps', async () => {
		const fixture = revisions()
		const first = fixture.next(102, 'first'),
			second = fixture.next(102, 'second')
		const [winner, loser] = first.id < second.id ? [first, second] : [second, first]
		requestFixture(of(winner, loser))
		expect((await fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true }))?.id).toBe(
			winner.id,
		)
	})

	it('retains a known source when EOSE or relay failure brings no newer result', async () => {
		const fixture = revisions()
		const request = requestFixture(of(fixture.next(99)))
		expect((await fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true }))?.id).toBe(
			fixture.original.id,
		)
		request.mockImplementation(() => throwError(() => new Error('Relay disconnected')))
		expect((await fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true }))?.id).toBe(
			fixture.original.id,
		)
	})

	it('ingests a verified source when no cached revision exists', async () => {
		const fixture = revisions()
		eventStore.remove(fixture.original.id)
		requestFixture(of(fixture.original))
		expect((await fetchLatestByCoordinate(fixture.ref))?.id).toBe(fixture.original.id)
		expect(
			eventStore.getReplaceable(fixture.ref.kind, fixture.ref.pubkey, fixture.ref.identifier)?.id,
		).toBe(fixture.original.id)
	})

	it('does not downgrade a newer cache revision ingested while the query is pending', async () => {
		const fixture = revisions()
		const updates = new Subject<NostrEvent>()
		requestFixture(updates)
		const read = fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true })
		updates.next(fixture.next(101))
		const concurrent = fixture.next(103)
		eventStore.add(concurrent)
		updates.complete()
		expect((await read)?.id).toBe(concurrent.id)
	})

	it('cancels pending refresh and closes its subscription without committing an intermediate result', async () => {
		const fixture = revisions()
		const updates = new Subject<NostrEvent>()
		requestFixture(updates)
		const controller = new AbortController()
		const newer = fixture.next(101)
		const read = fetchLatestByCoordinate(fixture.ref, controller.signal, { refresh: true })
		updates.next(newer)
		controller.abort(new Error('Read cancelled'))
		await expect(read).rejects.toThrow('Read cancelled')
		expect(updates.observed).toBe(false)
		expect(eventStore.getEvent(newer.id)).toBeUndefined()
		expect(() =>
			fetchLatestByCoordinate(fixture.ref, controller.signal, { refresh: true }),
		).toThrow('Read cancelled')
	})

	it('refresh never mixes a later dataset page with its earlier revision', async () => {
		const fixture = revisions(GEO_EVENT_KIND)
		const newer = fixture.next(101, JSON.stringify({ type: 'FeatureCollection', features: [] }))
		const request = requestFixture(of(newer))
		expect(
			await dispatch('read_entity', {
				reference: fixture.reference,
				refresh: true,
				revisionId: fixture.original.id,
				offset: 150,
			}),
		).toMatchObject({ ok: false, error: 'stale_revision' })
		expect(request).toHaveBeenCalledTimes(1)
	})

	it('bounds a silent relay query and closes its subscription while retaining the known source', async () => {
		const fixture = revisions()
		const updates = new Subject<NostrEvent>()
		requestFixture(updates)
		let deadline: (() => void) | undefined
		const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
			handler: Parameters<typeof setTimeout>[0],
		) => {
			deadline = handler as () => void
			return 0 as unknown as ReturnType<typeof setTimeout>
		}) as typeof setTimeout)
		try {
			const read = fetchLatestByCoordinate(fixture.ref, undefined, { refresh: true })
			expect(timeout.mock.calls[0]?.[1]).toBe(10_000)
			if (!deadline) throw new Error('Refresh did not schedule its bounded deadline')
			deadline()
			expect((await read)?.id).toBe(fixture.original.id)
			expect(updates.observed).toBe(false)
		} finally {
			timeout.mockRestore()
		}
	})
})

describe('parseEntityReference', () => {
	it('decodes a bare naddr', () => {
		const naddr = nip19.naddrEncode({ kind: 37520, pubkey: PUBKEY, identifier: 'my-story' })
		expect(parseEntityReference(naddr)).toEqual({
			kind: 37520,
			pubkey: PUBKEY,
			identifier: 'my-story',
		})
	})

	it('strips the nostr: prefix and returns a #featureId fragment', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'lanes' })
		expect(parseEntityReference(`nostr:${naddr}#feature-7`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'lanes',
			featureId: 'feature-7',
		})
	})

	it('decodes OSM-style feature selectors from a canonical mention', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'lanes' })
		expect(parseEntityReference(`nostr:${naddr}#relation%2F62504`).featureId).toBe('relation/62504')
	})

	it('accepts a kind:pubkey:d coordinate', () => {
		expect(parseEntityReference(`37518:${PUBKEY}:topic-1`)).toEqual({
			kind: 37518,
			pubkey: PUBKEY,
			identifier: 'topic-1',
		})
	})

	it('keeps colons inside the d-tag of a coordinate', () => {
		expect(parseEntityReference(`37515:${PUBKEY}:a:b:c`)).toEqual({
			kind: 37515,
			pubkey: PUBKEY,
			identifier: 'a:b:c',
		})
	})

	it('rejects empty and malformed references', () => {
		expect(() => parseEntityReference('')).toThrow()
		expect(() => parseEntityReference(undefined)).toThrow()
		expect(() => parseEntityReference('naddr1notreal')).toThrow()
		expect(() => parseEntityReference('37515:onlytwo')).toThrow()
		expect(() => parseEntityReference('nan:pk:d')).toThrow()
	})
})

describe('read_entity dataset callout inventory', () => {
	it('reports compact callout counts and summaries without returning unbounded text', async () => {
		const identifier = 'flood-map'
		const longText = `Timeline detail: ${'downstream '.repeat(100)}`
		const event = finalizeEvent(
			{
				kind: GEO_EVENT_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					type: 'FeatureCollection',
					name: 'Flood map',
					features: [
						{
							type: 'Feature',
							id: 'river-route',
							geometry: {
								type: 'LineString',
								coordinates: [
									[85, 28],
									[85.1, 27.9],
								],
							},
							properties: {
								name: 'Trishuli flood route',
								[MAP_CALLOUTS_PROPERTY]: [
									{
										id: 'callout-a',
										title: 'Border crossing damaged',
										text: 'The crossing was reported damaged at 08:44.',
									},
									{ id: 'callout-b', text: longText },
								],
							},
						},
					],
				}),
			},
			generateSecretKey(),
		)
		eventStore.add(event)
		addedEventIds.push(event.id)

		const result = (await dispatch('read_entity', {
			reference: `${GEO_EVENT_KIND}:${event.pubkey}:${identifier}`,
		})) as {
			calloutCount?: number
			calloutFeatureCount?: number
			features?: Array<{
				id: string
				calloutCount?: number
				callouts?: Array<{
					id: string
					title?: string
					text: string
					textTruncated?: boolean
				}>
			}>
		}

		expect(result.calloutCount).toBe(2)
		expect(result.calloutFeatureCount).toBe(1)
		expect(result.features?.[0]).toMatchObject({
			id: 'river-route',
			calloutCount: 2,
			callouts: [
				{
					id: 'callout-a',
					title: 'Border crossing damaged',
					text: 'The crossing was reported damaged at 08:44.',
				},
				{ id: 'callout-b', textTruncated: true },
			],
		})
		expect(result.features?.[0]?.callouts?.[1]?.text.length).toBeLessThan(300)
		expect(JSON.stringify(result)).not.toContain(longText)
	})
})

describe('read_entity paginated published feature inventory', () => {
	it('reads every feature in bounded pages bound to the same published revision', async () => {
		const identifier = crypto.randomUUID()
		const secret = generateSecretKey()
		const event = finalizeEvent(
			{
				kind: GEO_EVENT_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					type: 'FeatureCollection',
					features: Array.from({ length: 165 }, (_, index) => ({
						type: 'Feature',
						id: `place-${index}`,
						properties: {},
						geometry: { type: 'Point', coordinates: [16, 48] },
					})),
				}),
			},
			secret,
		)
		eventStore.add(event)
		addedEventIds.push(event.id)
		const reference = `${GEO_EVENT_KIND}:${event.pubkey}:${identifier}`
		const first = (await dispatch('read_entity', { reference })) as any
		expect(first).toMatchObject({
			revisionId: event.id,
			featureCount: 165,
			offset: 0,
			nextOffset: 150,
			featuresTruncated: true,
		})
		expect(first.features).toHaveLength(150)
		const second = (await dispatch('read_entity', {
			reference,
			offset: first.nextOffset,
			revisionId: first.revisionId,
		})) as any
		expect(second).toMatchObject({ revisionId: event.id, offset: 150, nextOffset: null })
		expect(second.features).toHaveLength(15)
		expect(second.features.at(-1).id).toBe('place-164')
		expect(new Set([...first.features, ...second.features].map((feature) => feature.id)).size).toBe(
			165,
		)
		expect(await dispatch('read_entity', { reference, offset: 150 })).toMatchObject({
			ok: false,
			message: expect.stringContaining('revisionId'),
		})
		expect(await dispatch('read_entity', { reference, limit: 151 })).toMatchObject({
			ok: false,
			message: expect.stringContaining('between 1 and 150'),
		})
		const replacement = finalizeEvent({ ...event, created_at: event.created_at + 1 }, secret)
		eventStore.add(replacement)
		addedEventIds.push(replacement.id)
		const stale = await dispatch('read_entity', { reference, revisionId: event.id, offset: 150 })
		expect(stale).toMatchObject({ ok: false, error: 'stale_revision' })
	})
})

describe('read_entity Story presentation inventory', () => {
	it('returns opening presentation and physical view diagnostics alongside published Markdown', async () => {
		const presentation = { version: 1, initialView: { center: [2, 49], zoom: 6 }, layers: [] }
		const markdown =
			'The opening paragraph.\n\n```earthly-view\n{"version":1,"type":"view","id":"first","title":"A closer look","display":"both","camera":{"center":[2,49],"zoom":10}}\n```'
		const event = finalizeEvent(
			{
				kind: ARTICLE_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', 'story-presentation']],
				content: JSON.stringify({ title: 'Story presentation', content: markdown, presentation }),
			},
			generateSecretKey(),
		)
		eventStore.add(event)
		addedEventIds.push(event.id)
		await expect(
			dispatch('read_entity', { reference: `${ARTICLE_KIND}:${event.pubkey}:story-presentation` }),
		).resolves.toMatchObject({
			markdown,
			presentation,
			presentationTruncated: false,
			mapAuthoring: {
				presentationStatus: 'valid',
				viewBlockCount: 1,
				viewBlocks: [{ id: 'first', display: 'both', status: 'valid' }],
			},
		})
	})

	it('bounds opaque future presentation output and directs full reads to the draft tool', async () => {
		const event = finalizeEvent(
			{
				kind: ARTICLE_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', 'future-presentation']],
				content: JSON.stringify({
					title: 'Future presentation',
					content: 'Prose',
					presentation: { version: 12, futureData: 'x'.repeat(25_000) },
				}),
			},
			generateSecretKey(),
		)
		eventStore.add(event)
		addedEventIds.push(event.id)
		await expect(
			dispatch('read_entity', { reference: `${ARTICLE_KIND}:${event.pubkey}:future-presentation` }),
		).resolves.toMatchObject({
			presentation: undefined,
			presentationTruncated: true,
			mapAuthoring: { presentationStatus: 'unsupported' },
			editHint: expect.stringContaining('read_story_draft'),
		})
	})
})
