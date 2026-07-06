/**
 * Wallet runtime singletons.
 *
 *   - `walletActions`: an `ActionRunner` bound to the active applesauce account.
 *     All NIP-60 mutations go through this — see `applesauce-wallet/actions`.
 *   - `couch`:        an `IndexedDBCouch` where in-flight tokens are parked
 *     during operations so they can be recovered if a swap or melt fails.
 *   - `getCashuWallet`: cached cashu-ts Wallet factory shared by every wallet
 *     action so each mint keeps a single info-cache + WebSocket connection.
 *
 * Side-effect: imports `applesauce-wallet/casts` so `user.wallet$` and
 * `user.nutzap$` are available on every `User` cast in the app.
 */

import 'applesauce-wallet/casts'
import { Mint, Wallet as CashuWallet } from '@cashu/cashu-ts'
import { ActionRunner } from 'applesauce-actions'
import { ProxySigner } from 'applesauce-accounts'
import { persistEncryptedContent } from 'applesauce-common/helpers'
import { defined } from 'applesauce-core'
import { normalizeURL, relaySet } from 'applesauce-core/helpers'
import type { ISigner } from 'applesauce-signers'
import {
	getWalletMints,
	getWalletRelays,
	IndexedDBCouch,
	WALLET_KIND,
} from 'applesauce-wallet/helpers'
import { WalletBalanceModel } from 'applesauce-wallet/models'
import type { NostrEvent } from 'nostr-tools'
import { BehaviorSubject, firstValueFrom, map, of, switchMap, timeout } from 'rxjs'
import { config } from '@/config'
import { accounts, allowRelays, eventStore, pool } from '@/lib/nostr'

/**
 * Tokens-in-flight storage. ApplesauceWallet `TokensOperation` requires this
 * so that if a mint operation fails partway, the proofs aren't lost.
 */
export const couch = new IndexedDBCouch()

/**
 * Cache of cashu-ts Mint instances reused across mint/melt operations.
 * A Mint caches the mint's info and owns a single WebSocket connection, so
 * reusing instances avoids re-fetching info and keeps one socket per mint.
 */
const mints = new Map<string, Mint>()

export function getMint(url: string): Mint {
	const key = normalizeURL(url)
	let mint = mints.get(key)
	if (!mint) {
		mint = new Mint(key)
		mints.set(key, mint)
	}
	return mint
}

/**
 * Builds a loaded cashu Wallet from a cached Mint. Passed as the
 * `getCashuWallet` option to wallet actions and used directly for quotes.
 */
export async function getCashuWallet(mint: string): Promise<CashuWallet> {
	const wallet = new CashuWallet(getMint(mint))
	await wallet.loadMint()
	return wallet
}

/**
 * Reactive view of the active account's signer. Wallet actions sign through
 * this proxy — no need to wire the signer through every call site.
 */
const activeSigner$ = accounts.active$.pipe(
	map((account) => account?.signer as ISigner | undefined),
)

/**
 * Encrypted-content cache keyed by event id. NIP-60 wallet/token/history
 * events stash their payloads in encrypted content; persisting decrypted
 * versions in localStorage avoids re-decrypting every reload.
 *
 * The cache is per-pubkey-prefixed so different accounts on the same browser
 * don't share decrypted state.
 */
function makeEncryptedContentStorage(): {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
} {
	const prefix = () => {
		const pk = accounts.active?.pubkey
		return pk ? `wallet:enc:${pk.slice(0, 16)}:` : null
	}
	return {
		async getItem(key) {
			if (typeof localStorage === 'undefined') return null
			const p = prefix()
			if (!p) return null
			return localStorage.getItem(p + key)
		},
		async setItem(key, value) {
			if (typeof localStorage === 'undefined') return
			const p = prefix()
			if (!p) return
			localStorage.setItem(p + key, value)
		},
	}
}

persistEncryptedContent(eventStore, of(makeEncryptedContentStorage()))

/**
 * Resolve publish relays for a wallet event when the action didn't pick any:
 * the wallet's own relay list merged with the author's NIP-65 outboxes,
 * mirroring the applesauce wallet example.
 */
async function resolveWalletPublishRelays(pubkey: string): Promise<string[]> {
	const mailboxes = await firstValueFrom(
		eventStore
			.mailboxes(pubkey)
			.pipe(defined(), timeout({ first: 5_000, with: () => of(undefined) })),
	)
	const wallet = await firstValueFrom(
		eventStore
			.replaceable(WALLET_KIND, pubkey)
			.pipe(defined(), timeout({ first: 5_000, with: () => of(undefined) })),
	)
	return relaySet(wallet && getWalletRelays(wallet), mailboxes?.outboxes)
}

/**
 * Action runner used by every wallet operation.
 *
 * Wallet events are exempt from the dev write-lock that governs `publish()`:
 * NIP-60 events are NIP-44-encrypted personal state, and writing them only to
 * the local relay forks the user's real wallet across relay sets (other NIP-60
 * clients would keep operating on stale token events). Action-chosen relays
 * win; otherwise wallet relays + outboxes; configured relays as last resort.
 */
export const walletActions = new ActionRunner(
	eventStore,
	new ProxySigner<ISigner>(activeSigner$),
	async (event: NostrEvent, relays?: string[]) => {
		let targetRelays = relays?.length ? relays : await resolveWalletPublishRelays(event.pubkey)
		if (targetRelays.length === 0) targetRelays = config.writeRelays
		// Vouch for the wallet's relays with the dev pool guard — the wallet is
		// the one sanctioned exception to dev relay isolation (see comment above).
		allowRelays(targetRelays)
		await pool.publish(targetRelays, event)
		eventStore.add(event)
	},
)

// =====================================================================
// Synchronous snapshot for non-React callers (e.g. the chat zustand store).
// Updated reactively from EventStore + WalletBalanceModel.
// =====================================================================

export interface WalletSnapshot {
	pubkey: string | null
	exists: boolean
	mints: string[]
	balance: Record<string, number>
	totalBalance: number
}

const EMPTY_SNAPSHOT: WalletSnapshot = {
	pubkey: null,
	exists: false,
	mints: [],
	balance: {},
	totalBalance: 0,
}

const snapshot$ = new BehaviorSubject<WalletSnapshot>(EMPTY_SNAPSHOT)

// Track the active pubkey + its wallet event + balance and rebuild the snapshot
// whenever any of them change. Resubscribes to the balance model when pubkey flips.
accounts.active$
	.pipe(
		switchMap((account) => {
			const pubkey = account?.pubkey ?? null
			if (!pubkey) return of(EMPTY_SNAPSHOT)
			return eventStore.model(WalletBalanceModel, pubkey).pipe(
				map((balance) => {
					const event = eventStore.getReplaceable(WALLET_KIND, pubkey)
					let mints: string[] = []
					try {
						mints = event ? getWalletMints(event) : []
					} catch {
						/* locked or invalid */
					}
					const totalBalance = Object.values(balance ?? {}).reduce((a, b) => a + b, 0)
					return {
						pubkey,
						exists: Boolean(event),
						mints,
						balance: balance ?? {},
						totalBalance,
					}
				}),
			)
		}),
	)
	.subscribe((snap) => snapshot$.next(snap))

/** Read the latest wallet snapshot synchronously. */
export function getWalletSnapshot(): WalletSnapshot {
	return snapshot$.value
}

/** Subscribe to wallet snapshot changes (rxjs Observable). */
export const walletSnapshot$ = snapshot$.asObservable()
