import { describe, expect, test } from 'bun:test'
import {
	cacheQueryableFilters,
	filterList,
	filterRequestKey,
	isCacheQueryableFilter,
} from './filterGuards'

describe('nostr filter guards', () => {
	test('treats null and empty arrays as no request filters', () => {
		expect(filterList(null)).toEqual([])
		expect(filterList([])).toEqual([])
		expect(filterRequestKey(null)).toBeNull()
		expect(filterRequestKey([])).toBeNull()
	})

	test('normalizes single filters to an array request key', () => {
		expect(filterRequestKey({ kinds: [37522] })).toBe(JSON.stringify([{ kinds: [37522] }]))
	})

	test('keeps only filters NostrIDB can query without throwing', () => {
		const queryable = { kinds: [37522], '#d': ['sighting-1'] }
		expect(isCacheQueryableFilter({})).toBe(false)
		expect(isCacheQueryableFilter(queryable)).toBe(true)
		expect(cacheQueryableFilters([{}, queryable])).toEqual([queryable])
	})
})
