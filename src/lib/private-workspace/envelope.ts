import {
	getEventHash,
	verifyEvent,
	type EventTemplate,
	type NostrEvent,
	type UnsignedEvent,
} from 'nostr-tools'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/**
 * A detached, encrypted-only Nostr proof that authorizes one private envelope.
 * It is deliberately separate from the payload so decrypted map data is not a
 * publishable signed Nostr event.
 */
/** Experimental NIP-01 ephemeral-range kind; it is never intentionally relayed. */
export const PRIVATE_WORKSPACE_AUTHORIZATION_KIND = 27523
export const PRIVATE_WORKSPACE_AUTHORIZATION_VERSION = 1
const PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN = 'earthly-private-workspace-authorization-v1'

export interface PrivateWorkspaceAuthorization {
	version: typeof PRIVATE_WORKSPACE_AUTHORIZATION_VERSION
	event: NostrEvent
}

export interface PrivateWorkspaceEnvelope extends UnsignedEvent {
	id: string
	authorization: PrivateWorkspaceAuthorization
}

export interface PrivateEnvelopeSigner {
	signEvent(event: EventTemplate): Promise<NostrEvent>
}

type PrivateEnvelopeBody = UnsignedEvent & { id: string }

function isStringTags(value: unknown): value is string[][] {
	return (
		Array.isArray(value) &&
		value.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'))
	)
}

function envelopeBody(envelope: PrivateWorkspaceEnvelope): PrivateEnvelopeBody {
	return {
		id: envelope.id,
		pubkey: envelope.pubkey,
		created_at: envelope.created_at,
		kind: envelope.kind,
		tags: envelope.tags,
		content: envelope.content,
	}
}

export function privateEnvelopeAuthorizationDigest(
	envelope: PrivateEnvelopeBody,
	groupId: string,
): string {
	if (!groupId) throw new Error('Private workspace authorization requires an MLS group id')
	return getEventHash({
		pubkey: envelope.pubkey,
		created_at: envelope.created_at,
		kind: PRIVATE_WORKSPACE_AUTHORIZATION_KIND,
		tags: [
			['e', envelope.id],
			['group', groupId],
		],
		content: PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN,
	})
}

export function assertPrivateEnvelopeAuthorization(
	envelope: PrivateWorkspaceEnvelope,
	expectedGroupId: string,
): void {
	const unsigned: UnsignedEvent = {
		pubkey: envelope.pubkey,
		created_at: envelope.created_at,
		kind: envelope.kind,
		tags: envelope.tags,
		content: envelope.content,
	}
	if (getEventHash(unsigned) !== envelope.id) {
		throw new Error('Private workspace envelope id mismatch')
	}

	const authorization = envelope.authorization
	if (
		!authorization ||
		authorization.version !== PRIVATE_WORKSPACE_AUTHORIZATION_VERSION ||
		!authorization.event
	) {
		throw new Error('Private workspace envelope authorization is missing or unsupported')
	}
	if (!verifyEvent(authorization.event)) {
		throw new Error('Invalid private workspace authorization signature')
	}
	if (authorization.event.pubkey !== envelope.pubkey) {
		throw new Error('Private workspace authorization author mismatch')
	}
	if (
		authorization.event.kind !== PRIVATE_WORKSPACE_AUTHORIZATION_KIND ||
		authorization.event.created_at !== envelope.created_at ||
		JSON.stringify(authorization.event.tags) !==
			JSON.stringify([['t', PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN]])
	) {
		throw new Error('Invalid private workspace authorization context')
	}
	if (
		authorization.event.content !==
		privateEnvelopeAuthorizationDigest(envelopeBody(envelope), expectedGroupId)
	) {
		throw new Error('Private workspace authorization is for another envelope or MLS group')
	}
}

export async function createPrivateEnvelope(input: {
	signer: PrivateEnvelopeSigner
	groupId: string
	pubkey: string
	kind: number
	content: string
	tags?: string[][]
	createdAt?: number
}): Promise<PrivateWorkspaceEnvelope> {
	const event: UnsignedEvent = {
		pubkey: input.pubkey,
		created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
		kind: input.kind,
		tags: input.tags ?? [],
		content: input.content,
	}
	const body: PrivateEnvelopeBody = { ...event, id: getEventHash(event) }
	const authorization = await input.signer.signEvent({
		kind: PRIVATE_WORKSPACE_AUTHORIZATION_KIND,
		created_at: event.created_at,
		tags: [['t', PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN]],
		content: privateEnvelopeAuthorizationDigest(body, input.groupId),
	})
	const envelope: PrivateWorkspaceEnvelope = {
		...body,
		authorization: {
			version: PRIVATE_WORKSPACE_AUTHORIZATION_VERSION,
			event: authorization,
		},
	}
	assertPrivateEnvelopeAuthorization(envelope, input.groupId)

	return envelope
}

export function encodePrivateEnvelope(envelope: PrivateWorkspaceEnvelope): Uint8Array {
	return encoder.encode(JSON.stringify(envelope))
}

export function decodePrivateEnvelope(
	bytes: Uint8Array,
	expectedGroupId: string,
): PrivateWorkspaceEnvelope {
	const parsed = JSON.parse(decoder.decode(bytes)) as unknown
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Invalid private workspace envelope')
	}

	const candidate = parsed as Record<string, unknown>
	if ('sig' in candidate)
		throw new Error('Private workspace envelopes must not contain a signature')
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.pubkey !== 'string' ||
		typeof candidate.created_at !== 'number' ||
		typeof candidate.kind !== 'number' ||
		!Array.isArray(candidate.tags) ||
		typeof candidate.content !== 'string'
	) {
		throw new Error('Invalid private workspace envelope')
	}
	if (!/^[0-9a-f]{64}$/u.test(candidate.pubkey) || !isStringTags(candidate.tags)) {
		throw new Error('Invalid private workspace envelope')
	}

	const unsigned: UnsignedEvent = {
		pubkey: candidate.pubkey,
		created_at: candidate.created_at,
		kind: candidate.kind,
		tags: candidate.tags as string[][],
		content: candidate.content,
	}
	const envelope = {
		...unsigned,
		id: candidate.id,
		authorization: candidate.authorization as PrivateWorkspaceAuthorization,
	}
	assertPrivateEnvelopeAuthorization(envelope, expectedGroupId)
	return envelope
}
