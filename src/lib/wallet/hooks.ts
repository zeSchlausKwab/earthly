/**
 * React hooks for the NIP-60 wallet.
 *
 * Built on `applesauce-wallet/casts` (which extend `User` with `wallet$` and
 * `nutzap$`). The active applesauce account drives everything — switching
 * accounts switches wallets automatically.
 */

import { castUser } from 'applesauce-common/casts'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import type { Wallet } from 'applesauce-wallet/casts'
import { useMemo } from 'react'
import { eventStore } from '@/lib/nostr'

/**
 * Reactive view of the active account's wallet state.
 *
 * `exists` becomes `true` once the kind 17375 wallet event is in the store.
 * `unlocked` flips to `true` after an UnlockWallet action (or autoUnlock).
 * `ready` is the conjunction — almost every UI gate should use it.
 */
export interface WalletState {
	/** `true` once a kind 17375 event for the active pubkey is in the store. */
	exists: boolean
	/** `true` once content has been decrypted (UnlockWallet action). */
	unlocked: boolean
	/** Convenience: `exists && unlocked`. */
	ready: boolean
	/** Per-mint sat balances. `undefined` while loading or locked. */
	balance: Record<string, number> | undefined
	/** Total across all mints. 0 if balance is unavailable. */
	totalBalance: number
	/** Configured mints on the wallet event. Empty array if locked. */
	mints: string[]
	/** The underlying Wallet cast — pass through to operations. */
	wallet: Wallet | undefined
}

/** Subscribe to the active account's wallet. Re-renders on state changes. */
export function useWallet(): WalletState {
	const active = useActiveAccount()
	const user = useMemo(
		() => (active?.pubkey ? castUser(active.pubkey, eventStore) : null),
		[active?.pubkey],
	)
	const wallet = use$(() => user?.wallet$, [user])
	const balance = use$(() => wallet?.balance$, [wallet])

	const totalBalance = useMemo(
		() => (balance ? Object.values(balance).reduce((a, b) => a + b, 0) : 0),
		[balance],
	)
	const mints = wallet?.unlocked ? wallet.mints : []

	return {
		exists: Boolean(wallet),
		unlocked: Boolean(wallet?.unlocked),
		ready: Boolean(wallet && wallet.unlocked),
		balance,
		totalBalance,
		mints,
		wallet: wallet ?? undefined,
	}
}

/**
 * Subscribe to the active account's wallet history events.
 *
 * Only unlocked entries have meaningful content; consume `entry.meta$` to
 * surface direction/amount/mint in the UI.
 */
export function useWalletHistory() {
	const wallet = useWallet().wallet
	return use$(() => wallet?.history$, [wallet])
}

/** Subscribe to the active account's token events (decrypted when unlocked). */
export function useWalletTokens() {
	const wallet = useWallet().wallet
	return use$(() => wallet?.tokens$, [wallet])
}
