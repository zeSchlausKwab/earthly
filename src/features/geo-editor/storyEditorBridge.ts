/**
 * storyEditorBridge — module-level seam between the chat's story-draft tools and
 * the Story editor UI (mirrors `features/chat/safeEditing/pendingDiffStore`'s
 * framework-light bridge pattern).
 *
 * `storyEditorMode` is LOCAL state inside `useStoryEditor` (instantiated by
 * GeoEditorView), so a chat tool handler cannot reach it directly. Instead the
 * `write_story_draft` handler calls `requestOpenStoryEditor()` to establish an
 * explicitly approved target and again after a successful draft write;
 * `useStoryEditor` subscribes and retains the matching create/edit state without
 * changing the visible surface, while an already-open `StoryEditorPanel`
 * subscribes to re-run its draft pre-fill. The monotonically increasing nonce
 * lets the panel distinguish "a new write happened" from its own mount.
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

/**
 * The retained Story authoring state. Unlike an open request, this remains
 * queryable by non-React tool handlers so they can distinguish an explicit
 * user-created Story target from the absence of one.
 */
export type StoryEditorTarget =
	| { mode: 'create'; story?: undefined }
	| { mode: 'edit'; story: Article }

let counter = 0
let lastRequest: StoryEditorOpenRequest | null = null
let retainedTarget: StoryEditorTarget | null = null
const subscribers = new Set<() => void>()

/** Record the Story edit state retained by the UI or an explicit dialog action. */
export function retainStoryEditorTarget(story?: Article | null): void {
	retainedTarget = story ? { mode: 'edit', story } : { mode: 'create' }
}

/** Clear the retained Story edit state when the author closes or publishes it. */
export function clearStoryEditorTarget(): void {
	retainedTarget = null
	// A consumed open request describes the same retained state. Leaving it
	// behind would let a later GeoEditorView mount replay and resurrect a Story
	// target the author explicitly closed.
	lastRequest = null
}

/** Read the retained Story edit state without importing React-local state. */
export function getStoryEditorTarget(): StoryEditorTarget | null {
	return retainedTarget
}

/**
 * Fire a Story editor-state request (create when no Story is supplied, edit
 * otherwise). This explicitly establishes the target before a gated AI write
 * and refreshes the same retained state after persistence; consumers do not
 * navigate or reveal it automatically.
 */
export function requestOpenStoryEditor(story?: Article | null): void {
	retainStoryEditorTarget(story)
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
	retainedTarget = null
	subscribers.clear()
}
