import { expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { myMapsModel, MAPLET_SOURCE_KIND } from './myMapsModel'
import { myMapsDataPolicy } from './myMapsPolicy'

const source = myMapsModel.source({
	url: 'https://www.google.com/maps/d/viewer?mid=publicMap123&z=4',
	title: 'Coastal survey',
	tags: ['coast'],
})
const key = generateSecretKey()
test('published sources contain canonical links and metadata, never geometry or personal view settings', () => {
	const event = finalizeEvent(
		myMapsModel.announcement({ ...source, opacity: 0.2, hiddenLayers: ['Areas'] }),
		key,
	)
	expect(event.kind).toBe(MAPLET_SOURCE_KIND)
	expect(JSON.parse(event.content)).toEqual({
		version: 1,
		maplet: 'my-maps-viewer',
		url: source.url,
		title: 'Coastal survey',
		description: '',
		tags: ['coast'],
		deleted: false,
	})
	expect(myMapsModel.parseAnnouncement(event).source.opacity).toBe(1)
	expect(event.content).not.toContain('hiddenLayers')
})
test('latest source replacement wins and an unpublish tombstone hides older announcements', () => {
	const first = finalizeEvent({ ...myMapsModel.announcement(source), created_at: 1 }, key)
	const second = finalizeEvent(
		{ ...myMapsModel.announcement({ ...source, title: 'Updated' }), created_at: 2 },
		key,
	)
	const deleted = finalizeEvent({ ...myMapsModel.announcement(source, true), created_at: 3 }, key)
	expect(myMapsModel.latest([second, first, second]).map((item) => item.source.title)).toEqual([
		'Updated',
	])
	expect(myMapsModel.latest([deleted, first, second])).toEqual([])
})
test('public source schema rejects geometry, mismatched tags and unrelated links', () => {
	const event = finalizeEvent(myMapsModel.announcement(source), key)
	expect(() =>
		myMapsModel.parseAnnouncement({
			...event,
			content: JSON.stringify({ ...JSON.parse(event.content), features: [] }),
		}),
	).toThrow()
	expect(() =>
		myMapsModel.parseAnnouncement({ ...event, tags: [['d', 'another-source']] }),
	).toThrow()
	expect(() => myMapsModel.source({ ...source, url: 'https://evil.example/data' })).toThrow()
})
test('saved preferences are bounded, deduplicate canonical URLs, and preserve view choices', () => {
	const saved = myMapsModel.preferences({
		version: 1,
		sources: [{ ...source, visible: false, opacity: 0.5, hiddenLayers: ['Areas'] }],
	})
	expect(saved.sources[0]).toMatchObject({ visible: false, opacity: 0.5, hiddenLayers: ['Areas'] })
	expect(() => myMapsModel.preferences({ version: 1, sources: [source, source] })).toThrow(
		'Duplicate',
	)
	expect(() => myMapsModel.source({ ...source, opacity: NaN })).toThrow()
	expect(() => myMapsModel.preferences({ version: 1, sources: Array(13).fill(source) })).toThrow(
		'12-source',
	)
})
test('host grants only source discovery and the active owner’s exact private app-data address', () => {
	const pubkey = 'a'.repeat(64)
	expect(
		myMapsDataPolicy.filters(
			[{ kinds: [MAPLET_SOURCE_KIND], '#t': ['maplet-source'], limit: 999 }],
			'',
		)[0]?.limit,
	).toBe(500)
	expect(() => myMapsDataPolicy.filters([{ kinds: [1] }], pubkey)).toThrow()
	expect(() =>
		myMapsDataPolicy.filters(
			[{ kinds: [30078], authors: ['b'.repeat(64)], '#d': [myMapsModel.preferencesId] }],
			pubkey,
		),
	).toThrow()
	expect(() =>
		myMapsDataPolicy.template({ kind: 1, content: 'hello', tags: [] }, pubkey, false),
	).toThrow()
	expect(() =>
		myMapsDataPolicy.template({ kind: 30078, content: '{}', tags: [] }, pubkey, false),
	).toThrow()
})
