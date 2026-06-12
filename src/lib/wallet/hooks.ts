/**
 * React hooks for the NIP-60 wallet.
 *
 * Built on the Applesauce wallet cast and EventStore models. The active
 * applesauce account drives everything — switching accounts switches wallets
 * automatically.
 */

import { castTimelineStream } from 'applesauce-common/observable'
import { castEvent } from 'applesauce-core/casts'
import { kinds, relaySet } from 'applesauce-core/helpers'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import { Nutzap, NutzapInfo, Wallet } from 'applesauce-wallet/casts'
import {
	NUTZAP_KIND,
	WALLET_HISTORY_KIND,
	WALLET_KIND,
	WALLET_TOKEN_KIND,
} from 'applesauce-wallet/helpers'
import { NUTZAP_INFO_KIND } from 'applesauce-wallet/helpers/nutzap-info'
import type { Filter } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { config } from '@/config'
import { eventStore } from '@/lib/nostr'
import { useTimelineWithEose } from '@/lib/nostr/hooks'

/**
 * Reactive view of the active account's wallet state.
 *
 * `exists` becomes `true` once the kind 17375 wallet event is in the store.
 * `unlocked` flips to `true` after an UnlockWallet action (or autoUnlock).
 * `ready` is the conjunction — almost every UI gate should use it.
 */
export interface WalletState {
	/** `true` while the wallet event lookup is still waiting on relay responses. */
	loading: boolean
	/** `true` while wallet token/history/delete events are still syncing. */
	syncing: boolean
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

	const walletFilter = useMemo<Filter | null>(
		() => (active?.pubkey ? { kinds: [WALLET_KIND], authors: [active.pubkey], limit: 1 } : null),
		[active?.pubkey],
	)
	const { eose: walletEose } = useTimelineWithEose(walletFilter)

	const walletEvent = use$(
		() => (active?.pubkey ? eventStore.replaceable(WALLET_KIND, active.pubkey) : undefined),
		[active?.pubkey],
	)
	const wallet = useMemo(() => {
		if (!walletEvent || walletEvent.pubkey !== active?.pubkey) return undefined
		try {
			return castEvent(walletEvent, Wallet, eventStore)
		} catch {
			return undefined
		}
	}, [walletEvent, active?.pubkey])
	const balance = use$(() => wallet?.balance$, [wallet])

	const walletRelays = wallet?.relays
	const walletDataRelays = useMemo(() => relaySet(config.readRelays, walletRelays), [walletRelays])
	const walletDataFilters = useMemo<Filter[] | null>(
		() =>
			active?.pubkey && wallet
				? [
						{
							kinds: [WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
							authors: [active.pubkey],
						},
						{
							kinds: [kinds.EventDeletion],
							authors: [active.pubkey],
							'#k': [String(WALLET_TOKEN_KIND)],
						},
					]
				: null,
		[active?.pubkey, wallet],
	)
	const { eose: walletDataEose } = useTimelineWithEose(walletDataFilters, walletDataRelays)

	const totalBalance = useMemo(
		() => (balance ? Object.values(balance).reduce((a, b) => a + b, 0) : 0),
		[balance],
	)
	const mints = wallet?.unlocked ? wallet.mints : []

	return {
		loading: Boolean(active?.pubkey && !wallet && !walletEose),
		syncing: Boolean(wallet && !walletDataEose),
		exists: Boolean(wallet),
		unlocked: Boolean(wallet?.unlocked),
		ready: Boolean(wallet?.unlocked && walletDataEose),
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

export interface NutzapsState {
	/** All incoming nutzap events for the active pubkey (newest first). */
	nutzaps: Nutzap[] | undefined
	/** Nutzap event ids already redeemed into the wallet. */
	received: string[] | undefined
	/** Nutzaps not yet redeemed. */
	unclaimed: Nutzap[]
	/** `true` while the nutzap lookup is waiting on relay responses. */
	loading: boolean
}

/**
 * Subscribe to incoming NIP-61 nutzaps for the active account.
 *
 * Redeemed ids come from the wallet's history events (`wallet.received$`), so
 * `unclaimed` only shrinks once a ReceiveNutzaps action lands.
 */
export function useNutzaps(): NutzapsState {
	const active = useActiveAccount()
	const { wallet } = useWallet()
	const received = use$(() => wallet?.received$, [wallet])

	const nutzapFilter = useMemo<Filter | null>(
		() => (active?.pubkey ? { kinds: [NUTZAP_KIND], '#p': [active.pubkey] } : null),
		[active?.pubkey],
	)
	const { eose } = useTimelineWithEose(nutzapFilter)

	const nutzaps = use$(
		() =>
			active?.pubkey
				? eventStore
						.timeline({ kinds: [NUTZAP_KIND], '#p': [active.pubkey] })
						.pipe(castTimelineStream(Nutzap, eventStore))
				: undefined,
		[active?.pubkey],
	)

	const unclaimed = useMemo(() => {
		if (!nutzaps) return []
		if (!received) return nutzaps
		const receivedSet = new Set(received)
		return nutzaps.filter((nutzap) => !receivedSet.has(nutzap.id))
	}, [nutzaps, received])

	return {
		nutzaps,
		received,
		unclaimed,
		loading: Boolean(active?.pubkey && !nutzaps?.length && !eose),
	}
}

/**
 * Subscribe to the active account's NIP-61 nutzap info event (kind 10019).
 * Holds the mints + relays where others should send nutzaps.
 */
export function useNutzapInfo(): NutzapInfo | undefined {
	const active = useActiveAccount()

	const infoFilter = useMemo<Filter | null>(
		() =>
			active?.pubkey ? { kinds: [NUTZAP_INFO_KIND], authors: [active.pubkey], limit: 1 } : null,
		[active?.pubkey],
	)
	useTimelineWithEose(infoFilter)

	const infoEvent = use$(
		() => (active?.pubkey ? eventStore.replaceable(NUTZAP_INFO_KIND, active.pubkey) : undefined),
		[active?.pubkey],
	)

	return useMemo(() => {
		if (!infoEvent || infoEvent.pubkey !== active?.pubkey) return undefined
		try {
			return castEvent(infoEvent, NutzapInfo, eventStore)
		} catch {
			return undefined
		}
	}, [infoEvent, active?.pubkey])
}

const DEFAULT_MINT_KEY = 'nip60_default_mint'

/**
 * Persisted "default mint" preference (per browser, not per account).
 *
 * The wallet event itself doesn't have a notion of a default — it just lists
 * mints. This hook backs the user's preferred mint to localStorage so the
 * Send/Deposit/Withdraw modals open pre-selected.
 */
export function useDefaultMint(): [string | null, (mint: string | null) => void] {
	const [value, setValue] = useState<string | null>(() => {
		if (typeof localStorage === 'undefined') return null
		return localStorage.getItem(DEFAULT_MINT_KEY)
	})

	useEffect(() => {
		if (typeof localStorage === 'undefined') return
		const onStorage = (e: StorageEvent) => {
			if (e.key === DEFAULT_MINT_KEY) setValue(e.newValue)
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])

	const setMint = useCallback((mint: string | null) => {
		if (typeof localStorage !== 'undefined') {
			if (mint) localStorage.setItem(DEFAULT_MINT_KEY, mint)
			else localStorage.removeItem(DEFAULT_MINT_KEY)
		}
		setValue(mint)
	}, [])

	return [value, setMint]
}
