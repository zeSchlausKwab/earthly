/**
 * Device-local, app-global contributor mute store (D-10 / D-11).
 *
 * Mute is LOCAL-ONLY (localStorage), per-device, applied app-wide — no signing, no
 * publish, no relay write. A muted contributor's events are dropped everywhere the app
 * reads a contributor lane (the foreign-lane gate, comments, shoutbox). The persisted
 * blob lives under `earthly-muted-contributors`, mirroring the chat store's persist
 * contract (`features/chat/store.ts`).
 */

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface MuteState {
	/** The muted contributor pubkeys (hex), de-duplicated (Set semantics). */
	muted: string[]
	/** Add a pubkey to the muted set (idempotent). */
	mute: (pubkey: string) => void
	/** Remove a pubkey from the muted set. */
	unmute: (pubkey: string) => void
	/** Whether a pubkey is currently muted. */
	isMuted: (pubkey: string) => boolean
}

/** persist `partialize` allow-list — only the `muted` list crosses into localStorage. */
function muteStorePartialize(state: MuteState): Pick<MuteState, 'muted'> {
	return { muted: state.muted }
}

export const useMuteStore = create<MuteState>()(
	persist(
		(set, get) => ({
			muted: [],
			mute: (pubkey: string) => set((s) => ({ muted: [...new Set([...s.muted, pubkey])] })),
			unmute: (pubkey: string) => set((s) => ({ muted: s.muted.filter((pk) => pk !== pubkey) })),
			isMuted: (pubkey: string) => get().muted.includes(pubkey),
		}),
		{
			name: 'earthly-muted-contributors',
			// Explicit JSON storage so the persist admin API (`.persist.getOptions()`) attaches
			// even where the default resolver can't (the localStorage polyfill under bun test).
			storage: createJSONStorage(() => localStorage),
			partialize: muteStorePartialize,
		},
	),
)
