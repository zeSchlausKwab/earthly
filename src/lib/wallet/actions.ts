/**
 * High-level wallet actions used by the UI.
 *
 * These are thin wrappers around `applesauce-wallet/actions` that expose a
 * stable, ergonomic surface and bake in:
 *
 *   - The shared `walletActions` ActionRunner (active applesauce signer +
 *     dev-safety publishing).
 *   - The shared `couch` for safe token operations.
 *   - The shared `getCashuWallet` factory (one cached Mint + socket per mint).
 *
 * Lower-level actions (e.g. `TokensOperation`, `RolloverTokens`) are still
 * available via `walletActions.run(...)` — these wrappers cover the common
 * happy paths.
 */

import { getEncodedToken, getTokenMetadata, MintQuoteState, type Token } from '@cashu/cashu-ts'
import {
	AddNutzapInfoMint,
	ConsolidateTokens,
	CreateWallet,
	MintTokens,
	ReceiveNutzaps,
	ReceiveToken,
	RecoverFromCouch,
	RemoveNutzapInfoMint,
	SetWalletMints,
	SetWalletRelays,
	TokensOperation,
	type TokenSelectionFunction,
	UnlockWallet,
} from 'applesauce-wallet/actions'
import {
	dumbTokenSelection,
	getTokenContent,
	getTokenDeletedIds,
	isTokenContentUnlocked,
} from 'applesauce-wallet/helpers'
import { generateSecretKey } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { couch, getCashuWallet, getWalletSnapshot, walletActions } from './runtime'

/**
 * Default relays for newly created wallets. Wallet events are encrypted
 * personal state that other NIP-60 clients must be able to find, so they go
 * to well-known public relays — never the local dev relay.
 */
const DEFAULT_WALLET_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.snort.social',
	'wss://relay.primal.net',
]

export interface CreateWalletOptions {
	/** Mints to use. Required. */
	mints: string[]
	/**
	 * Generate a P2PK private key so the wallet can receive nutzaps.
	 * Defaults to `false` — flip on if the user wants nutzap support.
	 */
	receiveNutzaps?: boolean
	/**
	 * Wallet relays. Defaults to {@link DEFAULT_WALLET_RELAYS}.
	 */
	relays?: string[]
}

/**
 * Create a brand-new NIP-60 wallet for the active account.
 *
 * Publishes the wallet event, optional wallet backup, and optional nutzap
 * info event. The new events flow into the EventStore and `useWallet()`
 * starts returning the populated state.
 */
export async function createWallet(options: CreateWalletOptions): Promise<void> {
	const { mints, receiveNutzaps = false, relays = DEFAULT_WALLET_RELAYS } = options
	if (!mints || mints.length === 0) throw new Error('At least one mint is required')

	await walletActions.run(CreateWallet, {
		mints,
		privateKey: receiveNutzaps ? generateSecretKey() : undefined,
		relays,
	})
}

/** Unlock the wallet (and optionally tokens + history) for the active account. */
export async function unlockWallet(opts?: { tokens?: boolean; history?: boolean }): Promise<void> {
	await walletActions.run(UnlockWallet, opts ?? { tokens: true, history: true })
}

/** Replace the wallet's mint list. Wallet must be unlocked first. */
export async function setMints(mints: string[]): Promise<void> {
	await walletActions.run(SetWalletMints, mints)
}

/** Replace the wallet's relay list. Wallet must be unlocked first. */
export async function setWalletRelays(relays: string[]): Promise<void> {
	await walletActions.run(SetWalletRelays, relays)
}

/** Add a mint to the nutzap-info event so others know where to send nutzaps. */
export async function addNutzapMint(url: string, units: string[] = ['sat']): Promise<void> {
	await walletActions.run(AddNutzapInfoMint, { url, units })
}

/** Remove a mint from the nutzap-info event. */
export async function removeNutzapMint(url: string): Promise<void> {
	await walletActions.run(RemoveNutzapInfoMint, url)
}

/**
 * Receive a Cashu token. Swaps it at the mint and adds the new proofs to the
 * wallet, plus a history entry.
 *
 * Pass either an encoded `cashuA…`/`cashuB…` string or a pre-decoded token.
 * Strings are decoded via the mint's keyset (cashu-ts v4 requires keyset ids
 * to hydrate short-id tokens, so decoding goes through a loaded wallet).
 */
