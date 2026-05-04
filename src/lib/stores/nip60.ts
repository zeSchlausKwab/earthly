/**
 * Compatibility shim during the wallet rebuild.
 *
 * The legacy `useNip60Store` exposed a Zustand-flavored API tied to NDKCashuWallet.
 * That implementation has been deleted; the new wallet runtime lives in
 * `@/lib/wallet` (built on `applesauce-wallet`).
 *
 * This shim keeps the EXISTING UI compiling against the old API. It is
 * intentionally lean: read-side maps to the new applesauce wallet hooks.
 * Write-side ops (sendEcash, deposit, withdraw, etc.) throw a clear error
 * pointing callers at the new module so they get rebuilt cleanly rather
 * than continue to depend on the buggy legacy flow.
 *
 * Once `Nip60Wallet.tsx` and the modals are rewritten on the new hook surface
 * this file can be deleted.
 */

import { create } from 'zustand'
import {
	getWalletMints,
	getWalletRelays,
	WALLET_KIND,
} from 'applesauce-wallet/helpers'
import { accounts, eventStore } from '@/lib/nostr'
import type { PendingToken } from '@/lib/wallet'

export type PendingNip60Token = PendingToken

const NOT_IMPLEMENTED =
	'[wallet] Legacy nip60Actions are not wired during the applesauce rebuild. ' +
	'Use the hooks/actions from `@/lib/wallet` instead.'

export interface Nip60State {
	wallet: null
	status: 'idle' | 'initializing' | 'ready' | 'no_wallet' | 'error'
	balance: number
	mintBalances: Record<string, number>
	mints: string[]
	defaultMint: string | null
	transactions: never[]
	error: string | null
	activeDeposit: null
	depositInvoice: null
	depositStatus: 'idle'
	pendingTokens: PendingNip60Token[]
}

const initialState: Nip60State = {
	wallet: null,
	status: 'idle',
	balance: 0,
	mintBalances: {},
	mints: [],
	defaultMint:
		typeof localStorage !== 'undefined' ? localStorage.getItem('nip60_default_mint') : null,
	transactions: [],
	error: null,
	activeDeposit: null,
	depositInvoice: null,
	depositStatus: 'idle',
	pendingTokens: [],
}

function readState(): Nip60State {
	const pubkey = accounts.active?.pubkey
	if (!pubkey) return { ...initialState }
	const event = eventStore.getReplaceable(WALLET_KIND, pubkey)
	if (!event) return { ...initialState, status: 'no_wallet' }
	try {
		const mints = getWalletMints(event)
		void getWalletRelays(event) // touch to keep import live
		return { ...initialState, status: 'ready', mints }
	} catch {
		return { ...initialState, status: 'no_wallet' }
	}
}

/** Zustand store mirroring the legacy API. Read-only during rebuild. */
export const useNip60Store = create<Nip60State>(() => readState())

// Re-pull state on event-store changes that affect the wallet event.
eventStore.insert$.subscribe((event) => {
	if (event.kind === WALLET_KIND && event.pubkey === accounts.active?.pubkey) {
		useNip60Store.setState(readState())
	}
})
accounts.active$.subscribe(() => {
	useNip60Store.setState(readState())
})

const reject = <T>(_label: string): T => {
	throw new Error(NOT_IMPLEMENTED)
}

/**
 * Legacy action surface — every method throws to surface the migration.
 * Real implementations live in `@/lib/wallet/actions`.
 */
export const nip60Actions = {
	initialize: async () => {
		// no-op: the new runtime initializes itself from accounts.active
	},
	createWallet: async (_mints: string[]) => reject('createWallet'),
	reset: () => {
		useNip60Store.setState(initialState)
	},
	refresh: async () => {
		useNip60Store.setState(readState())
	},
	addMint: (_mintUrl: string) => reject<void>('addMint'),
	removeMint: (_mintUrl: string) => reject<void>('removeMint'),
	publishWallet: async () => reject<void>('publishWallet'),
	setDefaultMint: (mintUrl: string | null) => {
		if (mintUrl) localStorage.setItem('nip60_default_mint', mintUrl)
		else localStorage.removeItem('nip60_default_mint')
		useNip60Store.setState({ defaultMint: mintUrl })
	},
	startDeposit: async (_amount: number, _mint?: string) =>
		reject<string | null>('startDeposit'),
	cancelDeposit: () => {
		// no-op
	},
	withdrawLightning: async (_invoice: string) => reject<boolean>('withdrawLightning'),
	sendEcash: async (_amount: number, _mint?: string) => reject<string | null>('sendEcash'),
	receiveEcash: async (_token: string) => reject<boolean>('receiveEcash'),
	loadPendingTokens: () => {
		// no-op
	},
	reclaimToken: async (_tokenId: string) => reject<boolean>('reclaimToken'),
	removePendingToken: (_tokenId: string) => {
		// no-op
	},
	getActivePendingTokens: () => [] as PendingNip60Token[],
} as const
