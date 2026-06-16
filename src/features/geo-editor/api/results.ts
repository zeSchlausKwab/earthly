/**
 * Authoring API — structured mutation result contract (D-11).
 *
 * Every mutating method on the Authoring facade returns a `MutationResult`,
 * never `void`. This is the generalized form of `EditorCommandExecutionResult`
 * (geo-editor/commands.ts) for geometry writes: it carries the classified
 * `intent`, the affected `featureIds`, and per-bucket `counts` so callers
 * (Plans 03/04/05: the store mirror, the registry dispatch, the primitives)
 * can report and reconcile without re-deriving anything.
 *
 * Boundary (D-07): imports nothing from chat, the tool registry, or Nostr.
 */

import type { MutationIntent } from './interceptor'

// Single source of the intent enum lives in `interceptor.ts`; re-export so
// callers can pull both the result type and its intent from `results.ts`.
export type { MutationIntent }

/** Per-bucket tally of what a mutation did. */
export interface MutationCounts {
	created: number
	updated: number
	deleted: number
	skippedDuplicates: number
}

/**
 * Structured outcome of an Authoring geometry mutation (D-11).
 *
 * - `ok` — false when the input was rejected at the boundary (e.g. null feature).
 * - `intent` — the classified mutation kind (`add | modify | delete`).
 * - `featureIds` — ids created/updated/deleted by this call.
 * - `counts` — per-bucket tally; `skippedDuplicates` reflects append dedup-by-id.
 */
export interface MutationResult {
	ok: boolean
	intent: MutationIntent
	featureIds: string[]
	counts: MutationCounts
}