export async function receiveCashuToken(tokenOrString: string | Token): Promise<void> {
	let token: Token
	if (typeof tokenOrString === 'string') {
		const meta = getTokenMetadata(tokenOrString.trim())
		const cashuWallet = await getCashuWallet(meta.mint)
		token = cashuWallet.decodeToken(tokenOrString.trim())
	} else {
		token = tokenOrString
	}
	await walletActions.run(ReceiveToken, token, { couch, getCashuWallet })
}

/**
 * Serializes proof-spending operations (send / melt / consolidate).
 *
 * `ActionRunner.run` does NOT queue: two concurrent `TokensOperation` runs
 * both read the token set before either publishes its `CompleteSpend`, so
 * they can select the SAME proofs — the mint accepts one and rejects the
 * other with "token already spent". Chaining through this mutex makes the
 * second operation see the post-spend token set (CompleteSpend deletes the
 * consumed token events from the store before the lock releases).
 */
let spendLock: Promise<unknown> = Promise.resolve()

/** Exported for tests; treat as internal. */
export function withSpendLock<T>(fn: () => Promise<T>): Promise<T> {
	const next = spendLock.then(fn, fn)
	// Keep the chain alive on failure — the next caller must still run.
	spendLock = next.catch(() => undefined)
	return next
}

function getDeletedTokenIds(tokens: NostrEvent[]): Set<string> {
	const deleted = new Set<string>()
	for (const token of tokens) {
		for (const id of getTokenDeletedIds(token)) deleted.add(id)
		if (isTokenContentUnlocked(token)) {
			for (const id of getTokenContent(token).del) deleted.add(id)
		}
	}
	return deleted
}

/**
 * TokensOperation reads raw token events from EventStore. Filter the same
 * `del` references that WalletBalanceModel uses before selecting proofs, or a
 * second immediate spend can choose an older token event whose proofs were
 * already consumed by the previous spend.
 */
export const selectSpendableTokens: TokenSelectionFunction = (tokens, minAmount, mint) => {
	const deleted = getDeletedTokenIds(tokens)
	return dumbTokenSelection(
		tokens.filter((token) => !deleted.has(token.id)),
		minAmount,
		mint,
	)
}

/**
 * Send a Cashu token of the given amount.
 *
 * Returns the encoded `cashuB…` string ready to share with the recipient.
 * Optionally constrains the source mint; when omitted, applesauce-wallet
 * picks a mint with sufficient balance.
 *
 * TokensOperation completes the spend lifecycle internally (applesauce ≥6.2):
 * consumed token events are deleted (del + NIP-09) and an "out" kind-7376
 * history entry is written.
 */
export async function sendCashuToken(
	amountSats: number,
	options?: { mint?: string },
): Promise<string> {
	return withSpendLock(async () => {
		let encoded: string | null = null

		await walletActions.run(
			TokensOperation,
			amountSats,
			async ({ selectedProofs, mint, cashuWallet }) => {
				const { keep, send } = await cashuWallet.ops.send(amountSats, selectedProofs).run()
				encoded = getEncodedToken({ mint, proofs: send, unit: 'sat' })
				return { change: keep.length > 0 ? keep : undefined }
			},
			{ mint: options?.mint, couch, getCashuWallet, tokenSelection: selectSpendableTokens },
		)

		if (!encoded) throw new Error('Failed to create token')
		return encoded
	})
}

/**
 * Pay a Lightning invoice from this wallet's eCash. Throws if the paying mint
 * doesn't have enough balance to cover the invoice amount + fee reserve.
 *
 * `mint` constrains which mint pays. If omitted, the mint with the highest
 * balance is used (the melt quote must be created against a specific mint
 * before proofs can be selected).
 */
export async function payLightningInvoice(
	invoice: string,
	options?: { mint?: string },
): Promise<{ paid: boolean; preimage?: string }> {
	return withSpendLock(() => payLightningInvoiceUnlocked(invoice, options))
}

