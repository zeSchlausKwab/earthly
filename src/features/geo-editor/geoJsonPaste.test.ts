import { describe, expect, test } from 'bun:test'
import { getGeoJsonPasteCandidate } from './geoJsonPaste'

describe('getGeoJsonPasteCandidate', () => {
	test('ignores ordinary chat text before JSON.parse', () => {
		expect(getGeoJsonPasteCandidate('I want you to find Vienna')).toBeNull()
	})

	test('returns trimmed JSON-looking clipboard text', () => {
		expect(getGeoJsonPasteCandidate('  {"type":"FeatureCollection","features":[]}  ')).toBe(
			'{"type":"FeatureCollection","features":[]}',
		)
		expect(getGeoJsonPasteCandidate('\n[]\n')).toBe('[]')
	})
})
