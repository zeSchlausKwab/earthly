/**
 * Wallet runtime singletons.
 *
 *   - `walletActions`: an `ActionRunner` bound to the active applesauce account.
 *     All NIP-60 mutations go through this — see `applesauce-wallet/actions`.
 *   - `couch`:        an `IndexedDBCouch` where in-flight tokens are parked
 *     during operations so they can be recovered if a swap or melt fails.
 *
 * Side-effect: imports `applesauce-wallet/casts` so `user.wallet$` and
 * `user.nutzap$` are available on every `User` cast in the app.
 */

import 'applesauce-wallet/casts'
import { ActionRunner } from 'applesauce-actions'
import { ProxySigner } from 'applesauce-accounts'
import { persistEncryptedContent } from 'applesauce-common/helpers'
import type { ISigner } from 'applesauce-signers'
import { IndexedDBCouch } from 'applesauce-wallet/helpers'
import type { NostrEvent } from 'nostr-tools'
import { map, of } from 'rxjs'
import { config } from '@/config'
import { accounts, eventStore, pool } from '@/lib/nostr'

/**
 * Tokens-in-flight storage. ApplesauceWallet `TokensOperation` requires this
 * so that if a mint operation fails partway, the proofs aren't lost.
 */
export const couch = new IndexedDBCouch()

/**
 * Reactive view of the active account's signer. Wallet actions sign through
 * this proxy — no need to wire the signer through every call site.
 */
const activeSigner$ = accounts.active$.pipe(
	map((account) => account?.signer as ISigner | undefined),
)

/**
 * Encrypted-content cache keyed by event id. NIP-60 wallet/token/history
 * events stash their payloads in encrypted content; persisting decrypted
 * versions in localStorage avoids re-decrypting every reload.
 *
 * The cache is per-pubkey-prefixed so different accounts on the same browser
 * don't share decrypted state.
 */
function makeEncryptedContentStorage(): {
	getItem(key: string): Promise<string | null>
	setItem(key: string, value: string): Promise<void>
} {
	const prefix = () => {
		const pk = accounts.active?.pubkey
		return pk ? `wallet:enc:${pk.slice(0, 16)}:` : null
	}
	return {
		async getItem(key) {
			if (typeof localStorage === 'undefined') return null
			const p = prefix()
			if (!p) return null
			return localStorage.getItem(p + key)
		},
		async setItem(key, value) {
			if (typeof localStorage === 'undefined') return
			const p = prefix()
			if (!p) return
			localStorage.setItem(p + key, value)
		},
	}
}

persistEncryptedContent(eventStore, of(makeEncryptedContentStorage()))

/**
 * Action runner used by every wallet operation.
 *
 * The publish method is dev-safety-aware: in dev we ignore action-supplied
 * relay hints and force everything to `config.writeRelays` (= local). In prod
 * the action's chosen relays (typically wallet relays + outboxes) are used.
 */
export const walletActions = new ActionRunner(
	eventStore,
	new ProxySigner<ISigner>(activeSigner$),
	{
		publish: async (event: NostrEvent, relays?: string[]) => {
			const targetRelays =
				config.isDevelopment || !relays || relays.length === 0
					? config.writeRelays
					: relays
			await pool.publish(targetRelays, event)
			eventStore.add(event)
		},
		// biome-ignore lint/suspicious/noExplicitAny: ActionRunner's publish-method type is overloaded and overly strict
	} as any,
)
