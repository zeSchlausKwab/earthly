/**
 * NDK adapter that delegates every operation to the active applesauce account.
 *
 * Existence is temporary — once Steps 3–4 land, no code path will reach NDK
 * for signing or relay I/O, and this file gets deleted in Step 6 along with
 * the rest of the NDK install.
 *
 * The adapter implements NDK's `NDKSigner` interface so that legacy code paths
 * (anything still calling `event.sign()`, `event.publish()`, or `useNDK().signer`)
 * keep working while the migration proceeds. The actual signing/encryption work
 * is done by the underlying applesauce signer attached to `accounts.active`.
 */

import {
	type NDKEncryptionScheme,
	type NDKRelay,
	type NDKSigner,
	NDKUser,
	type NostrEvent as NDKNostrEvent,
} from '@nostr-dev-kit/ndk'
import type { IAccount } from 'applesauce-accounts'
import { accounts } from './index'

/** Signer that proxies sign/encrypt/decrypt to a specific applesauce account. */
export class AccountBackedNdkSigner implements NDKSigner {
	constructor(private account: IAccount) {}

	get pubkey(): string {
		return this.account.pubkey
	}

	async user(): Promise<NDKUser> {
		return new NDKUser({ pubkey: this.account.pubkey })
	}

	get userSync(): NDKUser {
		return new NDKUser({ pubkey: this.account.pubkey })
	}

	async blockUntilReady(): Promise<NDKUser> {
		return this.user()
	}

	async sign(event: NDKNostrEvent): Promise<string> {
		const signed = await this.account.signEvent({
			kind: event.kind ?? 1,
			created_at: event.created_at,
			tags: event.tags,
			content: event.content,
		})
		return signed.sig
	}

	async relays(): Promise<NDKRelay[]> {
		return []
	}

	async encryptionEnabled(scheme?: NDKEncryptionScheme): Promise<NDKEncryptionScheme[]> {
		const supported: NDKEncryptionScheme[] = []
		if (this.account.nip04) supported.push('nip04')
		if (this.account.nip44) supported.push('nip44')
		if (scheme) return supported.includes(scheme) ? [scheme] : []
		return supported
	}

	async encrypt(
		recipient: NDKUser,
		value: string,
		scheme: NDKEncryptionScheme = 'nip44',
	): Promise<string> {
		const provider = scheme === 'nip04' ? this.account.nip04 : this.account.nip44
		if (!provider) throw new Error(`Active account does not support ${scheme} encryption`)
		return provider.encrypt(recipient.pubkey, value)
	}

	async decrypt(
		sender: NDKUser,
		value: string,
		scheme: NDKEncryptionScheme = 'nip44',
	): Promise<string> {
		const provider = scheme === 'nip04' ? this.account.nip04 : this.account.nip44
		if (!provider) throw new Error(`Active account does not support ${scheme} decryption`)
		return provider.decrypt(sender.pubkey, value)
	}

	toPayload(): string {
		// NDK serializes signers for session restore; we don't need that since
		// AccountManager owns persistence. Return a stub so the interface is satisfied.
		return JSON.stringify({ type: 'applesauce-bridge', pubkey: this.account.pubkey })
	}
}

/**
 * Bind an NDK instance to the AccountManager: whenever the active account
 * changes, swap in a fresh AccountBackedNdkSigner. Returns an unsubscribe
 * function for HMR cleanup.
 *
 * The `ndk` param is loosely typed because `@nostr-dev-kit/react` ships its
 * own bundled copy of `@nostr-dev-kit/ndk`, and the two copies don't
 * structurally match. The shape we use is small enough that this is safe.
 */
export function bindNdkToAccountManager(ndk: { signer?: unknown }): () => void {
	const sub = accounts.active$.subscribe((account) => {
		if (!account) {
			ndk.signer = undefined
			return
		}
		ndk.signer = new AccountBackedNdkSigner(account)
	})
	return () => sub.unsubscribe()
}
