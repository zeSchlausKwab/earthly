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
})

describe('deriveIngestSummary', () => {
	it('caps a wide table to MAX_SUMMARY_COLS and reports moreColumns (D-02)', () => {
		const schema = Array.from({ length: 80 }, (_, i) => ({ name: `c${i}`, type: 'string' as const }))
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
		const parsed = baseParsed({ coordinateColumns: { lat: 'Lat', lon: 'Lon' }, fullRows: [{ a: 1 }], rowCount: 1 })
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
