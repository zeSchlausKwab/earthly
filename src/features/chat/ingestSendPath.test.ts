/**
 * D-11 send-path invariant (BLOCKER 3): the composed outbound message must carry
 * an attached dataset as `{ handleId, summary }` (sampled rows) and NEVER the raw
 * `fullRows`. This mirrors the store-level invariant proven in 03-03, but at the
 * ChatPanel send-composition seam (`composeOutboundContent`) — the last point
 * before the payload leaves for the model.
 *
 * Also asserts the three-tier vision gate at composition: an attached image's
 * `image_url` part is included ONLY on confirmed `'vision'`, or `'uncertain'`
 * WITH an explicit Send-anyway opt-in; `'no-vision'` (and un-opted `'uncertain'`)
 * never include it (never a silent send — acceptance criterion #4).
 */

import { describe, expect, it } from 'bun:test'
import { composeOutboundContent } from './composeOutboundContent'
import type { AttachedFileView } from './components/FileChip'
import { putDataset } from './ingest/ingestStore'

/** Put a multi-row dataset into the store and return an attached-file view for it. */
function attachDataset(rowCount: number): { view: AttachedFileView; handleId: string } {
	const fullRows = Array.from({ length: rowCount }, (_, i) => ({
		id: `row-${String(i).padStart(5, '0')}-marker`,
		value: i,
	}))
	const handleId = putDataset({
		fileName: 'big.csv',
		type: 'csv',
		schema: [
			{ name: 'id', type: 'string' },
			{ name: 'value', type: 'number' },
		],
		rowCount,
		columnCount: 2,
		fullRows,
		coordinateColumns: {},
		bytes: 1000,
	})
	// The strip stores the model-facing summary on the chip (never fullRows).
	const { toModelSummary } = require('./ingest/ingestStore')
	const summary = toModelSummary(handleId)?.summary
	return {
		handleId,
		view: { id: 'chip-1', fileName: 'big.csv', status: 'parsed', summary },
	}
}

function imageView(): AttachedFileView {
	return {
		id: 'img-1',
		fileName: 'pic.png',
		status: 'image',
		imageUrl: 'data:image/png;base64,SECRETIMAGE',
	}
}

describe('composeOutboundContent — D-11 send-path invariant', () => {
	it('includes the dataset handleId + summary but NEVER fullRows', () => {
		const { view, handleId } = attachDataset(200)
		const content = composeOutboundContent({
			text: 'map these',
			attachedFiles: [view],
			visionSupport: 'no-vision',
			sendAnyway: false,
		})

		const serialized = JSON.stringify(content)
		// handle + summary present
		expect(serialized).toContain(handleId)
		// fullRows must never appear (neither the field name nor a non-sampled row)
		expect(serialized).not.toContain('fullRows')
		expect(serialized).not.toContain('row-00150-marker') // a mid-table, non-sampled row
	})

	// CR-01: GeoJSON/json/text carry the full payload in fullRows[0]; the composed
	// outbound content (the model-facing message) must stay bounded, never the
	// full FeatureCollection.
	it('keeps a large GeoJSON dataset BOUNDED in outbound content (no full FeatureCollection)', () => {
		const features = Array.from({ length: 4000 }, (_, i) => ({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [i * 0.001, i * 0.001] },
			properties: { id: `gj-${String(i).padStart(5, '0')}-marker` },
		}))
		const fc = { type: 'FeatureCollection' as const, features }
		const handleId = putDataset({
			fileName: 'big.geojson',
			type: 'geojson',
			schema: [],
			rowCount: 1,
			columnCount: 0,
			fullRows: [{ __geojson: fc }],
			coordinateColumns: {},
			bytes: 1000,
		})
		const { toModelSummary } = require('./ingest/ingestStore')
		const summary = toModelSummary(handleId)?.summary
		const view: AttachedFileView = {
			id: 'chip-gj',
			fileName: 'big.geojson',
			status: 'parsed',
			summary,
		}
		const content = composeOutboundContent({
			text: 'map this',
			attachedFiles: [view],
			visionSupport: 'no-vision',
			sendAnyway: false,
		})
		const serialized = JSON.stringify(content)
		expect(serialized).toContain(handleId)
		// A far-tail feature must not reach the model.
		expect(serialized).not.toContain('gj-03999-marker')
		expect(serialized).not.toContain('gj-02000-marker')
		// Outbound content stays far under the raw payload size.
		expect(serialized.length).toBeLessThan(JSON.stringify(fc).length / 10)
	})
})

describe('composeOutboundContent — three-tier image gate', () => {
	it("'no-vision' NEVER includes the image_url part", () => {
		const content = composeOutboundContent({
			text: 'look',
			attachedFiles: [imageView()],
			visionSupport: 'no-vision',
			sendAnyway: false,
		})
		expect(JSON.stringify(content)).not.toContain('SECRETIMAGE')
	})

	it("'uncertain' WITHOUT Send-anyway excludes the image", () => {
		const content = composeOutboundContent({
			text: 'look',
			attachedFiles: [imageView()],
			visionSupport: 'uncertain',
			sendAnyway: false,
		})
		expect(JSON.stringify(content)).not.toContain('SECRETIMAGE')
	})

	it("'uncertain' WITH Send-anyway includes the image", () => {
		const content = composeOutboundContent({
			text: 'look',
			attachedFiles: [imageView()],
			visionSupport: 'uncertain',
			sendAnyway: true,
		})
		const parts = Array.isArray(content) ? content : []
		expect(parts.some((p) => p.type === 'image_url')).toBe(true)
		expect(JSON.stringify(content)).toContain('SECRETIMAGE')
	})

	it("'vision' includes the image normally", () => {
		const content = composeOutboundContent({
			text: 'look',
			attachedFiles: [imageView()],
			visionSupport: 'vision',
			sendAnyway: false,
		})
		expect(JSON.stringify(content)).toContain('SECRETIMAGE')
	})

	it('returns a plain string when there are no attachments', () => {
		const content = composeOutboundContent({
			text: 'hello',
			attachedFiles: [],
			visionSupport: 'no-vision',
			sendAnyway: false,
		})
		expect(content).toBe('hello')
	})
})
