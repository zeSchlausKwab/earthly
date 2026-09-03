import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'nostr-tools'
import { personToSearchResult } from './types'
import { isQuestionQuery, resolveSearchEnterTarget } from './searchInteraction'

const personEvent: NostrEvent = {
	id: '1'.repeat(64),
	pubkey: '2'.repeat(64),
	created_at: 1,
	kind: 0,
	tags: [],
	content: JSON.stringify({ display_name: 'Ada Mapper' }),
	sig: '3'.repeat(128),
}

const person = personToSearchResult(personEvent)

describe('question search interaction', () => {
	test('recognizes the contract question grammar without treating ordinary text as a question', () => {
		expect(isQuestionQuery('Where did this route go')).toBe(true)
		expect(isQuestionQuery('cable landing stations?')).toBe(true)
		expect(isQuestionQuery('  WHY is this here  ')).toBe(true)
		expect(isQuestionQuery('western front')).toBe(false)
		expect(isQuestionQuery('')).toBe(false)
	})

	test('falls back to Ask on Enter when no row is selected', () => {
		expect(resolveSearchEnterTarget('Where was this?', true, -1, [person])).toEqual({
			kind: 'ask',
			query: 'Where was this?',
		})
	})

	test('keeps ordinary result keyboard navigation after the leading Ask row', () => {
		expect(resolveSearchEnterTarget('Who mapped this?', true, 0, [person])).toEqual({
			kind: 'ask',
			query: 'Who mapped this?',
		})
		expect(resolveSearchEnterTarget('Who mapped this?', true, 1, [person])).toEqual({
			kind: 'result',
			result: person,
		})
	})

	test('does not consume Enter when Ask is unavailable and no entity is selected', () => {
		expect(resolveSearchEnterTarget('Where was this?', false, -1, [person])).toBeNull()
	})
})
