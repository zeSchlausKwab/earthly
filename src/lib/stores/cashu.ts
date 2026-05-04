/**
 * Cashu wallet store using coco-cashu-core for robust operation management.
 *
 * This provides:
 * - IndexedDB persistence for proofs via coco
 * - Local persistence for pending tokens (tokens that have been generated but not yet claimed)
 * - Recovery of pending tokens on startup
 */
import { create } from 'zustand'
import { initializeCoco, type Manager, getEncodedToken } from 'coco-cashu-core'
import { IndexedDbRepositories } from 'coco-cashu-indexeddb'
import { getWalletMints, WALLET_KIND } from 'applesauce-wallet/helpers'
import { accounts, eventStore } from '@/lib/nostr'

/** Read the active account's wallet mints from the EventStore (sync). */
function getActiveWalletMints(): string[] {
	const pubkey = accounts.active?.pubkey
	if (!pubkey) return []
	const event = eventStore.getReplaceable(WALLET_KIND, pubkey)
	if (!event) return []
	try {
		return getWalletMints(event)
	} catch {
		return []
	}
}
import { loadUserData, saveUserData, type PendingToken } from '@/lib/wallet'

const CASHU_SEED_KEY = 'cashu_wallet_seed'
const PENDING_TOKENS_KEY = 'cashu_pending_tokens'

// Re-export for backward compatibility
export type { PendingToken }

export interface CashuState {
	manager: Manager | null
	status: 'idle' | 'initializing' | 'ready' | 'error'
	error: string | null
	balances: Record<string, number>
	totalBalance: number
	// Track pending send operations that have generated tokens
	pendingTokens: PendingToken[]
}

interface CashuActions {
	initialize: (pubkey: string) => Promise<void>
	syncMintsFromNip60: () => Promise<void>
	addMint: (mintUrl: string) => Promise<void>
	refreshBalances: () => Promise<void>
	send: (mintUrl: string, amount: number) => Promise<string>
	reclaimToken: (tokenId: string) => Promise<boolean>
	removePendingToken: (tokenId: string) => void
	receive: (token: string) => Promise<void>
	createMintQuote: (
		mintUrl: string,
		amount: number,
	) => ReturnType<Manager['quotes']['createMintQuote']>
	redeemMintQuote: (mintUrl: string, quoteId: string) => Promise<void>
	melt: (mintUrl: string, invoice: string) => ReturnType<Manager['quotes']['createMeltQuote']>
	getMints: () => ReturnType<Manager['mint']['getAllTrustedMints']>
	reset: () => Promise<void>
}

const initialState: CashuState = {
	manager: null,
	status: 'idle',
	error: null,
	balances: {},
	totalBalance: 0,
	pendingTokens: [],
}

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const loadPendingTokens = (): PendingToken[] => loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, [])

const savePendingTokens = (tokens: PendingToken[]): void => saveUserData(PENDING_TOKENS_KEY, tokens)

/**
 * Get or generate a seed for the wallet.
 * The seed is stored in localStorage and used for deterministic key derivation.
 */
async function getOrCreateSeed(pubkey: string): Promise<Uint8Array> {
	// Use a user-specific key
	const seedKey = `${CASHU_SEED_KEY}_${pubkey}`
	let seedHex = localStorage.getItem(seedKey)

	if (!seedHex) {
		// Generate a new 64-byte seed
		const seed = new Uint8Array(64)
		crypto.getRandomValues(seed)
		seedHex = Array.from(seed)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
		localStorage.setItem(seedKey, seedHex)
		console.log('[cashu] Generated new wallet seed')
	}

	// Convert hex string back to Uint8Array
	const bytes = new Uint8Array(seedHex.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(seedHex.slice(i * 2, i * 2 + 2), 16)
	}
	return bytes
}

