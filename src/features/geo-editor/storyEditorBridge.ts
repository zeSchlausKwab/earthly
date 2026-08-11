/**
 * storyEditorBridge — module-level seam between the chat's story-draft tools and
 * the Story editor UI (mirrors `features/chat/safeEditing/pendingDiffStore`'s
 * framework-light bridge pattern).
 *
 * `storyEditorMode` is LOCAL state inside `useStoryEditor` (instantiated by
 * GeoEditorView), so a chat tool handler cannot reach it directly. Instead the
 * `write_story_draft` handler calls `requestOpenStoryEditor()` after a
 * successful draft write; `useStoryEditor` subscribes and honors the request by
 * opening the Story editor in create or edit mode (which pre-fills from the
 * matching local draft), and `StoryEditorPanel` subscribes to re-run its draft
 * pre-fill when it is already open. The monotonically increasing nonce lets an
 * already-open panel distinguish "a new write happened" from its own mount.
 *
 * Framework-light (a counter + a subscriber set) so the chat tool — which must
 * not pull in React — can fire it, and consumers can wire it into effects.
 */

import type { Article } from '@/lib/nostr/article'

export interface StoryEditorOpenRequest {
	/** Monotonic id — a new request always carries a higher nonce. */
	nonce: number
	mode: 'create' | 'edit'
	/** Published Story target for edit mode. */
	story?: Article
}

let counter = 0
let lastRequest: StoryEditorOpenRequest | null = null
const subscribers = new Set<() => void>()

/**
 * Fire an "open the Story editor" request (create when no Story is supplied,
 * edit otherwise). Called by the
 * `write_story_draft` tool handler after the draft is persisted so the app
 * surfaces the draft instead of leaving the user to hunt for it.
 */
export function requestOpenStoryEditor(story?: Article | null): void {
	counter += 1
	lastRequest = story ? { nonce: counter, mode: 'edit', story } : { nonce: counter, mode: 'create' }
	for (const fn of subscribers) fn()
}

/** The most recent request, or null if none fired this page session. */
export function getStoryEditorOpenRequest(): StoryEditorOpenRequest | null {
	return lastRequest
}

/** Subscribe to new open requests. Returns the unsubscribe function. */
export function subscribeStoryEditorOpenRequests(fn: () => void): () => void {
	subscribers.add(fn)
	return () => {
		subscribers.delete(fn)
	}
}

/** Test/reset helper — clears the request state and subscribers. */
export function resetStoryEditorOpenRequests(): void {
	counter = 0
	lastRequest = null
	subscribers.clear()
}
