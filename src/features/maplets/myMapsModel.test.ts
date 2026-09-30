import { expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { myMapsModel, MAPLET_SOURCE_KIND } from './myMapsModel'
import { myMapsDataPolicy } from './myMapsPolicy'

const source = myMapsModel.source({
	url: 'https://www.google.com/maps/d/viewer?mid=publicMap123&z=4',
	title: 'Coastal survey',
	tags: ['coast'],
})
const key = generateSecretKey()
const pubkey = getPublicKey(key)
function signed(input = source, createdAt = 1, deleted = false) {
	return finalizeEvent({ ...myMapsModel.announcement(input, deleted), created_at: createdAt }, key)
}
function legacy(createdAt = 1, deleted = false) {
	return finalizeEvent(
		{
			kind: MAPLET_SOURCE_KIND,
			created_at: createdAt,
			tags: [
				['d', 'my-maps:publicMap123'],
				['t', 'maplet-source'],
				['maplet', 'my-maps-viewer'],
				['r', source.url],
			],
			content: JSON.stringify({
				version: 1,
				maplet: 'my-maps-viewer',
				url: source.url,
				title: source.title,
				description: '',
				tags: source.tags,
				deleted,
			}),
		},
		key,
	)
}

test('configuration announcements share link and defaults without geometry or personal view choices', () => {
	const configured = myMapsModel.source({
		...source,
		active: false,
		visible: false,
		opacity: 0.7,
		hiddenLayers: ['Areas'],
		layerColors: { Coast: '#AB12CD' },
		view: { opacity: 0.2, hiddenLayers: [] },
	})
	const event = signed(configured)
	expect(event.kind).toBe(MAPLET_SOURCE_KIND)
	expect(event.tags[0]).toEqual(['d', `my-maps-config:${source.id}`])
	expect(JSON.parse(event.content)).toEqual({
		version: 2,
		maplet: 'my-maps-viewer',
		id: source.id,
		url: source.url,
		title: source.title,
		description: '',
		tags: ['coast'],
		hiddenLayers: ['Areas'],
		opacity: 0.7,
		layerColors: { Coast: '#ab12cd' },
		deleted: false,
	})
	expect(myMapsModel.parseAnnouncement(event).source).toMatchObject({
		opacity: 0.7,
		hiddenLayers: ['Areas'],
		owner: pubkey,
		published: true,
		active: true,
		visible: true,
		publication: {
			identifier: `my-maps-config:${source.id}`,
			eventId: event.id,
			pubkey,
			createdAt: 1,
		},
	})
	for (const field of ['view', 'visible', 'active', 'owner', 'publication', 'geometry'])
		expect(JSON.parse(event.content)).not.toHaveProperty(field)
})

test('multiple configurations from the same author can use one canonical Google map link', () => {
	const alternate = myMapsModel.source({
		...source,
		id: 'coast-lines',
		title: 'Coast lines',
		hiddenLayers: ['Areas'],
	})
	const events = [signed(source), signed(alternate)]
	expect(myMapsModel.latest(events)).toHaveLength(2)
	expect(events[0]?.tags[0]).not.toEqual(events[1]?.tags[0])
	const saved = myMapsModel.preferences({ version: 2, sources: [source, alternate] })
	expect(saved.sources.map((item) => item.title)).toEqual(['Coastal survey', 'Coast lines'])
})

test('latest replacement wins and withdrawal hides only its own configuration', () => {
	const first = signed()
	const second = signed({ ...source, title: 'Updated' }, 2)
	const other = signed({ ...source, id: 'another-view' }, 2)
	const deleted = signed(source, 3, true)
	expect(myMapsModel.latest([second, first, second]).map((item) => item.source.title)).toEqual([
		'Updated',
	])
	expect(myMapsModel.latest([deleted, first, second, other]).map((item) => item.source.id)).toEqual(
		['another-view'],
	)
	expect(myMapsModel.latest([deleted, first, second], true)[0]?.deleted).toBe(true)
})

test('old public sources remain discoverable with neutral defaults and stable identity', () => {
	const old = legacy()
	const parsed = myMapsModel.parseAnnouncement(old)
	expect(parsed.identifier).toBe('my-maps:publicMap123')
	expect(parsed.source).toMatchObject({
		id: 'legacy-publicMap123',
		hiddenLayers: [],
		layerColors: {},
		opacity: 1,
		owner: pubkey,
	})
	expect(myMapsModel.latest([old])).toHaveLength(1)
	const upgrade = signed({ ...parsed.source, hiddenLayers: ['Areas'], opacity: 0.5 }, 2)
	expect(upgrade.tags[0]).toEqual(old.tags[0])
	expect(myMapsModel.latest([old, upgrade])[0]?.source.opacity).toBe(0.5)
	const withdrawn = signed({ ...parsed.source, id: 'local-legacy-record' }, 3, true)
	expect(myMapsModel.latest([old, upgrade, withdrawn])).toEqual([])
})

test('v1 encrypted preferences migrate deterministically and keep existing maps active', () => {
	const old = {
		url: source.url,
		title: source.title,
		description: '',
		tags: ['coast'],
		hiddenLayers: ['Areas'],
		opacity: 0.5,
		visible: false,
	}
	const saved = myMapsModel.preferences({ version: 1, sources: [old] })
	expect(saved.version).toBe(2)
	expect(saved.drafts).toEqual([])
	expect(saved.sources[0]).toMatchObject({
		id: 'legacy-publicMap123',
		active: true,
		visible: false,
		opacity: 0.5,
		hiddenLayers: ['Areas'],
		layerColors: {},
	})
	expect(myMapsModel.preferences({ version: 1, sources: [old] })).toEqual(saved)
	expect(() => myMapsModel.preferences({ version: 1, sources: [old, old] })).toThrow('Duplicate')
})

test('v2 preferences bound configurations and drafts and reject duplicate identities', () => {
	const draft = myMapsModel.copy(source)
	const saved = myMapsModel.preferences({
		version: 2,
		sources: [source],
		drafts: [{ ...draft, active: true }],
	})
	expect(saved.drafts[0]?.active).toBe(false)
	expect(() =>
		myMapsModel.preferences({ version: 2, sources: [{ ...source, id: undefined }] }),
	).toThrow()
	expect(() => myMapsModel.preferences({ version: 2, sources: [source, source] })).toThrow(
		'Duplicate',
	)
	expect(
		myMapsModel.preferences({ version: 2, sources: [source], drafts: [source] }).drafts[0]?.id,
	).toBe(source.id)
	expect(() =>
		myMapsModel.preferences({ version: 2, sources: [], drafts: [draft, draft] }),
	).toThrow('Duplicate')
	expect(() => myMapsModel.preferences({ version: 2, sources: Array(13).fill(source) })).toThrow(
		'12-source',
	)
	expect(() =>
		myMapsModel.preferences({ version: 2, sources: [], drafts: Array(13).fill(draft) }),
	).toThrow('12-source')
})

test('owner edits retain a draft beside the published configuration without replacing its defaults', () => {
	const published = myMapsModel.parseAnnouncement(signed()).source
	const edited = myMapsModel.source({ ...published, title: 'Work in progress', opacity: 0.3 })
	const saved = myMapsModel.preferences({ version: 2, sources: [published], drafts: [edited] })
	expect(saved.sources[0]).toMatchObject({
		id: source.id,
		title: source.title,
		opacity: 1,
		owner: pubkey,
		published: true,
	})
	expect(saved.drafts[0]).toMatchObject({
		id: source.id,
		title: 'Work in progress',
		opacity: 0.3,
		owner: pubkey,
		active: false,
	})
	expect(myMapsModel.announcement(edited).tags[0]).toEqual(
		myMapsModel.announcement(published).tags[0],
	)
})

test('incomplete draft links stay private while validated fetching and public identity keep their canonical URL', () => {
	const draft = myMapsModel.source({
		...source,
		inputUrl: 'https://www.google.com/maps/d/viewer?mid=incomplete',
	})
	const saved = myMapsModel.preferences({ version: 2, sources: [], drafts: [draft] })
	expect(saved.drafts[0]?.inputUrl).toBe(draft.inputUrl)
	expect(saved.drafts[0]?.url).toBe(source.url)
	expect(JSON.parse(myMapsModel.announcement(draft).content)).not.toHaveProperty('inputUrl')
	expect(myMapsModel.copy(draft).inputUrl).toBeUndefined()
	expect(() => myMapsModel.source({ ...source, inputUrl: 'a'.repeat(4097) })).toThrow()
	expect(() => myMapsModel.source({ ...source, inputUrl: 12 })).toThrow()
	const event = signed()
	expect(() =>
		myMapsModel.parseAnnouncement({
			...event,
			content: JSON.stringify({ ...JSON.parse(event.content), inputUrl: 'private' }),
		}),
	).toThrow()
})
test('publisher updates preserve local identity, active membership and explicit view overrides', () => {
	const original = myMapsModel.parseAnnouncement(
		signed({ ...source, layerColors: { Coast: '#111111', Roads: '#222222' } }),
	)
	const local = myMapsModel.source({
		...original.source,
		id: 'local-view',
		active: false,
		visible: false,
		view: { hiddenLayers: [], opacity: 0, layerColors: { Coast: '#000000' } },
	})
	const incoming = myMapsModel.parseAnnouncement(
		signed(
			{
				...source,
				title: 'Publisher revision',
				hiddenLayers: ['Areas'],
				opacity: 0.9,
				layerColors: { Coast: '#333333', Roads: '#444444', Parks: '#555555' },
			},
			2,
		),
	)
	const merged = myMapsModel.mergeAnnouncement(local, incoming)
	expect(merged).toMatchObject({
		id: 'local-view',
		active: false,
		visible: false,
		title: 'Publisher revision',
		opacity: 0.9,
		hiddenLayers: ['Areas'],
	})
	expect(myMapsModel.effectiveView(merged)).toEqual({
		hiddenLayers: [],
		opacity: 0,
		layerColors: { Coast: '#000000', Roads: '#444444', Parks: '#555555' },
	})
	expect(myMapsModel.mergeAnnouncement(merged, original)).toEqual(merged)
	expect(() =>
		myMapsModel.mergeAnnouncement(local, { ...incoming, pubkey: 'b'.repeat(64) }),
	).toThrow('another publication')
	expect(
		myMapsModel.effectiveView(myMapsModel.source({ ...merged, view: undefined })),
	).toMatchObject({ hiddenLayers: ['Areas'], opacity: 0.9 })
})

test('withdrawing a followed configuration keeps its saved defaults and viewing choices available', () => {
	const original = myMapsModel.parseAnnouncement(signed())
	const local = myMapsModel.source({
		...original.source,
		id: 'consumer-view',
		view: { opacity: 0.3 },
	})
	const deleted = myMapsModel.parseAnnouncement(signed(source, 2, true))
	const merged = myMapsModel.mergeAnnouncement(local, deleted)
	expect(merged).toMatchObject({
		id: 'consumer-view',
		active: true,
		published: false,
		url: source.url,
		view: { opacity: 0.3 },
	})
})

test('making a copy uses the personal view as independent defaults and drops publisher references', () => {
	const original = myMapsModel.parseAnnouncement(signed())
	const local = myMapsModel.source({
		...original.source,
		view: { opacity: 0.2, hiddenLayers: ['Areas'], layerColors: { Coast: '#000000' } },
	})
	const copied = myMapsModel.copy(local)
	expect(copied.id).not.toBe(local.id)
	expect(copied).toMatchObject({
		active: false,
		published: false,
		opacity: 0.2,
		hiddenLayers: ['Areas'],
		layerColors: { Coast: '#000000' },
	})
	expect(copied.publication).toBeUndefined()
	expect(copied.owner).toBeUndefined()
	expect(copied.view).toBeUndefined()
})

test('public schema rejects geometry, missing defaults, unsafe colors and mismatched identities', () => {
	const event = signed()
	const body = JSON.parse(event.content)
	for (const patch of [
		{ features: [] },
		{ owner: pubkey },
		{ view: { opacity: 0.1 } },
		{ layerColors: { Coast: 'url(https://evil.example)' } },
		{ id: '../invalid' },
		{ maplet: 'different-maplet' },
		{ opacity: 2 },
		{ hiddenLayers: 'Areas' },
	]) {
		expect(() =>
			myMapsModel.parseAnnouncement({ ...event, content: JSON.stringify({ ...body, ...patch }) }),
		).toThrow()
	}
	delete body.layerColors
	expect(() => myMapsModel.parseAnnouncement({ ...event, content: JSON.stringify(body) })).toThrow(
		'Missing',
	)
	expect(() =>
		myMapsModel.parseAnnouncement({ ...event, tags: [['d', 'another-source']] }),
	).toThrow()
	expect(() => myMapsModel.source({ ...source, url: 'https://evil.example/data' })).toThrow()
	expect(() => myMapsModel.source({ ...source, opacity: NaN })).toThrow()
	expect(() =>
		myMapsModel.source({
			...source,
			owner: pubkey,
			publication: {
				pubkey: 'b'.repeat(64),
				identifier: `my-maps-config:${source.id}`,
				eventId: event.id,
				createdAt: 1,
			},
		}),
	).toThrow('ownership')
})

test('layer names containing object-prototype keys remain safe and editable', () => {
	const layerColors = JSON.parse('{"__proto__":"#111111","constructor":"#222222"}')
	const styled = myMapsModel.source({ ...source, layerColors })
	expect(Object.keys(styled.layerColors)).toEqual(['__proto__', 'constructor'])
	Reflect.set(styled.layerColors, '__proto__', '#333333')
	expect(Reflect.get(myMapsModel.effectiveView(styled).layerColors, '__proto__')).toBe('#333333')
	expect({}).not.toHaveProperty('polluted')
})

test('host grants only source discovery and the active owner’s exact private app-data address', () => {
	expect(
		myMapsDataPolicy.filters(
			[{ kinds: [MAPLET_SOURCE_KIND], '#t': ['maplet-source'], limit: 999 }],
			'',
		)[0]?.limit,
	).toBe(500)
	expect(
		myMapsDataPolicy.filters(
			[{ kinds: [30078], authors: [pubkey], '#d': [myMapsModel.preferencesId] }],
			pubkey,
		),
	).toEqual([{ kinds: [30078], authors: [pubkey], '#d': [myMapsModel.preferencesId], limit: 1 }])
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

test('host accepts v2 defaults and legacy publication upgrades without permitting unrelated payloads', () => {
	const template = myMapsModel.announcement(source)
	expect(myMapsDataPolicy.template(template, pubkey, false)).toEqual(template)
	const old = legacy()
	const normalized = myMapsDataPolicy.template(old, pubkey, false)
	expect(normalized.tags).toEqual(old.tags)
	expect(JSON.parse(normalized.content).version).toBe(2)
	expect(() =>
		myMapsDataPolicy.template(
			{ ...template, content: JSON.stringify({ ...JSON.parse(template.content), features: [] }) },
			pubkey,
			false,
		),
	).toThrow()
	const prefs = myMapsDataPolicy.template(
		{
			kind: 30078,
			content: JSON.stringify({ version: 1, sources: [source] }),
			tags: [['d', myMapsModel.preferencesId]],
			created_at: 1,
		},
		pubkey,
		true,
	)
	expect(JSON.parse(prefs.content)).toMatchObject({ version: 2, drafts: [] })
})
