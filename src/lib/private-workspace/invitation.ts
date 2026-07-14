import { base64UrlToUtf8, utf8ToBase64Url } from './codec'

export interface PrivateMapInvitation {
	version: 1
	workspaceId: string
	groupId: string
	adminPubkey: string
	coordinatorPubkey: string
	relays: string[]
	nonce: string
}

function requireHexPubkey(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`Invalid ${field} in private map invitation`)
	}
	return value
}

export function encodePrivateMapInvitation(invitation: PrivateMapInvitation): string {
	return utf8ToBase64Url(JSON.stringify(invitation))
}

export function decodePrivateMapInvitation(value: string): PrivateMapInvitation {
	const parsed = JSON.parse(base64UrlToUtf8(value)) as Record<string, unknown>
	if (
		parsed.version !== 1 ||
		typeof parsed.workspaceId !== 'string' ||
		typeof parsed.groupId !== 'string' ||
		typeof parsed.nonce !== 'string' ||
		!Array.isArray(parsed.relays) ||
		!parsed.relays.every((relay) => typeof relay === 'string' && /^wss?:\/\//u.test(relay))
	) {
		throw new Error('Invalid private map invitation')
	}

	return {
		version: 1,
		workspaceId: parsed.workspaceId,
		groupId: parsed.groupId,
		adminPubkey: requireHexPubkey(parsed.adminPubkey, 'administrator pubkey'),
		coordinatorPubkey: requireHexPubkey(parsed.coordinatorPubkey, 'coordinator pubkey'),
		relays: parsed.relays as string[],
		nonce: parsed.nonce,
	}
}
