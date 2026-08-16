/**
 * Pure, synchronous-where-possible parse helpers for the five ingest kinds.
 *
 * These are extracted from the worker so they can be unit-tested directly under
 * `bun:test` without spinning up a real `Worker` (which `bun:test` cannot drive
 * with the `new Worker(new URL(...))` bundler form). The worker
 * (`ingest.worker.ts`) is a thin `self.onmessage` wrapper around these.
 *
 * Every helper either returns a typed result or throws — the worker boundary is
 * responsible for converting throws into `{ success: false, error }` responses
 * (never letting an error escape `self.onmessage`, mirroring
 * `src/lib/geo/geoJsonParseWorker.ts`).
 */

import Papa from 'papaparse'

export interface TabularParseResult {
	rows: Record<string, unknown>[]
	schemaFields: string[]
}

export interface TextParseResult {
	lineCount: number
	charCount: number
	lines: string[]
}

/**
 * Parse CSV text with PapaParse in header mode.
 * Handles quoted fields, embedded newlines, BOM, and delimiter inference.
 */
export function parseCsv(text: string): TabularParseResult {
	const result = Papa.parse<Record<string, unknown>>(text, {
		header: true,
		dynamicTyping: true,
		skipEmptyLines: true,
	})
	// IN-01: PapaParse (header + dynamicTyping) can still emit a row of all
	// null/undefined for a malformed trailing line, inflating rowCount with a
	// phantom. Drop rows where EVERY value is null/undefined.
	const rows = result.data.filter((row) => Object.values(row).some((v) => v != null))
	return {
		rows,
		schemaFields: result.meta.fields ?? [],
	}
}

/**
 * Parse an xlsx ArrayBuffer with the ExcelJS browser API (`wb.xlsx.load`).
 *
 * Intentionally uses the in-memory `load(buffer)` path, NOT the Node
 * `ExcelJS.stream.xlsx.WorkbookReader` (which is filepath/Node-stream based and
 * does not work in a browser/worker — RESEARCH Pitfall 2). The header is read
 * from row 1; each subsequent row becomes a `Record<string, unknown>`.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<TabularParseResult> {
	const { default: ExcelJS } = await import('exceljs')
	const wb = new ExcelJS.Workbook()
	await wb.xlsx.load(buffer)
	const ws = wb.worksheets[0]
	if (!ws) {
		return { rows: [], schemaFields: [] }
	}

	// ExcelJS row.values is 1-indexed (index 0 is empty); slice it off.
	const headerValues = (ws.getRow(1).values as unknown[]) ?? []
	const schemaFields = headerValues.slice(1).map((v) => String(v ?? ''))

	const rows: Record<string, unknown>[] = []
	ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber === 1) return
		const values = (row.values as unknown[]).slice(1)
		const record: Record<string, unknown> = {}
		schemaFields.forEach((field, i) => {
			record[field] = values[i]
		})
		rows.push(record)
	})

	return { rows, schemaFields }
}

/** Parse JSON / GeoJSON text into a structured object. */
export function parseJson(text: string): unknown {
	return JSON.parse(text)
}

/** Split plain text into lines and report line/character counts. */
export function parseText(text: string): TextParseResult {
	const lines = text.split(/\r\n|\r|\n/)
	return {
		lineCount: lines.length,
		charCount: text.length,
		lines,
	}
}
