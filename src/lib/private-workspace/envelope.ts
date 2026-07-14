import { getEventHash, type UnsignedEvent } from 'nostr-tools'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export interface PrivateWorkspaceEnvelope extends UnsignedEvent {
	id: string
}

export function createPrivateEnvelope(input: {
	pubkey: string
	kind: number
	content: string
	tags?: string[][]
	createdAt?: number
}): PrivateWorkspaceEnvelope {
	const event: UnsignedEvent = {
		pubkey: input.pubkey,
		created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
		kind: input.kind,
		tags: input.tags ?? [],
		content: input.content,
	}

	return { ...event, id: getEventHash(event) }
}

export function encodePrivateEnvelope(envelope: PrivateWorkspaceEnvelope): Uint8Array {
	return encoder.encode(JSON.stringify(envelope))
}

export function decodePrivateEnvelope(bytes: Uint8Array): PrivateWorkspaceEnvelope {
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

	const unsigned: UnsignedEvent = {
		pubkey: candidate.pubkey,
		created_at: candidate.created_at,
		kind: candidate.kind,
		tags: candidate.tags as string[][],
		content: candidate.content,
	}
	const id = getEventHash(unsigned)
	if (candidate.id !== id) throw new Error('Private workspace envelope id mismatch')

	return { ...unsigned, id }
}
