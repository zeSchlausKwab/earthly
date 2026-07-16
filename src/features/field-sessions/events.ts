import { verifyEvent, type EventTemplate, type NostrEvent } from 'nostr-tools'

export const FIELD_SESSION_RECORD_KIND = 37_523

export interface FieldSessionMessage {
	event: NostrEvent
	text: string
}

export function fieldSessionMessageTemplate(
	sessionId: string,
	text: string,
): EventTemplate & { created_at: number } {
	const trimmed = text.trim()
	if (!trimmed) throw new Error('Write a message first')
	if (trimmed.length > 8_000)
		throw new Error('Field-session messages are limited to 8,000 characters')
	return {
		kind: FIELD_SESSION_RECORD_KIND,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['d', crypto.randomUUID()],
			['h', sessionId],
			['t', 'field-session'],
			['type', 'message'],
		],
		content: JSON.stringify({ version: 1, type: 'message', text: trimmed }),
	}
}

export function fieldSessionIdForEvent(event: NostrEvent): string | null {
	return event.tags.find((tag) => tag[0] === 'h')?.[1] ?? null
}

export function parseFieldSessionMessage(
	event: NostrEvent,
	sessionId: string,
): FieldSessionMessage | null {
	if (
		event.kind !== FIELD_SESSION_RECORD_KIND ||
		fieldSessionIdForEvent(event) !== sessionId ||
		!verifyEvent(event)
	) {
		return null
	}
	try {
		const content = JSON.parse(event.content) as Record<string, unknown>
		if (content.version !== 1 || content.type !== 'message' || typeof content.text !== 'string') {
			return null
		}
		const text = content.text.trim()
		return text ? { event, text } : null
	} catch {
		return null
	}
}
