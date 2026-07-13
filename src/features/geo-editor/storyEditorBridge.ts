/**
 * storyEditorBridge — module-level seam between the chat's story-draft tools and
 * the Story editor UI (mirrors `features/chat/safeEditing/pendingDiffStore`'s
 * framework-light bridge pattern).
 *
 * `storyEditorMode` is LOCAL state inside `useStoryEditor` (instantiated by
 * GeoEditorView), so a chat tool handler cannot reach it directly. Instead the
 * `write_story_draft` handler calls `requestOpenStoryEditor()` after a
 * successful draft write; `useStoryEditor` subscribes and honors the request by
 * opening the Story editor in create mode (which pre-fills from the local
 * draft), and `StoryEditorPanel` subscribes to re-run its draft pre-fill when it
 * is ALREADY open in create mode (the panel otherwise reads the draft only on
 * mount). The monotonically increasing nonce is what lets an already-open panel
 * distinguish "a new write happened" from its own mount.
 *
 * Framework-light (a counter + a subscriber set) so the chat tool — which must
 * not pull in React — can fire it, and consumers can wire it into effects.
 */

export interface StoryEditorOpenRequest {
	/** Monotonic id — a new request always carries a higher nonce. */
	nonce: number
	/** Only the local new-story draft is AI-writable, so only create mode exists. */
	mode: 'create'
}

let counter = 0
let lastRequest: StoryEditorOpenRequest | null = null
const subscribers = new Set<() => void>()

/**
 * Fire an "open the Story editor (create mode)" request. Called by the
 * `write_story_draft` tool handler after the draft is persisted so the app
 * surfaces the draft instead of leaving the user to hunt for it.
 */
export function requestOpenStoryEditor(): void {
	counter += 1
	lastRequest = { nonce: counter, mode: 'create' }
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
