import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { IngestSummary } from '../ingest/datasetTypes'
import { AttachmentCard, parseIngestHandlePart } from './AttachmentCard'

/**
 * Slice A (ingest + attachment rethink, Move 1): an attached dataset renders in
 * the transcript as a compact, collapsible file card — NOT as the raw
 * `{ ingestHandle, ingestSummary }` JSON blob. Collapsed by default; the schema
 * + sample table live behind an expand. The model payload is unchanged (proven
 * separately by `ingestSendPath.test.ts`).
 */

const SUMMARY: IngestSummary = {
	handleId: 'h-abc123',
	fileName: 'places.csv',
	type: 'csv',
	rowCount: 200,
	columnCount: 3,
	schema: [
		{ name: 'name', type: 'string' },
		{ name: 'lat', type: 'number' },
		{ name: 'lon', type: 'number' },
	],
	sampleRows: [
		{ name: 'SAMPLE_ROW_ALPHA', lat: 1.23, lon: 4.56 },
		{ name: 'SAMPLE_ROW_BETA', lat: 7.89, lon: 0.12 },
	],
	detectedCoordinateColumns: ['lat', 'lon'],
}

const HANDLE_JSON = JSON.stringify({ ingestHandle: SUMMARY.handleId, ingestSummary: SUMMARY })

describe('parseIngestHandlePart', () => {
	test('recovers the dataset payload from the composed JSON text part', () => {
		const parsed = parseIngestHandlePart(HANDLE_JSON)
		expect(parsed).not.toBeNull()
		expect(parsed?.ingestHandle).toBe('h-abc123')
		expect(parsed?.ingestSummary.fileName).toBe('places.csv')
	})

	test('returns null for ordinary prose and non-handle JSON', () => {
		expect(parseIngestHandlePart('just a normal message')).toBeNull()
		expect(parseIngestHandlePart(JSON.stringify({ foo: 'bar' }))).toBeNull()
		expect(parseIngestHandlePart('{ not json')).toBeNull()
	})
})

describe('AttachmentCard render (Slice A)', () => {
	test('collapsed by default: shows filename + row/col, hides raw schema/sample', () => {
		const html = renderToStaticMarkup(<AttachmentCard summary={SUMMARY} />)
		// filename + compact stats visible
		expect(html).toContain('places.csv')
		expect(html).toContain('200 rows')
		expect(html).toContain('3 columns')
		// kind badge
		expect(html).toContain('CSV')
		// the raw sample rows are NOT in the collapsed DOM
		expect(html).not.toContain('SAMPLE_ROW_ALPHA')
		expect(html).not.toContain('SAMPLE_ROW_BETA')
	})

	test('expanded: reveals schema fields and the sample table', () => {
		const html = renderToStaticMarkup(<AttachmentCard summary={SUMMARY} defaultOpen />)
		// schema chips
		expect(html).toContain('name')
		expect(html).toContain('lat')
		// sample table rows now visible
		expect(html).toContain('SAMPLE_ROW_ALPHA')
		expect(html).toContain('SAMPLE_ROW_BETA')
	})

	test('does NOT render the raw {ingestHandle,ingestSummary} JSON blob as visible text', () => {
		const html = renderToStaticMarkup(<AttachmentCard summary={SUMMARY} defaultOpen />)
		// the literal JSON envelope is never dumped into the transcript
		expect(html).not.toContain('ingestHandle')
		expect(html).not.toContain('"sampleRows"')
	})

	test('⚠ warning badge affordance: absent when empty, present when summary carries warnings', () => {
		const clean = renderToStaticMarkup(<AttachmentCard summary={SUMMARY} />)
		expect(clean).not.toContain('skipped 3 junk rows')

		const withWarnings = {
			...SUMMARY,
			warnings: ['skipped 3 junk rows', 'no coordinate columns detected'],
		} as IngestSummary
		const warned = renderToStaticMarkup(<AttachmentCard summary={withWarnings} defaultOpen />)
		expect(warned).toContain('skipped 3 junk rows')
		expect(warned).toContain('no coordinate columns detected')
	})
})
