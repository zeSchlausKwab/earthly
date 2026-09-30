import { getCurrentPubkey } from './currentUser'
import type { WalletSnapshot } from './runtime'

export const DEFAULT_MINT_KEY = 'nip60_default_mint'
export const DEFAULT_MINT_CHANGE_EVENT = 'earthly:nip60-default-mint-changed'

export type WalletPaymentMintSource = 'default' | 'fallback' | 'none'

export interface WalletPaymentMintSelection {
	mint: string | null
	balance: number
	defaultMint: string | null
	source: WalletPaymentMintSource
}

export interface ResolveWalletPaymentMintOptions {
	defaultMint?: string | null
	amountSats?: number
}

export function normalizeDefaultMint(mint: string | null | undefined): string | null {
	const value = mint?.trim()
	return value ? value : null
}

export function defaultMintStorageKey(pubkey = getCurrentPubkey()): string {
	return pubkey ? `${DEFAULT_MINT_KEY}.${pubkey}` : DEFAULT_MINT_KEY
}

export function getStoredDefaultMint(pubkey = getCurrentPubkey()): string | null {
	if (typeof localStorage === 'undefined') return null
	const scoped = normalizeDefaultMint(localStorage.getItem(defaultMintStorageKey(pubkey)))
	if (scoped || !pubkey) return scoped
	// Preserve the old browser-wide choice for the first account using it after
	// upgrade, then retire the shared value so other accounts do not inherit it.
	const legacy = normalizeDefaultMint(localStorage.getItem(DEFAULT_MINT_KEY))
	if (legacy) {
		localStorage.setItem(defaultMintStorageKey(pubkey), legacy)
		localStorage.removeItem(DEFAULT_MINT_KEY)
	}
	return legacy
}

export function setStoredDefaultMint(mint: string | null, pubkey = getCurrentPubkey()): void {
	const normalized = normalizeDefaultMint(mint)
	if (typeof localStorage !== 'undefined') {
		if (normalized) localStorage.setItem(defaultMintStorageKey(pubkey), normalized)
		else localStorage.removeItem(defaultMintStorageKey(pubkey))
	}
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(DEFAULT_MINT_CHANGE_EVENT, { detail: normalized }))
	}
}

/**
 * Resolve the mint Routstr-style wallet payments should use.
 *
 * If the user selected a configured default mint, keep using it even when
 * another mint has more balance. That makes insufficient-default-balance
 * failures explicit instead of silently spending from a different mint.
 */
export function resolveWalletPaymentMint(
	snapshot: Pick<WalletSnapshot, 'mints' | 'balance'>,
	options: ResolveWalletPaymentMintOptions = {},
): WalletPaymentMintSelection {
	const defaultMint =
		'defaultMint' in options ? normalizeDefaultMint(options.defaultMint) : getStoredDefaultMint()

	if (defaultMint && snapshot.mints.includes(defaultMint)) {
		return {
			mint: defaultMint,
			balance: snapshot.balance[defaultMint] ?? 0,
			defaultMint,
			source: 'default',
		}
	}

	const amountSats = Math.max(0, options.amountSats ?? 0)
	const fundedMint =
		amountSats > 0
			? snapshot.mints.find((mint) => (snapshot.balance[mint] ?? 0) >= amountSats)
			: null
	const fallbackMint =
		fundedMint ??
		snapshot.mints.find((mint) => (snapshot.balance[mint] ?? 0) > 0) ??
		snapshot.mints[0] ??
		null

	return {
		mint: fallbackMint,
		balance: fallbackMint ? (snapshot.balance[fallbackMint] ?? 0) : 0,
		defaultMint,
		source: fallbackMint ? 'fallback' : 'none',
	}
}
