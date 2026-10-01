import { describe, expect, test } from 'bun:test'
import { AiOutputAttentionStore } from './outputAttention'

const map = { kind: 'dataset' as const, workspaceId: 'map-a', title: 'New Map' }
const story = { kind: 'story' as const, draftKey: 'story-a', title: 'New Story' }

describe('AI output attention', () => {
	test('Atlas and Story notices with the same draft key stay independent', () => {
		const store = new AiOutputAttentionStore()
		const atlas = { kind: 'atlas' as const, draftKey: story.draftKey, title: 'Atlas' }
		store.record('chat-a', story, 'owner')
		store.record('chat-a', atlas, 'owner')
		store.acknowledgeTarget(atlas)
		expect(store.getSnapshot().map((notice) => notice.key)).toEqual([`story:${story.draftKey}`])
	})
	test('keeps new output notices after opening the editing list until the draft is viewed', () => {
		const store = new AiOutputAttentionStore()
		store.record('chat-a', map, 'owner')
		store.record('chat-a', story, 'owner')
		store.acknowledgeList('chat-a')
		expect(store.getSnapshot()).toHaveLength(2)
		expect(store.getSnapshot().every((notice) => notice.listSeen)).toBe(true)
		store.acknowledgeTarget(map)
		expect(store.getSnapshot().map((notice) => notice.key)).toEqual(['story:story-a'])
	})
	test('new writes relight an acknowledged output without accumulating checkpoints', () => {
		const store = new AiOutputAttentionStore()
		store.record('chat-a', map, 'owner')
		const before = store.getSnapshot()[0]?.version ?? 0
		store.acknowledgeList('chat-a')
		store.record('chat-a', { ...map, title: 'Revised Map' }, 'owner')
		expect(store.getSnapshot()).toHaveLength(1)
		expect(store.getSnapshot()[0]).toMatchObject({
			listSeen: false,
			target: { title: 'Revised Map' },
		})
		expect(store.getSnapshot()[0]?.version).toBeGreaterThan(before)
	})
	test('list acknowledgement leaves other conversations unchanged and snapshots stable for no-ops', () => {
		const store = new AiOutputAttentionStore()
		store.record('chat-a', map, 'owner')
		store.record('chat-b', story, 'other-owner')
		store.acknowledgeList('chat-a')
		expect(store.getSnapshot().find((notice) => notice.chatId === 'chat-b')?.listSeen).toBe(false)
		const snapshot = store.getSnapshot()
		store.acknowledgeList('chat-a')
		expect(store.getSnapshot()).toBe(snapshot)
		store.acknowledgeTarget({ ...map, workspaceId: 'missing' })
		expect(store.getSnapshot()).toBe(snapshot)
	})
	test('acknowledging one account leaves its sibling notices intact', () => {
		const store = new AiOutputAttentionStore()
		store.record('same-chat', map, 'owner')
		store.record('same-chat', map, 'other-owner')
		store.acknowledgeList('same-chat', 'owner')
		expect(
			store.getSnapshot().find((notice) => notice.ownerPubkey === 'other-owner')?.listSeen,
		).toBe(false)
		store.acknowledgeTarget(map, 'owner')
		expect(store.getSnapshot()).toHaveLength(1)
		expect(store.getSnapshot()[0]?.ownerPubkey).toBe('other-owner')
	})
})
