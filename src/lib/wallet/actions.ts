/**
 * High-level wallet actions used by the UI.
 *
 * These are thin wrappers around `applesauce-wallet/actions` that expose a
 * stable, ergonomic surface and bake in:
 *
 *   - The shared `walletActions` ActionRunner (active applesauce signer +
 *     dev-safety publishing).
 *   - The shared `couch` for safe token operations.
 *
 * Lower-level actions (e.g. `TokensOperation`, `RolloverTokens`) are still
 * available via `walletActions.run(...)` — these wrappers cover the common
 * happy paths.
 */

import { generateSecretKey } from 'nostr-tools'
import {
	getDecodedToken,
	getEncodedToken,
	type MintQuoteBolt11Response,
	type Proof,
	Wallet as CashuWallet,
} from '@cashu/cashu-ts'
import {
	AddNutzapInfoMint,
	AddToken,
	ConsolidateTokens,
	CreateWallet,
	ReceiveNutzaps,
	ReceiveToken,
	RecoverFromCouch,
	RemoveNutzapInfoMint,
	SetWalletMints,
	SetWalletRelays,
	TokensOperation,
	UnlockWallet,
} from 'applesauce-wallet/actions'
import type { NostrEvent } from 'nostr-tools'
import { config } from '@/config'
import { couch, walletActions } from './runtime'

export interface CreateWalletOptions {
	/** Mints to use. Required. */
	mints: string[]
	/**
	 * Generate a P2PK private key so the wallet can receive nutzaps.
	 * Defaults to `false` — flip on if the user wants nutzap support.
	 */
	receiveNutzaps?: boolean
	/**
	 * Wallet relays. Defaults to `config.writeRelays` (always local in dev).
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
	const { mints, receiveNutzaps = false, relays = config.writeRelays } = options
	if (!mints || mints.length === 0) throw new Error('At least one mint is required')

	await walletActions.run(CreateWallet, {
		mints,
		privateKey: receiveNutzaps ? generateSecretKey() : undefined,
		relays,
	})
}

/** Unlock the wallet (and optionally tokens + history) for the active account. */
export async function unlockWallet(opts?: {
	tokens?: boolean
	history?: boolean
}): Promise<void> {
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
 * Receive a Cashu token (decoded). Swaps it at the mint and adds the new
 * proofs to the wallet, plus a history entry.
 *
 * Pass either an encoded `cashuA…` string or a pre-decoded token.
 */
export async function receiveCashuToken(
	tokenOrString: string | ReturnType<typeof getDecodedToken>,
): Promise<void> {
	const token =
		typeof tokenOrString === 'string' ? getDecodedToken(tokenOrString) : tokenOrString
	if (!token) throw new Error('Failed to decode token')
	await walletActions.run(ReceiveToken, token, { couch })
}

/**
 * Send a Cashu token of the given amount.
 *
 * Returns the encoded `cashuA…` string ready to share with the recipient.
 * Optionally constrains the source mint; when omitted, applesauce-wallet
 * picks a mint with sufficient balance.
 */
export async function sendCashuToken(
	amountSats: number,
	options?: { mint?: string },
): Promise<string> {
	let encoded: string | null = null

	await walletActions.run(
		TokensOperation,
		amountSats,
		async ({ selectedProofs, mint, cashuWallet }) => {
			const { keep, send } = await cashuWallet.ops.send(amountSats, selectedProofs).run()
			encoded = getEncodedToken({ mint, proofs: send, unit: 'sat' })
			return { change: keep.length > 0 ? keep : undefined }
		},
		{ mint: options?.mint, couch },
	)

	if (!encoded) throw new Error('Failed to create token')
	return encoded
}

/**
 * Pay a Lightning invoice from this wallet's eCash. Throws if no mint has
 * enough balance to cover the invoice amount + fee reserve.
 *
 * `mint` constrains which mint pays. If omitted, applesauce-wallet picks a
 * mint with sufficient balance.
 */
export async function payLightningInvoice(
	invoice: string,
	options?: { mint?: string },
): Promise<{ paid: boolean; preimage?: string }> {
	let result: { paid: boolean; preimage?: string } = { paid: false }

	await walletActions.run(
		TokensOperation,
		// We don't know the exact min until we fetch the quote, but TokensOperation
		// needs a min to pre-select proofs. We pass 1 — the operation re-checks
		// inside, and `selectedProofs` covers the bound at that time.
		1,
		async ({ selectedProofs, cashuWallet }) => {
			const meltQuote = await cashuWallet.createMeltQuoteBolt11(invoice)
			const required = meltQuote.amount + meltQuote.fee_reserve
			if (selectedProofs.reduce((s, p) => s + p.amount, 0) < required) {
				throw new Error(
					`Insufficient balance: need ${required} sat, have ${selectedProofs.reduce(
						(s, p) => s + p.amount,
						0,
					)}`,
				)
			}
			const { keep, send } = await cashuWallet.ops
				.send(required, selectedProofs)
				.includeFees(true)
				.run()
			const meltResponse = await cashuWallet.meltProofsBolt11(meltQuote, send)
			result = { paid: true, preimage: meltResponse.quote.payment_preimage ?? undefined }
			const change = [...keep, ...(meltResponse.change ?? [])]
			return { change: change.length > 0 ? change : undefined }
		},
		{ mint: options?.mint, couch },
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
	/** Polls the mint until the quote is paid. Resolves when paid; rejects if expired/failed. */
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

	const cashuWallet = new CashuWallet(mint, { unit: 'sat' })
	await cashuWallet.loadMint()
	const quote = await cashuWallet.createMintQuoteBolt11(amount)

	let latestQuote: MintQuoteBolt11Response = quote

	return {
		invoice: quote.request,
		quoteId: quote.quote,
		amount,
		mint,
		async waitForPayment({ intervalMs = 2000, signal } = {}) {
			while (true) {
				if (signal?.aborted) throw new Error('Cancelled')
				const refreshed = await cashuWallet.checkMintQuoteBolt11(quote.quote)
				latestQuote = refreshed
				if (refreshed.state === 'PAID' || refreshed.state === 'ISSUED') return
				await new Promise((r) => setTimeout(r, intervalMs))
			}
		},
		async claim() {
			const proofs: Proof[] = await cashuWallet.mintProofsBolt11(amount, latestQuote)
			await walletActions.run(AddToken, { mint, proofs, unit: 'sat' as const })
			return { amount: proofs.reduce((s, p) => s + p.amount, 0) }
		},
	}
}

/** Pull P2PK-locked tokens out of one or more nutzap events into the wallet. */
export async function receiveNutzaps(events: NostrEvent | NostrEvent[]): Promise<void> {
	await walletActions.run(ReceiveNutzaps, events, couch)
}

/**
 * Consolidate all unlocked tokens into one event per mint, verifying the
 * proofs at the mint along the way. Recommended after sends/receives to
 * reduce token-event count.
 */
export async function consolidateTokens(): Promise<void> {
	await walletActions.run(ConsolidateTokens, { unlockTokens: true, couch })
}

/** Sweep tokens stranded in the couch back into the wallet (after a crash). */
export async function recoverFromCouch(): Promise<void> {
	await walletActions.run(RecoverFromCouch, couch)
}
