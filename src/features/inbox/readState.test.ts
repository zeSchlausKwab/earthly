import { describe, expect, test } from 'bun:test'
import {
	EMPTY_INBOX_READ_STATE,
	isInboxItemRead,
	markInboxAllRead,
	markInboxItemRead,
	parseInboxReadState,
} from './readState'

describe('Inbox read state', () => {
	test('recovers safely from missing, malformed, and future state', () => {
		expect(parseInboxReadState(null)).toEqual(EMPTY_INBOX_READ_STATE)
		expect(parseInboxReadState('{')).toEqual(EMPTY_INBOX_READ_STATE)
		expect(parseInboxReadState(JSON.stringify({ version: 2, readThrough: 99 }))).toEqual(
			EMPTY_INBOX_READ_STATE,
		)
	})

	test('marks one item without hiding a newer unread item', () => {
		const next = markInboxItemRead(EMPTY_INBOX_READ_STATE, 'reply:one')
		expect(isInboxItemRead(next, { id: 'reply:one', createdAt: 20 })).toBe(true)
		expect(isInboxItemRead(next, { id: 'reply:two', createdAt: 21 })).toBe(false)
	})

	test('mark all advances a timestamp watermark and clears explicit ids', () => {
		const initial = markInboxItemRead(EMPTY_INBOX_READ_STATE, 'proposal:one')
		const next = markInboxAllRead(initial, [{ createdAt: 15 }, { createdAt: 25 }], 20)
		expect(next).toEqual({ version: 1, readThrough: 25, readIds: [] })
		expect(isInboxItemRead(next, { id: 'late-relay-event', createdAt: 24 })).toBe(true)
		expect(isInboxItemRead(next, { id: 'new-event', createdAt: 26 })).toBe(false)
	})
})
