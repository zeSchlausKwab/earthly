import { getCommentReplyPointer } from 'applesauce-common/helpers/comment'
import type { NostrEvent } from 'nostr-tools'
import type { CommentNode } from './types'

/** Rebuild from the live store snapshot so deletion and late-parent arrival work.
 * The upstream ThreadModel currently retains items after deletion. */
export function buildShoutboxThread(events: NostrEvent[], maxDepth = 10): CommentNode[] {
	const ordered = [...events].sort(
		(a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
	)
	const nodes = new Map(
		ordered.map((event) => [event.id, { event, children: [], depth: 0 } as CommentNode]),
	)
	const parents = new Map<string, string>()
	for (const event of ordered) {
		const pointer = getCommentReplyPointer(event)
		if (pointer?.type !== 'event' || pointer.kind !== 1111 || !nodes.has(pointer.id)) continue
		let ancestor: string | undefined = pointer.id
		let cyclic = false
		while (ancestor) {
			if (ancestor === event.id) {
				cyclic = true
				break
			}
			ancestor = parents.get(ancestor)
		}
		if (!cyclic) parents.set(event.id, pointer.id)
	}
	const roots: CommentNode[] = []
	for (const [id, node] of nodes) {
		const parent = nodes.get(parents.get(id) ?? '')
		if (parent) parent.children.push(node)
		else roots.push(node)
	}
	const queue = roots.map((node) => ({ node, depth: 0 }))
	for (let i = 0; i < queue.length; i++) {
		const entry = queue[i]
		if (!entry) continue
		entry.node.depth = Math.min(entry.depth, maxDepth)
		queue.push(...entry.node.children.map((node) => ({ node, depth: entry.depth + 1 })))
	}
	return roots
}
