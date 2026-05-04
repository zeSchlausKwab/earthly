/**
 * @deprecated These helpers operated on the legacy `NDKCashuWallet` instance.
 * The applesauce-wallet rebuild reads proofs from `WalletToken` casts via
 * `useWalletTokens()` instead. The shims below let the legacy
 * `Nip60Wallet.tsx` panel compile during the migration window. They will be
 * removed once that panel is rewritten on the new hook surface.
 */

import type { Proof } from '@cashu/cashu-ts'
import type { ProofInfo } from './types'

/** @deprecated returns empty map — call sites must migrate to `useWalletTokens()`. */
export function extractProofsByMint(_wallet: unknown): Map<string, ProofInfo[]> {
	return new Map()
}

/** @deprecated returns empty array — call sites must migrate to `useWalletTokens()`. */
export function getProofsForMint(_wallet: unknown, _mintUrl: string): Proof[] {
	return []
}
