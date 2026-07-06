/**
 * Message shapes for the off-thread ingest parse worker.
 *
 * Mirrors the discriminated request/response contract of
 * `src/lib/geo/geoJsonParseWorker.ts` (`ParseRequest`/`ParseResponse`): every
 * worker reply carries the originating `id` plus a `success` flag, so the host
 * client can key pending requests by id and never has an error throw out of the
 * worker `onmessage` handler.
 */

/** The five file kinds the ingest worker can parse off the main thread. */
export type IngestKind = 'csv' | 'xlsx' | 'json' | 'geojson' | 'text'

/**
 * A parse request posted to the worker.
 *
 * - `csv`/`json`/`geojson`/`text` carry their payload in `text`.
 * - `xlsx` carries a (transferable) `ArrayBuffer` in `buffer`.
 */
export interface IngestParseRequest {
	id: string
	kind: IngestKind
	/** UTF-8 source for csv / json / geojson / text. */
	text?: string
	/** Raw bytes for xlsx (pass as a transferable: `postMessage(req, [buffer])`). */
	buffer?: ArrayBuffer
}

/**
 * A parse response posted back from the worker.
 *
 * Tabular kinds (`csv`, `xlsx`) populate `rows` + `schemaFields`. Structured
 * kinds (`json`, `geojson`) populate `data`. `text` populates `data` with line
 * and character metadata. On any failure `success` is `false` and `error`
 * holds the message — `rows`/`data` are omitted.
 */
export interface IngestParseResponse {
	id: string
	success: boolean
	/** Tabular rows (csv / xlsx): one object per data row keyed by column name. */
	rows?: Record<string, unknown>[]
	/** Column names in source order (csv / xlsx). */
	schemaFields?: string[]
	/** Parsed object (json / geojson) or `{ lineCount, charCount, lines }` (text). */
	data?: unknown
	/** Present iff `success === false`. */
	error?: string
}
