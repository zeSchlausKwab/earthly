import { getCurrentPubkey } from '@/lib/wallet/currentUser'

export interface ScopedStorageWriteFailure {
	baseKey: string
	scopedKey: string
	scope: string | null
	message: string
	failedAt: number
}

export type ScopedStorageWriteFailures = Readonly<Record<string, ScopedStorageWriteFailure>>

let scopedStorageWriteFailures: ScopedStorageWriteFailures = {}
const scopedStorageWriteFailureListeners = new Set<() => void>()

function notifyScopedStorageWriteFailureListeners(): void {
	for (const listener of scopedStorageWriteFailureListeners) listener()
}

function describeStorageError(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message.trim()
	return 'Browser storage is unavailable.'
}

function recordScopedStorageWriteFailure(
	baseKey: string,
	scopedKey: string,
	scope: string | null,
	error: unknown,
): void {
	scopedStorageWriteFailures = {
		...scopedStorageWriteFailures,
		[scopedKey]: {
			baseKey,
			scopedKey,
			scope,
			message: describeStorageError(error),
			failedAt: Date.now(),
		},
	}
	notifyScopedStorageWriteFailureListeners()
}

function clearScopedStorageWriteFailure(scopedKey: string): void {
	if (!scopedStorageWriteFailures[scopedKey]) return
	const next = { ...scopedStorageWriteFailures }
	delete next[scopedKey]
	scopedStorageWriteFailures = next
	notifyScopedStorageWriteFailureListeners()
}

/**
 * Session-lifetime view of storage writes that have failed and have not yet
 * succeeded on a later retry. UI can subscribe to this without persisting the
 * warning in the same storage that just failed.
 */
export function getScopedStorageWriteFailures(): ScopedStorageWriteFailures {
	return scopedStorageWriteFailures
}

export function subscribeScopedStorageWriteFailures(listener: () => void): () => void {
	scopedStorageWriteFailureListeners.add(listener)
	return () => scopedStorageWriteFailureListeners.delete(listener)
}

function resolveStorageScope(pubkey?: string | null): string | null {
	// `undefined` means "use the active account". `null` is an explicit guest
	// scope, which lets delayed writes retain their original destination even if
	// an account becomes active before the write runs.
	return pubkey === undefined ? getCurrentPubkey() : pubkey
}

function getScopedStorageKey(baseKey: string, pubkey?: string | null): string {
	const scope = resolveStorageScope(pubkey)
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

	const scope = resolveStorageScope(pubkey)
	const scopedKey = getScopedStorageKey(baseKey, pubkey)
	try {
		window.localStorage.setItem(scopedKey, JSON.stringify(value))
		clearScopedStorageWriteFailure(scopedKey)
	} catch (error) {
		console.warn(`Failed to write scoped storage for ${baseKey}`, error)
		recordScopedStorageWriteFailure(baseKey, scopedKey, scope, error)
	}
}
