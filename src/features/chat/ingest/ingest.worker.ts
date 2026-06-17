/**
 * Web Worker for parsing ingested files off the main thread.
 *
 * Mirrors the structure of `src/lib/geo/geoJsonParseWorker.ts`: a single
 * `self.onmessage` handler that branches on the request `kind`, wraps every
 * branch in try/catch, and posts a discriminated `{ id, success, ... }`
 * response. An error NEVER throws out of the handler — it is always converted
 * to `{ success: false, error }`.
 *
 * Parse logic lives in `./parse.ts` (pure helpers) so it can be unit-tested
 * directly without instantiating a real Worker.
 */

import { parseCsv, parseJson, parseText, parseXlsx } from './parse'
import type { IngestParseRequest, IngestParseResponse } from './types'

self.onmessage = async (event: MessageEvent<IngestParseRequest>) => {
	const { id, kind, text, buffer } = event.data

	try {
		let response: IngestParseResponse

		switch (kind) {
			case 'csv': {
				const { rows, schemaFields } = parseCsv(text ?? '')
				response = { id, success: true, rows, schemaFields }
				break
			}
			case 'xlsx': {
				if (!buffer) throw new Error('xlsx parse requires an ArrayBuffer')
				const { rows, schemaFields } = await parseXlsx(buffer)
				response = { id, success: true, rows, schemaFields }
				break
			}
			case 'json':
			case 'geojson': {
				const data = parseJson(text ?? '')
				response = { id, success: true, data }
				break
			}
			case 'text': {
				const data = parseText(text ?? '')
				response = { id, success: true, data }
				break
			}
			default: {
				// Exhaustiveness guard — unknown kind is an error, not a throw-out.
				const exhaustive: never = kind
				throw new Error(`Unknown ingest kind: ${String(exhaustive)}`)
			}
		}

		self.postMessage(response)
	} catch (error) {
		const response: IngestParseResponse = {
			id,
			success: false,
			error: error instanceof Error ? error.message : 'Ingest parse failed',
		}
		self.postMessage(response)
	}
}
