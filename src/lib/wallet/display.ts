import { getEncodedToken, normalizeProofAmounts } from '@cashu/cashu-ts'

/**
 * Extract hostname from a mint URL for display purposes.
 * Handles invalid URLs gracefully.
 *
 * @param mintUrl Full mint URL
 * @returns Hostname or the original URL if parsing fails
 */
export function getMintHostname(mintUrl: string): string {
	try {
		return new URL(mintUrl).hostname
	} catch {
		return mintUrl
	}
}

/**
 * Format a sats amount for display.
 * @param sats Amount in satoshis
 * @returns Formatted string with locale-appropriate separators
 */
export function formatSats(sats: number): string {
	return sats.toLocaleString()
}

/**
 * Encode an unlocked NIP-60 token event's proofs as a shareable `cashuB…`
 * string. Returns undefined while the token is locked. Keeps cashu-ts imports
 * confined to `lib/wallet`.
 */
export function encodeWalletToken(token: {
	mint?: string
	proofs?: { id: string; amount: number; secret: string; C: string }[]
}): string | undefined {
	if (!token.mint || !token.proofs?.length) return undefined
	try {
		return getEncodedToken({
			mint: token.mint,
			proofs: normalizeProofAmounts(token.proofs),
			unit: 'sat',
		})
	} catch {
		return undefined
	}
}
