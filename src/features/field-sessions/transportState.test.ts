import { describe, expect, test } from 'bun:test'
import { transitionFieldSessionEventScope } from './transportState'

describe('Field-session transport event scope', () => {
	test('preserves events when metadata refreshes for the same session', () => {
		const currentEvents = [{ id: 'persisted-geometry' }]

		const transition = transitionFieldSessionEventScope(
			currentEvents,
			'field-session-a',
			'field-session-a',
		)

		expect(transition.events).toBe(currentEvents)
		expect(transition.sessionId).toBe('field-session-a')
	})

	test('clears events when the user changes Field sessions', () => {
		const transition = transitionFieldSessionEventScope(
			[{ id: 'old-session-geometry' }],
			'field-session-a',
			'field-session-b',
		)

		expect(transition.events).toEqual([])
		expect(transition.sessionId).toBe('field-session-b')
	})
})
