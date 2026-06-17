import { describe, expect, it } from 'bun:test'
import type { ParsedDataset } from './datasetTypes'
import {
	evictDataset,
	getDataset,
	MAX_INGEST_DATASETS,
	putDataset,
	toModelSummary,
} from './ingestStore'

function makeParsed(
	rowCount: number,
	overrides: Partial<ParsedDataset> = {},
): Omit<ParsedDataset, 'handleId' | 'createdAt'> {
	const fullRows = Array.from({ length: rowCount }, (_, i) => ({
		id: i,
		name: `row-${i}`,
		lat: 40 + i / 1000,
		lon: -73 - i / 1000,
	}))
	return {
		fileName: 'sample.csv',
		type: 'csv',
		schema: [
			{ name: 'id', type: 'number' },
			{ name: 'name', type: 'string' },
			{ name: 'lat', type: 'number' },
			{ name: 'lon', type: 'number' },
		],
		rowCount,
		columnCount: 4,
		fullRows,
		coordinateColumns: { lat: 'lat', lon: 'lon' },
		bytes: rowCount * 32,
		...overrides,
	}
}

describe('ingestStore', () => {
	it('putDataset returns a uuid handle and getDataset returns the dataset WITH fullRows', () => {
		const handle = putDataset(makeParsed(10))
		expect(handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

		const got = getDataset(handle)
		expect(got).toBeDefined()
		expect(got?.handleId).toBe(handle)
		expect(got?.fullRows).toHaveLength(10)
		expect(got?.createdAt).toBeGreaterThan(0)
		evictDataset(handle)
	})

	it('INVARIANT (V5/D-11): toModelSummary returns { handleId, summary } and its JSON excludes every non-sampled row', () => {
		const parsed = makeParsed(200)
		const handle = putDataset(parsed)

		const model = toModelSummary(handle)
		expect(model).toBeDefined()
		expect(model?.handleId).toBe(handle)
		expect(model?.summary.handleId).toBe(handle)

		const serialized = JSON.stringify(model)

		// The sampled rows (a small head+tail+random draw) ARE present.
		expect(model?.summary.sampleRows.length).toBeGreaterThan(0)
		expect(model?.summary.sampleRows.length).toBeLessThan(200)

		// Deep-scan: NO non-sampled row name may appear in the serialized model payload.
		const sampledNames = new Set(
			model?.summary.sampleRows.map((r) => (r as { name?: string }).name),
		)
		for (let i = 0; i < 200; i++) {
			const name = `row-${i}`
			if (sampledNames.has(name)) continue
			expect(serialized).not.toContain(`"${name}"`)
		}
		// There is no fullRows field on the model path at all.
		expect(serialized).not.toContain('fullRows')

		evictDataset(handle)
	})

	it('evictDataset removes the dataset; getDataset then returns undefined', () => {
		const handle = putDataset(makeParsed(5))
		expect(getDataset(handle)).toBeDefined()
		evictDataset(handle)
		expect(getDataset(handle)).toBeUndefined()
		expect(toModelSummary(handle)).toBeUndefined()
	})

	it('caps the store size (WR-02): exceeding MAX_INGEST_DATASETS evicts the oldest handles', () => {
		const overflow = 5
		const handles: string[] = []
		for (let i = 0; i < MAX_INGEST_DATASETS + overflow; i++) {
			handles.push(putDataset(makeParsed(1)))
		}
		// The first `overflow` (least-recently-used) handles were evicted.
		for (let i = 0; i < overflow; i++) {
			expect(getDataset(handles[i])).toBeUndefined()
			expect(toModelSummary(handles[i])).toBeUndefined()
		}
		// The most-recent MAX_INGEST_DATASETS handles survive.
		for (let i = overflow; i < handles.length; i++) {
			expect(getDataset(handles[i])).toBeDefined()
		}
		for (const h of handles) evictDataset(h)
	})

	it('LRU refresh (WR-02): a recently-read handle survives eviction over a cold one', () => {
		const handles: string[] = []
		for (let i = 0; i < MAX_INGEST_DATASETS; i++) handles.push(putDataset(makeParsed(1)))
		// Touch the oldest handle so it becomes most-recently-used.
		expect(getDataset(handles[0])).toBeDefined()
		// One more insert pushes over the cap — the now-coldest (handles[1]) is evicted,
		// not the freshly-touched handles[0].
		const extra = putDataset(makeParsed(1))
		handles.push(extra)
		expect(getDataset(handles[0])).toBeDefined()
		expect(getDataset(handles[1])).toBeUndefined()
		for (const h of handles) evictDataset(h)
	})

	it('holds nothing in localStorage / IndexedDB (session-only, D-12) — no persistence call', () => {
		// The store module must not reference any persistence API. Source-level
		// assertion: read the module source and ensure no persistence identifiers.
		const src = Bun.file(new URL('./ingestStore.ts', import.meta.url)).text()
		return src.then((text) => {
			expect(text).not.toContain('localStorage')
			expect(text).not.toContain('indexedDB')
			expect(text).not.toContain('IndexedDB')
			expect(text).not.toContain('persist')
		})
	})
})
