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

export function getStoredDefaultMint(): string | null {
	if (typeof localStorage === 'undefined') return null
	return normalizeDefaultMint(localStorage.getItem(DEFAULT_MINT_KEY))
}

export function setStoredDefaultMint(mint: string | null): void {
	const normalized = normalizeDefaultMint(mint)
	if (typeof localStorage !== 'undefined') {
		if (normalized) localStorage.setItem(DEFAULT_MINT_KEY, normalized)
		else localStorage.removeItem(DEFAULT_MINT_KEY)
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
