import { getCurrentPubkey } from '@/lib/wallet/currentUser'

function getScopedStorageKey(baseKey: string, pubkey?: string | null): string {
	const scope = pubkey ?? getCurrentPubkey()
	return scope ? `${baseKey}:${scope.slice(0, 8)}` : `${baseKey}:guest`
}

export function readScopedStorage<T>(baseKey: string, fallback: T, pubkey?: string | null): T {
	if (typeof window === 'undefined') {
		return fallback
	}

	try {
		const raw = window.localStorage.getItem(getScopedStorageKey(baseKey, pubkey))
		return raw ? (JSON.parse(raw) as T) : fallback
	} catch (error) {
		console.warn(`Failed to read scoped storage for ${baseKey}`, error)
		return fallback
	}
}

export function writeScopedStorage<T>(baseKey: string, value: T, pubkey?: string | null): void {
	if (typeof window === 'undefined') return

	try {
		window.localStorage.setItem(getScopedStorageKey(baseKey, pubkey), JSON.stringify(value))
	} catch (error) {
		console.warn(`Failed to write scoped storage for ${baseKey}`, error)
	}
}
