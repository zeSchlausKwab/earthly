import { verifyEvent, type EventTemplate, type NostrEvent } from 'nostr-tools'
import { base64UrlToUtf8, utf8ToBase64Url } from './codec'

export const PRIVATE_MAP_INVITATION_KIND = 27524
export const PRIVATE_MAP_INVITATION_TTL_SECONDS = 24 * 60 * 60
const PRIVATE_MAP_INVITATION_DOMAIN = 'earthly-private-map-invitation-v2'

export interface PrivateMapInvitation {
	version: 1 | 2
	workspaceId: string
	groupId: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	nonce: string
	/** Unix timestamp in seconds. Version-1 invitations did not carry an expiry. */
	expiresAt?: number
}

export interface PrivateMapInvitationSigner {
	signEvent(event: EventTemplate): Promise<NostrEvent>
}

interface SignedPrivateMapInvitation {
	version: 2
	event: NostrEvent
}

function isVerifiedNostrEvent(value: unknown): value is NostrEvent {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	try {
		return verifyEvent(value as NostrEvent)
	} catch {
		return false
	}
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`Invalid ${field} in private map invitation`)
	}
	return value
}

function requireHexPubkey(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`Invalid ${field} in private map invitation`)
	}
	return value
}

function requireRelays(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((relay) => typeof relay === 'string' && /^wss?:\/\//u.test(relay))
	) {
		throw new Error('Invalid relays in private map invitation')
	}
	return value as string[]
}

function invitationTags(input: {
	workspaceId: string
	groupId: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	nonce: string
	expiresAt: number
}): string[][] {
	return [
		['t', PRIVATE_MAP_INVITATION_DOMAIN],
		['workspace', input.workspaceId],
		['group', input.groupId],
		['admin', input.adminPubkey],
		['coordinator', input.coordinatorPubkey],
		...input.relays.map((relay) => ['relay', relay]),
		['nonce', input.nonce],
		['expiration', String(input.expiresAt)],
	]
}

function singleTag(event: NostrEvent, name: string): string {
	const tags = event.tags.filter((tag) => tag[0] === name)
	const tag = tags[0]
	if (tags.length !== 1 || !tag || tag.length !== 2) {
		throw new Error(`Invalid ${name} in private map invitation`)
	}
	return requireString(tag[1], name)
}

/** Encode a legacy invitation fixture. New application code should create signed version-2 links. */
export function encodePrivateMapInvitation(invitation: PrivateMapInvitation): string {
	return utf8ToBase64Url(JSON.stringify(invitation))
}

export async function createPrivateMapInvitation(input: {
	signer: PrivateMapInvitationSigner
	workspaceId: string
	groupId: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	nonce: string
	issuedAt: number
	ttlSeconds?: number
}): Promise<string> {
	const coordinatorPubkey = requireHexPubkey(input.coordinatorPubkey, 'coordinator pubkey')
	const adminPubkey = requireHexPubkey(input.adminPubkey, 'administrator pubkey')
	const relays = requireRelays(input.relays)
	const issuedAt = Math.floor(input.issuedAt)
	const ttlSeconds = input.ttlSeconds ?? PRIVATE_MAP_INVITATION_TTL_SECONDS
	if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
		throw new Error('Invalid lifetime in private map invitation')
	}
	const expiresAt = issuedAt + ttlSeconds
	const tags = invitationTags({
		workspaceId: requireString(input.workspaceId, 'workspace'),
		groupId: requireString(input.groupId, 'group'),
		adminPubkey,
		coordinatorPubkey,
		relays,
		nonce: requireString(input.nonce, 'nonce'),
		expiresAt,
	})
	const event = await input.signer.signEvent({
		kind: PRIVATE_MAP_INVITATION_KIND,
		created_at: issuedAt,
		tags,
		content: PRIVATE_MAP_INVITATION_DOMAIN,
	})
	const token: SignedPrivateMapInvitation = { version: 2, event }
	const encoded = utf8ToBase64Url(JSON.stringify(token))
	// Decode once before returning so an incompatible signer cannot emit a malformed link.
	decodePrivateMapInvitation(encoded)
	return encoded
}

function decodeLegacyInvitation(parsed: Record<string, unknown>): PrivateMapInvitation {
	if (
		parsed.version !== 1 ||
		typeof parsed.workspaceId !== 'string' ||
		typeof parsed.groupId !== 'string' ||
		typeof parsed.nonce !== 'string'
	) {
		throw new Error('Invalid private map invitation')
	}

	return {
		version: 1,
		workspaceId: requireString(parsed.workspaceId, 'workspace'),
		groupId: requireString(parsed.groupId, 'group'),
		adminPubkey: requireHexPubkey(parsed.adminPubkey, 'administrator pubkey'),
		coordinatorPubkey: requireHexPubkey(parsed.coordinatorPubkey, 'coordinator pubkey'),
		relays: requireRelays(parsed.relays),
		nonce: requireString(parsed.nonce, 'nonce'),
	}
}

function decodeSignedInvitation(parsed: Record<string, unknown>): PrivateMapInvitation {
	const event = parsed.event
	if (parsed.version !== 2 || !isVerifiedNostrEvent(event)) {
		throw new Error('Invalid private map invitation signature')
	}
	if (
		event.kind !== PRIVATE_MAP_INVITATION_KIND ||
		event.content !== PRIVATE_MAP_INVITATION_DOMAIN ||
		!Number.isSafeInteger(event.created_at)
	) {
		throw new Error('Invalid private map invitation authorization')
	}

	const workspaceId = singleTag(event, 'workspace')
	const groupId = singleTag(event, 'group')
	const adminPubkey = requireHexPubkey(singleTag(event, 'admin'), 'administrator pubkey')
	const coordinatorPubkey = requireHexPubkey(singleTag(event, 'coordinator'), 'coordinator pubkey')
	const nonce = singleTag(event, 'nonce')
	const expiresAt = Number(singleTag(event, 'expiration'))
	const relays = requireRelays(
		event.tags.filter((tag) => tag[0] === 'relay' && tag.length === 2).map((tag) => tag[1]),
	)
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= event.created_at) {
		throw new Error('Invalid expiration in private map invitation')
	}
	const expectedTags = invitationTags({
		workspaceId,
		groupId,
		adminPubkey,
		coordinatorPubkey,
		relays,
		nonce,
		expiresAt,
	})
	if (JSON.stringify(event.tags) !== JSON.stringify(expectedTags)) {
		throw new Error('Invalid private map invitation authorization')
	}

	return {
		version: 2,
		workspaceId,
		groupId,
		adminPubkey,
		coordinatorPubkey,
		relays,
		nonce,
		expiresAt,
	}
}

export function decodePrivateMapInvitation(value: string): PrivateMapInvitation {
	let parsed: Record<string, unknown>
	try {
		parsed = JSON.parse(base64UrlToUtf8(value)) as Record<string, unknown>
	} catch {
		throw new Error('Invalid private map invitation')
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Invalid private map invitation')
	}
	return parsed.version === 2 ? decodeSignedInvitation(parsed) : decodeLegacyInvitation(parsed)
}

export function assertPrivateMapInvitationCurrent(
	invitation: PrivateMapInvitation,
	nowMilliseconds: number,
): void {
	if (
		invitation.version === 2 &&
		invitation.expiresAt !== undefined &&
		Math.floor(nowMilliseconds / 1000) >= invitation.expiresAt
	) {
		throw new Error('This private-group invitation has expired')
	}
}
