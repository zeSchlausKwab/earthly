import { expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { buildShoutboxThread } from './thread'
const root = 'f'.repeat(64)
function comment(id: string, parent = root, createdAt = 1): NostrEvent {
	return {
		id: id.repeat(64),
		kind: 1111,
		pubkey: 'a'.repeat(64),
		sig: '',
		content: '',
		created_at: createdAt,
		tags: [
			['E', root],
			['K', '1'],
			['e', parent],
			['k', parent === root ? '1' : '1111'],
		],
	}
}

test('late parents and out-of-order timestamps produce correct depths', () => {
	const child = comment('b', 'a'.repeat(64), 1)
	const parent = comment('a', root, 2)
	const [tree] = buildShoutboxThread([child, parent])
	expect(tree?.event.id).toBe(parent.id)
	expect(tree?.children[0]?.depth).toBe(1)
})

test('deleting a parent leaves its surviving child visible as an orphan', () => {
	const child = comment('b', 'a'.repeat(64))
	expect(buildShoutboxThread([child])[0]?.event.id).toBe(child.id)
	expect(buildShoutboxThread([])).toEqual([])
})

test('hostile cycles do not hide all comments or recurse forever', () => {
	const roots = buildShoutboxThread([comment('a', 'b'.repeat(64)), comment('b', 'a'.repeat(64))])
	expect(roots).toHaveLength(1)
	expect(roots[0]?.children).toHaveLength(1)
})
