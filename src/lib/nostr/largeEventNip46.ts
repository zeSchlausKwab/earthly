import { NostrConnectSigner } from 'applesauce-signers'
import { Permission } from 'applesauce-signers/helpers/nostr-connect'
export { NostrConnectSigner as EarthlyNostrConnectSigner } from 'applesauce-signers'
export { NostrConnectAccount as EarthlyNostrConnectAccount } from 'applesauce-accounts/accounts'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	LIVE_BEACON_KIND,
	MAP_CONTEXT_KIND,
	MAPLET_SOURCE_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
	TEMPORAL_SIGHTING_KIND,
} from './kinds'

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
	30_078, // encrypted Maplet source preferences
	GEO_EVENT_KIND,
	GEO_COMMENT_KIND,
	MAP_CONTEXT_KIND,
	GEO_EDIT_PROPOSAL_KIND,
	ARTICLE_KIND,
	LIVE_BEACON_KIND,
	TEMPORAL_SIGHTING_KIND,
	MAPLET_SOURCE_KIND,
	37_523, // field-session records
] as const

/** Permissions advertised for both nostrconnect:// and bunker:// sessions. */
export const EARTHLY_NIP46_PERMISSIONS = [
	...NostrConnectSigner.buildSigningPermissions([...EARTHLY_NIP46_SIGNING_KINDS]),
	Permission.Nip44Encrypt,
	Permission.Nip44Decrypt,
]
