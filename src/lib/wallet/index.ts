/**
 * Wallet module — applesauce-wallet–powered NIP-60 implementation for Earthly.
 *
 * UI hook surface lives in `./hooks`; high-level actions in `./actions`.
 * Lower-level applesauce-wallet primitives are reachable via the singletons
 * in `./runtime` (`walletActions`, `couch`).
 */

// React hooks
export { useWallet, useWalletHistory, useWalletTokens, type WalletState } from './hooks'

// Action wrappers
export {
	addNutzapMint,
	consolidateTokens,
	createWallet,
	receiveCashuToken,
	receiveNutzaps,
	recoverFromCouch,
	removeNutzapMint,
	sendCashuToken,
	setMints,
	setWalletRelays,
	unlockWallet,
	type CreateWalletOptions,
} from './actions'

// Runtime singletons (rare direct use; most code should go via hooks/actions)
export {
	couch,
	getWalletSnapshot,
	walletActions,
	walletSnapshot$,
	type WalletSnapshot,
} from './runtime'

// Pre-existing utilities (kept)
export { getCurrentPubkey, setCurrentPubkey } from './currentUser'
export { getMintHostname, formatSats } from './display'
export { loadUserData, removeUserData, saveUserData } from './storage'
export type { PendingToken, ProofEntry, ProofInfo } from './types'

// Migration shims — see ./proofs.ts. Removed once Nip60Wallet.tsx is rewritten.
export { extractProofsByMint, getProofsForMint } from './proofs'
