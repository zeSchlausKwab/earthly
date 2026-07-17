import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_LAYER_SET_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import {
	MAX_SAVED_REGION_EVENT_BYTES,
	MAX_SAVED_REGION_EVENTS,
	selectSavedRegionEvents,
	type SavedRegionBoundingBox,
} from './selectSavedRegionEvents'

interface SignedFixture {
	kind: number
	secretKey: Uint8Array
	createdAt: number
	content: string
	d?: string
	bbox?: SavedRegionBoundingBox | string
	tags?: string[][]
}

function signFixture({
	kind,
	secretKey,
	createdAt,
	content,
	d,
	bbox,
	tags = [],
}: SignedFixture): NostrEvent {
	return finalizeEvent(
		{
			kind,
			created_at: createdAt,
			content,
			tags: [
				...(d === undefined ? [] : [['d', d]]),
				...(bbox === undefined ? [] : [['bbox', typeof bbox === 'string' ? bbox : bbox.join(',')]]),
				...tags,
			],
		},
		secretKey,
	) as NostrEvent
}

const featureCollection = JSON.stringify({ type: 'FeatureCollection', features: [] })
const groupContent = (name: string) =>
	JSON.stringify({ modelVersion: MODEL_VERSION, name, governance: 'open' })
const storyContent = (title: string) => JSON.stringify({ modelVersion: MODEL_VERSION, title })
const sightingContent = (title: string) => JSON.stringify({ modelVersion: MODEL_VERSION, title })

