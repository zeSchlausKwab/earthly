import { describe, expect, it } from 'bun:test'
import type { ParsedDataset } from './datasetTypes'
import { INGEST_SAMPLE, MAX_SUMMARY_COLS, deriveIngestSummary, sampleRows } from './parseSummary'
import { compactToolMessageContentForPrompt } from '../tools/helpers'

function baseParsed(overrides: Partial<ParsedDataset>): ParsedDataset {
	return {
		handleId: 'h-1',
		fileName: 'f.csv',
		type: 'csv',
		schema: [{ name: 'a', type: 'number' }],
		rowCount: 0,
		columnCount: 1,
		fullRows: [],
		coordinateColumns: {},
		bytes: 0,
		createdAt: 1,
		...overrides,
	}
}

describe('sampleRows', () => {
	it('returns head+tail+random length for a large dataset, drawn from first/last/middle', () => {
		const rows = Array.from({ length: 100 }, (_, i) => ({ i }))
		const out = sampleRows(rows)
		expect(out).toHaveLength(INGEST_SAMPLE.head + INGEST_SAMPLE.tail + INGEST_SAMPLE.random)
		// First head from the front, last tail from the back.
		expect(out.slice(0, INGEST_SAMPLE.head)).toEqual(rows.slice(0, INGEST_SAMPLE.head))
		expect(out.slice(INGEST_SAMPLE.head, INGEST_SAMPLE.head + INGEST_SAMPLE.tail)).toEqual(
			rows.slice(rows.length - INGEST_SAMPLE.tail),
		)
	})

	it('returns ALL rows (no padding) when the table is small', () => {
		const rows = Array.from({ length: 4 }, (_, i) => ({ i }))
		expect(sampleRows(rows)).toEqual(rows)
	})

	// IN-04: the random middle draw must be WITHOUT replacement — no duplicate
	// middle rows in a single sample when the middle is large enough.
	it('draws the random middle sample without replacement (IN-04)', () => {
		const rows = Array.from({ length: 100 }, (_, i) => ({ i }))
		// Run many times so a with-replacement collision would almost surely show up.
		for (let trial = 0; trial < 200; trial++) {
			const out = sampleRows(rows) as { i: number }[]
			const middle = out.slice(INGEST_SAMPLE.head, INGEST_SAMPLE.head + INGEST_SAMPLE.random)
			const unique = new Set(middle.map((r) => r.i))
			expect(unique.size).toBe(middle.length)
		}
	})
})

