import { describe, expect, test } from 'bun:test'
import vectors from '../../../spec/search-grammar-vectors.json'
import { buildSearchString, hasExtensions, stripExtensions } from './grammar'
import { SEARCH_GRAMMAR_VERSION, type SearchQuery } from './types'
import { coverBboxWithGeohashes, precisionForZoom } from './viewport'

// The golden vectors pin this serializer against the Go parser in
// relay/earthlysearch/grammar.go — both read the same fixture.

describe('search grammar golden vectors', () => {
	test('vector file version matches grammar version', () => {
		expect(vectors.version).toBe(SEARCH_GRAMMAR_VERSION)
	})

	for (const vector of vectors.vectors) {
		test(`serializes: ${vector.name}`, () => {
			expect(buildSearchString(vector.structured as SearchQuery)).toBe(vector.search)
		})
	}
})

describe('buildSearchString validation', () => {
	test('rejects inverted bbox', () => {
		expect(() => buildSearchString({ bbox: [16.7, 48.4, 16.1, 48.1] })).toThrow()
	})

	test('rejects out-of-range point', () => {
		expect(() => buildSearchString({ point: [200, 95] })).toThrow()
	})

	test('rejects radius without origin', () => {
		expect(() => buildSearchString({ text: 'parks', radiusKm: 5 })).toThrow()
	})

	test('rejects distance sort without origin', () => {
		expect(() => buildSearchString({ text: 'parks', sort: 'distance' })).toThrow()
	})

	test('rejects whitespace in token values', () => {
		expect(() => buildSearchString({ labels: ['two words'] })).toThrow()
	})

	test('rejects malformed date', () => {
		expect(() => buildSearchString({ startAfter: 'june 1st' })).toThrow()
	})
})

describe('degradation helpers', () => {
	test('stripExtensions keeps only free text', () => {
		expect(stripExtensions({ text: 'parks', bbox: [16.1, 48.1, 16.7, 48.4] })).toBe('parks')
	})

	test('hasExtensions detects geo constraints', () => {
		expect(hasExtensions({ text: 'parks' })).toBe(false)
		expect(hasExtensions({ text: 'parks', bbox: [16.1, 48.1, 16.7, 48.4] })).toBe(true)
	})
})

describe('viewport geohash cover', () => {
	test('covers central Vienna with fine cells', () => {
		const cells = coverBboxWithGeohashes([16.3, 48.15, 16.45, 48.25])
		expect(cells.length).toBeGreaterThan(0)
		expect(cells.length).toBeLessThanOrEqual(12)
		// Vienna is inside u2e; every cell must share the coarse prefix.
		for (const cell of cells) {
			expect(cell.startsWith('u2')).toBe(true)
		}
	})

	test('cover contains the cell of a point inside the viewport', () => {
		const cells = coverBboxWithGeohashes([16.3, 48.15, 16.45, 48.25])
		const precision = cells[0].length
		// Stephansdom: 16.3725, 48.2085 — its geohash prefix at the cover
		// precision must be one of the cells.
		const expected = 'u2edk82hq'.slice(0, precision)
		expect(cells).toContain(expected)
	})

	test('whole-world bbox falls back to coarse cells', () => {
		const cells = coverBboxWithGeohashes([-180, -90, 180, 90], 40)
		expect(cells.length).toBeGreaterThan(0)
		expect(cells[0].length).toBe(1)
	})

	test('cells are stable across a small pan', () => {
		const a = coverBboxWithGeohashes([16.3, 48.15, 16.45, 48.25])
		const b = coverBboxWithGeohashes([16.31, 48.16, 16.46, 48.26])
		const overlap = a.filter((cell) => b.includes(cell))
		expect(overlap.length).toBeGreaterThan(0)
	})

	test('precisionForZoom is monotonic', () => {
		let prev = 0
		for (const zoom of [0, 3, 5, 7, 10, 13, 16]) {
			const p = precisionForZoom(zoom)
			expect(p).toBeGreaterThanOrEqual(prev)
			prev = p
		}
	})
})
