import { useSyncExternalStore } from 'react'

export const CATALOG_PAGE_SIZE = 100
export type CatalogWindow = { limit: number | null; loading: boolean; hasMore: boolean }

/** Public catalog request windows are session-local, never persisted with an account. */
export function createCatalogWindows() {
	const states = new Map<number, CatalogWindow>()
	const listeners = new Map<number, Set<() => void>>()
	const get = (kind: number) => {
		let state = states.get(kind)
		if (!state) { state = { limit: CATALOG_PAGE_SIZE, loading: true, hasMore: true }; states.set(kind, state) }
		return state
	}
	const update = (kind: number, next: CatalogWindow) => {
		const current = get(kind)
		if (current.limit === next.limit && current.loading === next.loading && current.hasMore === next.hasMore) return
		states.set(kind, next)
		for (const listener of listeners.get(kind) ?? []) listener()
	}
	return {
		get,
		subscribe(kind: number, listener: () => void) {
			let entries = listeners.get(kind)
			if (!entries) { entries = new Set(); listeners.set(kind, entries) }
			entries.add(listener)
			return () => { entries.delete(listener) }
		},
		more(kind: number) {
			const state = get(kind)
			if (state.limit === null || state.loading || !state.hasMore) return
			update(kind, { ...state, limit: state.limit + CATALOG_PAGE_SIZE, loading: true })
		},
		all(kind: number) {
			const state = get(kind)
			if (state.limit === null) return
			update(kind, { limit: null, loading: true, hasMore: false })
		},
		settled(kind: number, requestedLimit: number | null, received: number, ready: boolean) {
			if (get(kind).limit !== requestedLimit) return
			update(kind, { limit: requestedLimit, loading: !ready, hasMore: requestedLimit !== null && received >= requestedLimit })
		},
	}
}

export const catalogWindows = createCatalogWindows()
export function useCatalogWindow(kind: number) {
	return useSyncExternalStore(listener => catalogWindows.subscribe(kind, listener), () => catalogWindows.get(kind), () => catalogWindows.get(kind))
}
