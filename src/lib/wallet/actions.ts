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
import { getDecodedToken, getEncodedToken } from '@cashu/cashu-ts'
import {
	AddNutzapInfoMint,
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

/**
 * applesauce-wallet bundles its own copy of `@cashu/cashu-ts` (currently 3.6.4),
 * while the legacy NDK wallet expects 4.x. The runtime shapes are compatible
 * enough for our purposes; this cast bridges the nominal type gap.
 *
 * Once the NDK wallet is gone (Step 6), we align on whichever cashu-ts
 * version applesauce-wallet ships with and drop these casts.
 */
// biome-ignore lint/suspicious/noExplicitAny: see comment above
type AnyToken = any

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
	await walletActions.run(ReceiveToken, token as AnyToken, { couch })
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
			const sendToken = { mint, proofs: send, unit: 'sat' as const }
			encoded = getEncodedToken(sendToken as AnyToken)
			return { change: keep.length > 0 ? keep : undefined }
		},
		{ mint: options?.mint, couch },
	)

	if (!encoded) throw new Error('Failed to create token')
	return encoded
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
