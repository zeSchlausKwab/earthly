/**
 * Seed identities — the ONE SeedIdentity shape used by every scenario,
 * wrapping the real applesauce `PrivateKeySigner` (factories accept it
 * directly via their `EventSigner` contract).
 *
 * devUser1 is the browser-UAT key: a tester logged in as that npub owns the
 * seeded groups/datasets and can exercise owner-only actions.
 */

import { hexToBytes } from '@noble/hashes/utils.js'
import { PrivateKeySigner } from 'applesauce-signers'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'

export interface SeedIdentity {
	name: string
	pubkey: string
	signer: PrivateKeySigner
}

export function identityFromHex(skHex: string, name: string): SeedIdentity {
	const sk = hexToBytes(skHex)
	return { name, pubkey: getPublicKey(sk), signer: new PrivateKeySigner(sk) }
}

/** A throwaway identity with a freshly generated key. */
export function ephemeralIdentity(name: string): SeedIdentity {
	const sk = new Uint8Array(32)
	crypto.getRandomValues(sk)
	return { name, pubkey: getPublicKey(sk), signer: new PrivateKeySigner(sk) }
}

/** npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah — the browser UAT key. */
export const OWNER_NPUB = 'npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah'

/** The dev-fixture roster with the display names the old seeds established. */
export function devIdentities(): {
	owner: SeedIdentity
	contributors: SeedIdentity[]
} {
	return {
		owner: identityFromHex(devUser1.sk, 'Earthly Curator'),
		contributors: [
			identityFromHex(devUser2.sk, 'Mara Holzer'),
			identityFromHex(devUser3.sk, 'Tomas Veit'),
			identityFromHex(devUser4.sk, 'Lena Brandt'),
			identityFromHex(devUser5.sk, 'Jonas Reiter'),
		],
	}
}

/** Sign a kind-0 profile event for an identity. */
export async function signProfile(
	identity: SeedIdentity,
	about?: string,
	extra: Record<string, unknown> = {},
): Promise<NostrEvent> {
	const template: EventTemplate = {
		kind: 0,
		content: JSON.stringify({
			name: identity.name,
			display_name: identity.name,
			...(about ? { about } : {}),
			...extra,
		}),
		tags: [],
		created_at: Math.floor(Date.now() / 1000),
	}
	return identity.signer.signEvent(template)
}
