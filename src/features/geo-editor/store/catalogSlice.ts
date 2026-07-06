import type { StateCreator } from 'zustand'
import { readScopedStorage, writeScopedStorage } from './persistence'
import type { CatalogSlice, EditorState, RecentEntity } from './types'

const PINNED_STORAGE_KEY = 'earthly:catalog-pins'
const RECENT_STORAGE_KEY = 'earthly:catalog-recents'
const RECENT_LIMIT = 20

/**
 * Round G.2: catalog-level pins and recents, persisted to scoped localStorage
 * (per-pubkey, falls back to a guest scope). Deliberately local-first — a
 * NIP-51 bookmark list can layer on later as an opt-in sync without changing
 * this surface. Entity ids use the stack-entry convention:
 * `dataset:<pubkey>:<d>` / `context:<kind>:<pubkey>:<d>`.
 */
export const createCatalogSlice: StateCreator<EditorState, [], [], CatalogSlice> = (set) => ({
	pinnedEntityIds: readScopedStorage<string[]>(PINNED_STORAGE_KEY, []),
	recentEntities: readScopedStorage<RecentEntity[]>(RECENT_STORAGE_KEY, []),

	togglePinnedEntity: (entityId) =>
		set((state) => {
			const next = state.pinnedEntityIds.includes(entityId)
				? state.pinnedEntityIds.filter((id) => id !== entityId)
				: [...state.pinnedEntityIds, entityId]
			writeScopedStorage(PINNED_STORAGE_KEY, next)
			return { pinnedEntityIds: next }
		}),

	recordRecentEntity: (entityId) =>
		set((state) => {
			const at = Date.now()
			const next: RecentEntity[] = [
				{ id: entityId, at },
				...state.recentEntities.filter((entry) => entry.id !== entityId),
			].slice(0, RECENT_LIMIT)
			writeScopedStorage(RECENT_STORAGE_KEY, next)
			return { recentEntities: next }
		}),

	hydrateCatalogPrefsForPubkey: (pubkey) =>
		set(() => ({
			pinnedEntityIds: readScopedStorage<string[]>(PINNED_STORAGE_KEY, [], pubkey),
			recentEntities: readScopedStorage<RecentEntity[]>(RECENT_STORAGE_KEY, [], pubkey),
		})),
})
