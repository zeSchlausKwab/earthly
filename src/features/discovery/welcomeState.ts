export const DISCOVER_WELCOME_STORAGE_KEY = 'earthly-discover-welcome-v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function getDiscoverWelcomeStorage(): StorageLike | undefined {
	try {
		return typeof window === 'undefined' ? undefined : window.localStorage
	} catch {
		return undefined
	}
}

export function hasSeenDiscoverWelcome(storage: StorageLike | undefined): boolean {
	if (!storage) return false
	try {
		return storage.getItem(DISCOVER_WELCOME_STORAGE_KEY) === 'seen'
	} catch {
		return false
	}
}

export function markDiscoverWelcomeSeen(storage: StorageLike | undefined): void {
	if (!storage) return
	try {
		storage.setItem(DISCOVER_WELCOME_STORAGE_KEY, 'seen')
	} catch {
		// Discovery remains usable when storage is blocked.
	}
}
