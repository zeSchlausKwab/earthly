/**
 * Local-first Temporal Sighting draft persistence (D-04 draft, local-first).
 *
 * A Sighting draft is held per-device in scoped localStorage, keyed by the
 * Sighting's `d`-tag, and cleared on publish. Reuses the existing
 * `readScopedStorage` / `writeScopedStorage` primitives (pubkey-scoped storage),
 * so there is no new localStorage code here. The whole drafts map lives at a
 * single base key; a malformed stored value yields an empty map and NEVER throws
 * (mirrors `story/draft.ts`). Drafts are local-only, per-device, scoped by pubkey
 * — no trust boundary crosses (T-11-02-04, accept).
 */

import type { LineString, Point, Polygon } from 'geojson'
import { readScopedStorage, writeScopedStorage } from '@/features/geo-editor/store/persistence'
import type { TemporalSightingContent } from './helpers'

/** The editable slice of a Sighting we persist locally, plus a save timestamp. */
export type SightingDraft = Pick<
	TemporalSightingContent,
	'title' | 'description' | 'start' | 'end' | 'geometry'
> & {
	updatedAt: number
}

/** Base storage key for the keyed Sighting-drafts map (pubkey-scoped by the primitive). */
const SIGHTING_DRAFTS_STORAGE_KEY = 'earthly:sighting:drafts:v1'

/** Sentinel key for an unsaved Sighting that has no `d`-tag yet. */
export const NEW_SIGHTING_DRAFT_KEY = 'new-sighting'

/** Narrowing guard for a stored geometry object (object, not array). */
function isGeometryLike(value: unknown): value is Point | LineString | Polygon {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Defensive read of the whole drafts map — a malformed value yields `{}`, never throws. */
function readDraftMap(pubkey?: string | null): Record<string, SightingDraft> {
	const parsed = readScopedStorage<unknown>(SIGHTING_DRAFTS_STORAGE_KEY, null, pubkey)
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

	const out: Record<string, SightingDraft> = {}
	for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
		const r = raw as Record<string, unknown>
		out[key] = {
			title: typeof r.title === 'string' ? r.title : undefined,
			description: typeof r.description === 'string' ? r.description : undefined,
			start: typeof r.start === 'number' ? r.start : undefined,
			end: typeof r.end === 'number' ? r.end : undefined,
			geometry: isGeometryLike(r.geometry) ? r.geometry : undefined,
			updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
		}
	}
	return out
}

/** Read a single Sighting draft by `d`-tag (or the `new-sighting` sentinel). */
export function readSightingDraft(dTag: string, pubkey?: string | null): SightingDraft | null {
	const map = readDraftMap(pubkey)
	return map[dTag] ?? null
}

/** Write/replace a single Sighting draft, keyed by `d`-tag, stamping `updatedAt`. */
export function writeSightingDraft(
	dTag: string,
	draft: Omit<SightingDraft, 'updatedAt'> & Partial<Pick<SightingDraft, 'updatedAt'>>,
	pubkey?: string | null,
): void {
	const map = readDraftMap(pubkey)
	map[dTag] = { ...draft, updatedAt: draft.updatedAt ?? Date.now() }
	writeScopedStorage(SIGHTING_DRAFTS_STORAGE_KEY, map, pubkey)
}

/** Remove a single Sighting draft (call on publish). No-op if absent. */
export function clearSightingDraft(dTag: string, pubkey?: string | null): void {
	const map = readDraftMap(pubkey)
	if (!(dTag in map)) return
	delete map[dTag]
	writeScopedStorage(SIGHTING_DRAFTS_STORAGE_KEY, map, pubkey)
}
