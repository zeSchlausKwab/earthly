/**
 * Parse-correctness scaffold for the five ingest kinds (INGEST-02 / INGEST-03).
 *
 * The plan (03-01 Task 4) frames this as the "Wave-0 RED parse scaffold the
 * Wave-1 parse client (Plan 02) makes GREEN". The interrupted Wave-0 executor
 * extracted the worker's parse logic into pure helpers (`./parse.ts`) so the
 * worker (`ingest.worker.ts`) is a thin `self.onmessage` wrapper around them —
 * a deviation the plan explicitly invites ("invoke the worker's parse logic
 * directly or via a small synchronous parse helper extracted from the worker").
 *
 * Because those helpers are directly importable under `bun:test` (a real
 * `Worker` built via `new Worker(new URL(...))` is not driveable here), this
 * suite asserts REAL parse behaviour and is GREEN today — it is the executable
 * contract Plan 02's client wires the worker round-trip against, not a
 * `MISSING`-stub placeholder.
 *
 * Fixtures live in `./__fixtures__/`:
 *  - messy.csv     quoted field + embedded newline + lat/lon + place column
 *  - sample.xlsx   real ExcelJS-written workbook (header + 3 data rows)
 *  - sample.geojson small FeatureCollection
 *  - sample.txt    three lines of plain text
 */

import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { parseCsv, parseJson, parseText, parseXlsx } from './parse'

const fixture = (name: string) => path.resolve(import.meta.dir, '__fixtures__', name)

describe('ingest parse — csv (PapaParse, INGEST-02)', () => {
	it('parses headers into schemaFields and rows, surviving quotes + embedded newlines', async () => {
		const text = await Bun.file(fixture('messy.csv')).text()
		const { rows, schemaFields } = parseCsv(text)

		expect(schemaFields).toEqual(['name', 'lat', 'lon', 'place', 'note'])
		expect(rows).toHaveLength(3)

		// Coordinate columns dynamic-typed to numbers (drives Plan 05 coord-detect).
		const eiffel = rows[0]
		expect(eiffel.name).toBe('Eiffel Tower')
		expect(eiffel.lat).toBe(48.8584)
		expect(eiffel.lon).toBe(2.2945)
		expect(eiffel.place).toBe('Paris, France')

		// Embedded newline inside a quoted field is preserved, not row-split.
		expect(String(eiffel.note)).toContain('\n')
		expect(String(eiffel.note)).toContain('Champ de Mars')

		// Escaped doubled-quote unescapes to a single quote.
		expect(String(rows[1].note)).toBe('Gift from "France"')

		// place-name column present for Plan 05 geocode path.
		expect(rows[2].place).toBe('Sydney, Australia')
	})
})

describe('ingest parse — xlsx (ExcelJS in-memory load, INGEST-03)', () => {
	it('loads a real .xlsx ArrayBuffer into header-keyed rows', async () => {
		const buffer = await Bun.file(fixture('sample.xlsx')).arrayBuffer()
		const { rows, schemaFields } = await parseXlsx(buffer)

		expect(schemaFields).toEqual(['name', 'lat', 'lon', 'place'])
		expect(rows).toHaveLength(3)

		const eiffel = rows[0]
		expect(eiffel.name).toBe('Eiffel Tower')
		expect(eiffel.lat).toBe(48.8584)
		expect(eiffel.lon).toBe(2.2945)
		expect(eiffel.place).toBe('Paris, France')

		expect(rows[1].name).toBe('Statue of Liberty')
		expect(rows[2].lat).toBe(-33.8568)
	})
})

describe('ingest parse — json / geojson', () => {
	it('parses a GeoJSON FeatureCollection into a structured object', async () => {
		const text = await Bun.file(fixture('sample.geojson')).text()
		const data = parseJson(text) as {
			type: string
			features: Array<{ geometry: { coordinates: [number, number] } }>
		}

		expect(data.type).toBe('FeatureCollection')
		expect(data.features).toHaveLength(2)
		expect(data.features[0].geometry.coordinates).toEqual([2.2945, 48.8584])
	})

	it('throws on malformed json (worker boundary converts this to { success:false })', () => {
		expect(() => parseJson('{ not valid json')).toThrow()
	})
})

describe('ingest parse — text', () => {
	it('reports line and character counts for plain text', async () => {
		const text = await Bun.file(fixture('sample.txt')).text()
		const result = parseText(text)

		// File ends with a trailing newline → final empty segment.
		expect(result.lines[0]).toBe('The quick brown fox jumps over the lazy dog.')
		expect(result.lineCount).toBe(4)
		expect(result.charCount).toBe(text.length)
	})
})
