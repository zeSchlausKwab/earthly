import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	GEO_COMMENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
} from '@/lib/nostr/kinds'
import { buildInboxFilters, deriveInboxItems, filterInboxItems } from './deriveInbox'

const USER = 'a'.repeat(64)
const ACTOR = 'b'.repeat(64)
const REVIEWER = 'c'.repeat(64)
const MAP = `${GEO_EVENT_KIND}:${USER}:river-paths`
const OTHER_MAP = `${GEO_EVENT_KIND}:${REVIEWER}:shared-map`
const ATLAS = `${MAP_CONTEXT_KIND}:${USER}:field-notes`

function event(
	kind: number,
	pubkey: string,
	createdAt: number,
	tags: string[][],
	content = '',
): NostrEvent {
	return {
		id: `${kind}-${createdAt}`,
		kind,
		pubkey,
		created_at: createdAt,
		tags,
		content,
		sig: 'f'.repeat(128),
	}
}

function dataset(pubkey: string, identifier: string, name: string): GeoDataset {
	return {
		kind: GEO_EVENT_KIND,
		pubkey,
		datasetId: identifier,
		dTag: identifier,
		featureCollection: { type: 'FeatureCollection', features: [], name },
	} as unknown as GeoDataset
}

function atlas(referencedAddresses: string[] = []): MapContext {
	return {
		kind: MAP_CONTEXT_KIND,
		pubkey: USER,
		contextId: 'field-notes',
		contextCoordinate: ATLAS,
		context: { name: 'Field notes' },
		referencedAddresses,
	} as unknown as MapContext
}

const getDatasetName = (value: GeoDataset) =>
	(value.featureCollection as unknown as { name?: string }).name ?? value.datasetId

describe('deriveInboxItems', () => {
	test('derives proposal, reply, reaction, zap, follow, and uncurated Atlas-arrival rows', () => {
		const sourceEvents = [
			event(
				GEO_EDIT_PROPOSAL_KIND,
				ACTOR,
				10,
				[
					['d', 'proposal-1'],
					['a', MAP],
					['p', USER],
					['description', 'Correct the southern bend'],
				],
				'{}',
			),
			event(
				GEO_COMMENT_KIND,
				ACTOR,
				20,
				[
					['d', 'reply-1'],
					['K', String(GEO_EVENT_KIND)],
					['k', String(GEO_COMMENT_KIND)],
					['A', MAP],
					['a', `${GEO_COMMENT_KIND}:${USER}:comment-1`],
					['P', USER],
					['p', USER],
				],
				JSON.stringify({ text: 'I checked this on the ground.' }),
			),
			event(
				7,
				ACTOR,
				30,
				[
					['p', USER],
					['a', MAP],
				],
				'+',
			),
			event(9735, REVIEWER, 40, [
				['p', USER],
				['a', MAP],
				['description', JSON.stringify({ pubkey: ACTOR })],
			]),
			event(3, ACTOR, 50, [['p', USER]]),
			event(GEO_EVENT_KIND, ACTOR, 60, [
				['d', 'contributed-map'],
				['c', ATLAS],
			]),
		]
		const geoEvents = [
			dataset(USER, 'river-paths', 'River paths'),
			dataset(ACTOR, 'contributed-map', 'New footbridges'),
		]
		const items = deriveInboxItems({
			currentUserPubkey: USER,
			events: sourceEvents,
			geoEvents,
			mapContextEvents: [atlas()],
			getDatasetName,
		})

		expect(items.map((item) => item.kind)).toEqual([
			'atlas-arrival',
			'follow',
			'zap',
			'reaction',
			'reply',
			'proposal',
		])
		expect(items.find((item) => item.kind === 'proposal')?.thingLabel).toBe('River paths')
		expect(items.find((item) => item.kind === 'reply')?.target).toMatchObject({
			type: 'entity',
			coordinate: MAP,
			tab: 'comments',
			commentId: 'reply-1',
		})
		expect(items.find((item) => item.kind === 'zap')?.actorPubkey).toBe(ACTOR)
		expect(items.find((item) => item.kind === 'atlas-arrival')?.action).toBe(
			'added New footbridges to',
		)
		expect(filterInboxItems(items, 'replies')).toHaveLength(1)
		expect(filterInboxItems(items, 'proposals')).toHaveLength(1)
	})

	test('resolves an accepted status through the account-owned proposal', () => {
		const proposal = event(
			GEO_EDIT_PROPOSAL_KIND,
			USER,
			100,
			[
				['d', 'mine'],
				['a', OTHER_MAP],
				['p', REVIEWER],
			],
			'{}',
		)
		const status = event(PROPOSAL_STATUS_APPLIED_KIND, REVIEWER, 110, [
			['a', `${GEO_EDIT_PROPOSAL_KIND}:${USER}:mine`],
			['p', USER],
		])
		const items = deriveInboxItems({
			currentUserPubkey: USER,
			events: [proposal, status],
			geoEvents: [dataset(REVIEWER, 'shared-map', 'Shared map')],
			mapContextEvents: [],
			getDatasetName,
		})

		expect(items).toHaveLength(1)
		expect(items[0]).toMatchObject({
			kind: 'accepted',
			thingLabel: 'Shared map',
			category: 'proposals',
		})
	})

	test('does not notify for own actions or Atlas maps already curated by the owner', () => {
		const ownComment = event(GEO_COMMENT_KIND, USER, 120, [
			['d', 'own'],
			['A', MAP],
			['P', USER],
			['p', USER],
		])
		const attached = event(GEO_EVENT_KIND, ACTOR, 130, [
			['d', 'contributed-map'],
			['c', ATLAS],
		])
		const advisoryOnlyProposal = event(
			GEO_EDIT_PROPOSAL_KIND,
			ACTOR,
			125,
			[
				['d', 'not-for-user'],
				['a', OTHER_MAP],
				['p', USER],
			],
			'{}',
		)
		const unrelatedReaction = event(7, ACTOR, 126, [['a', MAP]], '+')
		const mapCoordinate = `${GEO_EVENT_KIND}:${ACTOR}:contributed-map`
		const items = deriveInboxItems({
			currentUserPubkey: USER,
			events: [ownComment, advisoryOnlyProposal, unrelatedReaction, attached],
			geoEvents: [dataset(ACTOR, 'contributed-map', 'Curated map')],
			mapContextEvents: [atlas([mapCoordinate])],
			getDatasetName,
		})

		expect(items).toEqual([])
	})
})

test('buildInboxFilters requests directed activity, own proposals, and owned Atlas attachments', () => {
	expect(buildInboxFilters(undefined, [ATLAS])).toBeNull()
	const filters = buildInboxFilters(USER, [ATLAS])
	expect(filters).toHaveLength(3)
	expect(filters?.[0]?.['#p']).toEqual([USER])
	expect(filters?.[1]?.authors).toEqual([USER])
	expect(filters?.[2]).toMatchObject({ kinds: [GEO_EVENT_KIND], '#c': [ATLAS] })
})
