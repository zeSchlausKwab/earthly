import { describe, expect, it } from 'bun:test'
import type { ParsedDataset } from '../ingest/datasetTypes'
import {
	type AttachDeps,
	detectIngestKind,
	handleAttachedFile,
	inferSchema,
	isImageFile,
} from './fileAttachHandler'

/** A minimal File stand-in (bun:test has no DOM File). */
function fakeFile(name: string, type: string, size: number, text = '', buffer?: ArrayBuffer): File {
	return {
		name,
		type,
		size,
		text: async () => text,
		arrayBuffer: async () => buffer ?? new ArrayBuffer(0),
	} as unknown as File
}

/** Build deps with a shared call-log so order can be asserted. */
function makeDeps(over: Partial<AttachDeps> = {}): { deps: AttachDeps; calls: string[] } {
	const calls: string[] = []
	const deps: AttachDeps = {
		assertFileWithinCaps: (..._args) => {
			calls.push('assertFileWithinCaps')
			return { ok: true }
		},
		parseFileInWorker: async (..._args) => {
			calls.push('parseFileInWorker')
			return { id: 'x', success: true, rows: [{ a: 1 }], schemaFields: ['a'] }
		},
		putDataset: (_parsed) => {
			calls.push('putDataset')
			return 'handle-123'
		},
		deriveIngestSummary: (parsed: ParsedDataset) => {
			calls.push('deriveIngestSummary')
			return {
				handleId: parsed.handleId,
				fileName: parsed.fileName,
				type: parsed.type,
				rowCount: parsed.rowCount,
				columnCount: parsed.columnCount,
				schema: parsed.schema,
				sampleRows: [],
				detectedCoordinateColumns: [],
			}
		},
		readImageDataUrl: async (_file) => {
			calls.push('readImageDataUrl')
			return 'data:image/png;base64,AAAA'
		},
		...over,
	}
	return { deps, calls }
}

describe('detectIngestKind', () => {
	it('maps extensions to ingest kinds', () => {
		expect(detectIngestKind(fakeFile('a.csv', 'text/csv', 1))).toBe('csv')
		expect(detectIngestKind(fakeFile('a.xlsx', '', 1))).toBe('xlsx')
		expect(detectIngestKind(fakeFile('a.geojson', '', 1))).toBe('geojson')
		expect(detectIngestKind(fakeFile('a.json', 'application/json', 1))).toBe('json')
		expect(detectIngestKind(fakeFile('a.txt', 'text/plain', 1))).toBe('text')
	})
})

describe('isImageFile', () => {
	it('detects images by mime type and extension', () => {
		expect(isImageFile(fakeFile('a.png', 'image/png', 1))).toBe(true)
		expect(isImageFile(fakeFile('a.jpg', '', 1))).toBe(true)
		expect(isImageFile(fakeFile('a.csv', 'text/csv', 1))).toBe(false)
	})
})

describe('handleAttachedFile (WARNING 5: strict order)', () => {
	it('runs assertFileWithinCaps → parseFileInWorker → putDataset in order for a data file', async () => {
		const { deps, calls } = makeDeps()
		const result = await handleAttachedFile(fakeFile('a.csv', 'text/csv', 100, 'a\n1'), deps)

		// The three pinned steps appear in the exact contract order.
		const pinned = calls.filter((c) =>
			['assertFileWithinCaps', 'parseFileInWorker', 'putDataset'].includes(c),
		)
		expect(pinned).toEqual(['assertFileWithinCaps', 'parseFileInWorker', 'putDataset'])
		expect(result.status).toBe('parsed')
		if (result.status === 'parsed') {
			expect(result.handleId).toBe('handle-123')
			expect(result.summary.handleId).toBe('handle-123')
		}
	})

	it('short-circuits on over-cap: NEVER calls parseFileInWorker / putDataset', async () => {
		const { deps, calls } = makeDeps({
			assertFileWithinCaps: () => {
				calls.push('assertFileWithinCaps')
				return { ok: false, reason: 'This file is too large (max 50 MB for data files).' }
			},
		})
		const result = await handleAttachedFile(fakeFile('big.csv', 'text/csv', 9e9), deps)

		expect(calls).toEqual(['assertFileWithinCaps'])
		expect(calls).not.toContain('parseFileInWorker')
		expect(calls).not.toContain('putDataset')
		expect(result.status).toBe('rejected')
		if (result.status === 'rejected') {
			expect(result.reason).toContain('too large')
		}
	})

	it('routes an image through readImageDataUrl → image_url, NOT parseFileInWorker / putDataset', async () => {
		const { deps, calls } = makeDeps()
		const result = await handleAttachedFile(fakeFile('pic.png', 'image/png', 100), deps)

		expect(calls).toContain('assertFileWithinCaps')
		expect(calls).toContain('readImageDataUrl')
		expect(calls).not.toContain('parseFileInWorker')
		expect(calls).not.toContain('putDataset')
		expect(result.status).toBe('image')
		if (result.status === 'image') {
			expect(result.imageUrl).toBe('data:image/png;base64,AAAA')
		}
	})

	it('reports a parse failure as status "failed"', async () => {
		const { deps } = makeDeps({
			parseFileInWorker: async () => ({ id: 'x', success: false, error: 'bad csv' }),
		})
		const result = await handleAttachedFile(fakeFile('a.csv', 'text/csv', 100, 'broken'), deps)
		expect(result.status).toBe('failed')
	})
})

describe('inferSchema — bounded multi-value sampling (WR-07)', () => {
	it('types a clean numeric column as number', () => {
		const rows = [{ n: 1 }, { n: 2 }, { n: 3 }]
		expect(inferSchema(rows, ['n'])).toEqual([{ name: 'n', type: 'number' }])
	})

	it("emits 'mixed' when a column has more than one primitive type", () => {
		// First value is numeric, a later row is a string token — the old first-value
		// heuristic would have mis-typed this as 'number'.
		const rows = [{ v: 1 }, { v: 2 }, { v: 'N/A' }, { v: 4 }]
		expect(inferSchema(rows, ['v'])).toEqual([{ name: 'v', type: 'mixed' }])
	})

	it('ignores null/undefined when deciding the type', () => {
		const rows = [{ v: null }, { v: undefined }, { v: true }, { v: false }]
		expect(inferSchema(rows, ['v'])).toEqual([{ name: 'v', type: 'boolean' }])
	})

	it("a string-first numeric column is correctly 'mixed', not 'string'", () => {
		const rows = [{ v: 'header-echo' }, { v: 10 }, { v: 20 }]
		expect(inferSchema(rows, ['v'])).toEqual([{ name: 'v', type: 'mixed' }])
	})

	it('defaults an all-null column to string', () => {
		const rows = [{ v: null }, { v: null }]
		expect(inferSchema(rows, ['v'])).toEqual([{ name: 'v', type: 'string' }])
	})
})
