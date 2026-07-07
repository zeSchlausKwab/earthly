import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import type { GeoFeatureItem } from './GeoRichTextEditor'
import { entityEventToMentionItem, mergeMentionItems } from './mentionSearch'

const base = {
	id: 'a'.repeat(64),
	pubkey: 'b'.repeat(64),
	created_at: 1780000000,
	sig: '',
}

describe('entityEventToMentionItem', () => {
	test('maps a story to an address-only mention item', () => {
		const event: NostrEvent = {
			...base,
			kind: 37520,
			content: JSON.stringify({ modelVersion: 'earthly/2', title: 'Danube Walk' }),
			tags: [['d', 'walk1']],
		}
		const item = entityEventToMentionItem(event)
		expect(item).not.toBeNull()
		expect(item?.name).toBe('Danube Walk')
		expect(item?.entityType).toBe('story')
		expect(item?.datasetName).toBe('Story')
		expect(item?.address).toStartWith('naddr1')
		expect(item?.featureId).toBeUndefined()
	})

	test('maps a dataset via content name', () => {
		const event: NostrEvent = {
			...base,
			kind: 37515,
			content: JSON.stringify({ type: 'FeatureCollection', name: 'Vienna Parks', features: [] }),
			tags: [['d', 'parks1']],
		}
		const item = entityEventToMentionItem(event)
		expect(item?.name).toBe('Vienna Parks')
		expect(item?.entityType).toBe('dataset')
	})

	test('rejects non-mentionable kinds and missing d tags', () => {
		const beacon: NostrEvent = { ...base, kind: 37521, content: '{}', tags: [['d', 'b1']] }
		expect(entityEventToMentionItem(beacon)).toBeNull()

		const noD: NostrEvent = { ...base, kind: 37515, content: '{}', tags: [] }
		expect(entityEventToMentionItem(noD)).toBeNull()
	})

	test('falls back to d tag on unparseable content', () => {
		const event: NostrEvent = { ...base, kind: 37515, content: 'not json', tags: [['d', 'raw1']] }
		expect(entityEventToMentionItem(event)?.name).toBe('raw1')
	})
})

describe('mergeMentionItems', () => {
	const item = (id: string, address: string, featureId?: string): GeoFeatureItem => ({
		id,
		name: id,
		address,
		featureId,
	})

	test('local first, relay deduped by address+featureId, capped', () => {
		const local = [item('l1', 'naddr1aaa'), item('l2', 'naddr1bbb')]
		const relay = [item('r1', 'naddr1bbb'), item('r2', 'naddr1ccc')]
		const merged = mergeMentionItems(local, relay)
		expect(merged.map((m) => m.id)).toEqual(['l1', 'l2', 'r2'])

		const many = Array.from({ length: 20 }, (_, i) => item(`r${i}`, `naddr1x${i}`))
		expect(mergeMentionItems(local, many, 10)).toHaveLength(10)
	})

	test('a loaded feature does not swallow the relay dataset-level mention', () => {
		// Local feature mention shares the dataset naddr but has a featureId;
		// the relay's address-only dataset mention must still appear.
		const local = [item('feat', 'naddr1aaa', 'stephansdom')]
		const relay = [item('dataset', 'naddr1aaa')]
		const merged = mergeMentionItems(local, relay)
		expect(merged.map((m) => m.id)).toEqual(['feat', 'dataset'])
	})
})
