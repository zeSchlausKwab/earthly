import { create } from 'zustand'
import type { ReactableEvent } from '../hooks/useGeoReactions'

interface ZapDialogState {
	target: ReactableEvent | null
	open: (target: ReactableEvent) => void
	close: () => void
}

/**
 * The zap flow outlives whichever list row or inspector launched it. Entity
 * surfaces are intentionally remounted during navigation and live updates, so
 * dialog ownership must sit at the application boundary instead.
 */
export const useZapDialogStore = create<ZapDialogState>((set) => ({
	target: null,
	open: (target) => set({ target }),
	close: () => set({ target: null }),
}))