describe('deriveIngestSummary', () => {
	it('caps a wide table to MAX_SUMMARY_COLS and reports moreColumns (D-02)', () => {
		const schema = Array.from({ length: 80 }, (_, i) => ({
			name: `c${i}`,
			type: 'string' as const,
		}))
		const parsed = baseParsed({ schema, columnCount: 80, rowCount: 1, fullRows: [{ c0: 1 }] })
		const summary = deriveIngestSummary(parsed)
		expect(summary.schema).toHaveLength(MAX_SUMMARY_COLS)
		expect(summary.moreColumns).toBe(80 - MAX_SUMMARY_COLS)
	})

	it('omits moreColumns when nothing is dropped', () => {
		const parsed = baseParsed({ columnCount: 1, rowCount: 1, fullRows: [{ a: 1 }] })
		expect(deriveIngestSummary(parsed).moreColumns).toBeUndefined()
	})

	it('INVARIANT: the summary never contains a row outside the sampled set', () => {
		// Zero-pad markers so no marker is a substring of another (m-3 ⊄ m-30).
		const mk = (i: number) => `m-${String(i).padStart(4, '0')}-end`
		const fullRows = Array.from({ length: 300 }, (_, i) => ({ marker: mk(i) }))
		const parsed = baseParsed({ rowCount: 300, fullRows })
		const summary = deriveIngestSummary(parsed)
		const sampled = new Set(summary.sampleRows.map((r) => (r as { marker: string }).marker))
		const serialized = JSON.stringify(summary)
		for (let i = 0; i < 300; i++) {
			if (sampled.has(mk(i))) continue
			expect(serialized).not.toContain(mk(i))
		}
	})

	it('populates detectedCoordinateColumns from coordinateColumns', () => {
		const parsed = baseParsed({
			coordinateColumns: { lat: 'Lat', lon: 'Lon' },
			fullRows: [{ a: 1 }],
			rowCount: 1,
		})
		expect(deriveIngestSummary(parsed).detectedCoordinateColumns.sort()).toEqual(['Lat', 'Lon'])
	})

	it('GeoJSON: surfaces feature count + geometry types + bbox via @turf/turf', () => {
		const fc = {
			type: 'FeatureCollection',
			features: [
				{ type: 'Feature', geometry: { type: 'Point', coordinates: [10, 20] }, properties: {} },
				{ type: 'Feature', geometry: { type: 'Point', coordinates: [30, 40] }, properties: {} },
			],
		}
		const parsed = baseParsed({
			type: 'geojson',
			fileName: 'a.geojson',
			rowCount: 2,
			fullRows: [{ __geojson: fc }],
		})
		const stats = deriveIngestSummary(parsed).typeStats
		expect(stats?.featureCount).toBe(2)
		expect(stats?.geometryTypes).toEqual(['Point'])
		expect(stats?.bbox).toEqual([10, 20, 30, 40])
	})

	it('text: surfaces line/char counts', () => {
		const parsed = baseParsed({
			type: 'text',
			fileName: 'a.txt',
			rowCount: 1,
			fullRows: [{ lineCount: 12, charCount: 345 }],
		})
		const stats = deriveIngestSummary(parsed).typeStats
		expect(stats?.lineCount).toBe(12)
		expect(stats?.charCount).toBe(345)
	})

	// CR-01: structured kinds (geojson/json/text) carry the FULL payload in
	// fullRows[0] for tools only — the model-facing summary must NOT embed it.
	it('CR-01 INVARIANT: a large GeoJSON summary does NOT embed the full FeatureCollection', () => {
		const features = Array.from({ length: 5000 }, (_, i) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [i * 0.001, i * 0.001] },
			properties: { id: `feature-${String(i).padStart(5, '0')}-marker`, name: `n-${i}` },
		}))
		const fc = { type: 'FeatureCollection' as const, features }
		const parsed = baseParsed({
			type: 'geojson',
			fileName: 'big.geojson',
			rowCount: 1,
			fullRows: [{ __geojson: fc }],
		})
		const summary = deriveIngestSummary(parsed)
		const serialized = JSON.stringify(summary)

		// typeStats still reports the true feature count.
		expect(summary.typeStats?.featureCount).toBe(5000)
		// sampleRows is bounded — at most MAX_GEOJSON_SAMPLE_FEATURES.
		expect(summary.sampleRows.length).toBeLessThanOrEqual(5)
		// No far-tail feature (id) leaks into the summary.
		expect(serialized).not.toContain('feature-04999-marker')
		expect(serialized).not.toContain('feature-02500-marker')
		// And the serialized summary stays far under the raw payload size.
		expect(serialized.length).toBeLessThan(JSON.stringify(fc).length / 10)
	})

	it('CR-01 INVARIANT: a large JSON object summary surfaces keys, not the full object', () => {
		const big: Record<string, unknown> = {}
		for (let i = 0; i < 50; i++) big[`key-${i}`] = `value-${String(i).padStart(5, '0')}-secret`
		const parsed = baseParsed({
			type: 'json',
			fileName: 'big.json',
			rowCount: 1,
			fullRows: [big],
		})
		const summary = deriveIngestSummary(parsed)
		const serialized = JSON.stringify(summary)
		// A deep value must not leak.
		expect(serialized).not.toContain('value-00049-secret')
		// Keys ARE surfaced (bounded).
		expect(serialized).toContain('key-0')
		expect(serialized.length).toBeLessThan(JSON.stringify(big).length)
	})

	it('CR-01 INVARIANT: a large text summary does NOT embed the full line array', () => {
		const lines = Array.from({ length: 10000 }, (_, i) => `line-${String(i).padStart(5, '0')}-body`)
		const parsed = baseParsed({
			type: 'text',
			fileName: 'big.txt',
			rowCount: 1,
			fullRows: [{ lineCount: lines.length, charCount: 999999, lines }],
		})
		const summary = deriveIngestSummary(parsed)
		const serialized = JSON.stringify(summary)
		// A mid-body line must not leak (only first/last few lines are surfaced).
		expect(serialized).not.toContain('line-05000-body')
		expect(serialized).not.toContain('line-00100-body')
		expect(serialized).not.toContain('line-09000-body')
		// Counts surface via typeStats.
		expect(summary.typeStats?.lineCount).toBe(10000)
		expect(serialized.length).toBeLessThan(JSON.stringify(lines).length / 10)
	})
})

describe('compactToolMessageContentForPrompt — ingest-handle compaction', () => {
	it('compacts a tool result carrying an ingest handle to the IngestSummary (no fullRows)', () => {
		const fullRows = Array.from({ length: 50 }, (_, i) => ({ secret: `leak-${i}` }))
		const toolResult = {
			ingestHandle: 'handle-xyz',
			ingestSummary: {
				handleId: 'handle-xyz',
				fileName: 'f.csv',
				type: 'csv',
				rowCount: 50,
				columnCount: 1,
				schema: [{ name: 'secret', type: 'string' }],
				sampleRows: [{ secret: 'leak-0' }],
				detectedCoordinateColumns: [],
			},
			fullRows,
		}
		const compacted = compactToolMessageContentForPrompt(JSON.stringify(toolResult))
		expect(compacted).not.toContain('fullRows')
		expect(compacted).not.toContain('leak-49')
		expect(compacted).toContain('handle-xyz')
		expect(compacted).toContain('leak-0')
	})
})