export const useCashuStore = create<CashuState & CashuActions>()((set, get) => ({
	...initialState,

	/**
	 * Initialize the coco manager with IndexedDB persistence
	 */
	initialize: async (pubkey: string): Promise<void> => {
		const state = get()
		if (state.status === 'initializing' || state.status === 'ready') {
			return
		}

		if (!pubkey) {
			console.warn('[cashu] Cannot initialize without pubkey')
			return
		}

		set({ status: 'initializing', error: null })

		try {
			console.log('[cashu] Initializing coco manager...')

			// Create IndexedDB repositories with user-specific database name
			const repos = new IndexedDbRepositories({
				name: `cashu_wallet_${pubkey.slice(0, 8)}`,
			})

			const seed = await getOrCreateSeed(pubkey)

			// Initialize coco with watchers enabled
			const manager = await initializeCoco({
				repo: repos,
				seedGetter: async () => seed,
				watchers: {
					mintQuoteWatcher: { watchExistingPendingOnStart: true },
					proofStateWatcher: {},
				},
				processors: {
					mintQuoteProcessor: { processIntervalMs: 3000 },
				},
			})

			console.log('[cashu] Coco manager initialized')

			// Subscribe to balance updates
			manager.on('proofs:saved', async () => {
				await get().refreshBalances()
			})
			manager.on('proofs:state-changed', async () => {
				await get().refreshBalances()
			})
			manager.on('proofs:deleted', async () => {
				await get().refreshBalances()
			})

			// Load pending tokens from localStorage
			const pendingTokens = loadPendingTokens()

			set({
				manager,
				status: 'ready',
				pendingTokens,
			})

			// Initial balance fetch
			await get().refreshBalances()

			// Sync mints from nip60 store
			await get().syncMintsFromNip60()
		} catch (err) {
			console.error('[cashu] Failed to initialize:', err)
			set({
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to initialize wallet',
			})
		}
	},

	/**
	 * Sync mints from the NIP-60 wallet to coco
	 */
	syncMintsFromNip60: async (): Promise<void> => {
		const manager = get().manager
		if (!manager) return

		const nip60Mints = getActiveWalletMints()
		console.log('[cashu] Syncing mints from NIP-60:', nip60Mints)

		for (const mintUrl of nip60Mints) {
			try {
				const existingMints = await manager.mint.getAllMints()
				const exists = existingMints.some((m) => m.mintUrl === mintUrl)

				if (!exists) {
					console.log('[cashu] Adding mint:', mintUrl)
					await manager.mint.addMint(mintUrl, { trusted: true })
				} else {
					// Ensure mint is trusted
					await manager.mint.trustMint(mintUrl)
				}
			} catch (err) {
				console.error('[cashu] Failed to add mint:', mintUrl, err)
			}
		}
	},

	/**
	 * Add a mint to coco
	 */
	addMint: async (mintUrl: string): Promise<void> => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
			console.log('[cashu] Mint added:', mintUrl)
		} catch (err) {
			console.error('[cashu] Failed to add mint:', err)
			throw err
		}
	},

	/**
	 * Refresh balances from coco
	 */
	refreshBalances: async (): Promise<void> => {
		const manager = get().manager
		if (!manager) return

		try {
			const balances = await manager.wallet.getBalances()
			const total = Object.values(balances).reduce((sum, b) => sum + b, 0)

			set({
				balances,
				totalBalance: total,
			})

			console.log('[cashu] Balances updated:', { balances, total })
		} catch (err) {
			console.error('[cashu] Failed to refresh balances:', err)
		}
	},

	/**
	 * Send eCash - generates a token
	 * The token is persisted to localStorage so it can be recovered if the app crashes
	 */
	send: async (mintUrl: string, amount: number): Promise<string> => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added and trusted
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Sending:', { mintUrl, amount })

		// Generate the token
		const token = await manager.wallet.send(mintUrl, amount)
		const tokenString = getEncodedToken(token)

		// Store as pending token BEFORE returning
		// This ensures the token is saved even if the user closes the modal
		const pendingToken: PendingToken = {
			id: generateId(),
			token: tokenString,
			amount: token.proofs.reduce((sum, p) => sum + p.amount, 0),
			mintUrl: token.mint,
			createdAt: Date.now(),
			status: 'pending',
		}

		const pendingTokens = [...get().pendingTokens, pendingToken]
		savePendingTokens(pendingTokens)

		set({ pendingTokens })

		console.log('[cashu] Token generated and saved:', tokenString.slice(0, 50))

		// Refresh balances
		await get().refreshBalances()

		return tokenString
	},

	/**
	 * Reclaim a pending token (if recipient hasn't claimed it yet)
	 * This receives the token back into our wallet
	 */
	reclaimToken: async (tokenId: string): Promise<boolean> => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = get().pendingTokens.find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		console.log('[cashu] Attempting to reclaim token:', tokenId)

		try {
			// Try to receive the token back
			await manager.wallet.receive(pendingToken.token)

			// Update status to reclaimed
			const pendingTokens = get().pendingTokens.map((t) =>
				t.id === tokenId ? { ...t, status: 'reclaimed' as const } : t,
			)
			savePendingTokens(pendingTokens)

			set({ pendingTokens })

			// Refresh balances
			await get().refreshBalances()

			console.log('[cashu] Token reclaimed successfully')
			return true
		} catch (err) {
			// Token was already claimed by recipient
			console.log('[cashu] Token already claimed:', err)

			// Mark as claimed
			const pendingTokens = get().pendingTokens.map((t) =>
				t.id === tokenId ? { ...t, status: 'claimed' as const } : t,
			)
			savePendingTokens(pendingTokens)

			set({ pendingTokens })

			return false
		}
	},

	/**
	 * Remove a pending token from the list (after user confirms)
	 */
	removePendingToken: (tokenId: string): void => {
		const pendingTokens = get().pendingTokens.filter((t) => t.id !== tokenId)
		savePendingTokens(pendingTokens)

		set({ pendingTokens })
	},

	/**
	 * Receive an eCash token
	 */
	receive: async (token: string): Promise<void> => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		console.log('[cashu] Receiving token...')
		await manager.wallet.receive(token)
		await get().refreshBalances()
		console.log('[cashu] Token received')
	},

	/**
	 * Create a mint quote (for deposits)
	 */
	createMintQuote: async (mintUrl: string, amount: number) => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Creating mint quote:', { mintUrl, amount })
		return manager.quotes.createMintQuote(mintUrl, amount)
	},

	/**
	 * Redeem a mint quote (after payment)
	 */
	redeemMintQuote: async (mintUrl: string, quoteId: string) => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		console.log('[cashu] Redeeming mint quote:', { mintUrl, quoteId })
		await manager.quotes.redeemMintQuote(mintUrl, quoteId)
		await get().refreshBalances()
	},

	/**
	 * Melt (withdraw to Lightning)
	 */
	melt: async (mintUrl: string, invoice: string) => {
		const manager = get().manager
		if (!manager) {
			throw new Error('Wallet not initialized')
		}

		// Ensure mint is added
		try {
			await manager.mint.addMint(mintUrl, { trusted: true })
		} catch {
			// Mint might already exist
		}

		console.log('[cashu] Creating melt quote:', { mintUrl, invoice: invoice.slice(0, 50) })

		// Create melt quote
		const quote = await manager.quotes.createMeltQuote(mintUrl, invoice)
		console.log('[cashu] Melt quote created:', quote)

		// Pay the melt quote
		await manager.quotes.payMeltQuote(mintUrl, quote.quote)
		console.log('[cashu] Melt paid successfully')

		await get().refreshBalances()
		return quote
	},

	/**
	 * Get all trusted mints
	 */
	getMints: async () => {
		const manager = get().manager
		if (!manager) return []

		return manager.mint.getAllTrustedMints()
	},

	/**
	 * Reset the store
	 */
	reset: async (): Promise<void> => {
		const manager = get().manager
		if (manager) {
			await manager.dispose()
		}
		set(initialState)
	},
}))

// Action helpers for non-hook usage
export const cashuActions = {
	initialize: (pubkey: string) => useCashuStore.getState().initialize(pubkey),
	syncMintsFromNip60: () => useCashuStore.getState().syncMintsFromNip60(),
	addMint: (mintUrl: string) => useCashuStore.getState().addMint(mintUrl),
	refreshBalances: () => useCashuStore.getState().refreshBalances(),
	send: (mintUrl: string, amount: number) => useCashuStore.getState().send(mintUrl, amount),
	reclaimToken: (tokenId: string) => useCashuStore.getState().reclaimToken(tokenId),
	removePendingToken: (tokenId: string) => useCashuStore.getState().removePendingToken(tokenId),
	receive: (token: string) => useCashuStore.getState().receive(token),
	createMintQuote: (mintUrl: string, amount: number) =>
		useCashuStore.getState().createMintQuote(mintUrl, amount),
	redeemMintQuote: (mintUrl: string, quoteId: string) =>
		useCashuStore.getState().redeemMintQuote(mintUrl, quoteId),
	melt: (mintUrl: string, invoice: string) => useCashuStore.getState().melt(mintUrl, invoice),
	getMints: () => useCashuStore.getState().getMints(),
	reset: () => useCashuStore.getState().reset(),
}