describe('selectSavedRegionEvents', () => {
	test('reserves verified public source announcements first and fails closed for invalid requirements', () => {
		const sourceKey = generateSecretKey()
		const secondSourceKey = generateSecretKey()
		const datasetKey = generateSecretKey()
		const olderAnnouncement = signFixture({
			kind: MAP_LAYER_SET_KIND,
			secretKey: sourceKey,
			createdAt: 90,
			content: JSON.stringify({ version: 1, layers: [] }),
		})
		const newerAnnouncement = signFixture({
			kind: MAP_LAYER_SET_KIND,
			secretKey: secondSourceKey,
			createdAt: 91,
			content: JSON.stringify({ version: 1, layers: [] }),
		})
		const dataset = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: datasetKey,
			createdAt: 100,
			d: 'required-source-test',
			bbox: [10, 10, 11, 11],
			content: featureCollection,
		})

		const selected = selectSavedRegionEvents({
			bbox: [0, 0, 20, 20],
			events: [dataset],
			requiredEvents: [olderAnnouncement, newerAnnouncement],
			now: 1_000,
		})
		expect(selected.events.slice(0, 2).map((event) => event.id)).toEqual([
			newerAnnouncement.id,
			olderAnnouncement.id,
		])
		expect(selected.events[2]?.id).toBe(dataset.id)
		expect(selected.counts).toMatchObject({ required: 2, datasets: 1, total: 3 })

		const reversed = selectSavedRegionEvents({
			bbox: [0, 0, 20, 20],
			events: [dataset],
			requiredEvents: [newerAnnouncement, olderAnnouncement],
			now: 1_000,
		})
		expect(reversed.events.map((event) => event.id)).toEqual(
			selected.events.map((event) => event.id),
		)

		const privateAnnouncement = signFixture({
			kind: MAP_LAYER_SET_KIND,
			secretKey: sourceKey,
			createdAt: 92,
			content: JSON.stringify({ version: 1, layers: [] }),
			tags: [['h', 'field-session-1']],
		})
		expect(() =>
			selectSavedRegionEvents({
				bbox: [0, 0, 20, 20],
				events: [],
				requiredEvents: [privateAnnouncement],
			}),
		).toThrow('not public')

		const forgedAnnouncement = { ...olderAnnouncement, sig: '0'.repeat(128) }
		expect(() =>
			selectSavedRegionEvents({
				bbox: [0, 0, 20, 20],
				events: [],
				requiredEvents: [forgedAnnouncement],
			}),
		).toThrow('invalid signature')
	})

	test('throws instead of omitting a required event that exceeds the shared byte ceiling', () => {
		const oversizedAnnouncement = signFixture({
			kind: MAP_LAYER_SET_KIND,
			secretKey: generateSecretKey(),
			createdAt: 90,
			content: 'x'.repeat(MAX_SAVED_REGION_EVENT_BYTES),
		})
		expect(() =>
			selectSavedRegionEvents({
				bbox: [0, 0, 20, 20],
				events: [],
				requiredEvents: [oversizedAnnouncement],
			}),
		).toThrow('limits')
	})

	test('selects the public spatial graph, referenced Groups, complete comment threads, and profiles', () => {
		const keys = Array.from({ length: 8 }, () => generateSecretKey())
		const [datasetKey, groupKey, storyKey, sightingKey, referencedGroupKey, commentKey, replyKey] =
			keys as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array]

		const referencedGroupCoordinate = `${MAP_CONTEXT_KIND}:${getPublicKey(
			referencedGroupKey,
		)}:remote-group`
		const dataset = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: datasetKey,
			createdAt: 100,
			d: 'trail-data',
			bbox: [10, 10, 20, 20],
			content: featureCollection,
			tags: [['c', referencedGroupCoordinate]],
		})
		const spatialGroup = signFixture({
			kind: MAP_CONTEXT_KIND,
			secretKey: groupKey,
			createdAt: 101,
			d: 'local-group',
			bbox: [12, 12, 13, 13],
			content: groupContent('Local group'),
		})
		const story = signFixture({
			kind: ARTICLE_KIND,
			secretKey: storyKey,
			createdAt: 102,
			d: 'trail-story',
			bbox: [20, 20, 25, 25],
			content: storyContent('Trail story'),
		})
		const sighting = signFixture({
			kind: TEMPORAL_SIGHTING_KIND,
			secretKey: sightingKey,
			createdAt: 103,
			d: 'fox',
			bbox: [15, 15, 15, 15],
			content: sightingContent('Fox'),
			tags: [['expiration', '5000']],
		})
		const referencedGroup = signFixture({
			kind: MAP_CONTEXT_KIND,
			secretKey: referencedGroupKey,
			createdAt: 104,
			d: 'remote-group',
			content: groupContent('Remote group'),
		})

		const datasetCoordinate = `${GEO_EVENT_KIND}:${dataset.pubkey}:trail-data`
		const topComment = signFixture({
			kind: GEO_COMMENT_KIND,
			secretKey: commentKey,
			createdAt: 105,
			d: 'comment-1',
			content: JSON.stringify({ text: 'Water is available here.' }),
			tags: [
				['K', String(GEO_EVENT_KIND)],
				['k', String(GEO_EVENT_KIND)],
				['A', datasetCoordinate],
				['a', datasetCoordinate],
				['P', dataset.pubkey],
				['p', dataset.pubkey],
			],
		})
		const topCommentCoordinate = `${GEO_COMMENT_KIND}:${topComment.pubkey}:comment-1`
		const reply = signFixture({
			kind: GEO_COMMENT_KIND,
			secretKey: replyKey,
			createdAt: 106,
			d: 'reply-1',
			content: JSON.stringify({ text: 'Confirmed.' }),
			tags: [
				['K', String(GEO_EVENT_KIND)],
				['k', String(GEO_COMMENT_KIND)],
				['A', datasetCoordinate],
				['a', topCommentCoordinate],
				['P', dataset.pubkey],
				['p', topComment.pubkey],
				['e', topComment.id],
			],
		})
		const orphan = signFixture({
			kind: GEO_COMMENT_KIND,
			secretKey: keys[7] as Uint8Array,
			createdAt: 107,
			d: 'orphan',
			content: JSON.stringify({ text: 'Dangling reply' }),
			tags: [
				['K', String(GEO_EVENT_KIND)],
				['k', String(GEO_COMMENT_KIND)],
				['A', datasetCoordinate],
				['a', `${GEO_COMMENT_KIND}:${'0'.repeat(64)}:missing`],
			],
		})

		const authors = [dataset, spatialGroup, story, sighting, referencedGroup, topComment, reply]
		const profiles = authors.map((_, index) =>
			signFixture({
				kind: 0,
				secretKey: [
					datasetKey,
					groupKey,
					storyKey,
					sightingKey,
					referencedGroupKey,
					commentKey,
					replyKey,
				][index] as Uint8Array,
				createdAt: 200 + index,
				content: JSON.stringify({ name: `Person ${index}` }),
			}),
		)
		const input = [
			dataset,
			spatialGroup,
			story,
			sighting,
			referencedGroup,
			topComment,
			reply,
			orphan,
			...profiles,
			dataset,
		]

		const selected = selectSavedRegionEvents({
			bbox: [0, 0, 20, 20],
			events: [...input].reverse(),
			now: 1_000,
		})
		const selectedIds = new Set(selected.events.map((event) => event.id))

		for (const event of [...authors, ...profiles]) expect(selectedIds.has(event.id)).toBe(true)
		expect(selectedIds.has(orphan.id)).toBe(false)
		expect(selected.counts).toMatchObject({
			spatialRoots: 4,
			referencedGroups: 1,
			roots: 5,
			datasets: 1,
			groups: 2,
			stories: 1,
			sightings: 1,
			comments: 2,
			profiles: 7,
			total: 14,
			omittedEvents: 0,
		})
		expect(selected.truncated).toBe(false)
		expect(selected.counts.bytesTotal).toBeGreaterThan(0)
		expect(selected.counts.bytesTotal).toBeLessThanOrEqual(MAX_SAVED_REGION_EVENT_BYTES)

		const forward = selectSavedRegionEvents({ bbox: [0, 0, 20, 20], events: input, now: 1_000 })
		expect(forward.events.map((event) => event.id)).toEqual(
			selected.events.map((event) => event.id),
		)
	})

	test('does not resurrect stale lineages and rejects private, expired, live, malformed, forged, and unrelated records', () => {
		const key = generateSecretKey()
		const oldPublic = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 100,
			d: 'moved',
			bbox: [10, 10, 11, 11],
			content: featureCollection,
		})
		const movedAway = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 101,
			d: 'moved',
			bbox: [80, 80, 81, 81],
			content: featureCollection,
		})
		const priorPublicScope = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 110,
			d: 'scope-change',
			bbox: [10, 10, 11, 11],
			content: featureCollection,
		})
		const fieldScopedReplacement = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 111,
			d: 'scope-change',
			bbox: [10, 10, 11, 11],
			content: featureCollection,
			tags: [
				['h', 'field-session-1'],
				['t', 'field-session'],
			],
		})
		const expiredSighting = signFixture({
			kind: TEMPORAL_SIGHTING_KIND,
			secretKey: key,
			createdAt: 120,
			d: 'expired',
			bbox: [10, 10, 11, 11],
			content: sightingContent('Old fox'),
			tags: [['expiration', '999']],
		})
		const liveBeacon = signFixture({
			kind: LIVE_BEACON_KIND,
			secretKey: key,
			createdAt: 121,
			d: 'live',
			bbox: [10, 10, 11, 11],
			content: JSON.stringify({ modelVersion: MODEL_VERSION }),
		})
		const legacyGroup = signFixture({
			kind: MAP_CONTEXT_KIND,
			secretKey: key,
			createdAt: 122,
			d: 'legacy',
			bbox: [10, 10, 11, 11],
			content: JSON.stringify({ name: 'Legacy', governance: 'open' }),
		})
		const malformedDataset = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 123,
			d: 'malformed',
			bbox: [10, 10, 11, 11],
			content: '{not geojson',
		})
		const invalidBbox = signFixture({
			kind: ARTICLE_KIND,
			secretKey: key,
			createdAt: 124,
			d: 'bad-bbox',
			bbox: '181,10,182,11',
			content: storyContent('Off world'),
		})
		const signedThenForged = signFixture({
			kind: GEO_EVENT_KIND,
			secretKey: key,
			createdAt: 125,
			d: 'forged',
			bbox: [10, 10, 11, 11],
			content: featureCollection,
		})
		const forged = { ...signedThenForged, sig: '0'.repeat(128) }
		const unrelatedProfile = signFixture({
			kind: 0,
			secretKey: key,
			createdAt: 126,
			content: JSON.stringify({ name: 'No selected records' }),
		})

		const selected = selectSavedRegionEvents({
			bbox: [0, 0, 20, 20],
			events: [
				oldPublic,
				movedAway,
				priorPublicScope,
				fieldScopedReplacement,
				expiredSighting,
				liveBeacon,
				legacyGroup,
				malformedDataset,
				invalidBbox,
				forged,
				unrelatedProfile,
			],
			now: 1_000,
		})

		expect(selected.events).toEqual([])
		expect(selected.counts.total).toBe(0)
		expect(selected.truncated).toBe(false)
	})

	test('uses the NIP-01 lowest-id tie break for replaceable roots and profiles', () => {
		const key = generateSecretKey()
		const roots = [
			signFixture({
				kind: GEO_EVENT_KIND,
				secretKey: key,
				createdAt: 100,
				d: 'same-timestamp',
				bbox: [10, 10, 11, 11],
				content: JSON.stringify({ type: 'FeatureCollection', features: [], revision: 'alpha' }),
			}),
			signFixture({
				kind: GEO_EVENT_KIND,
				secretKey: key,
				createdAt: 100,
				d: 'same-timestamp',
				bbox: [10, 10, 11, 11],
				content: JSON.stringify({ type: 'FeatureCollection', features: [], revision: 'beta' }),
			}),
		]
		const profiles = [
			signFixture({
				kind: 0,
				secretKey: key,
				createdAt: 200,
				content: JSON.stringify({ name: 'Alpha' }),
			}),
			signFixture({
				kind: 0,
				secretKey: key,
				createdAt: 200,
				content: JSON.stringify({ name: 'Beta' }),
			}),
		]
		const expectedRoot = [...roots].sort((left, right) => left.id.localeCompare(right.id))[0]
		const expectedProfile = [...profiles].sort((left, right) => left.id.localeCompare(right.id))[0]
		if (!expectedRoot || !expectedProfile) throw new Error('tie-break fixtures are missing')

		const selected = selectSavedRegionEvents({
			bbox: [0, 0, 20, 20],
			events: [...roots, ...profiles].reverse(),
			now: 1_000,
		})

		expect(selected.events.map((event) => event.id)).toEqual([expectedRoot.id, expectedProfile.id])
	})

	test('pins the native-compatible ceilings and rejects invalid selection bounds', () => {
		expect(MAX_SAVED_REGION_EVENTS).toBe(4_096)
		expect(MAX_SAVED_REGION_EVENT_BYTES).toBe(16 * 1024 * 1024)
		expect(() =>
			selectSavedRegionEvents({ bbox: [170, -10, -170, 10], events: [], now: 1_000 }),
		).toThrow('bounds')
	})
})