async function payLightningInvoiceUnlocked(
	invoice: string,
	options?: { mint?: string },
): Promise<{ paid: boolean; preimage?: string }> {
	const snapshot = getWalletSnapshot()
	const mint = options?.mint ?? Object.entries(snapshot.balance).sort((a, b) => b[1] - a[1])[0]?.[0]
	if (!mint) throw new Error('No mint with a balance to pay from')

	// Create the melt quote first so the exact amount + fee reserve is known
	// before proofs are selected.
	const cashuWallet = await getCashuWallet(mint)
	const meltQuote = await cashuWallet.createMeltQuoteBolt11(invoice)
	const amount = meltQuote.amount.toNumber()
	const fee = meltQuote.fee_reserve.toNumber()

	const mintBalance = snapshot.balance[mint] ?? 0
	if (mintBalance < amount + fee) {
		throw new Error(`Insufficient balance: need ${amount + fee} sat, have ${mintBalance}`)
	}

	let result: { paid: boolean; preimage?: string } = { paid: false }

	await walletActions.run(
		TokensOperation,
		amount + fee,
		async ({ selectedProofs, cashuWallet: opWallet }) => {
			// Set aside amount + fee reserve to melt; keep any remainder as change.
			const { keep, send } = await opWallet.ops
				.send(amount + fee, selectedProofs)
				.includeFees(true)
				.run()
			const response = await opWallet.meltProofsBolt11(meltQuote, send)
			result = {
				paid: true,
				preimage: response.quote.payment_preimage ?? undefined,
			}
			return { change: [...keep, ...response.change] }
		},
		{ mint, couch, getCashuWallet, tokenSelection: selectSpendableTokens },
	)

	return result
}

export interface DepositSession {
	/** Lightning bolt11 invoice to pay. */
	invoice: string
	/** Mint quote id — opaque, store it if you want to retry later. */
	quoteId: string
	/** Sat amount the user is depositing. */
	amount: number
	/** Mint URL the proofs will come from. */
	mint: string
	/** Waits until the invoice is paid (NUT-17 websocket when supported, else poll). */
	waitForPayment: (opts?: { intervalMs?: number; signal?: AbortSignal }) => Promise<void>
	/** After waitForPayment resolves, mint proofs and add them to the wallet. */
	claim: () => Promise<{ amount: number }>
}

/**
 * Start a Lightning → eCash deposit. Returns the bolt11 invoice plus helpers
 * to wait for payment and claim the resulting proofs into the wallet.
 *
 * Caller flow:
 *   const session = await startLightningDeposit({ mint, amount: 1000 })
 *   showInvoice(session.invoice)
 *   await session.waitForPayment()
 *   await session.claim()
 */
export async function startLightningDeposit(opts: {
	mint: string
	amount: number
}): Promise<DepositSession> {
	const { mint, amount } = opts
	if (!mint) throw new Error('Mint is required')
	if (!amount || amount <= 0) throw new Error('Amount must be positive')

	const cashuWallet = await getCashuWallet(mint)
	const quote = await cashuWallet.createMintQuoteBolt11(amount)

	return {
		invoice: quote.request,
		quoteId: quote.quote,
		amount,
		mint,
		async waitForPayment({ intervalMs = 3000, signal } = {}) {
			// NUT-17 websocket notification when the mint supports it, else poll.
			if (cashuWallet.getMintInfo().isSupported(17).supported) {
				try {
					await cashuWallet.on.onceMintPaid(quote.quote, { signal })
				} catch (err) {
					if (signal?.aborted) throw new Error('Cancelled')
					throw err
				}
				return
			}
			while (true) {
				if (signal?.aborted) throw new Error('Cancelled')
				const check = await cashuWallet.checkMintQuoteBolt11(quote.quote)
				if (check.state === MintQuoteState.PAID || check.state === MintQuoteState.ISSUED) return
				await new Promise((r) => setTimeout(r, intervalMs))
			}
		},
		async claim() {
			// Mints the paid quote into proofs and records token + history events.
			await walletActions.run(MintTokens, mint, amount, quote, { couch, getCashuWallet })
			return { amount }
		},
	}
}

/** Pull P2PK-locked tokens out of one or more nutzap events into the wallet. */
export async function receiveNutzaps(events: NostrEvent | NostrEvent[]): Promise<void> {
	await walletActions.run(ReceiveNutzaps, events, couch, getCashuWallet)
}

/**
 * Consolidate all unlocked tokens into one event per mint, verifying the
 * proofs at the mint along the way. Recommended after sends/receives to
 * reduce token-event count.
 */
export async function consolidateTokens(): Promise<void> {
	await withSpendLock(() =>
		walletActions.run(ConsolidateTokens, { unlockTokens: true, getCashuWallet }),
	)
}

/** Sweep tokens stranded in the couch back into the wallet (after a crash). */
export async function recoverFromCouch(): Promise<void> {
	await walletActions.run(RecoverFromCouch, couch, { getCashuWallet })
}
