import { requirePublishAcknowledgement } from '@/lib/nostr/publishAcknowledgement'
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
import { ActionRunner, type ActionBuilder } from 'applesauce-actions'
import { defined } from 'applesauce-core'
import { normalizeURL, relaySet } from 'applesauce-core/helpers'
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
/** Legacy unscoped recovery storage; retained for explicit recovery only. */
export const couch = new IndexedDBCouch()
const accountCouches = new Map<string, IndexedDBCouch>()
export function getWalletCouch(pubkey = accounts.active?.pubkey): IndexedDBCouch {
	if (!pubkey) throw new Error('Sign in to use your wallet')
	let storage = accountCouches.get(pubkey)
	if (!storage) {
		storage = new IndexedDBCouch(`earthly-wallet-couch-${pubkey}`)
		accountCouches.set(pubkey, storage)
	}
	return storage
}

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

// The old decrypted-content cache contained spendable proofs in plaintext.
// Relay ciphertext remains the source of truth; unlock through the signer after reload.
if (typeof localStorage !== 'undefined') {
	for (const key of Object.keys(localStorage)) {
		if (key.startsWith('wallet:enc:')) localStorage.removeItem(key)
	}
}

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
/** Capture a real signer per operation. ActionRunner caches `self`, so a singleton
 * runner backed by ProxySigner can mix the first account's proofs with a later signer. */
export function createWalletActions(): ActionRunner {
	const account = accounts.active
	if (!account) throw new Error('Sign in to use your wallet')
	const runner = new ActionRunner(
		eventStore,
		account.signer,
		async (event: NostrEvent, relays?: string[]) => {
			if (event.pubkey !== account.pubkey) throw new Error('Wallet signer changed account')
			let targetRelays = relays?.length ? relays : await resolveWalletPublishRelays(event.pubkey)
			if (targetRelays.length === 0) targetRelays = config.writeRelays
			allowRelays(targetRelays)
			requirePublishAcknowledgement(await pool.publish(targetRelays, event))
			eventStore.add(event)
		},
	)
	// A rejected publication must not look durable or clear recovery proofs.
	runner.saveToStore = false
	return runner
}

export const walletActions = {
	run<Args extends unknown[]>(builder: ActionBuilder<Args>, ...args: Args): Promise<void> {
		return createWalletActions().run(builder, ...args)
	},
}

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
