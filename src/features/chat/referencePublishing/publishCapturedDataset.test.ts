import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	capturedDatasetPublicationMode,
	capturedDatasetReferenceCoordinates,
} from './publishCapturedDataset'
import type { CapturedDatasetPublication } from './types'

const owner = 'a'.repeat(64)
const sourceAddress = `${GEO_EVENT_KIND}:${owner}:original-map`
const captured: CapturedDatasetPublication = {
	binding: {
		chatId: 'chat-a',
		toolCallId: 'tool-a',
		workspaceId: 'workspace-a',
		draftId: 'draft-a',
		sourceId: `fork:${owner}:original-map`,
		draftUpdatedAt: 10,
		baseRevisionId: 'base-event',
		baseCoordinate: sourceAddress,
	},
	authoringIntent: 'fork',
	sourceDataset: {
		address: sourceAddress,
		pubkey: owner,
		identifier: 'original-map',
		eventId: 'base-event',
	},
	title: 'Independent fork',
	publishChannel: { kind: 'public' },
	featureCollection: { type: 'FeatureCollection', features: [] },
	contextReferences: [],
	blobReferences: [],
	featureIds: [],
	baseEvent: {
		id: 'base-event',
		pubkey: owner,
		kind: GEO_EVENT_KIND,
		created_at: 1,
		tags: [['d', 'original-map']],
		content: '{}',
		sig: '',
	} satisfies NostrEvent,
}

describe('captured Map publication intent (no signing or relay writes)', () => {
	test('an explicit fork always creates a copy, including an owner forking their own Map', () => {
		expect(capturedDatasetPublicationMode(captured, owner)).toBe('copy')
		expect(capturedDatasetPublicationMode(captured, 'b'.repeat(64))).toBe('copy')
	})

	test('proposal and foreign edit intents cannot fall through to independent publication', () => {
		expect(() =>
			capturedDatasetPublicationMode({ ...captured, authoringIntent: 'propose' }, owner),
		).toThrow('proposal')
		expect(() =>
			capturedDatasetPublicationMode({ ...captured, authoringIntent: 'edit' }, 'b'.repeat(64)),
		).toThrow('owner')
		expect(capturedDatasetPublicationMode({ ...captured, authoringIntent: 'edit' }, owner)).toBe(
			'update',
		)
	})

	test('copy and later owner updates retain original provenance without a self-reference', () => {
		expect(capturedDatasetReferenceCoordinates(captured, 'copy')).toEqual([sourceAddress])
		expect(
			capturedDatasetReferenceCoordinates({ ...captured, authoringIntent: 'edit' }, 'update'),
		).toEqual([])
		expect(
			capturedDatasetReferenceCoordinates(
				{
					...captured,
					authoringIntent: 'edit',
					binding: {
						...captured.binding,
						baseCoordinate: `${GEO_EVENT_KIND}:${owner}:published-copy`,
					},
				},
				'update',
			),
		).toEqual([sourceAddress])
	})
})
