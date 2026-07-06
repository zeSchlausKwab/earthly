/**
 * Local-first Story draft persistence (STORY-04 draft).
 *
 * A Story draft is held per-device in scoped localStorage, keyed by the Story's
 * `d`-tag, and cleared on publish. Reuses the existing `readScopedStorage` /
 * `writeScopedStorage` primitives (pubkey-scoped storage), so there is no new
 * localStorage code here. The whole drafts map lives at a single base key; a
 * malformed stored value yields an empty map and NEVER throws (mirrors the
 * defensive read in `draftSlice.ts`). Drafts are local-only, per-device, scoped
 * by pubkey — no trust boundary crosses (T-10-03, accept).
 */

import { readScopedStorage, writeScopedStorage } from '@/features/geo-editor/store/persistence'
import type { ArticleContent } from '@/lib/nostr/article'

/** The editable slice of a Story we persist locally, plus a save timestamp. */
export type StoryDraft = Pick<ArticleContent, 'title' | 'summary' | 'image' | 'content'> & {
	updatedAt: number
}

/** Base storage key for the keyed Story-drafts map (pubkey-scoped by the primitive). */
const STORY_DRAFTS_STORAGE_KEY = 'earthly:story:drafts:v1'

/** Sentinel key for an unsaved Story that has no `d`-tag yet. */
export const NEW_STORY_DRAFT_KEY = 'new-story'

/** Defensive read of the whole drafts map — a malformed value yields `{}`, never throws. */
function readDraftMap(pubkey?: string | null): Record<string, StoryDraft> {
	const parsed = readScopedStorage<unknown>(STORY_DRAFTS_STORAGE_KEY, null, pubkey)
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

	const out: Record<string, StoryDraft> = {}
	for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
		const r = raw as Record<string, unknown>
		out[key] = {
			title: typeof r.title === 'string' ? r.title : undefined,
			summary: typeof r.summary === 'string' ? r.summary : undefined,
			image: typeof r.image === 'string' ? r.image : undefined,
			content: typeof r.content === 'string' ? r.content : undefined,
			updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
		}
	}
	return out
}

/** Read a single Story draft by `d`-tag (or the `new-story` sentinel). */
export function readStoryDraft(dTag: string, pubkey?: string | null): StoryDraft | null {
	const map = readDraftMap(pubkey)
	return map[dTag] ?? null
}

/** Write/replace a single Story draft, keyed by `d`-tag, stamping `updatedAt`. */
export function writeStoryDraft(
	dTag: string,
	draft: Omit<StoryDraft, 'updatedAt'> & Partial<Pick<StoryDraft, 'updatedAt'>>,
	pubkey?: string | null,
): void {
	const map = readDraftMap(pubkey)
	map[dTag] = { ...draft, updatedAt: draft.updatedAt ?? Date.now() }
	writeScopedStorage(STORY_DRAFTS_STORAGE_KEY, map, pubkey)
}

/** Remove a single Story draft (call on publish). No-op if absent. */
export function clearStoryDraft(dTag: string, pubkey?: string | null): void {
	const map = readDraftMap(pubkey)
	if (!(dTag in map)) return
	delete map[dTag]
	writeScopedStorage(STORY_DRAFTS_STORAGE_KEY, map, pubkey)
}
