import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
	FIELD_SESSION_RECORD_KIND,
	fieldSessionMessageTemplate,
	parseFieldSessionMessage,
} from './events'

describe('Field-session records', () => {
	test('a signed message remains scoped to its Field session', () => {
		const event = finalizeEvent(
			fieldSessionMessageTemplate('survey-123', 'Found a spring'),
			generateSecretKey(),
		)
		const message = parseFieldSessionMessage(event, 'survey-123')
		expect(event.kind).toBe(FIELD_SESSION_RECORD_KIND)
		expect(message?.text).toBe('Found a spring')
		expect(parseFieldSessionMessage(event, 'another-session')).toBeNull()
	})

	test('empty messages are rejected before signing', () => {
		expect(() => fieldSessionMessageTemplate('survey-123', '   ')).toThrow('Write a message')
	})
})
