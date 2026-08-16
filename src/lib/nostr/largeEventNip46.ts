import { BaseAccount, type SerializedAccount } from 'applesauce-accounts'
import { bytesToHex, hexToBytes } from 'applesauce-core/helpers/event'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import { Permission } from 'applesauce-signers/helpers/nostr-connect'
import type { NostrConnectSignerOptions } from 'applesauce-signers/signers/nostr-connect-signer'
import { nip44 } from 'nostr-tools'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
	TEMPORAL_SIGHTING_KIND,
} from './kinds'

export interface EarthlyNostrConnectSignerData {
	clientKey: string
	remote: string
	relays: string[]
	bunkerSecret?: string
}

/**
 * The events Earthly's UI can ask an account to sign. Keep this explicit so
 * strict remote signers can grant useful access without granting every kind.
 * Server-signed layer announcements (34444) are intentionally absent.
 */
export const EARTHLY_NIP46_SIGNING_KINDS = [
	0, // profile metadata
	1, // short notes / shoutbox posts
	3, // contact lists
	5, // deletions
	7, // reactions
	375, // NIP-60 wallet backup
	1111, // NIP-22 comments
	PROPOSAL_STATUS_OPEN_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	7375, // NIP-60 wallet tokens
	7376, // NIP-60 wallet history
	9321, // NIP-61 nutzaps
	9734, // NIP-57 zap requests
	10_002, // relay lists
	10_019, // NIP-61 nutzap preferences
	17_375, // NIP-60 wallet configuration
	22_242, // NIP-42 relay authentication
	24_242, // Blossom upload authorization
	27_523, // private workspace envelope authorization
	27_524, // private workspace invitations
	GEO_EVENT_KIND,
	GEO_COMMENT_KIND,
	MAP_CONTEXT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	ARTICLE_KIND,
	LIVE_BEACON_KIND,
	TEMPORAL_SIGHTING_KIND,
	37_523, // field-session records
] as const

/** Permissions advertised for both nostrconnect:// and bunker:// sessions. */
export const EARTHLY_NIP46_PERMISSIONS = [
	...NostrConnectSigner.buildSigningPermissions([...EARTHLY_NIP46_SIGNING_KINDS]),
	Permission.Nip44Encrypt,
	Permission.Nip44Decrypt,
]

/**
 * NIP-44 added an extended length prefix for payloads at or above 64 KiB.
 * Applesauce currently resolves an older transitive nostr-tools build, so use
 * Earthly's current direct implementation for the NIP-46 client key only.
 */
export class ExtendedNip44PrivateKeySigner extends PrivateKeySigner {
	override nip44 = {
		encrypt: async (pubkey: string, plaintext: string) =>
			nip44.v2.encrypt(plaintext, nip44.v2.utils.getConversationKey(this.key, pubkey)),
		decrypt: async (pubkey: string, ciphertext: string) =>
			nip44.v2.decrypt(ciphertext, nip44.v2.utils.getConversationKey(this.key, pubkey)),
	}
}

export class EarthlyNostrConnectSigner extends NostrConnectSigner {
	constructor(options: NostrConnectSignerOptions) {
		const signer =
			options.signer instanceof ExtendedNip44PrivateKeySigner
				? options.signer
				: new ExtendedNip44PrivateKeySigner(options.signer?.key)
		super({
			...options,
			signer,
		})
	}

	static override async fromBunkerURI(
		uri: string,
		options: Omit<NostrConnectSignerOptions, 'relays'> & {
			permissions?: string[]
			signer?: PrivateKeySigner
		} = {},
	): Promise<EarthlyNostrConnectSigner> {
		const { remote, relays, bunkerSecret } = NostrConnectSigner.parseBunkerURI(uri)
		const { permissions, ...signerOptions } = options
		const client = new EarthlyNostrConnectSigner({
			...signerOptions,
			relays,
			remote,
			bunkerSecret,
		})
		await client.connect(bunkerSecret, permissions)
		return client
	}

	static override async fromNbunksec(
		encoded: string,
		options: Omit<NostrConnectSignerOptions, 'relays' | 'remote' | 'signer' | 'bunkerSecret'> & {
			permissions?: string[]
		} = {},
	): Promise<EarthlyNostrConnectSigner> {
		const { remote, clientKey, relays, bunkerSecret } = NostrConnectSigner.parseNbunksec(encoded)
		const { permissions, ...signerOptions } = options
		const client = new EarthlyNostrConnectSigner({
			...signerOptions,
			relays,
			remote,
			bunkerSecret,
			signer: new ExtendedNip44PrivateKeySigner(hexToBytes(clientKey)),
		})
		await client.connect(bunkerSecret, permissions)
		return client
	}
}

/** Persisted shape stays byte-for-byte compatible with applesauce's account. */
export class EarthlyNostrConnectAccount<Metadata = unknown> extends BaseAccount<
	EarthlyNostrConnectSigner,
	EarthlyNostrConnectSignerData,
	Metadata
> {
	static readonly type = 'nostr-connect'

	override toJSON(): SerializedAccount<EarthlyNostrConnectSignerData, Metadata> {
		if (!this.signer.remote) {
			throw new Error("Can't save a Nostr Connect account before it is initialized")
		}
		return this.saveCommonFields({
			signer: {
				clientKey: bytesToHex(this.signer.signer.key),
				remote: this.signer.remote,
				relays: this.signer.relays,
				...(this.signer.bunkerSecret ? { bunkerSecret: this.signer.bunkerSecret } : {}),
			},
		})
	}

	static fromJSON<Metadata = unknown>(
		json: SerializedAccount<EarthlyNostrConnectSignerData, Metadata>,
	): EarthlyNostrConnectAccount<Metadata> {
		const signer = new EarthlyNostrConnectSigner({
			relays: json.signer.relays,
			pubkey: json.pubkey,
			remote: json.signer.remote,
			bunkerSecret: json.signer.bunkerSecret,
			signer: new ExtendedNip44PrivateKeySigner(hexToBytes(json.signer.clientKey)),
		})
		return BaseAccount.loadCommonFields(
			new EarthlyNostrConnectAccount<Metadata>(json.pubkey, signer),
			json,
		)
	}
}
